import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import { createUnasClient } from './unas.js';
import { createGraphClient } from './graphClient.js';
import { runSyncCheck, readReport, writeReport, clearReport, startScheduler } from './scheduler.js';
import { buildUpdatesFromDiff } from './compare.js';

const UNAS_API_KEY = process.env.UNAS_API_KEY;
if (!UNAS_API_KEY) {
  console.error('Hiányzik az UNAS_API_KEY a .env-ből!');
  process.exit(1);
}

const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID;
const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID;
const ONEDRIVE_HANSA_FOLDER = process.env.ONEDRIVE_HANSA_FOLDER;
if (!AZURE_CLIENT_ID || !AZURE_TENANT_ID || !ONEDRIVE_HANSA_FOLDER) {
  console.error('Hiányzik az AZURE_CLIENT_ID / AZURE_TENANT_ID / ONEDRIVE_HANSA_FOLDER a .env-ből!');
  process.exit(1);
}

const unasClient = createUnasClient({ apiUrl: process.env.UNAS_API_URL, apiKey: UNAS_API_KEY });
const graphClient = createGraphClient({
  clientId: AZURE_CLIENT_ID,
  tenantId: AZURE_TENANT_ID,
  oneDriveFolder: ONEDRIVE_HANSA_FOLDER,
});

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || true }));
app.use(rateLimit({ windowMs: 60_000, max: 60 }));

// --- Napi Hansa <-> UNAS szinkron riport ---

app.get('/api/sync/report', (req, res) => {
  const report = readReport();
  res.json({ ok: true, report });
});

app.post('/api/sync/run-now', async (req, res) => {
  try {
    const report = await runSyncCheck({ graphClient, unasClient });
    res.json({ ok: true, report });
  } catch (err) {
    console.error('[run-now]', err.message || err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.post('/api/sync/approve', async (req, res) => {
  try {
    const report = readReport();
    if (!report || report.status !== 'pending') {
      return res.status(400).json({ ok: false, error: 'Nincs jóváhagyásra váró riport.' });
    }
    const updates = buildUpdatesFromDiff(report.diff);
    if (updates.length === 0) {
      report.status = 'approved';
      report.approvedAt = new Date().toISOString();
      writeReport(report);
      return res.json({ ok: true, updated: 0, note: 'Nem volt eltérés, nincs mit frissíteni.' });
    }
    const result = await unasClient.setStock(updates);
    report.status = 'approved';
    report.approvedAt = new Date().toISOString();
    report.pushResult = { updated: result.updated, batches: result.batches };
    writeReport(report);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[approve]', err.message || err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.post('/api/sync/reject', (req, res) => {
  clearReport();
  res.json({ ok: true });
});

// --- UNAS segéd-végpontok (manuális lekérdezéshez) ---

app.post('/api/unas/get-stock', async (req, res) => {
  try {
    const { skus } = req.body || {};
    if (!Array.isArray(skus) || skus.length === 0) {
      return res.status(400).json({ ok: false, error: 'Adj meg legalább 1 SKU-t a "skus" tömbben.' });
    }
    const data = await unasClient.getStock(skus);
    res.json({ ok: true, count: data.length, data });
  } catch (err) {
    console.error('[get-stock]', err.message || err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.post('/api/unas/stock-sync', async (req, res) => {
  try {
    const { updates, dryRun, limit } = req.body || {};
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ ok: false, error: 'Üres updates lista' });
    }

    let sanitized = updates
      .map(u => ({ sku: String(u.sku || '').trim().toUpperCase(), qty: Number(u.qty) || 0 }))
      .filter(u => !!u.sku);

    const limited = Number.isFinite(limit) && limit > 0 ? sanitized.slice(0, limit) : sanitized;

    if (dryRun) {
      return res.json({ ok: true, dryRun: true, count: limited.length, sample: limited.slice(0, 5) });
    }
    if (limited.length === 0) {
      return res.status(400).json({ ok: false, error: 'Szűrés/limit után nincs frissítendő tétel' });
    }

    const result = await unasClient.setStock(limited);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[stock-sync]', err.message || err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => {
  console.log(`Készlet-ellenőr szerver fut a :${port} porton`);
  startScheduler({ graphClient, unasClient, cronExpression: process.env.SYNC_CRON });
});

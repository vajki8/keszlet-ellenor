import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import { createUnasClient } from './unas.js';
import { createLocalFileClient } from './localFile.js';
import { runSyncCheck, readReport, writeReport, clearReport, startScheduler } from './scheduler.js';
import { buildUpdatesFromDiff } from './compare.js';

const UNAS_API_KEY = process.env.UNAS_API_KEY;
if (!UNAS_API_KEY) {
  console.error('Hiányzik az UNAS_API_KEY a .env-ből!');
  process.exit(1);
}

const LOCAL_HANSA_FOLDER = process.env.LOCAL_HANSA_FOLDER;
if (!LOCAL_HANSA_FOLDER) {
  console.error('Hiányzik a LOCAL_HANSA_FOLDER a .env-ből! (A Teamsben szinkronizált helyi mappa útvonala.)');
  process.exit(1);
}

const unasClient = createUnasClient({ apiUrl: process.env.UNAS_API_URL, apiKey: UNAS_API_KEY });
const fileClient = createLocalFileClient({ folder: LOCAL_HANSA_FOLDER });

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
    const report = await runSyncCheck({ fileClient, unasClient });
    res.json({ ok: true, report });
  } catch (err) {
    console.error('[run-now]', err.message || err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

// Kézi jóváhagyás — csak akkor kell, ha a napi automata futás gyanúsan sok
// eltérés miatt "needs_review" állapotban hagyta a riportot ahelyett, hogy
// automatikusan pusholt volna.
app.post('/api/sync/approve', async (req, res) => {
  try {
    const report = readReport();
    if (!report || report.status !== 'needs_review') {
      return res.status(400).json({ ok: false, error: 'Nincs jóváhagyásra váró riport.' });
    }
    const updates = buildUpdatesFromDiff(report.diff);
    const result = updates.length ? await unasClient.setStock(updates) : { updated: 0, batches: 0 };
    report.status = 'auto_approved';
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
  startScheduler({ fileClient, unasClient, cronExpression: process.env.SYNC_CRON });
});

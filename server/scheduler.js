import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { fileURLToPath } from 'url';
import { parseHansaFile, buildDiff, buildUpdatesFromDiff } from './compare.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = path.join(__dirname, 'data', 'pending-report.json');

// Ha az eltérő tételek aránya az összes összevetett tételhez képest ennél
// magasabb, az gyanúsan sok — valószínűbb, hogy a Hansa export volt hibás
// vagy hiányos, mint hogy tényleg ennyi minden változott. Ilyenkor nem
// pusholunk automatikusan, hanem kézi átnézésre várunk.
const SUSPICIOUS_DIFF_RATIO = 0.3;

export function readReport() {
  if (!fs.existsSync(REPORT_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(REPORT_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

export function writeReport(report) {
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
}

export function clearReport() {
  if (fs.existsSync(REPORT_PATH)) fs.rmSync(REPORT_PATH);
}

export async function runSyncCheck({ fileClient, unasClient }) {
  const file = await fileClient.downloadLatestHansaFile();
  const raktarMap = await parseHansaFile(file.buffer);
  const diff = await buildDiff(raktarMap, unasClient);

  const comparedCount = diff.elteresek.length + diff.egyezok.length;
  const diffRatio = comparedCount > 0 ? diff.elteresek.length / comparedCount : 0;

  const report = {
    createdAt: new Date().toISOString(),
    sourceFile: { name: file.name, modifiedAt: file.modifiedAt },
    diff,
    diffRatio,
  };

  if (diff.elteresek.length === 0) {
    report.status = 'auto_approved';
    report.pushResult = { updated: 0 };
  } else if (diffRatio > SUSPICIOUS_DIFF_RATIO) {
    report.status = 'needs_review';
    report.note = `Gyanúsan magas eltérési arány (${Math.round(diffRatio * 100)}%) — kézi jóváhagyás szükséges.`;
  } else {
    const updates = buildUpdatesFromDiff(diff);
    const result = await unasClient.setStock(updates);
    report.status = 'auto_approved';
    report.approvedAt = new Date().toISOString();
    report.pushResult = { updated: result.updated, batches: result.batches };
  }

  writeReport(report);
  return report;
}

export function startScheduler({ fileClient, unasClient, cronExpression }) {
  const expr = cronExpression || '0 10 * * *'; // minden nap reggel 10:00
  cron.schedule(expr, async () => {
    try {
      console.log('[scheduler] Napi Hansa-UNAS ellenőrzés indul...');
      const report = await runSyncCheck({ fileClient, unasClient });
      console.log(
        `[scheduler] Kész. Állapot: ${report.status}. Eltérés: ${report.diff.elteresek.length}, egyezés: ${report.diff.egyezok.length}, nem található UNAS-ban: ${report.diff.nemTalalhatoUnasban.length}`
      );
    } catch (err) {
      console.error('[scheduler] Hiba a napi ellenőrzés közben:', err.message || err);
    }
  });
  console.log(`[scheduler] Ütemezve: "${expr}" (cron kifejezés)`);
}

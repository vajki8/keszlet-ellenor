import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { fileURLToPath } from 'url';
import { parseHansaFile, buildDiff } from './compare.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = path.join(__dirname, 'data', 'pending-report.json');

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

export async function runSyncCheck({ graphClient, unasClient }) {
  const file = await graphClient.downloadLatestHansaFile();
  const raktarMap = await parseHansaFile(file.buffer);
  const diff = await buildDiff(raktarMap, unasClient);

  const report = {
    status: 'pending',
    createdAt: new Date().toISOString(),
    sourceFile: { name: file.name, modifiedAt: file.modifiedAt },
    diff,
  };
  writeReport(report);
  return report;
}

export function startScheduler({ graphClient, unasClient, cronExpression }) {
  const expr = cronExpression || '0 6 * * 1-5'; // hétköznap reggel 6-kor
  cron.schedule(expr, async () => {
    try {
      console.log('[scheduler] Napi Hansa-UNAS ellenőrzés indul...');
      const report = await runSyncCheck({ graphClient, unasClient });
      console.log(
        `[scheduler] Kész. Eltérés: ${report.diff.elteresek.length}, egyezés: ${report.diff.egyezok.length}, nem található UNAS-ban: ${report.diff.nemTalalhatoUnasban.length}`
      );
    } catch (err) {
      console.error('[scheduler] Hiba a napi ellenőrzés közben:', err.message || err);
    }
  });
  console.log(`[scheduler] Ütemezve: "${expr}" (cron kifejezés)`);
}

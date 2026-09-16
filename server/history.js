import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = path.join(__dirname, 'data', 'history.json');

// Ennyi bejegyzést tartunk meg — nagyjából 2 év napi futásnak felel meg.
const MAX_ENTRIES = 730;

export function readHistory() {
  if (!fs.existsSync(HISTORY_PATH)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function appendHistory(entry) {
  const history = readHistory();
  history.push(entry);
  if (history.length > MAX_ENTRIES) history.splice(0, history.length - MAX_ENTRIES);
  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
  return entry;
}

export function summarizeReportForHistory(report, { trigger }) {
  return {
    at: report.createdAt || new Date().toISOString(),
    trigger, // 'scheduler' | 'manual' | 'approve'
    status: report.status,
    sourceFile: report.sourceFile || null,
    diffRatio: report.diffRatio ?? null,
    elteresekCount: report.diff?.elteresek?.length ?? 0,
    egyezokCount: report.diff?.egyezok?.length ?? 0,
    nemTalalhatoCount: report.diff?.nemTalalhatoUnasban?.length ?? 0,
    updated: report.pushResult?.updated ?? 0,
    note: report.note || null,
    // A ténylegesen megváltozott tételek részletei (mit miről mire állítottunk).
    elteresek: report.diff?.elteresek || [],
  };
}

export function recordError({ trigger, error }) {
  return appendHistory({
    at: new Date().toISOString(),
    trigger,
    status: 'error',
    error: String(error?.message || error),
  });
}

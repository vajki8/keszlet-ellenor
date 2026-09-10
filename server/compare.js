import ExcelJS from 'exceljs';

async function readSheetAsObjects(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];

  const headerRow = sheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? '').trim();
  });

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const key = headers[colNumber];
      if (key) obj[key] = cell.value;
    });
    rows.push(obj);
  });
  return rows;
}

// Hansa export -> Cikk-kód szerint összesített raktárkészlet.
// Ugyanaz a szűrés/összegzés-logika, mint a korábbi kézi raktár-Excel feldolgozásnál:
// csak 600/900 helyszín/szériaszám (vagy üres) sorok számítanak, és ha a "Szabad"
// negatív, a "Készleten" értéket vesszük helyette.
export async function parseHansaFile(buffer) {
  const rows = await readSheetAsObjects(buffer);

  const szurt = rows.filter(row => {
    const h = String(row['Helyszín '] ?? row['Helyszín'] ?? '').trim();
    const s = String(row['Szériaszám'] ?? '').trim();
    return h === '600' || h === '900' || s === '600' || s === '900' || h === '' || s === '';
  });

  const raktarMap = new Map();
  for (const row of szurt) {
    const cs = String(row['Cikk-kód'] ?? '').trim().toUpperCase();
    if (!cs) continue;

    const szabad = Number(row['Szabad'] ?? 0) || 0;
    const keszleten = Number(row['Készleten'] ?? 0) || 0;
    const hasznaltKeszlet = szabad < 0 ? keszleten : szabad;

    if (!raktarMap.has(cs)) {
      raktarMap.set(cs, { nev: row['Megnevezés'] ?? '', keszlet: 0 });
    }
    raktarMap.get(cs).keszlet += hasznaltKeszlet;
  }

  return raktarMap; // Cikk-kód -> { nev, keszlet }
}

// Összeveti a Hansa raktárkészletet az élő UNAS készlettel.
// unasClient.getStock(skus) -> [{ requestedSku, unasSku, qty, matched }]
export async function buildDiff(raktarMap, unasClient) {
  const skus = Array.from(raktarMap.keys());
  const unasResults = skus.length ? await unasClient.getStock(skus) : [];
  const bySku = new Map(unasResults.map(r => [r.requestedSku, r]));

  const elteresek = [];
  const egyezok = [];
  const nemTalalhatoUnasban = [];

  for (const [cs, data] of raktarMap.entries()) {
    const hit = bySku.get(cs);
    const raktarKeszlet = Number(data.keszlet) || 0;

    if (!hit || hit.matched === 'none' || hit.matched === 'error') {
      nemTalalhatoUnasban.push({
        'Cikkszám': cs,
        'Termék név': data.nev,
        'Raktárkészlet': raktarKeszlet,
      });
      continue;
    }

    const rec = {
      'Cikkszám': hit.unasSku || cs,
      'Raktári kód': cs,
      'Termék név': data.nev,
      'Webshop készlet': hit.qty,
      'Raktárkészlet': raktarKeszlet,
      'Egyeztetés': hit.matched,
    };

    if (hit.qty !== raktarKeszlet) elteresek.push(rec);
    else egyezok.push(rec);
  }

  return { elteresek, egyezok, nemTalalhatoUnasban };
}

export function buildUpdatesFromDiff(diff) {
  return diff.elteresek.map(r => ({
    sku: String(r['Cikkszám'] || '').trim().toUpperCase(),
    qty: Number(r['Raktárkészlet'] || 0) || 0,
  })).filter(u => u.sku);
}

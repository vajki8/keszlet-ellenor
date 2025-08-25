import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import rateLimit from 'express-rate-limit';
import { XMLParser } from 'fast-xml-parser';
import http from 'http';
import https from 'https';

const keepAliveHttp = new http.Agent({ keepAlive: true, maxSockets: 50, keepAliveMsecs: 30_000 });
const keepAliveHttps = new https.Agent({ keepAlive: true, maxSockets: 50, keepAliveMsecs: 30_000 });

const ax = axios.create({
  httpAgent: keepAliveHttp,
  httpsAgent: keepAliveHttps,
  timeout: 20000,
  headers: { 'User-Agent': 'Agrolanc-StockSync/1.0' },
  validateStatus: () => true
});


const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || true })); // fejlesztéshez oké
app.use(rateLimit({ windowMs: 60_000, max: 60 })); // 60 kérés/perc

const UNAS_API = (process.env.UNAS_API_URL || 'https://api.unas.eu/shop').trim();
const UNAS_API_KEY = process.env.UNAS_API_KEY;
if (!UNAS_API_KEY) {
  console.error('Hiányzik az UNAS_API_KEY a .env-ből!');
  process.exit(1);
}

const parser = new XMLParser({ ignoreAttributes: false });
let tokenCache = { token: null, exp: 0 };

// ---- segédek ----
function xmlEscape(s = '') {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// szám konvertálás XML-objektumokra is (#text/@_value)
function toNum(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') return Number(v.replace(',', '.')) || 0;
  if (typeof v === 'object') {
    if ('#text' in v) return toNum(v['#text']);
    if ('@_value' in v) return toNum(v['@_value']);
    if ('value' in v) return toNum(v.value);
    if ('@_qty' in v) return toNum(v['@_qty']);
  }
  return 0;
}
const KEY = s => String(s || '').toLowerCase();

// rekurzívan összead minden qty/quantity/available/stock jellegű mezőt
function sumQtyKeys(obj) {
  if (!obj || typeof obj !== 'object') return 0;
  let total = 0;
  for (const [k, v] of Object.entries(obj)) {
    const kl = KEY(k);
    if (
      kl.includes('qty') ||
      kl.includes('quantity') ||
      kl.includes('available') ||
      kl === 'stock' || kl === 'stocks' ||
      kl === 'onhand' || kl === 'stockqty'
    ) {
      total += toNum(v);
      if (v && typeof v === 'object') total += sumQtyKeys(v);
    } else if (v && typeof v === 'object') {
      total += sumQtyKeys(v);
    }
  }
  return total;
}

// Teljes készlet kinyerés: Stocks + Variants ágakról is
function extractQty(product) {
  if (!product || typeof product !== 'object') return 0;

  // 1) Stocks
  const stocks = product.Stocks || product.stocks || null;
  if (stocks) {
    const node = stocks.Stock ?? stocks.stock ?? stocks;
    const arr = Array.isArray(node) ? node : [node];
    const sum = arr.reduce((acc, n) => acc + sumQtyKeys(n), 0);
    if (sum !== 0) return sum; // lehet negatív is
  }

  // 2) Variants
  const variants = product.Variants || product.variants || null;
  if (variants) {
    const vNode = variants.Variant ?? variants.variant ?? variants;
    const vArr = Array.isArray(vNode) ? vNode : [vNode];
    const sum = vArr.reduce((acc, v) => {
      const vs = v?.Stocks || v?.stocks || null;
      if (vs) {
        const sn = vs.Stock ?? vs.stock ?? vs;
        const sArr = Array.isArray(sn) ? sn : [sn];
        return acc + sArr.reduce((a, s) => a + sumQtyKeys(s), 0);
      }
      return acc + sumQtyKeys(v);
    }, 0);
    if (sum !== 0) return sum;
  }

  // 3) bárhol a product alatt
  return sumQtyKeys(product);
}

// ---- UNAS login + token cache ----
async function unasLogin() {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.exp - 120000) return tokenCache.token;

  const xmlReq =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Params><ApiKey>${xmlEscape(UNAS_API_KEY)}</ApiKey><WebshopInfo>false</WebshopInfo></Params>`;

  const resp = await ax.post(`${UNAS_API}/login`, xmlReq, {
    headers: {
      'Content-Type': 'application/xml',
      'Accept': 'application/xml',
      'User-Agent': 'Agrolanc-StockSync/1.0'
    },
    timeout: 20000,
    validateStatus: () => true
  });

  const raw = typeof resp.data === 'string' ? resp.data : String(resp.data || '');
  const j = parser.parse(raw || '<Empty/>');

  const token =
    j?.Login?.Token ||
    j?.Response?.Token ||
    j?.Token || null;

  const expireStr =
    j?.Login?.Expire ||
    j?.Response?.Expire ||
    j?.Expire || null;

  if (!token) {
    console.error('[UNAS login] Nincs Token a válaszban. XML head:', raw.slice(0, 200));
    throw new Error(`UNAS login hiba (status ${resp.status})`);
  }

  tokenCache.token = token;
  tokenCache.exp = expireStr ? Date.parse(expireStr) : Date.now() + 2 * 60 * 60 * 1000;
  return token;
}

// ---- DEBUG endpointok ----
app.get('/api/unas/debug-login', async (req, res) => {
  try {
    const xmlReq =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Params><ApiKey>${xmlEscape(UNAS_API_KEY)}</ApiKey><WebshopInfo>false</WebshopInfo></Params>`;

    const resp = await ax.post(`${UNAS_API}/login`, xmlReq, {
      headers: {
        'Content-Type': 'application/xml',
        'Accept': 'application/xml',
        'User-Agent': 'Agrolanc-StockSync/1.0'
      },
      timeout: 20000,
      validateStatus: () => true
    });

    const raw = typeof resp.data === 'string' ? resp.data : String(resp.data || '');
    let parsed = {};
    try { parsed = parser.parse(raw || '<Empty/>'); } catch { parsed = { parseError: true }; }

    res.json({
      status: resp.status,
      content_type: resp.headers?.['content-type'] || null,
      url: `${UNAS_API}/login`,
      body_head: raw.slice(0, 500),
      parsed_keys: Object.keys(parsed || {}),
      parsed_sample: JSON.stringify(parsed).slice(0, 500)
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// /getStock debug 1 SKU-ra
app.get('/api/unas/debug-stock', async (req, res) => {
  try {
    const sku = String(req.query.sku || '').trim();
    if (!sku) return res.status(400).json({ ok: false, error: 'Adj meg ?sku=... paramétert' });

    const token = await unasLogin();

    const resp = await axios.get(`${UNAS_API}/getStock`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/xml',
        'User-Agent': 'Agrolanc-StockSync/1.0'
      },
      params: { Sku: sku }, // több SKU: "A1,A2,A3"
      timeout: 20000,
      validateStatus: () => true
    });

    const raw = typeof resp.data === 'string' ? resp.data : String(resp.data || '');
    const parsed = (() => { try { return parser.parse(raw || '<Empty/>'); } catch { return {}; } })();

    let arr = parsed?.StockResult?.Product || [];
    if (!Array.isArray(arr)) arr = arr ? [arr] : [];
    const p = arr[0] || null;

    res.json({
      ok: true,
      status: resp.status,
      found: !!p,
      skuEcho: sku,
      skuFromApi: p?.Sku ?? null,
      qty: Number(p?.Qty ?? p?.Quantity ?? 0) || 0,
      xmlHead: raw.slice(0, 300),
      parsedHead: JSON.stringify(parsed).slice(0, 1200)
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});



app.get('/api/unas/debug-product', async (req, res) => {
  try {
    const sku = String(req.query.sku || '').trim();
    if (!sku) return res.status(400).json({ ok: false, error: 'Adj meg ?sku=... paramétert' });

    const token = await unasLogin();
    const xmlReq =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Params>` +
        `<Fields><Field>Sku</Field><Field>Stocks</Field><Field>Variants</Field></Fields>` +
        `<Filters>` +
          `<Filter><Field>Sku</Field><Operator>equals</Operator><Value>${xmlEscape(sku)}</Value></Filter>` +
        `</Filters>` +
        `<Limit>1</Limit>` +
      `</Params>`;

    const resp = await axios.post(`${UNAS_API}/getProducts`, xmlReq, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/xml',
        'Accept': 'application/xml',
        'User-Agent': 'Agrolanc-StockSync/1.0'
      },
      timeout: 20000, validateStatus: () => true
    });

    const raw = typeof resp.data === 'string' ? resp.data : String(resp.data || '');
    let parsed = {};
    try { parsed = parser.parse(raw || '<Empty/>'); } catch (e) { parsed = { parseError: String(e?.message || e) }; }

    let arr = parsed?.Products?.Product || [];
    if (!Array.isArray(arr)) arr = arr ? [arr] : [];
    const p = arr[0] || null;

    res.json({
      ok: true,
      status: resp.status,
      found: !!p,
      skuEcho: sku,
      skuFromApi: p?.Sku ?? null,
      extractedQty: p ? extractQty(p) : null,
      xmlHead: raw.slice(0, 500),
      parsedHead: JSON.stringify(parsed).slice(0, 1500)
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});


// ---- készlet írás (/setStock) ----
async function unasSetStockBatch(items, bearer) {
  // items: [{ sku, qty }]
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Products>` +
      items.map(it =>
        `<Product>` +
          `<Action>modify</Action>` +
          `<Sku>${xmlEscape(it.sku)}</Sku>` +
          `<Stocks><Stock><Qty>${Number(it.qty) || 0}</Qty></Stock></Stocks>` +
        `</Product>`
      ).join('') +
    `</Products>`;

  const { data } = await ax.post(`${UNAS_API}/setStock`, body, {
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/xml' },
    timeout: 30000, validateStatus: () => true
  });

  return parser.parse(data || '<Empty/>');
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

app.post('/api/unas/stock-sync', async (req, res) => {
  try {
    const { updates, dryRun, filterSkus, limit } = req.body || {};
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ ok: false, error: 'Üres updates lista' });
    }

    // szanálás
    let sanitized = updates
      .map(u => ({ sku: String(u.sku || '').trim().toUpperCase(), qty: Number(u.qty) || 0 }))
      .filter(u => !!u.sku);

    // SKU-szűrés (ha van)
    if (Array.isArray(filterSkus) && filterSkus.length > 0) {
      const set = new Set(filterSkus.map(s => String(s).trim().toUpperCase()));
      sanitized = sanitized.filter(u => set.has(u.sku));
    }

    // limit (ha van)
    const limited = Number.isFinite(limit) && limit > 0 ? sanitized.slice(0, limit) : sanitized;

    if (dryRun) {
      return res.json({
        ok: true,
        dryRun: true,
        count: limited.length,
        sample: limited.slice(0, 5),
        note: limited.length !== sanitized.length ? 'Megjegyzés: filter/limit érvényesült.' : undefined
      });
    }

    if (limited.length === 0) {
      return res.status(400).json({ ok: false, error: 'Szűrés/limit után nincs frissítendő tétel' });
    }

    const token = await unasLogin();
    const batches = chunk(limited, 100);
    const results = [];
    for (const b of batches) {
      const r = await unasSetStockBatch(b, token);
      results.push(r);
    }
    res.json({ ok: true, updated: limited.length, batches: batches.length, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});
// SKU -> { requestedSku, unasSku, qty, matched } — szigorú SKU=equals filterrel
async function unasGetStock(items, bearer) {
  const limit = 8;
  const queue = [...items];
  let running = 0;

  const norm = s => String(s || '').trim();

  async function viaGetProductsExact(requestedSku) {
    const sku = norm(requestedSku);
    const xmlReq =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Params>` +
        `<Fields><Field>Sku</Field><Field>Stocks</Field><Field>Variants</Field></Fields>` +
        `<Filters>` +
          `<Filter><Field>Sku</Field><Operator>equals</Operator><Value>${xmlEscape(sku)}</Value></Filter>` +
        `</Filters>` +
        `<Limit>1</Limit>` +
      `</Params>`;

    const resp = await axios.post(`${UNAS_API}/getProducts`, xmlReq, {
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/xml',
        'Accept': 'application/xml',
        'User-Agent': 'Agrolanc-StockSync/1.0'
      },
      timeout: 20000, validateStatus: () => true
    });

    const raw = typeof resp.data === 'string' ? resp.data : String(resp.data || '');
    let j = {};
    try { j = parser.parse(raw || '<Empty/>'); } catch { j = {}; }

    let arr = j?.Products?.Product || [];
    if (!Array.isArray(arr)) arr = arr ? [arr] : [];

    if (arr.length === 0) {
      return { requestedSku: sku, unasSku: null, qty: 0, matched: 'none' };
    }

    const p = arr[0];
    const unasSku = String(p?.Sku || sku).trim();
    const qty = Number(extractQty(p)) || 0;

    return {
      requestedSku: sku,
      unasSku,
      qty,
      matched: (unasSku.toUpperCase() === sku.toUpperCase()) ? 'exact' : 'fuzzy'
    };
  }

  return await new Promise(resolve => {
    const results = [];
    const kick = () => {
      while (running < limit && queue.length) {
        const it = queue.shift();
        running++;
        viaGetProductsExact(it.sku)
          .then(r => results.push(r))
          .catch(() => results.push({ requestedSku: norm(it.sku), unasSku: null, qty: 0, matched: 'error' }))
          .finally(() => {
            running--;
            if (!queue.length && running === 0) {
              const map = new Map(results.map(r => [r.requestedSku, r]));
              resolve(items.map(i => map.get(norm(i.sku)) || { requestedSku: norm(i.sku), unasSku: null, qty: 0, matched: 'none' }));
            } else {
              kick();
            }
          });
      }
    };
    kick();
  });
}

// REST: több SKU készlete (UNAS-SKU visszaadása is)
app.post('/api/unas/get-stock', async (req, res) => {
  try {
    const { skus } = req.body || {};
    if (!Array.isArray(skus) || skus.length === 0) {
      return res.status(400).json({ ok: false, error: 'Adj meg legalább 1 SKU-t a "skus" tömbben.' });
    }

    const token = await unasLogin();

    // batcheljük 100-asával, majd összefűzzük
    const chunks = [];
    for (let i = 0; i < skus.length; i += 100) chunks.push(skus.slice(i, i + 100));

    const collected = [];
    for (const c of chunks) {
      const items = c.map(s => ({ sku: s }));
      const part = await unasGetStock(items, token); // -> { requestedSku, unasSku, qty, matched }
      collected.push(...part);
    }

    // válasz normalizálása: mindig legyen benne a kért és az UNAS SKU is
    const data = collected.map(r => ({
      requestedSku: r.requestedSku,
      sku: r.unasSku || r.requestedSku,  // ezzel tudsz az UNAS tényleges SKU-jára írni
      qty: r.qty,
      matched: r.matched                 // 'exact' | 'fuzzy' | 'none' | 'error'
    }));

    return res.json({ ok: true, count: data.length, data });
  } catch (e) {
    console.error('[get-stock]', e?.message || e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});




// ---- szerver indul ----
const port = Number(process.env.PORT || 8080);
app.listen(port, () => {
  console.log(`UNAS proxy fut a :${port} porton`);
});


// ====== DEBUG: TELJES getProduct válasz (szeletelhető) ======
app.get('/api/unas/debug-product-full', async (req, res) => {
  try {
    const sku = String(req.query.sku || '').trim();
    const max = Number(req.query.max || 0); // 0 = teljes
    if (!sku) return res.status(400).json({ ok: false, error: 'Adj meg ?sku=... paramétert' });

    const token = await unasLogin();
    const body =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Products><Product><Sku>${xmlEscape(sku)}</Sku></Product></Products>`;

    const resp = await axios.post(`${UNAS_API}/getProduct`, body, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/xml', 'Accept': 'application/xml' },
      timeout: 20000, validateStatus: () => true
    });

    const raw = typeof resp.data === 'string' ? resp.data : String(resp.data || '');
    let parsed = {};
    try { parsed = parser.parse(raw || '<Empty/>'); } catch (e) { parsed = { parseError: String(e?.message || e) }; }

    const rawOut = max > 0 ? raw.slice(0, max) : raw;
    // vigyázat: nagyon nagy lehet — ezért adjunk egy max opciót
    const parsedOut = max > 0 ? JSON.parse(JSON.stringify(parsed)) : parsed;

    res.json({
      ok: true,
      status: resp.status,
      skuEcho: sku,
      rawLen: raw.length,
      raw: rawOut,
      parsed: parsedOut
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// ====== DEBUG: hol vannak a "qty" jellegű számok? ======
function _isQtyishKey(k) {
  const kl = String(k || '').toLowerCase();
  if (kl.includes('minimum')) return false; // MinimumQty kizárva
  return (
    kl === 'qty' || kl === 'quantity' || kl === 'stockqty' ||
    kl === 'available' || kl === 'onhand' || kl === 'stock' ||
    kl.includes('qty') || kl.includes('quantity') || kl.includes('available') || kl.includes('onhand')
  );
}
function _toNumLoose(v) {
  if (v == null) return NaN;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  }
  if (typeof v === 'object') {
    if ('#text' in v) return _toNumLoose(v['#text']);
    if ('@_value' in v) return _toNumLoose(v['@_value']);
  }
  return NaN;
}
function _scanQtyPaths(obj, path = [], out = []) {
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    const pth = path.concat(k);
    if (v && typeof v === 'object') {
      _scanQtyPaths(v, pth, out);
    } else {
      if (_isQtyishKey(k)) {
        const n = _toNumLoose(v);
        if (Number.isFinite(n)) out.push({ path: pth.join('.'), key: k, value: n });
      }
    }
  }
  return out;
}

app.get('/api/unas/debug-qtypaths', async (req, res) => {
  try {
    const sku = String(req.query.sku || '').trim();
    if (!sku) return res.status(400).json({ ok: false, error: 'Adj meg ?sku=... paramétert' });

    const token = await unasLogin();
    const body =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Products><Product><Sku>${xmlEscape(sku)}</Sku></Product></Products>`;

    const resp = await axios.post(`${UNAS_API}/getProduct`, body, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/xml', 'Accept': 'application/xml' },
      timeout: 20000, validateStatus: () => true
    });

    const raw = typeof resp.data === 'string' ? resp.data : String(resp.data || '');
    let parsed = {};
    try { parsed = parser.parse(raw || '<Empty/>'); } catch (e) { parsed = { parseError: String(e?.message || e) }; }

    // Vegyük az első Product-ot
    let arr = parsed?.Products?.Product || [];
    if (!Array.isArray(arr)) arr = arr ? [arr] : [];
    const p = arr[0] || {};

    const qtyPaths = _scanQtyPaths(p).sort((a, b) => b.value - a.value); // érték szerint csökkenő
    res.json({
      ok: true,
      status: resp.status,
      skuEcho: sku,
      skuFromApi: p?.Sku ?? null,
      topQtyPaths: qtyPaths.slice(0, 50),  // első 50 elég áttekintéshez
      totalQtyPaths: qtyPaths.length,
      hintStocks: p?.Stocks ?? null,
      hintVariants: p?.Variants ?? null
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

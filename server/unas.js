import axios from 'axios';
import http from 'http';
import https from 'https';
import { XMLParser } from 'fast-xml-parser';

const keepAliveHttp = new http.Agent({ keepAlive: true, maxSockets: 50, keepAliveMsecs: 30_000 });
const keepAliveHttps = new https.Agent({ keepAlive: true, maxSockets: 50, keepAliveMsecs: 30_000 });

const ax = axios.create({
  httpAgent: keepAliveHttp,
  httpsAgent: keepAliveHttps,
  timeout: 20000,
  headers: { 'User-Agent': 'Agrolanc-StockSync/1.0' },
  validateStatus: () => true,
});

const parser = new XMLParser({ ignoreAttributes: false });

function xmlEscape(s = '') {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

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

function sumQtyKeys(obj) {
  if (!obj || typeof obj !== 'object') return 0;
  let total = 0;
  for (const [k, v] of Object.entries(obj)) {
    const kl = KEY(k);
    if (
      kl.includes('qty') || kl.includes('quantity') || kl.includes('available') ||
      kl === 'stock' || kl === 'stocks' || kl === 'onhand' || kl === 'stockqty'
    ) {
      total += toNum(v);
      if (v && typeof v === 'object') total += sumQtyKeys(v);
    } else if (v && typeof v === 'object') {
      total += sumQtyKeys(v);
    }
  }
  return total;
}

function extractQty(product) {
  if (!product || typeof product !== 'object') return 0;

  const stocks = product.Stocks || product.stocks || null;
  if (stocks) {
    const node = stocks.Stock ?? stocks.stock ?? stocks;
    const arr = Array.isArray(node) ? node : [node];
    const sum = arr.reduce((acc, n) => acc + sumQtyKeys(n), 0);
    if (sum !== 0) return sum;
  }

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

  return sumQtyKeys(product);
}

export function createUnasClient({ apiUrl, apiKey }) {
  const UNAS_API = (apiUrl || 'https://api.unas.eu/shop').trim();
  let tokenCache = { token: null, exp: 0 };

  async function login() {
    const now = Date.now();
    if (tokenCache.token && now < tokenCache.exp - 120000) return tokenCache.token;

    const xmlReq =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Params><ApiKey>${xmlEscape(apiKey)}</ApiKey><WebshopInfo>false</WebshopInfo></Params>`;

    const resp = await ax.post(`${UNAS_API}/login`, xmlReq, {
      headers: { 'Content-Type': 'application/xml', 'Accept': 'application/xml' },
    });

    const raw = typeof resp.data === 'string' ? resp.data : String(resp.data || '');
    const j = parser.parse(raw || '<Empty/>');

    const token = j?.Login?.Token || j?.Response?.Token || j?.Token || null;
    const expireStr = j?.Login?.Expire || j?.Response?.Expire || j?.Expire || null;

    if (!token) {
      throw new Error(`UNAS login hiba (status ${resp.status}): ${raw.slice(0, 200)}`);
    }

    tokenCache.token = token;
    tokenCache.exp = expireStr ? Date.parse(expireStr) : Date.now() + 2 * 60 * 60 * 1000;
    return token;
  }

  // SKU -> { requestedSku, unasSku, qty, matched } — a dedikált getStock végponton,
  // vesszővel elválasztott Sku listával (max ~100 cikkszám/hívás, lásd UNAS API limit).
  async function getStock(skus) {
    const token = await login();
    const norm = s => String(s || '').trim();

    async function fetchBatch(batchSkus) {
      const skuList = batchSkus.map(norm).map(xmlEscape).join(',');
      const xmlReq =
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<Params><Sku>${skuList}</Sku></Params>`;

      const resp = await ax.post(`${UNAS_API}/getStock`, xmlReq, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/xml', 'Accept': 'application/xml' },
      });

      const raw = typeof resp.data === 'string' ? resp.data : String(resp.data || '');
      let j = {};
      try { j = parser.parse(raw || '<Empty/>'); } catch { j = {}; }

      let arr = j?.Products?.Product || [];
      if (!Array.isArray(arr)) arr = arr ? [arr] : [];

      const bySku = new Map();
      for (const p of arr) {
        const unasSku = String(p?.Sku || '').trim();
        if (!unasSku) continue;
        bySku.set(unasSku.toUpperCase(), { unasSku, qty: Number(extractQty(p)) || 0 });
      }
      return bySku;
    }

    const chunks = chunk(skus.map(norm), 100);
    const merged = new Map();
    for (const batch of chunks) {
      try {
        const bySku = await fetchBatch(batch);
        for (const [k, v] of bySku.entries()) merged.set(k, v);
      } catch {
        // A batch hibája esetén az érintett cikkszámok "none"-ként térnek vissza lent.
      }
    }

    return skus.map(s => {
      const sku = norm(s);
      const hit = merged.get(sku.toUpperCase());
      if (!hit) return { requestedSku: sku, unasSku: null, qty: 0, matched: 'none' };
      return {
        requestedSku: sku,
        unasSku: hit.unasSku,
        qty: hit.qty,
        matched: hit.unasSku.toUpperCase() === sku.toUpperCase() ? 'exact' : 'fuzzy',
      };
    });
  }

  function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  async function setStockBatch(items) {
    const token = await login();
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
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/xml' },
      timeout: 30000,
    });

    return parser.parse(data || '<Empty/>');
  }

  async function setStock(updates) {
    const batches = chunk(updates, 100);
    const results = [];
    for (const b of batches) results.push(await setStockBatch(b));
    return { updated: updates.length, batches: batches.length, results };
  }

  return { login, getStock, setStock, extractQty };
}

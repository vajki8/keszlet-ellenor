// cSpell:disable
import React, { useState, useCallback, useEffect } from "react";
import * as XLSX from "xlsx";
import HirlevelSzinkron from "./HirlevelSzinkron";

function App() {
  // --- Választott nézet state ---
  const [view, setView] = useState("keszlet"); // "keszlet" vagy "hirlevel"

  // --- Készlet-ellenőrző state-ek ---
  const [raktarFile, setRaktarFile] = useState(null);
  const [webshopFile, setWebshopFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [summary, setSummary] = useState(null);
  const [filterText, setFilterText] = useState("");
  const [filterField, setFilterField] = useState("Cikkszám");
  const [showMatches, setShowMatches] = useState(false);
  const [dryRun, setDryRun] = useState(true);
const [maxItems, setMaxItems] = useState(1);
const [busy, setBusy] = useState(false);
const [lastResponse, setLastResponse] = useState(null);
const [unasLoading, setUnasLoading] = useState(false);
const [unasError, setUnasError] = useState("");

function buildUpdatesFromSummary(sum) {
  if (!sum) return [];

  const updates = [];

  // Eltérés: írd az UNAS-SKU-ra a raktárkészletet
  (sum.elteresek || []).forEach(r => {
    updates.push({ sku: String(r["Cikkszám"] || "").trim().toUpperCase(), qty: Number(r["Raktárkészlet"] || 0) || 0 });
  });

  // Egyező: nem kell frissíteni — kihagyjuk

  // Csak webshopban: lenullázás (UNAS-SKU ismerős)
  (sum.csakWebshopban || []).forEach(r => {
    updates.push({ sku: String(r["Cikkszám"] || "").trim().toUpperCase(), qty: 0 });
  });

  // Csak raktárban: ezekre nincs UNAS termék — HA MÉGIS küldeni akarod:
  // updates.push({ sku: String(r["Cikk-kód"]||"").trim().toUpperCase(), qty: Number(r["Szabad készlet"]||0)||0 });
  // de jellemzően kihagyjuk, mert nincs ilyen SKU az UNAS-ban

  // duplikált SKU-k konszolidálása
  const map = new Map();
  for (const u of updates) {
    if (!u.sku) continue;
    map.set(u.sku, u.qty);
  }
  return Array.from(map.entries()).map(([sku, qty]) => ({ sku, qty }));
}


async function callUnas({ updates, dryRun, limit }) {
  const resp = await fetch("http://localhost:8080/api/unas/stock-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updates, dryRun, limit })
  });
  const data = await resp.json();
  if (!resp.ok || !data.ok) throw new Error(data?.error || resp.statusText);
  return data;
}

// ÖSSZES UNAS KÉSZLET LEKÉRÉSE (paginálás-agnosztikus)
// UNAS get-stock – új formátumot várunk; ha nem azt kapjuk VAGY minden 0,
// fallback: /api/unas/debug-product SKU-nként, pool=10
async function fetchUnasStock(skus) {
  const API = "http://localhost:8080";

  const baseResp = await fetch(`${API}/api/unas/get-stock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skus })
  });
  const baseData = await baseResp.json().catch(() => ({}));

  // ha rendben jött az új forma, adjuk vissza
  if (baseResp.ok && baseData?.ok && Array.isArray(baseData.data)) {
    const hasNewShape = baseData.data.some(x => "requestedSku" in x && "matched" in x);
    const anyQty = baseData.data.some(x => Number(x?.qty || 0) !== 0);
    if (hasNewShape && baseData.data.length) return baseData.data;
    // ha régi forma vagy minden 0 → menjünk fallbackra
  }

  // --- FALLBACK: per-SKU /debug-product, párhuzamosítva ---
  const pool = 10;
  const inSkus = skus.map(s => String(s || "").trim()).filter(Boolean);
  const out = [];
  let idx = 0;

  async function runOne(requestedSku) {
    const url = `${API}/api/unas/debug-product?sku=${encodeURIComponent(requestedSku)}`;
    const r = await fetch(url);
    const d = await r.json().catch(() => ({}));
    // elvárt: { found, skuFromApi, extractedQty }
    if (d?.ok && d?.found) {
      out.push({
        requestedSku,
        sku: String(d.skuFromApi || requestedSku).trim(),
        qty: Number(d.extractedQty || 0) || 0,
        matched: (String(d.skuFromApi || "").trim().toUpperCase() === requestedSku.toUpperCase())
          ? "exact" : "fuzzy"
      });
    } else {
      out.push({ requestedSku, sku: requestedSku, qty: 0, matched: "none" });
    }
  }

  const workers = Array.from({ length: pool }, async () => {
    while (idx < inSkus.length) {
      const cur = inSkus[idx++];
      try { await runOne(cur); } catch { out.push({ requestedSku: cur, sku: cur, qty: 0, matched: "error" }); }
    }
  });
  await Promise.all(workers);
  return out;
}



// UNAS get-stock hívó (backend: POST /api/unas/get-stock)
async function fetchUnasStock(skus) {
  const resp = await fetch("http://localhost:8080/api/unas/get-stock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skus }),
  });
  let data;
  try {
    data = await resp.json();
  } catch {
    console.error("[UNAS][get-stock] invalid JSON response");
    throw new Error("UNAS get-stock: érvénytelen JSON válasz");
  }

  console.log("[UNAS][get-stock] reqCount:", (skus||[]).length, "status:", resp.status, "resp:", data);

  if (!resp.ok) throw new Error(data?.error || resp.statusText || "get-stock HTTP hiba");
  if (!data?.ok) throw new Error(data?.error || "get-stock API hiba (ok=false)");
  if (!Array.isArray(data.data)) throw new Error("get-stock: 'data' nem tömb");

  // <-- NINCS THROW üresnél, csak visszaadjuk az üreset
  return data.data; // [{ sku, qty }] vagy []
}




async function pushUpdates({ isDryRun }) {
  if (!summary) return;
  setBusy(true); setLastResponse(null);
  try {
    const updates = buildUpdatesFromSummary(summary);
    const res = await callUnas({
      updates,
      dryRun: isDryRun,
      limit: Number(maxItems) || undefined
    });
    setLastResponse(res);
    if (!isDryRun) {
      alert(`Kész: ${res.updated} tétel frissítve (${res.batches} batch).`);
    }
  } catch (e) {
    alert("Hiba: " + e.message);
  } finally {
    setBusy(false);
  }
}

  // --- Fájl feltöltés és összehasonlítás logika ---
  const handleFileUpload = file => {
    if (!file.name.endsWith(".xlsx")) return;
    const lowered = file.name.toLowerCase();
    if (lowered.includes("raktar")) setRaktarFile(file);
    else if (lowered.includes("webshop") || lowered.includes("unasshop"))
      setWebshopFile(file);
  };
  const handleDrop = useCallback(
    e => {
      e.preventDefault();
      setDragOver(false);
      Array.from(e.dataTransfer.files).forEach(handleFileUpload);
    },
    []
  );
  function readExcel(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: "array" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(worksheet);
        resolve(json);
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }
 useEffect(() => {
  if (raktarFile) {
    handleCompare();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [raktarFile]);

async function importWebshopFromUnas() {
  if (!summary) { alert("Először tölts be egy raktár Excel fájlt."); return; }

  try {
    // raktári kódok, ahogy a summary-ben vannak
    const raktarSkuk = (summary.cikkszamDarabszamok || [])
      .map(r => String(r["Cikkszám"] ?? "").trim())
      .filter(Boolean);

    if (raktarSkuk.length === 0) {
      alert("Nincs raktári cikkszám a listában (summary.cikkszamDarabszamok üres).");
      return;
    }

    setUnasLoading(true);
    setUnasError("");

    // BACKEND: { requestedSku, sku (UNAS), qty, matched }
    const unasList = await fetchUnasStock(raktarSkuk);
    // map: requestedSku -> { unasSku, qty, matched }
    const respMap = new Map(
      (unasList || []).map(x => [
        String(x.requestedSku || "").trim().toUpperCase(),
        { unasSku: String(x.sku || "").trim(), qty: Number(x.qty || 0), matched: x.matched || "none" }
      ])
    );

    // raktár összesítés
    const raktarMap = buildRaktarMapFromSummary(summary); // cikkszám (raktári) -> { nev, keszlet }

    const elteresek = [];
    const egyezok = [];
    const csakWebshopban = []; // itt most nem lesz extra, mert csak raktári kódokra kérdeztünk

    for (const [raktariKod, r] of raktarMap.entries()) {
      const key = String(raktariKod).toUpperCase();
      const hit = respMap.get(key);

      const unasSku = hit?.unasSku || raktariKod;  // ha fuzzy volt, ez az UNAS SKU
      const webshopKeszlet = hit ? hit.qty : 0;    // UNAS qty
      const raktarKeszlet = Number(r?.keszlet || 0);

      const sor = {
        "Cikkszám": unasSku,              // <- ETTŐL KEZDVE UNAS-SKU!
        "Raktári kód": raktariKod,        // megjelenítéshez
        "Termék név": r?.nev || "",
        "Webshop készlet": webshopKeszlet,
        "Raktárkészlet": raktarKeszlet,
        "Match": hit?.matched || "none"   // "exact" | "fuzzy" | "none"
      };

      if (webshopKeszlet !== raktarKeszlet) elteresek.push(sor);
      else egyezok.push(sor);
    }

    setSummary(s => ({ 
      ...s, 
      elteresek, 
      egyezok, 
      csakWebshopban,               // marad, ha később all:true/összes UNAS készlet is jön
    }));

    alert(`UNAS → Webshop táblák frissítve. Eltérések: ${elteresek.length}, Egyezők: ${egyezok.length}.`);
  } catch (e) {
    console.error(e);
    setUnasError(e.message || "Ismeretlen hiba");
    alert("Hiba: " + (e.message || e));
  } finally {
    setUnasLoading(false);
  }
}


async function handleFetchUnas() {
  if (busy) return;
  setBusy(true);
  try {
    const skus = raktarLista.map(r => r.cikkszam).filter(Boolean);
    const chunkSize = 1000; // UI-nak kevesebb kör, backend úgyis 100-asával batchel
    setProgress({ done: 0, total: skus.length });

    const out = [];
    for (let i = 0; i < skus.length; i += chunkSize) {
      const slice = skus.slice(i, i + chunkSize);
      const resp = await fetch('/api/unas/get-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skus: slice })
      }).then(r => r.json());

      out.push(...(resp?.data || []));
      setProgress(p => ({ done: Math.min(p.total, p.done + slice.length), total: p.total }));
      await new Promise(r => setTimeout(r, 50)); // kis szusszanás a főszálon (UI simább)
    }

    // !!! INNENTŐL az UNAS-értéket használd:
    // data: { requestedSku, sku (UNAS), qty, matched }
    // építsd az Eltérés/Egyező táblákat a 'sku' mezőre
    setUnasAdatok(out);
  } finally {
    setBusy(false);
  }
}

async function handleCompare() {
  // 1) Excel beolvasás
  let raktarData = await readExcel(raktarFile);
  const hasWebshop = !!webshopFile;
  const webshopData = hasWebshop ? await readExcel(webshopFile) : [];

  // 2) Csak 600/900 (vagy üres helyszín/szériaszám) sorok
  raktarData = raktarData.filter(row => {
    const helyszin = String(row["Helyszín "] ?? "").trim();
    const szeriaszam = String(row["Szériaszám"] ?? "").trim();
    return (
      helyszin === "600" || helyszin === "900" ||
      szeriaszam === "600" || szeriaszam === "900" ||
      helyszin === "" || szeriaszam === ""
    );
  });

  // 3) Cikkszám szerinti összesítés (Szabad < 0 esetén Készleten)
  const raktarMap = {};
  const raktarCikkszamok = new Set();
  for (const row of raktarData) {
    const cikkszam = String(row["Cikk-kód"] ?? "").toUpperCase();
    if (!cikkszam) continue;
    const szabad = Number(row["Szabad"] ?? 0);
    const keszleten = Number(row["Készleten"] ?? 0);
    const nev = row["Megnevezés"];
    const hasznaltKeszlet = szabad < 0 ? keszleten : szabad;

    if (!raktarMap[cikkszam]) raktarMap[cikkszam] = { nev, keszlet: 0 };
    raktarMap[cikkszam].keszlet += hasznaltKeszlet;
    raktarCikkszamok.add(cikkszam);
  }

  // 4) Összesített lista
  const cikkszamDarabszamok = Array.from(raktarCikkszamok).sort().map(cs => ({
    "Cikkszám": cs,
    "Megnevezés": raktarMap[cs].nev,
    "Raktári készlet (600/900)": raktarMap[cs].keszlet
  }));

  // 5) Részletes lista helyszínnel
  const reszletezettKeszletLista = raktarData.map(row => ({
    "Cikkszám": String(row["Cikk-kód"] ?? "").toUpperCase(),
    "Megnevezés": row["Megnevezés"],
    "Helyszín": String(row["Helyszín "] ?? "").trim() || "-",
    "Szabad készlet": Number(row["Szabad"] ?? 0)
  }));

  // 6) Webshop összehasonlítás (csak ha VAN webshop)
  let elteresek = [];
  let egyezok = [];
  let csakWebshopban = [];

  if (hasWebshop) {
    const webshopCikkszamok = new Set();
    for (const row of webshopData) {
      const cikkszam = String(row["Cikkszám"] ?? "").toUpperCase();
      const webshopKeszlet = Number(row["Raktárkészlet"] ?? 0);
      const nev = row["Termék Név"];
      webshopCikkszamok.add(cikkszam);

      const raktar = raktarMap[cikkszam];
      const raktarKeszlet = raktar ? raktar.keszlet : 0;

      const rec = {
        "Cikkszám": cikkszam,
        "Termék név": nev,
        "Webshop készlet": webshopKeszlet,
        "Raktárkészlet": raktarKeszlet
      };
      if (webshopKeszlet !== raktarKeszlet) elteresek.push(rec);
      else egyezok.push(rec);
    }

    // Csak raktárban (nincs webshopban)
    const csakRaktarban = [];
    for (const cs of raktarCikkszamok) {
      if (!webshopCikkszamok.has(cs)) {
        const termek = raktarMap[cs];
        csakRaktarban.push({
          "Cikk-kód": cs,
          "Megnevezés": termek.nev,
          "Szabad készlet": termek.keszlet
        });
      }
    }

    setSummary({
      elteresek,
      egyezok,
      csakWebshopban,
      csakRaktarban,
      cikkszamDarabszamok,
      reszletezettKeszletLista
    });
  } else {
    // Webshop nélkül: csak raktári nézetek (és a későbbi UNAS-hoz szükséges táblák legyenek üresek)
    setSummary({
      elteresek: [],
      egyezok: [],
      csakWebshopban: [],
      csakRaktarban: Array.from(raktarCikkszamok).map(cs => ({
        "Cikk-kód": cs,
        "Megnevezés": raktarMap[cs].nev,
        "Szabad készlet": raktarMap[cs].keszlet
      })),
      cikkszamDarabszamok,
      reszletezettKeszletLista
    });
  }
}

  function buildRaktarMapFromSummary(sum) {
  // cikkszám -> { nev, keszlet }
  const map = new Map();
  (sum?.cikkszamDarabszamok || []).forEach(r => {
    const cs = String(r["Cikkszám"] ?? "").trim();
    if (!cs) return;
    map.set(cs, {
      nev: r["Megnevezés"],
      keszlet: Number(r["Raktári készlet (600/900)"] ?? 0)
    });
  });
  return map;
}


  const handleExport = () => {
    if (!summary) return;
    const wb = XLSX.utils.book_new();
    const sheets = [
      ["Eltérések", summary.elteresek],
      ["Egyező tételek", summary.egyezok],
      ["Csak_webshopban", summary.csakWebshopban],
      ["Csak_raktarban", summary.csakRaktarban]
    ];
    sheets.forEach(([name, data]) => {
      const ws = XLSX.utils.json_to_sheet(
        data.length ? data : [{}]
      );
      XLSX.utils.book_append_sheet(wb, ws, name);
    });
    XLSX.writeFile(wb, "keszlet_ellenorzes.xlsx");
  };

  const filterRows = rows => {
    if (!filterText) return rows;
    return rows.filter(row => {
      const value = row[filterField];
      return (
        value &&
        value.toString().toLowerCase().includes(filterText.toLowerCase())
      );
    });
  };

  const renderTable = (title, rows) => {
    const filtered = filterRows(rows);
    return (
      <div style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.25rem", color: "#333" }}>
          {title} ({filtered.length})
        </h2>
        {filtered.length === 0 ? (
          <p style={{ color: "#777" }}>Nincs találat.</p>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              marginTop: "0.5rem"
            }}
          >
            <thead>
              <tr>
                {Object.keys(filtered[0]).map(key => (
                  <th
                    key={key}
                    style={{
                      borderBottom: "1px solid #ccc",
                      textAlign: "left",
                      padding: "0.5rem"
                    }}
                  >
                    {key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={i}>
                  {Object.values(row).map((val, j) => (
                    <td
                      key={j}
                      style={{
                        borderBottom: "1px solid #eee",
                        padding: "0.5rem"
                      }}
                    >
                      {val}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  };

  // --- JSX render ---
  return (
    <div style={{ 
      fontFamily: "sans-serif" ,
      background: "#f4f5f7",
      minHeight: "100vh",
      }}>
      {/* Fejléc a nézetválasztóval */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "1rem 2rem",
          background: "#4a772c",
          color: "#fff",
          boxShadow: "0 2px 6px rgba(0,0,0,0.15)"
        }}
      >
        <h1 style={{ margin: 0 }}>Agrolánc programok</h1>
        <select
          value={view}
          onChange={e => setView(e.target.value)}
          style={{
            padding: "0.5rem 1rem",
            borderRadius: 4,
            border: "1px solid #ccc",
            fontSize: "1rem",
            background: "#fff",
            marginLeft: "1rem",
          }}
        >
          <option value="keszlet">Készlet-ellenőrzés</option>
          <option value="hirlevel">Hírlevél szinkron</option>
        </select>
      </header>

      {/* Fő tartalom nézet szerint */}
      {view === "keszlet" && (
        <main
          style={{
            padding: "2rem",
            maxWidth: "900px",
            margin: "2rem auto",
            fontFamily: "sans-serif"
          }}
        >
          <h1
            style={{
              fontSize: "1.75rem",
              fontWeight: "bold",
              color: "#6ba539",
              marginBottom: "1rem"
            }}
          >
            Készlet-ellenőrző
          </h1>

          <div
            onDrop={handleDrop}
            onDragOver={e => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            style={{
              border: `2px dashed ${dragOver ? "#6ba539" : "#ccc"}`,
              borderRadius: "10px",
              padding: "2rem",
              textAlign: "center",
              marginBottom: "1.5rem",
              backgroundColor: dragOver ? "#f5fff0" : "#fafafa"
            }}
          >
            <p style={{ margin: 0 }}>Húzd ide a fájlokat (.xlsx)</p>
            <p style={{ fontSize: "0.9rem", color: "#666" }}>
              (A fájl nevében szerepeljen: "webshop" és "raktar")
            </p>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label
              style={{
                fontWeight: "bold",
                display: "block",
                marginBottom: "0.5rem"
              }}
            >
              Webshop Excel kiválasztása
            </label>
            <input
              type="file"
              accept=".xlsx"
              onChange={e => setWebshopFile(e.target.files[0])}
            />
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <label
              style={{
                fontWeight: "bold",
                display: "block",
                marginBottom: "0.5rem"
              }}
            >
              Raktár Excel kiválasztása
            </label>
            <input
              type="file"
              accept=".xlsx"
              onChange={e => setRaktarFile(e.target.files[0])}
            />
          </div>

          <div style={{ marginBottom: "1rem" }}>
            {webshopFile && (
              <div style={{ color: "green" }}>✔️ Webshop fájl betöltve</div>
            )}
            {raktarFile && (
              <div style={{ color: "green" }}>✔️ Raktár fájl betöltve</div>
            )}
          </div>

          {summary && (
            <>
              <button
                onClick={handleExport}
                style={{
                  backgroundColor: "#6ba539",
                  color: "white",
                  padding: "0.5rem 1rem",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontWeight: "bold",
                  marginBottom: "2rem"
                }}
              >
                Riport letöltése Excelként
              </button>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center", marginBottom: "1rem" }}>
  <label style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
    <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} />
    Dry run (csak szimuláció)
  </label>

  <label>
    Max tételek:&nbsp;
    <input type="number" min={1} value={maxItems} onChange={e => setMaxItems(e.target.value)} style={{ width: 80 }} />
  </label>

  <button
    onClick={() => pushUpdates({ isDryRun: true })}
    disabled={busy}
    style={{ backgroundColor: "#888", color: "white", padding: "0.5rem 1rem", border: "none", borderRadius: "6px", fontWeight: "bold" }}
    title="Szimuláció: nem módosít a webshopon"
  >
    Dry run küldése
  </button>

  <button
    onClick={() => pushUpdates({ isDryRun: dryRun ? true : false })}
    disabled={busy || dryRun}
    style={{
      backgroundColor: dryRun ? "#ccc" : "#2d6cdf",
      color: "white", padding: "0.5rem 1rem", border: "none", borderRadius: "6px", fontWeight: "bold"
    }}
    title={dryRun ? "Kapcsold ki a Dry run-t az éles frissítéshez" : "Éles frissítés indítása"}
  >
    Éles frissítés
  </button>

  <button
  onClick={importWebshopFromUnas}
  disabled={!summary}
  style={{
    backgroundColor: "#2d6cdf",
    color: "white",
    padding: "0.5rem 1rem",
    border: "none",
    borderRadius: "6px",
    cursor: "pointer",
    fontWeight: "bold",
    marginBottom: "1rem",
    marginRight: "0.75rem"
  }}
  title="UNAS-ból lekéri a készleteket és feltölti velük a webshop táblákat (Eltérések/Egyezők/Csak webshopban)"
>
  Webshop feltöltése UNAS-ból
</button>

  
</div>
{lastResponse && lastResponse.dryRun && (
  <div style={{ background: "#fff", border: "1px solid #ddd", borderRadius: 8, padding: "1rem", marginBottom: "1rem" }}>
    <strong>Dry run eredmény:</strong>
    <div>Érintett tételek: {lastResponse.count}</div>
    {lastResponse.note && <div style={{ color: "#666" }}>{lastResponse.note}</div>}
    <div style={{ marginTop: "0.5rem", fontSize: "0.9rem" }}>
      <em>Minta (max 5):</em>
      <ul>
        {(lastResponse.sample || []).map((s, i) => (<li key={i}>{s.sku} → {s.qty}</li>))}
      </ul>
    </div>
  </div>
)}

              <div style={{ marginBottom: "1rem" }}>
                <label style={{ marginRight: "0.5rem" }}>Szűrés mező:</label>
                <select
                  value={filterField}
                  onChange={e => setFilterField(e.target.value)}
                >
                  <option value="Cikkszám">Cikkszám</option>
                  <option value="Cikk-kód">Cikk-kód</option>
                  <option value="Termék név">Termék név</option>
                  <option value="Megnevezés">Megnevezés</option>
                </select>
                <input
                  type="text"
                  placeholder="Szűrés..."
                  value={filterText}
                  onChange={e => setFilterText(e.target.value)}
                  style={{ marginLeft: "0.5rem", padding: "0.25rem" }}
                />
              </div>

              {renderTable("Eltérések", summary.elteresek)}

              <div style={{ marginTop: "2rem" }}>
                <button
                  onClick={() => setShowMatches(!showMatches)}
                  style={{
                    backgroundColor: showMatches ? "#ddd" : "#6ba539",
                    color: showMatches ? "#333" : "white",
                    padding: "0.5rem 1rem",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                    fontWeight: "bold"
                  }}
                >
                  {showMatches
                    ? "Egyező tételek elrejtése"
                    : "Egyező tételek megjelenítése"}
                </button>
                {showMatches && renderTable("Egyező tételek", summary.egyezok)}
              </div>

              {renderTable("Csak a webshopban", summary.csakWebshopban)}
              {renderTable("Csak a raktárban", summary.csakRaktarban)}
            </>
          )}

          <footer
            style={{
              marginTop: "3rem",
              fontSize: "0.85rem",
              color: "#888",
              textAlign: "center"
            }}
          >
            Verzió: 1.0.7 – Utolsó frissítés: 2025. június 3.
          </footer>
        </main>
      )}

      {view === "hirlevel" && (
        <main
          style={{
            padding: "2rem",
            maxWidth: "800px",
            margin: "auto",
            fontFamily: "sans-serif"
          }}
        >
          <HirlevelSzinkron />
        </main>
      )}
    </div>
  );
}

export default App;

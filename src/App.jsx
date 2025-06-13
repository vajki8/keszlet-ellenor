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
    if (raktarFile && webshopFile) {
      handleCompare();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raktarFile, webshopFile]);
  async function handleCompare() {
    // 1. Excel fájlok beolvasása
    let raktarData = await readExcel(raktarFile);
    const webshopData = await readExcel(webshopFile);
  
    // 2. Csak a 600 vagy 900 szériás sorokat tartjuk meg
    raktarData = raktarData.filter(row => {
      const helyszin = String(row["Helyszín "] ?? "").trim();
      const szeriaszam = String(row["Szériaszám"] ?? "").trim();
      return helyszin === "600" || helyszin === "900" || szeriaszam === "600" || szeriaszam === "900" ||  helyszin === "" || szeriaszam === "";
    });
  
    // 3. Cikkszám szerint összesítés (600/900 sorok alapján)
    const raktarMap = {};
    const raktarCikkszamok = new Set();
    const cikkszamDarabszamok = [];
  
    for (const row of raktarData) {
      const cikkszam = String(row["Cikk-kód"] ?? "").toUpperCase();
      const szabad = Number(row["Szabad"] ?? 0);
      const keszleten = Number(row["Készleten"] ?? 0);
      const nev = row["Megnevezés"];
      const hasznaltKeszlet = szabad < 0 ? keszleten : szabad;
  
      if (!raktarMap[cikkszam]) raktarMap[cikkszam] = { nev, keszlet: 0 };
      raktarMap[cikkszam].keszlet += hasznaltKeszlet;
      raktarCikkszamok.add(cikkszam);
    }
  
    // 4. Összesített cikkszám/készlet lista
    for (const cikkszam of Array.from(raktarCikkszamok).sort()) {
      cikkszamDarabszamok.push({
        "Cikkszám": cikkszam,
        "Megnevezés": raktarMap[cikkszam].nev,
        "Raktári készlet (600/900)": raktarMap[cikkszam].keszlet
      });
    }
  
    // 5. Részletes, soronkénti lista helyszínnel együtt
    const reszletezettKeszletLista = raktarData.map(row => {
      return {
        "Cikkszám": String(row["Cikk-kód"] ?? "").toUpperCase(),
        "Megnevezés": row["Megnevezés"],
        "Helyszín": String(row["Helyszín "] ?? "").trim() || "-",
        "Szabad készlet": Number(row["Szabad"] ?? 0)
      };
    });
  
    // 6. Webshop összehasonlítás
    const elteresek = [];
    const egyezok = [];
    const webshopCikkszamok = new Set();
  
    for (const row of webshopData) {
      const cikkszam = String(row["Cikkszám"] ?? "").toUpperCase();
      const webshopKeszlet = Number(row["Raktárkészlet"] ?? 0);
      const nev = row["Termék Név"];
      const kategoria = row["Kategória"];
  
      webshopCikkszamok.add(cikkszam);
      const raktar = raktarMap[cikkszam];
      const raktarKeszlet = raktar ? raktar.keszlet : 0;
  
      if (webshopKeszlet !== raktarKeszlet) {
        elteresek.push({
          "Cikkszám": cikkszam,
          "Termék név": nev,
          "Webshop készlet": webshopKeszlet,
          "Raktárkészlet": raktarKeszlet
        });
      } else {
        egyezok.push({
          "Cikkszám": cikkszam,
          "Termék név": nev,
          "Webshop készlet": webshopKeszlet,
          "Raktárkészlet": raktarKeszlet
        });
      }
    }
  
    // 7. Csak raktárban lévő cikkszámok (nincs webshopban)
    const csakRaktarban = [];
    for (const cikkszam of raktarCikkszamok) {
      if (!webshopCikkszamok.has(cikkszam)) {
        const termek = raktarMap[cikkszam];
        csakRaktarban.push({
          "Cikk-kód": cikkszam,
          "Megnevezés": termek.nev,
          "Szabad készlet": termek.keszlet
        });
      }
    }
  
    // 8. Eredmények tárolása megjelenítéshez
    setSummary({
      elteresek,
      egyezok,
      csakWebshopban: [],
      csakRaktarban,
      cikkszamDarabszamok,
      reszletezettKeszletLista
    });
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

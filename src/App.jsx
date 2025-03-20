// cSpell:disable

import { useState, useCallback, useEffect } from "react";
import * as XLSX from "xlsx";

function App() {
  const [raktarFile, setRaktarFile] = useState(null);
  const [webshopFile, setWebshopFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [summary, setSummary] = useState(null);
  const [filterText, setFilterText] = useState("");
  const [filterField, setFilterField] = useState("Cikkszám");

  const handleFileUpload = (file) => {
    if (!file.name.endsWith(".xlsx")) return;
    const lowered = file.name.toLowerCase();
    if (lowered.includes("raktar")) setRaktarFile(file);
    else if (lowered.includes("webshop")) setWebshopFile(file);
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(handleFileUpload);
  }, []);

  function readExcel(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
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
    const raktarData = await readExcel(raktarFile);
    const webshopData = await readExcel(webshopFile);

    const raktarMap = {};
    const raktarCikkszamok = new Set();

    for (const row of raktarData) {
      const cikkszam = row["Cikk-kód"];
      const keszlet = Number(row["Szabad"] ?? 0);
      const nev = row["Megnevezés"];
      if (!raktarMap[cikkszam]) {
        raktarMap[cikkszam] = { nev, keszlet: 0 };
      }
      raktarMap[cikkszam].keszlet += keszlet;
      raktarCikkszamok.add(cikkszam);
    }

    const elteresek = [];
    const csakWebshopban = [];
    const webshopCikkszamok = new Set();

    for (const row of webshopData) {
      const cikkszam = row["Cikkszám"]?.toUpperCase();
      const webshopKeszlet = Number(row["Raktárkészlet"] ?? 0);
      const nev = row["Termék Név"];
      const kategoria = row["Kategória"];
      webshopCikkszamok.add(cikkszam);

      const raktar = raktarMap[cikkszam];
      if (raktar && webshopKeszlet > raktar.keszlet) {
        elteresek.push({
          "Cikkszám": cikkszam,
          "Termék név": nev,
          "Webshop készlet": webshopKeszlet,
          "Raktárkészlet": raktar.keszlet,
        });
      }

      if (!raktar) {
        csakWebshopban.push({
          "Cikkszám": cikkszam,
          "Termék név": nev,
          "Kategória": kategoria,
        });
      }
    }

    const csakRaktarban = [];
    for (const cikkszam of raktarCikkszamok) {
      if (!webshopCikkszamok.has(cikkszam)) {
        const termek = raktarMap[cikkszam];
        csakRaktarban.push({
          "Cikk-kód": cikkszam,
          "Megnevezés": termek.nev,
          "Szabad készlet": termek.keszlet,
        });
      }
    }

    setSummary({ elteresek, csakWebshopban, csakRaktarban });
  }

  const handleExport = () => {
    if (!summary) return;
    const wb = XLSX.utils.book_new();

    const elteresSheet = XLSX.utils.json_to_sheet(
      summary.elteresek.length ? summary.elteresek : [{ "Cikkszám": "", "Termék név": "", "Webshop készlet": "", "Raktárkészlet": "" }]
    );
    const webshopOnlySheet = XLSX.utils.json_to_sheet(
      summary.csakWebshopban.length ? summary.csakWebshopban : [{ "Cikkszám": "", "Termék név": "", "Kategória": "" }]
    );
    const raktarOnlySheet = XLSX.utils.json_to_sheet(
      summary.csakRaktarban.length ? summary.csakRaktarban : [{ "Cikk-kód": "", "Megnevezés": "", "Szabad készlet": "" }]
    );

    XLSX.utils.book_append_sheet(wb, elteresSheet, "Eltérések");
    XLSX.utils.book_append_sheet(wb, webshopOnlySheet, "Csak_webshopban");
    XLSX.utils.book_append_sheet(wb, raktarOnlySheet, "Csak_raktarban");

    XLSX.writeFile(wb, "keszlet_ellenorzes.xlsx");
  };

  const filterRows = (rows) => {
    if (!filterText) return rows;
    return rows.filter((row) => {
      const value = row[filterField];
      return value && value.toString().toLowerCase().includes(filterText.toLowerCase());
    });
  };

  const renderTable = (title, rows) => {
    const filtered = filterRows(rows);
    return (
      <div style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.25rem", color: "#333" }}>{title} ({filtered.length})</h2>
        {filtered.length === 0 ? (
          <p style={{ color: "#777" }}>Nincs találat.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "0.5rem" }}>
            <thead>
              <tr>
                {Object.keys(filtered[0]).map((key) => (
                  <th key={key} style={{ borderBottom: "1px solid #ccc", textAlign: "left", padding: "0.5rem" }}>{key}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={i}>
                  {Object.values(row).map((val, j) => (
                    <td key={j} style={{ borderBottom: "1px solid #eee", padding: "0.5rem" }}>{val}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  };

  return (
    <main style={{ padding: "2rem", maxWidth: "800px", margin: "auto", fontFamily: "sans-serif" }}>
      <h1 style={{ fontSize: "1.75rem", fontWeight: "bold", color: "#6ba539", marginBottom: "1rem" }}>Készlet-ellenőrző</h1>

      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        style={{
          border: `2px dashed ${dragOver ? "#6ba539" : "#ccc"}`,
          borderRadius: "10px",
          padding: "2rem",
          textAlign: "center",
          marginBottom: "1.5rem",
          backgroundColor: dragOver ? "#f5fff0" : "#fafafa",
        }}
      >
        <p style={{ margin: 0 }}>Húzd ide a fájlokat (.xlsx)</p>
        <p style={{ fontSize: "0.9rem", color: "#666" }}>(A fájl nevében szerepeljen: "webshop" és "raktar")</p>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label style={{ fontWeight: "bold", display: "block", marginBottom: "0.5rem" }}>Webshop Excel kiválasztása</label>
        <input type="file" accept=".xlsx" onChange={(e) => setWebshopFile(e.target.files[0])} />
      </div>
      <div style={{ marginBottom: "1rem" }}>
        <label style={{ fontWeight: "bold", display: "block", marginBottom: "0.5rem" }}>Raktár Excel kiválasztása</label>
        <input type="file" accept=".xlsx" onChange={(e) => setRaktarFile(e.target.files[0])} />
      </div>

      <div style={{ marginBottom: "1rem" }}>
        {webshopFile && <div style={{ color: "green" }}>✔️ Webshop fájl betöltve</div>}
        {raktarFile && <div style={{ color: "green" }}>✔️ Raktár fájl betöltve</div>}
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
              marginBottom: "2rem",
            }}
          >
            Riport letöltése Excelként
          </button>

          <div style={{ marginBottom: "1rem" }}>
            <label style={{ marginRight: "0.5rem" }}>Szűrés mező:</label>
            <select value={filterField} onChange={(e) => setFilterField(e.target.value)}>
              <option value="Cikkszám">Cikkszám</option>
              <option value="Cikk-kód">Cikk-kód</option>
              <option value="Termék név">Termék név</option>
              <option value="Megnevezés">Megnevezés</option>
            </select>
            <input
              type="text"
              placeholder="Szűrés..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              style={{ marginLeft: "0.5rem", padding: "0.25rem" }}
            />
          </div>

          {renderTable("Eltérések", summary.elteresek)}
          {renderTable("Csak a webshopban", summary.csakWebshopban)}
          {renderTable("Csak a raktárban", summary.csakRaktarban)}
        </>
      )}

      <footer style={{ marginTop: "3rem", fontSize: "0.85rem", color: "#888", textAlign: "center" }}>
        Verzió: 1.0.0 – Utolsó frissítés: 2025. március 20.
      </footer>
    </main>
  );
}

export default App;

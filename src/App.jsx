import { useState } from "react";
import * as XLSX from "xlsx";

function App() {
  const [raktarFile, setRaktarFile] = useState(null);
  const [webshopFile, setWebshopFile] = useState(null);
  const [resultUrl, setResultUrl] = useState(null);

  function handleFileUpload(e, setter) {
    const file = e.target.files[0];
    setter(file);
  }

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

  async function handleCompare() {
    if (!raktarFile || !webshopFile) return;

    const raktarData = await readExcel(raktarFile);
    const webshopData = await readExcel(webshopFile);

    const raktarMap = {};
    for (const row of raktarData) {
      const cikkszam = row["Cikk-kód"];
      const keszlet = Number(row["Készleten"] ?? 0);
      const nev = row["Megnevezés"];
      if (!raktarMap[cikkszam]) {
        raktarMap[cikkszam] = { nev, keszlet: 0 };
      }
      raktarMap[cikkszam].keszlet += keszlet;
    }

    const elteresek = [];
    for (const row of webshopData) {
      const cikkszam = row["Cikkszám"]?.toUpperCase();
      const webshopKeszlet = Number(row["Raktárkészlet"] ?? 0);
      const nev = row["Termék Név"];
      const raktar = raktarMap[cikkszam];
      if (raktar && webshopKeszlet > raktar.keszlet) {
        elteresek.push({
          "Cikkszám": cikkszam,
          "Termék név": nev,
          "Webshop készlet": webshopKeszlet,
          "Raktárkészlet": raktar.keszlet,
        });
      }
    }

    const ws = XLSX.utils.json_to_sheet(elteresek);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Eltérések");
    const blob = XLSX.write(wb, { bookType: "xlsx", type: "blob" });
    const url = URL.createObjectURL(blob);
    setResultUrl(url);
  }

  return (
    <main style={{ padding: "2rem", maxWidth: "600px", margin: "auto" }}>
      <h1 style={{ fontSize: "1.5rem", fontWeight: "bold", marginBottom: "1rem" }}>Készlet-ellenőrző</h1>
      <div style={{ marginBottom: "1rem" }}>
        <label style={{ fontWeight: "bold", display: "block", marginBottom: "0.5rem" }}>
          Webshop Excel feltöltése
        </label>
        <input type="file" accept=".xlsx" onChange={(e) => handleFileUpload(e, setWebshopFile)} />
      </div>
      <div style={{ marginBottom: "1rem" }}>
        <label style={{ fontWeight: "bold", display: "block", marginBottom: "0.5rem" }}>
          Raktár Excel feltöltése
        </label>
        <input type="file" accept=".xlsx" onChange={(e) => handleFileUpload(e, setRaktarFile)} />
      </div>
      <button
        onClick={handleCompare}
        disabled={!raktarFile || !webshopFile}
        style={{
          backgroundColor: "#4f46e5",
          color: "white",
          padding: "0.5rem 1rem",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer",
          fontWeight: "bold",
        }}
      >
        Ellenőrzés indítása
      </button>

      {resultUrl && (
        <div style={{ marginTop: "1rem" }}>
          <a
            href={resultUrl}
            download="elteresek.xlsx"
            style={{ color: "#2563eb", textDecoration: "underline" }}
          >
            Eltérések letöltése
          </a>
        </div>
      )}
    </main>
  );
}

export default App;
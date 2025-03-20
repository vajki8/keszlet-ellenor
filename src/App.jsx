import { useState } from "react";
import * as XLSX from "xlsx";

function App() {
  const [raktarFile, setRaktarFile] = useState(null);
  const [webshopFile, setWebshopFile] = useState(null);

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
    if (!raktarFile || !webshopFile) {
      alert("Töltsd fel mindkét Excel fájlt!");
      return;
    }

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

    const wb = XLSX.utils.book_new();
    const elteresSheet = XLSX.utils.json_to_sheet(elteresek);
    const webshopOnlySheet = XLSX.utils.json_to_sheet(
      csakWebshopban.length ? csakWebshopban : [{ "Cikkszám": "", "Termék név": "", "Kategória": "" }]
    );
    
    const raktarOnlySheet = XLSX.utils.json_to_sheet(
      csakRaktarban.length ? csakRaktarban : [{ "Cikk-kód": "", "Megnevezés": "", "Szabad készlet": "" }]
    );
    

    XLSX.utils.book_append_sheet(wb, elteresSheet, "Eltérések");
    XLSX.utils.book_append_sheet(wb, webshopOnlySheet, "Csak_webshopban");
    XLSX.utils.book_append_sheet(wb, raktarOnlySheet, "Csak_raktarban");

    XLSX.writeFile(wb, "keszlet_ellenorzes.xlsx");
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
    </main>
  );
}

export default App;

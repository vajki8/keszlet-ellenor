// cspell:disable
import { useState, useCallback, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";


export default function HirlevelSzinkron() {
  // Állapotok
  const [hansaContacts, setHansaContacts] = useState([]);
  const [mailchimpContacts, setMailchimpContacts] = useState([]);
  const [unsubscribedContacts, setUnsubscribedContacts] = useState([]);
  const [hiányzók, setHiányzók] = useState([]);
  const [feleslegesek, setFeleslegesek] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({
    hansa: false,
    mailchimp: false,
    unsubscribed: false
  });
  const [sortConfig, setSortConfig] = useState({
    key: "Kontakt sorszám",
    direction: "asc"
  });

  // Teszt és pagináció
  const [testData, setTestData] = useState([]);
  const [testType, setTestType] = useState(""); // "hansa" vagy "mailchimp"
  const [showTestData, setShowTestData] = useState(true);
  const [testPage, setTestPage] = useState(1);
  const PAGE_SIZE = 25;
  const totalTestPage = Math.ceil(testData.length / PAGE_SIZE);
  const pagedTestData = testData.slice(
    (testPage - 1) * PAGE_SIZE,
    testPage * PAGE_SIZE
  );

  // Új kontaktok pagináció
  const [showHiány, setShowHiány] = useState(true);
  const [page, setPage] = useState(1);
  const totalHiányPage = Math.ceil(hiányzók.length / PAGE_SIZE);
  // először rendezzük a teljes listát a sortConfig alapján
const sortedHiányzók = useMemo(() => {
  const arr = [...hiányzók];
  arr.sort((a, b) => {
    const A = (a[sortConfig.key] || "").toString().toLowerCase();
    const B = (b[sortConfig.key] || "").toString().toLowerCase();
    if (A < B) return sortConfig.direction === "asc" ? -1 : 1;
    if (A > B) return sortConfig.direction === "asc" ? 1 : -1;
    return 0;
  });
  return arr;
}, [hiányzók, sortConfig]);

// paginált rész
const pagedHiányzók = sortedHiányzók.slice(
  (page - 1) * PAGE_SIZE,
  page * PAGE_SIZE
);

const nameMismatches = useMemo(() => {
  // készítsünk egy map-et mailchimp email → név
  const mcMap = new Map(
    mailchimpContacts.map(c => [c["Email-cím"], c["Név"]])
  );
  // szűrjük ki a közös email‐eket, aztán csak az eltéréseket
  return hansaContacts
    .filter(c => mcMap.has(c["Email-cím"]))
    .map(c => ({
      email:           c["Email-cím"],
      hansaName:       c["Kontaktszemély"],
      mailchimpName:   mcMap.get(c["Email-cím"])
    }))
    .filter(item => item.hansaName !== item.mailchimpName);
}, [hansaContacts, mailchimpContacts]);

const exportNameMismatches = () => {
  // Létrehozzuk a munkafüzetet
  const wb = XLSX.utils.book_new();
  // A nameMismatches tömböt átalakítjuk munkalappá
  const ws = XLSX.utils.json_to_sheet(nameMismatches);
  // Hozzáadjuk a "Név-eltérések" nevű lapként
  XLSX.utils.book_append_sheet(wb, ws, "Név-eltérések");
  // Kiírjuk a fájlt
  XLSX.writeFile(wb, "nev_elteresek.xlsx");
};

  // 1) Hansa-normalizáló
  const normalizeHansa = useCallback(rows =>
    rows
      .map(r => ({
        "Kontakt sorszám": String(r["Kontakt sorszám"] || r["Kontaktsorszám"] || "").trim(),
        "Kontaktszemély":    String(r["Kontaktszemély"] || "").trim() || (r["Név"] || "").trim(),
        "Email-cím":       String(r["Email-cím"] || r["E-mail-cím"] || "")
                             .toLowerCase().trim(),
        "Besorolás":         String(r["Besorolás"] || "").trim()
      }))
      .filter(r => r["Email-cím"])
  , []);

    // 2) Mailchimp- és Unsubscribed-normalizáló: egységes kulcsokkal
    const normalizeMailchimp = useCallback(rows =>
      rows
        .map(r => ({
          "Kontakt sorszám": String(r["Phone Number"]     || r["Phone number"]    || "").trim(),
          "Név":              String(r["First Name"]      || r["First name"]      || "").trim(),
          "Email-cím":        String(r["Email address"]    || r["Email Address"]   || "").toLowerCase().trim(),
          "Besorolás":        String(r["Tags"]            || r["tags"]            || "").trim()
        }))
        .filter(r => r["Email-cím"])
    , []);

  // 3) Átfogó beolvasó
const handleFile = useCallback((file, setter, type = "") => {
  if (!file) return;
  const ext = file.name.split(".").pop().toLowerCase();
  const reader = new FileReader();

  reader.onload = e => {
    try {
      let json = [];

      if (type === "hansa") {
        // Hansa: natív SheetJS
        if (ext === "csv") {
          const text = e.target.result;
          const wb = XLSX.read(text, { type: "string" });
          const sh = wb.Sheets[wb.SheetNames[0]];
          json = XLSX.utils.sheet_to_json(sh, { defval: "" });
        } else {
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, { type: "array" });
          const sh = wb.Sheets[wb.SheetNames[0]];
          json = XLSX.utils.sheet_to_json(sh, { defval: "" });
        }
        json = normalizeHansa(json);

      } else {
        // Mailchimp és Unsubscribed: ugyanúgy, natív SheetJS → sheet_to_json
        if (ext === "csv") {
          const text = e.target.result;
          const wb = XLSX.read(text, { type: "string" });
          const sh = wb.Sheets[wb.SheetNames[0]];
          json = XLSX.utils.sheet_to_json(sh, { defval: "" });
        } else {
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, { type: "array" });
          const sh = wb.Sheets[wb.SheetNames[0]];
          json = XLSX.utils.sheet_to_json(sh, { defval: "" });
        }
        json = normalizeMailchimp(json);
      }

      setter(json);
      setStatus(s => ({ ...s, [type]: true }));
    } catch (err) {
      console.error("Hiba a fájl feldolgozásakor:", err);
    }
  };

  // olvasás típusa
  if (ext === "csv") reader.readAsText(file, "UTF-8");
  else reader.readAsArrayBuffer(file);
}, [normalizeHansa, normalizeMailchimp]);


  // Drag & drop
  const handleDropWrapper = useCallback(e => {
    e.preventDefault(); setDragOver(false);
    Array.from(e.dataTransfer.files).forEach(file => {
      const n = file.name.toLowerCase();
      if (n.includes("unsub")) {
        handleFile(file, setUnsubscribedContacts, "unsubscribed");
      } else if (n.includes("mailchimp")) {
        handleFile(file, setMailchimpContacts, "mailchimp");
      } else {
        handleFile(file, setHansaContacts, "hansa");
      }
    });
  }, [handleFile]);

  // Összehasonlítás
    const compareContacts = useCallback(() => {
        setLoading(true);
        setTimeout(() => {
          // mindkét listában az "Email-cím" mezőt használjuk
          const hSet = new Set(hansaContacts.map(c => c["Email-cím"]));
          const mSet = new Set(mailchimpContacts.map(c => c["Email-cím"]));
    
        // új kontaktok: Hansa-ban van, Mailchimp-ben nincs
          setHiányzók(
            hansaContacts.filter(c => !mSet.has(c["Email-cím"]))
          );
        // feleslegesek: Mailchimp-ben van, Hansa-ban nincs
          setFeleslegesek(
            mailchimpContacts.filter(c => !hSet.has(c["Email-cím"]))
          );
    
          setLoading(false);
          setPage(1);
        }, 300);
      }, [hansaContacts, mailchimpContacts]);

  useEffect(() => {
    if (hansaContacts.length && mailchimpContacts.length) {
      compareContacts();
    }
  }, [hansaContacts, mailchimpContacts, compareContacts]);

  // Leiratkozottak kiszűrése (Email-cím mező alapján)
  const filterUnsubscribed = useCallback(() => {
    const unsubSet = new Set(
      unsubscribedContacts.map(c =>
        (c["Email-cím"] || "").toLowerCase().trim()
      )
    );
    setHiányzók(prev =>
      prev.filter(c =>
        !unsubSet.has((c["Email-cím"] || "").toLowerCase().trim())
      )
    );
  }, [unsubscribedContacts]);

  // Teszt gomb
  const handleTest = useCallback((contacts, type) => {
    setTestData(contacts);
    setTestType(type);
    setTestPage(1);
  }, []);

  // Excel export
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(hiányzók);
    XLSX.utils.book_append_sheet(wb, ws, "UjKontaktok");
    XLSX.writeFile(wb, "uj_kontaktok.xlsx");
  };

  // Teszt-táblázat
  const renderTestTable = () => {
    if (testType === "mailchimp" || testType === "unsubscribed") {
      return (
        <div style={{ marginTop: 20 }}>
          <h3>Teszt Adatok ({testData.length})</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: "#f8f0ff" }}>
            <thead>
              <tr>
                <th style={{ borderBottom: "1px solid #ccc", padding: 8, textAlign: "left" }}>Kontakt sorszám</th>
                <th style={{ borderBottom: "1px solid #ccc", padding: 8, textAlign: "left" }}>Név</th>
                <th style={{ borderBottom: "1px solid #ccc", padding: 8, textAlign: "left" }}>Email-cím</th>
                <th style={{ borderBottom: "1px solid #ccc", padding: 8, textAlign: "left" }}>Besorolás</th>
              </tr>
            </thead>
            <tbody>
              {pagedTestData.map((r, i) => (
                <tr key={i}>
                  <td style={{ borderBottom: "1px solid #eee", padding: 8 }}>{r["Kontakt sorszám"]}</td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 8 }}>{r["Név"]}</td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 8 }}>{r["Email-cím"]}</td>
                  <td style={{ borderBottom: "1px solid #eee", padding: 8 }}>{r["Besorolás"]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 8 }}>
            <button onClick={() => setTestPage(p => Math.max(1, p - 1))} disabled={testPage === 1}>
              Előző
            </button>
            <span style={{ margin: "0 12px" }}>Oldal {testPage} / {totalTestPage}</span>
            <button onClick={() => setTestPage(p => Math.min(totalTestPage, p + 1))} disabled={testPage === totalTestPage}>
              Következő
            </button>
          </div>
        </div>
      );
    }
    
    // default: hansa vagy unsub teszt
    return (
      <div style={{ marginTop: 20 }}>
        <h3>Teszt Adatok ({testData.length})</h3>
        {testData.length === 0 ? (
          <p style={{ color: "#777" }}>Nincs adat.</p>
        ) : (
          <>
            <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: "#f8f0ff" }}>
              <thead>
                <tr>
                  {Object.keys(pagedTestData[0]).map(k => (
                    <th key={k} style={{ borderBottom: "1px solid #ccc", padding: 8, textAlign: "left" }}>
                      {k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedTestData.map((r, i) => (
                  <tr key={i}>
                    {Object.values(r).map((v, j) => (
                      <td key={j} style={{ borderBottom: "1px solid #eee", padding: 8 }}>{v}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 8 }}>
              <button onClick={() => setTestPage(p => Math.max(1, p - 1))} disabled={testPage === 1}>
                Előző
              </button>
              <span style={{ margin: "0 12px" }}>Oldal {testPage} / {totalTestPage}</span>
              <button onClick={() => setTestPage(p => Math.min(totalTestPage, p + 1))} disabled={testPage === totalTestPage}>
                Következő
              </button>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <main style={{ padding: 16, fontFamily: "sans-serif" }}>
      <h2 style={{ color: "#6ba539" }}>Hírlevél szinkron</h2>

      <div
        onDrop={handleDropWrapper}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        style={{
          border: `2px dashed ${dragOver ? "#6ba539" : "#ccc"}`,
          borderRadius: 8,
          padding: 24,
          textAlign: "center",
          marginBottom: 16,
          background: dragOver ? "#f5fff0" : "#fafafa"
        }}
      >
        Húzd ide a Hansa, Mailchimp és Unsubscribed fájlokat (.xlsx/.csv)
      </div>

      <div style={{ marginBottom: 12 }}>
        <label>
          Hansa lista:
          <input
            type="file" accept=".xlsx,.csv"
            onChange={e => handleFile(e.target.files[0], setHansaContacts, "hansa")}
            style={{ marginLeft: 8 }}
          />
        </label>
        <button onClick={() => handleTest(hansaContacts, "hansa")} style={{ marginLeft: 8 }}>
          Hansa teszt
        </button>
        {status.hansa && <span style={{ marginLeft: 8, color: "green" }}>✔️</span>}
      </div>

      <div style={{ marginBottom: 12 }}>
        <label>
          Mailchimp lista:
          <input
            type="file" accept=".xlsx,.csv"
            onChange={e => handleFile(e.target.files[0], setMailchimpContacts, "mailchimp")}
            style={{ marginLeft: 8 }}
          />
        </label>
        <button onClick={() => handleTest(mailchimpContacts, "mailchimp")} style={{ marginLeft: 8 }}>
          Mailchimp teszt
        </button>
        {status.mailchimp && <span style={{ marginLeft: 8, color: "green" }}>✔️</span>}
      </div>

      <div style={{ marginBottom: 12 }}>
        <label>
          Unsubscribed lista:
          <input
            type="file" accept=".xlsx,.csv"
            onChange={e => handleFile(e.target.files[0], setUnsubscribedContacts, "unsubscribed")}
            style={{ marginLeft: 8 }}
          />
        </label>
        <button onClick={() => handleTest(unsubscribedContacts, "unsubscribed")} style={{ marginLeft: 8 }}>
          Unsubscribed teszt
        </button>
        {status.unsubscribed && <span style={{ marginLeft: 8, color: "green" }}>✔️</span>}
      </div>

      {loading && <p>Összehasonlítás folyamatban…</p>}

      {/* Új kontaktok elrejtése / megjelenítése */}
      <div style={{ marginTop: 24 }}>
        <button onClick={() => setShowHiány(v => !v)}>
          {showHiány ? "Új kontaktok elrejtése" : "Új kontaktok mutatása"}
        </button>
      </div>

      {showHiány && hiányzók.length > 0 && (
        <section style={{ marginTop: 16 }}>
          <h3>Új kontaktok ({hiányzók.length})</h3>
          <button onClick={exportExcel} style={{ marginBottom: 8 }}>Exportálás Excelbe</button>
          <button onClick={filterUnsubscribed} style={{ marginLeft: 8 }}>Leiratkozottak kiszűrése</button>
          <button onClick={exportNameMismatches} style={{ marginLeft: 8 }}>Név-eltérések exportálása</button>

          <table style={{ width: "100%", borderCollapse: "collapse", background: "#f8f0ff" }}>
          <thead>
  <tr>
    {["Kontakt sorszám","Kontaktszemély","Email-cím","Besorolás"].map(col => {
      const isSorted = sortConfig.key === col;
      const arrow    = isSorted
        ? sortConfig.direction === "asc" ? " ▲" : " ▼"
        : "";
      return (
        <th
          key={col}
          style={{
            borderBottom: "1px solid #ccc",
            padding: 8,
            textAlign: "left",
            cursor: "pointer"
          }}
          onClick={() => {
            const direction =
              isSorted && sortConfig.direction === "asc"
                ? "desc"
                : "asc";
            setSortConfig({ key: col, direction });
          }}
        >
          {col}{arrow}
        </th>
      );
    })}
  </tr>
</thead>
            <tbody>
              {pagedHiányzók.map((c, i) => (
                <tr key={i}>
                  <td style={{ padding: 8 }}>{c["Kontakt sorszám"]}</td>
                  <td style={{ padding: 8 }}>{c["Kontaktszemély"]}</td>
                  <td style={{ padding: 8 }}>{c["Email-cím"]}</td>
                  <td style={{ padding: 8 }}>{c["Besorolás"]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 8 }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
              Előző
            </button>
            <span style={{ margin: "0 12px" }}>
              Oldal {page} / {totalHiányPage}
            </span>
            <button onClick={() => setPage(p => Math.min(totalHiányPage, p + 1))} disabled={page === totalHiányPage}>
              Következő
            </button>
          </div>
        </section>
      )}

      {/* Teszt adatok */}
      {showTestData && renderTestTable()}
      <div style={{ marginTop: 12 }}>
        <button onClick={() => setShowTestData(v => !v)}>
          {showTestData ? "Teszt adatok elrejtése" : "Teszt adatok mutatása"}
        </button>
      </div>
    </main>
  );
}

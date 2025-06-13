// cspell:disable
import { useState, useCallback, useEffect, useMemo, useRef} from "react";
import * as XLSX from "xlsx";


export default function HirlevelSzinkron() {
  // Állapotok
  const [hansaContacts, setHansaContacts] = useState([]);
  const [filterText, setFilterText] = useState("");
  const [filterField, setFilterField] = useState("Email-cím");
  const [showHansaMissing, setShowHansaMissing] = useState(true);
  const [mailchimpContacts, setMailchimpContacts] = useState([]);
  const [unsubscribedContacts, setUnsubscribedContacts] = useState([]);
  const [hiányzók, setHiányzók] = useState([]);
  const [feleslegesek, setFeleslegesek] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const allRawHansaEmails = useRef(new Set());
  const [status, setStatus] = useState({
    hansa: false,
    mailchimp: false,
    unsubscribed: false
  });
  const defaultColumns = [
    { key: "Kontakt sorszám", label: "Kontakt sorszám" },
    { key: "Kontaktszemély",  label: "Kontaktszemély"  },
    { key: "Email-cím",        label: "Email-cím"        },
    { key: "Besorolás",        label: "Besorolás"        },
  ];
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
  // először rendezzük a teljes listát a sortConfig alapján

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

// Végigfilterezi, rendezi és paginálja a kapott rows tömböt, majd visszaadja a JSX táblát
function DataTable({ title, rows, columns = defaultColumns }) {

  // 2) szűrés
  const filtered = rows.filter(r => {
    if (!filterText) return true;
    const val = String(r[filterField] ?? "").toLowerCase();
    return val.includes(filterText.toLowerCase());
  });

  // 3) rendezés
  const sorted = [...filtered].sort((a, b) => {
    const aVal = String(a[sortConfig.key]  ?? "");
    const bVal = String(b[sortConfig.key]  ?? "");
    if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
    if (aVal > bVal) return sortConfig.direction === "asc" ?  1 : -1;
    return 0;
  });

  // 4) pagináció
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <section style={{ marginTop: 16 }}>
      <h3>{title} ({filtered.length})</h3>

      {/* Szűrés */}
      <div style={{ marginBottom: 12, display: "flex", alignItems: "center" }}>
        <label>
          Szűrés mező:&nbsp;
          <select
            value={filterField}
            onChange={e => { setFilterField(e.target.value); setPage(1); }}
          >
            {columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <input
          value={filterText}
          onChange={e => { setFilterText(e.target.value); setPage(1); }}
          placeholder="keresés…"
          style={{ marginLeft: 8, padding: "4px 8px", flex: 1 }}
        />
      </div>

      {/* Táblázat */}
      <table style={{
        width: "100%",
        borderCollapse: "collapse",
        background: "#f8f0ff"
      }}>
        <thead>
          <tr>
            {columns.map(({ key, label }) => {
              const isSorted = sortConfig.key === key;
              const arrow = isSorted ? (sortConfig.direction === "asc" ? " ▲" : " ▼") : "";
              return (
                <th
                  key={key}
                  style={{
                    borderBottom: "1px solid #ccc",
                    padding: 8,
                    textAlign: "left",
                    cursor: "pointer"
                  }}
                  onClick={() => {
                    const dir = isSorted && sortConfig.direction === "asc" ? "desc" : "asc";
                    setSortConfig({ key, direction: dir });
                  }}
                >
                  {label}{arrow}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
  {paged.map((row, i) => (
    <tr key={i}>
      {columns.map(({ key }) => {
        let cell = row[key];
        // 4. fallback "Kontakt sorszám"-ra
        if (key === "Kontakt sorszám" && !cell) {
          cell = row["Phone Number"] || row["Phone number"] || "";
        }
        // a "Besorolás" esetén nincs külön Tags-fallback
        return <td key={key} style={{ padding: 8 }}>{cell}</td>;
      })}
    </tr>
  ))}
</tbody>
      </table>

      {/* Pagináció */}
      <div style={{ marginTop: 8, display: "flex", alignItems: "center" }}>
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
          Előző
        </button>
        <span style={{ margin: "0 12px" }}>Oldal {page} / {totalPages}</span>
        <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
          Következő
        </button>
      </div>
    </section>
  );
};

const normalizeHansa = useCallback((rows) => {
  let lastBesorolas = "";

  const cleanEmail = (raw) => {
    const rawEmail = String(raw ?? "")
    const email = String(raw ?? "")
      .split(/[;,]/)[0] // csak az első email (ha több van pontosvesszővel vagy vesszővel elválasztva)
      .replace(/\.+$/, "") // végéről pont eltávolítása
      .replace(/@{2,}/g, "@") // dupla vagy több kukacból egy kukac
      .toLowerCase()
      .normalize("NFD") // ékezetek bontása
      .replace(/[\u0300-\u036f]/g, "") // diakritikus karakterek törlése
      .trim();


      if (rawEmail.toLowerCase().includes("igazgató") || email.includes("igazgató")) {
        console.log("👉 1380. sor vagy igazgató e-mail:");
        console.log("  Nyers e-mail:", rawEmail);
        console.log("  Normalizált:", email);
      }
    
    return email;
  };

  return rows.reduce((acc, r) => {
    const email = cleanEmail(r["E-mail-cím"] ?? r["Kontakt személy e-mail-címe"]);
    if (!email) return acc;

    let besorol = (r["Besorolás"] || "").trim();
    if (besorol) {
      lastBesorolas = besorol;
    } else {
      besorol = lastBesorolas;
    }

    acc.push({
      "Kontakt sorszám": String(r["Kontakt sorszám"] || r["Kontaktsorszám"] || "").trim(),
      "Kontaktszemély":   String(r["Kontaktszemély"] || r["Név"] || "").trim(),
      "Email-cím":        email,
      "Besorolás":        besorol
    });
    return acc;
  }, []);
}, []);


    // 2) Mailchimp- és Unsubscribed-normalizáló: egységes kulcsokkal
    const normalizeMailchimp = useCallback((rows) => {
      return rows
        .map(r => {
          const kontaktSorszam = String(r["Phone Number"] || r["Phone number"] || "").trim();
          const nev            = String(r["First Name"]   || r["First name"]   || "").trim();
          const email          = String(r["Email address"]|| r["Email Address"]|| "")
                                   .toLowerCase()
                                   .trim();
          const rawTags        = String(r["TAGS"]         || r["tags"]         || "");
          const tagsArr        = rawTags
                                   .replace(/"/g, "")
                                   .split(",")
                                   .map(s => s.trim())
                                   .filter(Boolean);
          const besorolas      = tagsArr.join(", ");
          return {
            "Kontakt sorszám": kontaktSorszam,
            "Név":             nev,
            "Email-cím":       email,
            "Besorolás":       besorolas
          };
        })
        .filter(r => r["Email-cím"]);
    }, []);

  // 3) Átfogó beolvasó
const handleFile = useCallback((file, setter, type = "") => {
  if (!file) return;
  const ext = file.name.split(".").pop().toLowerCase();
  const reader = new FileReader();

  reader.onload = e => {
    try {
      let json = [];

      if (type === "hansa") {
        if (ext === "csv") {
          const text = e.target.result;
          const wb = XLSX.read(text, { type: "binary" });
          const sh = wb.Sheets[wb.SheetNames[0]];
          json = XLSX.utils.sheet_to_json(sh, { defval: "" });
        } else {
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, { type: "array" });
          const sh = wb.Sheets[wb.SheetNames[0]];
          json = XLSX.utils.sheet_to_json(sh, { defval: "" });
        }
      
        // 🔧 itt jön a nyers email kigyűjtés
        const allEmails = json.flatMap(r => {
          const raw1 = String(r["E-mail-cím"] ?? "").toLowerCase().trim();
          const raw2 = String(r["Kontakt személy e-mail-címe"] ?? "").toLowerCase().trim();
        
          return [raw1, raw2]
            .map(e =>
              e
                .replace(/\.+$/, "")    // végi pont eltávolítása
                .replace(/@{2,}/g, "@") // dupla kukac javítása
                .trim()
            )
            .filter(email => email && !email.endsWith("@agrolanc.hu"));
        });
        
        
        allRawHansaEmails.current = new Set(allEmails);
        
        
      
        json = normalizeHansa(json);
        setter(json);
        setStatus(s => ({ ...s, [type]: true }));
      
      

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
         const rawSet = allRawHansaEmails.current;
        console.log("Hansa e-mailek:", allRawHansaEmails.current);

       // új kontaktok: Hansa-ban van, Mailchimp-ben nincs
         setHiányzók(
           hansaContacts.filter(c => !mSet.has(c["Email-cím"]))
         );
       // feleslegesek: Mailchimp-ben van, Hansa-ban nincs
         setFeleslegesek(
          mailchimpContacts.filter(c => !rawSet.has(String(c["Email-cím"]).toLowerCase().trim()))
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
        <button onClick={() => setShowHansaMissing(v => !v)} style={{ marginLeft : 8 }} > {showHansaMissing ? "Mailchimpből hiányzó kontaktok mutatása" : "Hansából hiányzó kontaktok mutatása"}</button>
      </div>
      <div style={{ marginTop: 12 }}>
        <button onClick={() => setShowTestData(v => !v)}>
          {showTestData ? "Teszt adatok elrejtése" : "Teszt adatok mutatása"}
        </button>
      </div>

      {showHiány && (
  <section style={{ marginTop: 16 }}>
    {/* Dinamikus cím */}
    <h3>
      {showHansaMissing
        ? `Új kontaktok (${hiányzók.length})`
        : `Mailchimpben de Hansában nincs (${feleslegesek.length})`}
    </h3>

    {/* Akciógombok */}
    {showHansaMissing ? (
      <>
        <button onClick={exportExcel} style={{ marginRight: 8 }}>
          Exportálás Excelbe
        </button>
        <button onClick={filterUnsubscribed} style={{ marginRight: 8 }}>
          Leiratkozottak kiszűrése
        </button>
        <button onClick={exportNameMismatches}>
          Név-eltérések exportálása
        </button>
      </>
    ) : (
      
      <button onClick={() => {
        // ha szeretnél exportot a feleslegesekre:
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(feleslegesek);
        XLSX.utils.book_append_sheet(wb, ws, "Feleslegesek");
        XLSX.writeFile(wb, "mailchimp_feleslegesek.xlsx");
      }}>
        Exportálás Excelbe
      </button>
    )}
    

    {/* Táblázat ugyanazzal a renderTable függvénnyel */}
    {showHiány && (
  showHansaMissing ? (
    <DataTable
      title="Új kontaktok (Hansában de Mailchimpben nincs)"
      rows={hiányzók}
    />
  ) : (
    <DataTable
      title="Mailchimpben de Hansában nincs"
      rows={feleslegesek}
      columns={[
        { key: "Kontakt sorszám", label: "Kontakt sorszám" },
        { key: "Név",              label: "First Name"        },
        { key: "Email-cím",        label: "Email-cím"         },
        { key: "Besorolás",        label: "Besorolás"         },
      ]}
    />
  )
)}

  </section>
)}

      {/* Teszt adatok */}
      {showTestData && renderTestTable()}
    </main>
  );
}

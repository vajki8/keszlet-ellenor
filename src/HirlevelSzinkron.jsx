// cspell:disable
import { useState, useCallback, useEffect } from "react";
import * as XLSX from "xlsx";

export default function HirlevelSzinkron() {
  const [hansaContacts, setHansaContacts] = useState([]);
  const [mailchimpContacts, setMailchimpContacts] = useState([]);
  const [hiányzók, setHiányzók] = useState([]);
  const [feleslegesek, setFeleslegesek] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ hansa: false, mailchimp: false });
  const [testData, setTestData] = useState([]);
  const [showTestData, setShowTestData] = useState(true);


  // Pagination for új kontaktok
  const PAGE_SIZE = 25;
  const [page, setPage] = useState(1);
  const totalHiányPage = Math.ceil(hiányzók.length / PAGE_SIZE);
  const pagedHiányzók = hiányzók.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Teszt pagination
  const [testPage, setTestPage] = useState(1);
  const totalTestPage = Math.ceil(testData.length / PAGE_SIZE);
  const pagedTestData = testData.slice((testPage - 1) * PAGE_SIZE, testPage * PAGE_SIZE);

  // 1) Hansa-normalizáló
  const normalizeHansa = useCallback((rows) => {
    return rows
      .map(r => {
        const id      = String(r["Kontakt sorszám"] || r["Kontaktsorszám"] || "").trim();
        const name    = String(r["Név"]               || r["Kontakt személy neve"] || "").trim();
        const email   = String(r["Email-cím"]         || r["E-mail-cím"]           || "").toLowerCase().trim();
        const besorol = String(r["Besorolás"]         || "").trim();
        return { "Kontakt sorszám": id, "Név": name, "Email-cím": email, "Besorolás": besorol };
      })
      .filter(r => r["Email-cím"]);
  }, []);

  // 2) Mailchimp-normalizáló
  const normalizeMailchimp = useCallback((rows) => {
    return rows
      .map(r => ({
        "Email Address": (r["Email Address"] || "").toLowerCase().trim(),
        "First Name":    (r["First Name"]    || "").trim(),
        "Last Name":     (r["Last Name"]     || "").trim(),
      }))
      .filter(r => r["Email Address"]);
  }, []);

  // 3) Kézi CSV-parser
  const parseCsv = useCallback((text) => {
    const lines = text.split(/\r\n|\n/).filter(l => l.trim());
    const rows = lines.map(line => {
      const fields = [];
      let field = "", inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i+1] === '"') { field += '"'; i++; }
          else { inQuotes = !inQuotes; }
        } else if (ch === ',' && !inQuotes) {
          fields.push(field); field = "";
        } else {
          field += ch;
        }
      }
      fields.push(field);
      return fields;
    });
    const header = rows[0] || [];
    return rows.slice(1).map(r => {
      const obj = {};
      header.forEach((h, i) => obj[h] = r[i] ?? "");
      return obj;
    });
  }, []);

  // 4) Átfogó beolvasó: Hansa natív XLSX, Mailchimp kézi CSV
  const handleFile = useCallback((file, setContacts, type = "") => {
    if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const buffer = e.target.result;
        let json = [];

        if (type === "mailchimp") {
          // Mailchimp arc: XLSX-be álcázott CSV → kézi parser
          const wb = XLSX.read(buffer, { type: "array" });
          const sh = wb.Sheets[wb.SheetNames[0]];
          const range = XLSX.utils.decode_range(sh["!ref"] || "");
          const lines = [];
          for (let R = range.s.r; R <= range.e.r; ++R) {
            const cellRef = XLSX.utils.encode_cell({ c: 0, r: R });
            const cell = sh[cellRef];
            lines.push(cell ? (cell.w ?? cell.v).toString() : "");
          }
          json = parseCsv(lines.join("\n"));
        } else {
          // Hansa XLSX
          if (ext === "csv") {
            const text = e.target.result;
            const wb2 = XLSX.read(text, { type: "binary" });
            const sh2 = wb2.Sheets[wb2.SheetNames[0]];
            json = XLSX.utils.sheet_to_json(sh2, { defval: "" });
          } else {
            const data = new Uint8Array(buffer);
            const wb2 = XLSX.read(data, { type: "array" });
            const sh2 = wb2.Sheets[wb2.SheetNames[0]];
            json = XLSX.utils.sheet_to_json(sh2, { defval: "" });
          }
        }

        const normalized = type === "hansa"
          ? normalizeHansa(json)
          : normalizeMailchimp(json);

        setContacts(normalized);
        setStatus(s => ({ ...s, [type]: true }));
      } catch (err) {
        console.error("Hiba a fájl feldolgozásakor:", err);
      }
    };

    if (ext === "csv" && type !== "mailchimp") reader.readAsBinaryString(file);
    else reader.readAsArrayBuffer(file);
  }, [normalizeHansa, normalizeMailchimp, parseCsv]);

  // Drag & drop
  const handleDrop = useCallback(e => {
    e.preventDefault(); setDragOver(false);
    Array.from(e.dataTransfer.files).forEach(file => {
      const n = file.name.toLowerCase();
      if (n.includes("mailchimp")||n.includes("audience")) handleFile(file, setMailchimpContacts, "mailchimp");
      else handleFile(file, setHansaContacts, "hansa");
    });
  }, [handleFile]);

  // Összehasonlítás
  const compareContacts = useCallback(() => {
    setLoading(true);
    setTimeout(() => {
      const hSet = new Set(hansaContacts.map(c => c["Email-cím"]));
      const mSet = new Set(mailchimpContacts.map(c => c["Email Address"]));
      setHiányzók(hansaContacts.filter(c => !mSet.has(c["Email-cím"])));
      setFeleslegesek(mailchimpContacts.filter(c => !hSet.has(c["Email Address"])));
      setLoading(false); setPage(1);
    },300);
  },[hansaContacts, mailchimpContacts]);

  useEffect(() => {
    if (hansaContacts.length && mailchimpContacts.length) compareContacts();
  },[hansaContacts, mailchimpContacts, compareContacts]);

  // Teszt gomb
  const handleTest = useCallback(contacts => {
    setTestData(contacts); setTestPage(1);
  },[]);

  // Export Excel
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(hiányzók);
    XLSX.utils.book_append_sheet(wb, ws, "UjKontaktok");
    XLSX.writeFile(wb, "uj_kontaktok.xlsx");
  };

  // Teszt táblázat
  const renderTestTable = () => (
    <div style={{ marginTop:20 }}>
      <h3>Teszt Adatok ({testData.length})</h3>
      {testData.length===0 ? <p style={{color:"#777"}}>Nincs adat.</p> : (
        <>
          <table style={{width:"100%",borderCollapse:"collapse",background:"#f8f0ff"}}>
            <thead>
              <tr>
                {Object.keys(pagedTestData[0]||{}).map(k=>(
                  <th key={k} style={{borderBottom:"1px solid #ccc",padding:8,textAlign:"left"}}>{k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedTestData.map((r,i)=>(
                <tr key={i}>
                  {Object.values(r).map((v,j)=><td key={j} style={{borderBottom:"1px solid #eee",padding:8}}>{v}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{marginTop:8}}>
            <button onClick={()=>setTestPage(p=>Math.max(1,p-1))} disabled={testPage===1}>Előző</button>
            <span style={{margin:"0 12px"}}>Oldal {testPage}/{totalTestPage}</span>
            <button onClick={()=>setTestPage(p=>Math.min(totalTestPage,p+1))} disabled={testPage===totalTestPage}>Következő</button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <section style={{padding:16}}>
      <h2>Hírlevél szinkron</h2>

      <div
        onDrop={handleDrop}
        onDragOver={e=>{e.preventDefault();setDragOver(true);}}
        onDragLeave={()=>setDragOver(false)}
        style={{border:`2px dashed ${dragOver?"#6ba539":"#ccc"}`,padding:24,textAlign:"center",marginBottom:16,background:dragOver?"#f5fff0":"#fafafa"}}
      >
        Húzd ide a Hansa és Mailchimp fájlokat
      </div>

      <div style={{marginBottom:12}}>
        <label>Hansa lista:
          <input type="file" accept=".xlsx,.csv"
            onChange={e=>handleFile(e.target.files[0],setHansaContacts,"hansa")}
            style={{marginLeft:8}}/>
        </label>
        <button onClick={()=>handleTest(hansaContacts)} style={{marginLeft:8}}>Hansa teszt</button>
        {status.hansa && <span style={{marginLeft:8,color:"green"}}>✔️</span>}
      </div>

      <div style={{marginBottom:12}}>
        <label>Mailchimp lista:
          <input type="file" accept=".xlsx,.csv"
            onChange={e=>handleFile(e.target.files[0],setMailchimpContacts,"mailchimp")}
            style={{marginLeft:8}}/>
        </label>
        <button onClick={()=>handleTest(mailchimpContacts)} style={{marginLeft:8}}>Mailchimp teszt</button>
        {status.mailchimp && <span style={{marginLeft:8,color:"green"}}>✔️</span>}
      </div>

      {loading && <p>Összehasonlítás folyamatban…</p>}

      {hiányzók.length>0 && (
        <div style={{marginTop:24}}>
          <h3>Új kontaktok ({hiányzók.length})</h3>
          <button onClick={exportExcel} style={{marginBottom:8}}>Exportálás Excelbe</button>
          <table style={{width:"100%",borderCollapse:"collapse",background:"#f8f0ff"}}>
            <thead>
              <tr>
                {["Kontakt sorszám","Név","Email-cím","Besorolás"].map(col=>(
                  <th key={col} style={{borderBottom:"1px solid #ccc",padding:8,textAlign:"left"}}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedHiányzók.map((c,i)=>(
                <tr key={i}>
                  <td style={{padding:8}}>{c["Kontakt sorszám"]}</td>
                  <td style={{padding:8}}>{c["Név"]}</td>
                  <td style={{padding:8}}>{c["Email-cím"]}</td>
                  <td style={{padding:8}}>{c["Besorolás"]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{marginTop:8}}>
            <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1}>Előző</button>
            <span style={{margin:"0 12px"}}>Oldal {page}/{totalHiányPage}</span>
            <button onClick={()=>setPage(p=>Math.min(totalHiányPage,p+1))} disabled={page===totalHiányPage}>Következő</button>
          </div>
        </div>
      )}

      <div style={{marginTop:24}}>
        <button onClick={()=>setShowTestData(v=>!v)}>
          {showTestData?"Teszt adatok elrejtése":"Teszt adatok mutatása"}
        </button>
        {showTestData && renderTestTable()}
      </div>
    </section>
  );
}

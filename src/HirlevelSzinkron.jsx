//cspell:disable
// HirlevelSzinkron.jsx
import { useState, useCallback, useEffect } from "react";
import * as XLSX from "xlsx";

export default function HirlevelSzinkron() {
  const [hansaContacts, setHansaContacts] = useState([]);
  const [mailchimpContacts, setMailchimpContacts] = useState([]);
  const [hiányzók, setHiányzók] = useState(null);
  const [feleslegesek, setFeleslegesek] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState({ hansa: false, mailchimp: false });

  const normalizeHansa = (rows) => {
    return rows
      .map((r) => {
        const email = r["E-mail-cím"] || r["Kontakt személy e-mail-címe"] || "";
        const first = r["Kontakt személy neve"] || r["Kapcsolattartó neve"] || "";
        const code = r["Ügyfélkód"] || r["Partnerkód"] || r["Ügyfél kód"] || "";
        return {
          Email: email.toLowerCase().trim(),
          Név: first,
          Ügyfélkód: code,
        };
      })
      .filter((r) => r.Email);
  };

  const normalizeMailchimp = (rows) => {
    return rows
      .map((r) => {
        return {
          Email: r["Email Address"]?.toLowerCase().trim() || "",
          Név: `${r["First Name"] || ""} ${r["Last Name"] || ""}`.trim(),
          Ügyfélkód: r["Ügyfélkód"] || "",
        };
      })
      .filter((r) => r.Email);
  };

  const handleFile = useCallback((file, setContacts, type = "") => {
    if (!file) return;
    const extension = file.name.split('.').pop().toLowerCase();
    const reader = new FileReader();

    reader.onload = (e) => {
      let json = [];
      try {
        if (extension === 'csv') {
          const text = e.target.result;
          const workbook = XLSX.read(text, { type: "binary" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        } else {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        }
        const normalized = type === "hansa" ? normalizeHansa(json) : normalizeMailchimp(json);
        console.log(`${type} fájl betöltve:`, normalized.slice(0, 5));
        setContacts(normalized);
        setStatus((prev) => ({ ...prev, [type]: true }));
      } catch (err) {
        console.error("Hiba a fájl feldolgozásakor:", err);
      }
    };

    if (extension === 'csv') reader.readAsBinaryString(file);
    else reader.readAsArrayBuffer(file);
  }, []);

  const compareContacts = useCallback(() => {
    setLoading(true);
    setTimeout(() => {
      const hansaEmails = new Set(hansaContacts.map(c => c.Email));
      const mailchimpEmails = new Set(mailchimpContacts.map(c => c.Email));

      const ujKontaktok = hansaContacts.filter(c => !mailchimpEmails.has(c.Email));
      const feleslegesKontaktok = mailchimpContacts.filter(c => !hansaEmails.has(c.Email));

      setHiányzók(ujKontaktok);
      setFeleslegesek(feleslegesKontaktok);
      setLoading(false);
    }, 300);
  }, [hansaContacts, mailchimpContacts]);

  useEffect(() => {
    if (hansaContacts.length > 0 && mailchimpContacts.length > 0) {
      compareContacts();
    }
  }, [hansaContacts, mailchimpContacts, compareContacts]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach((file) => {
      const name = file.name.toLowerCase();
      if (name.includes("mailchimp") || name.includes("audience")) {
        handleFile(file, setMailchimpContacts, "mailchimp");
      } else if (name.includes("hansa") || name.includes("kontaktok")) {
        handleFile(file, setHansaContacts, "hansa");
      }
    });
  }, [handleFile]);

  const handleFileChange = (e, setContacts, type) => {
    const file = e.target.files[0];
    if (!file) return;
    handleFile(file, setContacts, type);
  };

  const renderTable = (title, rows) => (
    <div style={{ marginTop: "2rem" }}>
      <h3 style={{ fontWeight: "bold", fontSize: "1.2rem" }}>{title} ({rows.length})</h3>
      {rows.length === 0 ? <p style={{ color: "#777" }}>Nincs adat.</p> : (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "0.5rem", backgroundColor: "#f8f0ff" }}>
          <thead>
            <tr>
              {Object.keys(rows[0]).map((key) => (
                <th key={key} style={{ borderBottom: "1px solid #ccc", padding: "0.5rem", textAlign: "left" }}>{key}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
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

  return (
    <section style={{ marginTop: "4rem" }}>
      <h2 style={{ fontSize: "1.5rem", color: "#6ba539", marginBottom: "1rem" }}>Hírlevél szinkron</h2>

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
        <p style={{ margin: 0 }}>Húzd ide a fájlokat (.xlsx vagy .csv)</p>
        <p style={{ fontSize: "0.9rem", color: "#666" }}>(A fájl nevében szerepeljen: "mailchimp", "audience" vagy "hansa", "kontaktok")</p>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label style={{ fontWeight: "bold" }}>Hansa kontaktlista (.xlsx / .csv):</label><br />
        <input type="file" accept=".xlsx,.csv" onChange={(e) => handleFileChange(e, setHansaContacts, "hansa")} />
        <button onClick={() => console.log("Hansa lista", hansaContacts.slice(0, 20))} style={{ marginLeft: "1rem" }}>Hansa teszt</button>
        {status.hansa && <span style={{ marginLeft: "1rem", color: "green" }}>✔️ Betöltve</span>}
      </div>
      <div style={{ marginBottom: "1rem" }}>
        <label style={{ fontWeight: "bold" }}>Mailchimp kontaktlista (.xlsx / .csv):</label><br />
        <input type="file" accept=".xlsx,.csv" onChange={(e) => handleFileChange(e, setMailchimpContacts, "mailchimp")} />
        <button onClick={() => console.log("Mailchimp lista", mailchimpContacts.slice(0, 20))} style={{ marginLeft: "1rem" }}>Mailchimp teszt</button>
        {status.mailchimp && <span style={{ marginLeft: "1rem", color: "green" }}>✔️ Betöltve</span>}
      </div>

      {loading && (
        <div style={{ margin: "2rem 0" }}>
          <p style={{ marginBottom: "0.5rem", color: "#555" }}>Összehasonlítás folyamatban...</p>
          <div style={{ height: "8px", width: "100%", backgroundColor: "#eee", borderRadius: "4px" }}>
            <div style={{ width: "100%", height: "100%", backgroundColor: "#6ba539", animation: "progress 1s linear infinite" }} />
          </div>
        </div>
      )}

      {hiányzók !== null && renderTable("Új kontaktok (nincsenek Mailchimpben)", hiányzók)}
      {feleslegesek !== null && renderTable("Felesleges kontaktok (csak Mailchimpben)", feleslegesek)}

      <style>{`
        @keyframes progress {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(-50%); }
          100% { transform: translateX(0); }
        }
      `}</style>
    </section>
  );
}

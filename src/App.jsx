// cSpell:disable
import React, { useState, useCallback, useEffect } from "react";
import HirlevelSzinkron from "./HirlevelSzinkron";

const API = "http://localhost:8080";

function App() {
  const [view, setView] = useState("keszlet"); // "keszlet" vagy "hirlevel"

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filterText, setFilterText] = useState("");

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await fetch(`${API}/api/sync/report`);
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || "Ismeretlen hiba");
      setReport(data.report);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  async function runNow() {
    setBusy(true);
    setError("");
    try {
      const resp = await fetch(`${API}/api/sync/run-now`, { method: "POST" });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || "Ismeretlen hiba");
      setReport(data.report);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!window.confirm("Biztosan élesíted az eltéréseket az UNAS webshopban?")) return;
    setBusy(true);
    setError("");
    try {
      const resp = await fetch(`${API}/api/sync/approve`, { method: "POST" });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || "Ismeretlen hiba");
      alert(`Kész: ${data.updated ?? 0} tétel frissítve.`);
      await loadReport();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!window.confirm("Elveted a mai riportot? (Nem lesz frissítés UNAS-ban.)")) return;
    setBusy(true);
    try {
      await fetch(`${API}/api/sync/reject`, { method: "POST" });
      await loadReport();
    } finally {
      setBusy(false);
    }
  }

  const filterRows = rows => {
    if (!filterText) return rows;
    return rows.filter(row =>
      Object.values(row).some(v => String(v ?? "").toLowerCase().includes(filterText.toLowerCase()))
    );
  };

  const renderTable = (title, rows) => {
    const filtered = filterRows(rows || []);
    return (
      <div style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.25rem", color: "#333" }}>{title} ({filtered.length})</h2>
        {filtered.length === 0 ? (
          <p style={{ color: "#777" }}>Nincs találat.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "0.5rem" }}>
            <thead>
              <tr>
                {Object.keys(filtered[0]).map(key => (
                  <th key={key} style={{ borderBottom: "1px solid #ccc", textAlign: "left", padding: "0.5rem" }}>
                    {key}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => (
                <tr key={i}>
                  {Object.values(row).map((val, j) => (
                    <td key={j} style={{ borderBottom: "1px solid #eee", padding: "0.5rem" }}>{String(val ?? "")}</td>
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
    <div style={{ fontFamily: "sans-serif", background: "#f4f5f7", minHeight: "100vh" }}>
      <header
        style={{
          position: "sticky", top: 0, zIndex: 100, display: "flex", alignItems: "center",
          justifyContent: "space-between", padding: "1rem 2rem", background: "#4a772c",
          color: "#fff", boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
        }}
      >
        <h1 style={{ margin: 0 }}>Agrolánc programok</h1>
        <select
          value={view}
          onChange={e => setView(e.target.value)}
          style={{ padding: "0.5rem 1rem", borderRadius: 4, border: "1px solid #ccc", fontSize: "1rem", background: "#fff", marginLeft: "1rem" }}
        >
          <option value="keszlet">Készlet-ellenőrzés</option>
          <option value="hirlevel">Hírlevél szinkron</option>
        </select>
      </header>

      {view === "keszlet" && (
        <main style={{ padding: "2rem", maxWidth: "1000px", margin: "2rem auto" }}>
          <h1 style={{ fontSize: "1.75rem", fontWeight: "bold", color: "#6ba539", marginBottom: "0.5rem" }}>
            Készlet-ellenőrző
          </h1>
          <p style={{ color: "#666", marginTop: 0 }}>
            Minden hétköznap reggel automatikusan lekéri a Hansa-fájlt és az élő UNAS készletet,
            majd itt megjelenik egy jóváhagyásra váró riport.
          </p>

          <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem" }}>
            <button
              onClick={runNow}
              disabled={busy}
              style={{ backgroundColor: "#888", color: "white", padding: "0.5rem 1rem", border: "none", borderRadius: "6px", fontWeight: "bold", cursor: "pointer" }}
            >
              Ellenőrzés futtatása most
            </button>
            <button
              onClick={loadReport}
              disabled={busy || loading}
              style={{ backgroundColor: "#ccc", color: "#333", padding: "0.5rem 1rem", border: "none", borderRadius: "6px", fontWeight: "bold", cursor: "pointer" }}
            >
              Frissítés
            </button>
          </div>

          {error && (
            <div style={{ background: "#fdeaea", border: "1px solid #f3b3b3", color: "#a33", borderRadius: 8, padding: "1rem", marginBottom: "1.5rem" }}>
              Hiba: {error}
            </div>
          )}

          {loading && <p>Betöltés...</p>}

          {!loading && !report && !error && (
            <p style={{ color: "#777" }}>Még nincs riport. Kattints az "Ellenőrzés futtatása most" gombra.</p>
          )}

          {report && (
            <>
              <div style={{ background: "#fff", border: "1px solid #ddd", borderRadius: 8, padding: "1rem", marginBottom: "1.5rem" }}>
                <div><strong>Forrásfájl:</strong> {report.sourceFile?.name} (módosítva: {new Date(report.sourceFile?.modifiedAt).toLocaleString("hu-HU")})</div>
                <div><strong>Riport időpontja:</strong> {new Date(report.createdAt).toLocaleString("hu-HU")}</div>
                <div><strong>Állapot:</strong> {report.status === "pending" ? "Jóváhagyásra vár" : "Jóváhagyva"}</div>
                {report.pushResult && <div><strong>Frissített tételek:</strong> {report.pushResult.updated}</div>}
              </div>

              {report.status === "pending" && (
                <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem" }}>
                  <button
                    onClick={approve}
                    disabled={busy}
                    style={{ backgroundColor: "#2d6cdf", color: "white", padding: "0.75rem 1.5rem", border: "none", borderRadius: "6px", fontWeight: "bold", cursor: "pointer" }}
                  >
                    Jóváhagyás és élesítés UNAS-ban ({report.diff.elteresek.length} tétel)
                  </button>
                  <button
                    onClick={reject}
                    disabled={busy}
                    style={{ backgroundColor: "#ddd", color: "#333", padding: "0.75rem 1.5rem", border: "none", borderRadius: "6px", fontWeight: "bold", cursor: "pointer" }}
                  >
                    Elvetés
                  </button>
                </div>
              )}

              <div style={{ marginBottom: "1rem" }}>
                <input
                  type="text"
                  placeholder="Szűrés bármelyik oszlopban..."
                  value={filterText}
                  onChange={e => setFilterText(e.target.value)}
                  style={{ padding: "0.5rem", width: "300px" }}
                />
              </div>

              {renderTable("Eltérések (ezek frissülnek jóváhagyáskor)", report.diff.elteresek)}
              {renderTable("Egyező tételek", report.diff.egyezok)}
              {renderTable("Nem található az UNAS-ban", report.diff.nemTalalhatoUnasban)}
            </>
          )}
        </main>
      )}

      {view === "hirlevel" && (
        <main style={{ padding: "2rem", maxWidth: "800px", margin: "auto" }}>
          <HirlevelSzinkron />
        </main>
      )}
    </div>
  );
}

export default App;

// cSpell:disable
import React, { useState, useCallback, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import HirlevelSzinkron from "./HirlevelSzinkron";
import SyncTortenet from "./SyncTortenet";
import "./App.css";

const API = "http://localhost:8080";

const TABS = [
  { id: "keszlet", label: "Készlet-ellenőrzés" },
  { id: "tortenet", label: "Előzmények" },
  { id: "hirlevel", label: "Hírlevél szinkron" },
];

const pageTransition = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] },
};

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    try {
      const saved = localStorage.getItem("theme");
      if (saved) return saved === "dark";
      return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.body.classList.toggle("dark", dark);
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {
      // ignore
    }
  }, [dark]);

  return [dark, setDark];
}

function ThemeToggle({ dark, onToggle }) {
  return (
    <button
      className="icon-btn"
      onClick={onToggle}
      title={dark ? "Világos mód" : "Sötét mód"}
      aria-label="Téma váltása"
    >
      <motion.span
        key={dark ? "moon" : "sun"}
        initial={{ rotate: -90, opacity: 0 }}
        animate={{ rotate: 0, opacity: 1 }}
        transition={{ duration: 0.25 }}
      >
        {dark ? "🌙" : "☀️"}
      </motion.span>
    </button>
  );
}

function Tabs({ view, setView }) {
  return (
    <div className="tabs">
      {TABS.map(t => (
        <button
          key={t.id}
          className={`tab ${view === t.id ? "active" : ""}`}
          onClick={() => setView(t.id)}
        >
          {view === t.id && (
            <motion.span
              layoutId="tab-pill"
              className="tab-pill"
              transition={{ type: "spring", stiffness: 500, damping: 38 }}
            />
          )}
          <span style={{ position: "relative", zIndex: 1 }}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

function StatusBadge({ status, note }) {
  if (status === "needs_review") {
    return (
      <span className="badge badge-warn" title={note}>
        <span className="badge-dot" /> Kézi jóváhagyásra vár
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="badge badge-err" title={note}>
        <span className="badge-dot" /> Hiba
      </span>
    );
  }
  return (
    <span className="badge badge-ok">
      <span className="badge-dot" /> Automatikusan élesítve
    </span>
  );
}

function DataTable({ title, rows, delay = 0 }) {
  if (!rows || rows.length === 0) {
    return (
      <div style={{ marginTop: "1.75rem" }}>
        <h2 style={{ fontSize: "1.05rem", color: "var(--text)", marginBottom: "0.6rem" }}>
          {title} <span style={{ color: "var(--text-faint)", fontWeight: 500 }}>(0)</span>
        </h2>
        <div className="card empty-state">Nincs találat.</div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: [0.16, 1, 0.3, 1] }}
      style={{ marginTop: "1.75rem" }}
    >
      <h2 style={{ fontSize: "1.05rem", color: "var(--text)", marginBottom: "0.6rem" }}>
        {title} <span style={{ color: "var(--text-faint)", fontWeight: 500 }}>({rows.length})</span>
      </h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              {Object.keys(rows[0]).map(key => (
                <th key={key}>{key}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {Object.values(row).map((val, j) => (
                  <td key={j}>{String(val ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}

function KeszletView() {
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
      await loadReport();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!window.confirm("Elveted a mai riportot? (Nem lesz frissítés UNAS-ban, holnap újra lefut az ellenőrzés.)")) return;
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

  const filtered = useMemo(() => ({
    elteresek: filterRows(report?.diff?.elteresek || []),
    egyezok: filterRows(report?.diff?.egyezok || []),
    nemTalalhato: filterRows(report?.diff?.nemTalalhatoUnasban || []),
  }), [report, filterText]);

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Készlet-ellenőrző</h1>
        <p className="page-subtitle">
          Minden nap reggel 10:00-kor automatikusan lekéri a Hansa-fájlt a szinkronizált mappából
          és az élő UNAS készletet, majd az eltéréseket automatikusan élesíti. Ha gyanúsan sok
          eltérés van, a rendszer kézi átnézésre vár itt.
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.6rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={runNow} disabled={busy}>
          {busy ? <span className="spinner" /> : "▶"} Ellenőrzés futtatása most
        </button>
        <button className="btn btn-ghost" onClick={loadReport} disabled={busy || loading}>
          ⟳ Frissítés
        </button>
      </div>

      <AnimatePresence mode="wait">
        {error && (
          <motion.div
            key="error"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="card"
            style={{ background: "var(--err-bg)", borderColor: "var(--err)", color: "var(--err)", padding: "1rem", marginBottom: "1.5rem" }}
          >
            Hiba: {error}
          </motion.div>
        )}
      </AnimatePresence>

      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", color: "var(--text-dim)" }}>
          <span className="spinner" /> Betöltés...
        </div>
      )}

      {!loading && !report && !error && (
        <div className="card empty-state">Még nincs riport. Kattints az "Ellenőrzés futtatása most" gombra.</div>
      )}

      {report && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem" }}>
            <StatusBadge status={report.status} note={report.note} />
            <span style={{ color: "var(--text-faint)", fontSize: "0.82rem" }}>
              {report.sourceFile?.name} · {new Date(report.createdAt).toLocaleString("hu-HU")}
            </span>
          </div>

          <div className="stat-grid">
            <motion.div className="card stat-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
              <span className="stat-label">Eltérés</span>
              <span className="stat-value" style={{ color: "var(--warn)" }}>{report.diff.elteresek.length}</span>
            </motion.div>
            <motion.div className="card stat-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <span className="stat-label">Egyezik</span>
              <span className="stat-value" style={{ color: "var(--ok)" }}>{report.diff.egyezok.length}</span>
            </motion.div>
            <motion.div className="card stat-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
              <span className="stat-label">Nincs UNAS-ban</span>
              <span className="stat-value" style={{ color: "var(--text-dim)" }}>{report.diff.nemTalalhatoUnasban.length}</span>
            </motion.div>
            <motion.div className="card stat-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <span className="stat-label">Eltérési arány</span>
              <span className="stat-value">{Math.round((report.diffRatio ?? 0) * 100)}%</span>
            </motion.div>
          </div>

          {report.status === "needs_review" && (
            <div style={{ display: "flex", gap: "0.6rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={approve} disabled={busy}>
                Mégis élesítés UNAS-ban ({report.diff.elteresek.length} tétel)
              </button>
              <button className="btn btn-ghost" onClick={reject} disabled={busy}>
                Elvetés
              </button>
            </div>
          )}

          <input
            type="text"
            className="search-input"
            placeholder="Szűrés bármelyik oszlopban..."
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
          />

          <DataTable title="Eltérések (ezek frissülnek jóváhagyáskor)" rows={filtered.elteresek} delay={0} />
          <DataTable title="Egyező tételek" rows={filtered.egyezok} delay={0.06} />
          <DataTable title="Nem található az UNAS-ban" rows={filtered.nemTalalhato} delay={0.12} />
        </motion.div>
      )}
    </div>
  );
}

function App() {
  const [view, setView] = useState("keszlet");
  const [dark, setDark] = useDarkMode();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">A</span>
          Agrolánc programok
        </div>
        <div className="topbar-right">
          <Tabs view={view} setView={setView} />
          <ThemeToggle dark={dark} onToggle={() => setDark(d => !d)} />
        </div>
      </header>

      <AnimatePresence mode="wait">
        {view === "keszlet" && (
          <motion.div key="keszlet" {...pageTransition}>
            <KeszletView />
          </motion.div>
        )}
        {view === "tortenet" && (
          <motion.div key="tortenet" {...pageTransition}>
            <div className="page">
              <SyncTortenet />
            </div>
          </motion.div>
        )}
        {view === "hirlevel" && (
          <motion.div key="hirlevel" {...pageTransition}>
            <div className="page" style={{ maxWidth: 1000 }}>
              <HirlevelSzinkron />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;

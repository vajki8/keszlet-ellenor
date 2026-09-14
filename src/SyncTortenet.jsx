// cSpell:disable
import { useState, useEffect, useCallback, useMemo } from "react";
import { motion } from "framer-motion";

const API = "http://localhost:8080";

const STATUS_LABEL = {
  auto_approved: "Élesítve",
  needs_review: "Kézi jóváhagyás",
  error: "Hiba",
};

const STATUS_CLASS = {
  auto_approved: "badge-ok",
  needs_review: "badge-warn",
  error: "badge-err",
};

const BAR_COLOR_VAR = {
  auto_approved: "var(--ok)",
  needs_review: "var(--warn)",
  error: "var(--err)",
};

const TRIGGER_LABEL = {
  scheduler: "Napi automata",
  manual: "Kézi futtatás",
  approve: "Kézi jóváhagyás",
};

function formatDate(iso) {
  return new Date(iso).toLocaleString("hu-HU");
}

function Badge({ status }) {
  return (
    <span className={`badge ${STATUS_CLASS[status] || "badge-warn"}`}>
      <span className="badge-dot" /> {STATUS_LABEL[status] || status}
    </span>
  );
}

function BarChart({ entries }) {
  const width = 760;
  const height = 190;
  const padding = 30;

  const data = useMemo(() => entries.slice().reverse(), [entries]);
  const maxUpdated = Math.max(1, ...data.map(e => e.updated || 0));
  const barGap = 5;
  const barWidth = data.length ? Math.max(4, (width - padding * 2) / data.length - barGap) : 0;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
      role="img"
      aria-label="Napi frissített tételek száma"
    >
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="var(--border)" />
      {data.map((e, i) => {
        const barHeight = e.status === "error" ? 4 : Math.max(3, ((e.updated || 0) / maxUpdated) * (height - padding * 2));
        const x = padding + i * (barWidth + barGap);
        const y = height - padding - barHeight;
        const color = BAR_COLOR_VAR[e.status] || "var(--text-faint)";
        return (
          <motion.rect
            key={i}
            x={x}
            width={barWidth}
            rx="3"
            fill={color}
            initial={{ y: height - padding, height: 0, opacity: 0 }}
            animate={{ y, height: barHeight, opacity: 1 }}
            transition={{ duration: 0.5, delay: i * 0.012, ease: [0.16, 1, 0.3, 1] }}
          >
            <title>
              {formatDate(e.at)} — {STATUS_LABEL[e.status] || e.status} — {e.updated || 0} tétel
            </title>
          </motion.rect>
        );
      })}
    </svg>
  );
}

export default function SyncTortenet() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await fetch(`${API}/api/sync/history`);
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || "Ismeretlen hiba");
      setHistory(data.history);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const recentForChart = history.slice(0, 30);

  const summary = useMemo(() => {
    const total = history.length;
    const errors = history.filter(e => e.status === "error").length;
    const totalUpdated = history.reduce((s, e) => s + (e.updated || 0), 0);
    const last = history[0];
    return { total, errors, totalUpdated, last };
  }, [history]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Szinkron előzmények</h1>
        <p className="page-subtitle">
          Minden futás (automata, kézi vagy jóváhagyás) itt nyomon követhető: mikor, mi történt, hány
          tétel frissült, és volt-e hiba.
        </p>
      </div>

      <div style={{ marginBottom: "1.5rem" }}>
        <button className="btn btn-ghost" onClick={load} disabled={loading}>
          {loading ? <span className="spinner" /> : "⟳"} Frissítés
        </button>
      </div>

      {error && (
        <div className="card" style={{ background: "var(--err-bg)", borderColor: "var(--err)", color: "var(--err)", padding: "1rem", marginBottom: "1.5rem" }}>
          Hiba: {error}
        </div>
      )}

      {loading && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", color: "var(--text-dim)" }}>
          <span className="spinner" /> Betöltés...
        </div>
      )}

      {!loading && history.length === 0 && !error && (
        <div className="card empty-state">Még nincs egyetlen naplózott futás sem.</div>
      )}

      {!loading && history.length > 0 && (
        <>
          <div className="stat-grid">
            <motion.div className="card stat-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <span className="stat-label">Összes futás</span>
              <span className="stat-value">{summary.total}</span>
            </motion.div>
            <motion.div className="card stat-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
              <span className="stat-label">Összes frissített tétel</span>
              <span className="stat-value" style={{ color: "var(--ok)" }}>{summary.totalUpdated}</span>
            </motion.div>
            <motion.div className="card stat-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <span className="stat-label">Hibák</span>
              <span className="stat-value" style={{ color: summary.errors ? "var(--err)" : "var(--text)" }}>{summary.errors}</span>
            </motion.div>
            <motion.div className="card stat-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
              <span className="stat-label">Utolsó futás</span>
              <span style={{ fontSize: "0.95rem", fontWeight: 700 }}>
                {summary.last ? formatDate(summary.last.at) : "—"}
              </span>
            </motion.div>
          </div>

          <motion.div
            className="card"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            style={{ padding: "1.25rem", marginBottom: "1.5rem" }}
          >
            <div style={{ fontWeight: 700, marginBottom: "0.75rem" }}>
              Frissített tételek (utolsó {recentForChart.length} futás)
            </div>
            <BarChart entries={recentForChart} />
          </motion.div>

          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  {["Időpont", "Forrás", "Állapot", "Forrásfájl", "Frissült", "Eltérés", "Egyezés", "Megjegyzés"].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((e, i) => (
                  <tr key={i}>
                    <td>{formatDate(e.at)}</td>
                    <td>{TRIGGER_LABEL[e.trigger] || e.trigger}</td>
                    <td><Badge status={e.status} /></td>
                    <td>{e.sourceFile?.name || "—"}</td>
                    <td>{e.updated ?? "—"}</td>
                    <td>{e.elteresekCount ?? "—"}</td>
                    <td>{e.egyezokCount ?? "—"}</td>
                    <td style={{ color: "var(--text-dim)", whiteSpace: "normal", maxWidth: 260 }}>
                      {e.error || e.note || ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

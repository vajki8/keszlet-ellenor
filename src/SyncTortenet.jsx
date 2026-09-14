// cSpell:disable
import { useState, useEffect, useCallback, useMemo } from "react";

const API = "http://localhost:8080";

const STATUS_LABEL = {
  auto_approved: "Automatikusan élesítve",
  needs_review: "Kézi jóváhagyásra várt",
  error: "Hiba történt",
};

const STATUS_COLOR = {
  auto_approved: "#2c6b2c",
  needs_review: "#8a6400",
  error: "#a33",
};

const TRIGGER_LABEL = {
  scheduler: "Napi automata",
  manual: "Kézi futtatás",
  approve: "Kézi jóváhagyás",
};

function formatDate(iso) {
  return new Date(iso).toLocaleString("hu-HU");
}

function BarChart({ entries }) {
  const width = 720;
  const height = 180;
  const padding = 28;

  const data = useMemo(() => entries.slice().reverse(), [entries]);
  const maxUpdated = Math.max(1, ...data.map(e => e.updated || 0));
  const barGap = 4;
  const barWidth = data.length ? Math.max(4, (width - padding * 2) / data.length - barGap) : 0;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: "100%", height: "auto", display: "block" }}
      role="img"
      aria-label="Napi frissített tételek száma"
    >
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#ccc" />
      {data.map((e, i) => {
        const barHeight = e.status === "error" ? 3 : ((e.updated || 0) / maxUpdated) * (height - padding * 2);
        const x = padding + i * (barWidth + barGap);
        const y = height - padding - barHeight;
        const color = STATUS_COLOR[e.status] || "#999";
        return (
          <g key={i}>
            <rect x={x} y={y} width={barWidth} height={Math.max(2, barHeight)} fill={color} rx="2">
              <title>
                {formatDate(e.at)} — {STATUS_LABEL[e.status] || e.status} — {e.updated || 0} tétel
              </title>
            </rect>
          </g>
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

  return (
    <div>
      <h1 style={{ fontSize: "1.75rem", fontWeight: "bold", color: "#6ba539", marginBottom: "0.5rem" }}>
        Szinkron előzmények
      </h1>
      <p style={{ color: "#666", marginTop: 0 }}>
        Minden futás (automata, kézi vagy jóváhagyás) itt nyomon követhető: mikor, mi történt, hány tétel
        frissült, és volt-e hiba.
      </p>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <button
          onClick={load}
          disabled={loading}
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

      {!loading && history.length === 0 && !error && (
        <p style={{ color: "#777" }}>Még nincs egyetlen naplózott futás sem.</p>
      )}

      {!loading && history.length > 0 && (
        <>
          <div style={{ background: "#fff", border: "1px solid #ddd", borderRadius: 8, padding: "1rem", marginBottom: "1.5rem" }}>
            <div style={{ fontWeight: "bold", marginBottom: "0.5rem", color: "#333" }}>
              Frissített tételek száma (utolsó {recentForChart.length} futás)
            </div>
            <BarChart entries={recentForChart} />
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Időpont", "Forrás", "Állapot", "Forrásfájl", "Frissült", "Eltérés", "Egyezés", "Megjegyzés"].map(h => (
                  <th key={h} style={{ borderBottom: "1px solid #ccc", textAlign: "left", padding: "0.5rem" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((e, i) => (
                <tr key={i}>
                  <td style={{ borderBottom: "1px solid #eee", padding: "0.5rem", whiteSpace: "nowrap" }}>{formatDate(e.at)}</td>
                  <td style={{ borderBottom: "1px solid #eee", padding: "0.5rem" }}>{TRIGGER_LABEL[e.trigger] || e.trigger}</td>
                  <td style={{ borderBottom: "1px solid #eee", padding: "0.5rem", color: STATUS_COLOR[e.status] || "#333", fontWeight: "bold" }}>
                    {STATUS_LABEL[e.status] || e.status}
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: "0.5rem" }}>{e.sourceFile?.name || "—"}</td>
                  <td style={{ borderBottom: "1px solid #eee", padding: "0.5rem" }}>{e.updated ?? "—"}</td>
                  <td style={{ borderBottom: "1px solid #eee", padding: "0.5rem" }}>{e.elteresekCount ?? "—"}</td>
                  <td style={{ borderBottom: "1px solid #eee", padding: "0.5rem" }}>{e.egyezokCount ?? "—"}</td>
                  <td style={{ borderBottom: "1px solid #eee", padding: "0.5rem", color: "#666" }}>
                    {e.error || e.note || ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

import React, { useEffect, useMemo, useState } from "react";

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function pipelineLabel(value) {
  if (value === "rent2buy") return "Rent2Buy";
  if (value === "cars") return "Cars";
  return "Finance";
}

export default function StockReconciliationAgent() {
  const [visible, setVisible] = useState(() => window.location.pathname === "/vansco-stock-watch");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const sync = () => setVisible(window.location.pathname === "/vansco-stock-watch");
    window.addEventListener("popstate", sync);
    const timer = window.setInterval(sync, 800);
    return () => {
      window.removeEventListener("popstate", sync);
      window.clearInterval(timer);
    };
  }, []);

  const metrics = useMemo(() => Object.entries(result?.metrics || {}), [result]);
  if (!visible) return null;

  async function run() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/stock-reconciliation-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "read_only" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Stock reconciliation could not complete.");
      setResult(payload);
      setOpen(true);
    } catch (err) {
      setError(err?.message || "Stock reconciliation could not complete.");
      setOpen(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={run}
        disabled={loading}
        title="Read-only analysis of Stock Watch exceptions. It cannot change stock."
        style={{
          position: "fixed",
          right: 18,
          bottom: 66,
          zIndex: 9996,
          border: "1px solid #c4b5fd",
          borderRadius: 999,
          padding: "9px 12px",
          background: "rgba(250,245,255,.97)",
          color: "#6d28d9",
          boxShadow: "0 10px 28px rgba(15,23,42,.12)",
          fontSize: 10,
          fontWeight: 950,
          cursor: loading ? "wait" : "pointer",
          opacity: loading ? .72 : 1,
        }}
      >
        {loading ? "Analysing stock…" : "✨ Reconcile stock"}
      </button>

      {open ? (
        <div role="dialog" aria-modal="true" aria-label="Stock Reconciliation Agent" onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 100001, display: "grid", placeItems: "center", padding: 18, background: "rgba(15,23,42,.5)", backdropFilter: "blur(5px)" }}>
          <div onClick={(event) => event.stopPropagation()} style={{ width: "min(900px,96vw)", maxHeight: "88vh", overflow: "auto", borderRadius: 22, background: "#f8fafc", boxShadow: "0 28px 80px rgba(2,6,23,.34)" }}>
            <div style={{ position: "sticky", top: 0, zIndex: 2, display: "flex", justifyContent: "space-between", gap: 14, padding: "18px 20px", background: "rgba(255,255,255,.97)", borderBottom: "1px solid #e2e8f0", backdropFilter: "blur(12px)" }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 950, color: "#6d28d9", textTransform: "uppercase", letterSpacing: ".09em" }}>Read-only agent</div>
                <div style={{ marginTop: 3, fontSize: 20, fontWeight: 950, color: "#0f172a" }}>Stock Reconciliation</div>
                <div style={{ marginTop: 4, fontSize: 10, color: "#64748b" }}>Finds exceptions and patterns. It cannot delete, hide, publish or reprice vehicles.</div>
              </div>
              <button type="button" onClick={() => setOpen(false)} style={{ border: 0, width: 31, height: 31, borderRadius: 999, background: "#e2e8f0", color: "#334155", fontSize: 18, cursor: "pointer" }}>×</button>
            </div>

            <div style={{ padding: 16 }}>
              {error ? <div role="alert" style={{ border: "1px solid #fecaca", borderRadius: 12, padding: 11, background: "#fff", color: "#b91c1c", fontSize: 10, fontWeight: 800 }}>{error}</div> : null}
              {result ? (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 9 }}>
                    {metrics.map(([pipeline, item]) => (
                      <div key={pipeline} style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, background: "#fff" }}>
                        <div style={{ fontSize: 11, fontWeight: 950, color: "#0f172a" }}>{pipelineLabel(pipeline)}</div>
                        <div style={{ marginTop: 7, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 9, color: "#64748b" }}>
                          <span>Source <strong style={{ color: "#334155" }}>{item.source_registrations}</strong></span>
                          <span>Local <strong style={{ color: "#334155" }}>{item.local_registrations}</strong></span>
                          <span>Missing <strong style={{ color: item.missing_from_local ? "#b91c1c" : "#047857" }}>{item.missing_from_local}</strong></span>
                          <span>Local-only <strong style={{ color: item.local_not_source ? "#c2410c" : "#047857" }}>{item.local_not_source}</strong></span>
                          <span>Duplicates <strong>{item.duplicate_source_rows}</strong></span>
                          <span>Price diffs <strong>{item.price_differences}</strong></span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ marginTop: 11, border: "1px solid #ddd6fe", borderRadius: 14, padding: 13, background: "#faf8ff" }}>
                    <div style={{ fontSize: 9, fontWeight: 950, color: "#6d28d9", textTransform: "uppercase", letterSpacing: ".06em" }}>Agent summary</div>
                    <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.55, color: "#334155" }}>{result.report?.summary}</div>
                    {result.ai_error ? <div style={{ marginTop: 7, fontSize: 9, color: "#9a3412" }}>AI pattern review unavailable: {result.ai_error}. Deterministic reconciliation still completed.</div> : null}
                  </div>

                  {result.report?.priority_exceptions?.length ? (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ marginBottom: 7, fontSize: 11, fontWeight: 950, color: "#0f172a" }}>Priority exceptions to review</div>
                      <div style={{ display: "grid", gap: 7 }}>
                        {result.report.priority_exceptions.slice(0, 20).map((item, index) => (
                          <div key={`${item.registration}:${index}`} style={{ border: "1px solid #e2e8f0", borderRadius: 11, padding: 10, background: "#fff" }}>
                            <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
                              <strong style={{ fontSize: 11, color: "#0f172a" }}>{item.registration || "No registration"}</strong>
                              <span style={{ borderRadius: 999, padding: "3px 6px", background: "#f1f5f9", color: "#475569", fontSize: 8, fontWeight: 850 }}>{pipelineLabel(item.pipeline)}</span>
                            </div>
                            <div style={{ marginTop: 4, fontSize: 9, lineHeight: 1.45, color: "#64748b" }}>{item.reason}</div>
                            <div style={{ marginTop: 4, fontSize: 9, lineHeight: 1.45, color: "#334155", fontWeight: 750 }}>{item.review}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {result.report?.patterns?.length ? (
                    <div style={{ marginTop: 12, borderTop: "1px solid #e2e8f0", paddingTop: 11 }}>
                      <div style={{ marginBottom: 7, fontSize: 11, fontWeight: 950, color: "#0f172a" }}>Patterns spotted</div>
                      {result.report.patterns.map((item, index) => <div key={index} style={{ marginBottom: 7, fontSize: 9, lineHeight: 1.5, color: "#475569" }}><strong style={{ color: "#334155" }}>{item.pattern}</strong> · {item.evidence}</div>)}
                    </div>
                  ) : null}

                  {result.report?.next_steps?.length ? (
                    <div style={{ marginTop: 12, borderRadius: 12, padding: 11, background: "#ecfdf5", color: "#065f46" }}>
                      <div style={{ fontSize: 9, fontWeight: 950, textTransform: "uppercase", letterSpacing: ".06em" }}>Suggested human checks</div>
                      <ul style={{ margin: "7px 0 0", paddingLeft: 17, fontSize: 9, lineHeight: 1.55 }}>{result.report.next_steps.map((item, index) => <li key={index}>{item}</li>)}</ul>
                    </div>
                  ) : null}

                  <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ fontSize: 8, color: "#94a3b8" }}>Checked {formatTime(result.checked_at)} · {result.exception_count} exception records found · no writes performed</div>
                    <button type="button" onClick={run} disabled={loading} style={{ border: "1px solid #c4b5fd", borderRadius: 9, padding: "7px 10px", background: "#fff", color: "#6d28d9", fontSize: 9, fontWeight: 900, cursor: loading ? "wait" : "pointer" }}>{loading ? "Running…" : "Run again"}</button>
                  </div>
                </>
              ) : !error ? <div style={{ padding: 28, textAlign: "center", color: "#64748b", fontSize: 11 }}>Run the agent to build a fresh read-only reconciliation.</div> : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

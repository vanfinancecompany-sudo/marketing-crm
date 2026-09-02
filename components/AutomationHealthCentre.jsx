import React, { useEffect, useMemo, useState } from "react";

function formatTime(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function tone(status) {
  const value = String(status || "").toLowerCase();
  if (value === "failed" || value === "error") return { bg: "#fef2f2", fg: "#b91c1c", dot: "#dc2626", label: "Needs attention" };
  if (value === "running") return { bg: "#eff6ff", fg: "#1d4ed8", dot: "#2563eb", label: "Running" };
  if (value === "waiting" || value === "scheduled") return { bg: "#f8fafc", fg: "#64748b", dot: "#94a3b8", label: value === "waiting" ? "Waiting" : "Scheduled" };
  return { bg: "#ecfdf5", fg: "#047857", dot: "#10b981", label: "Healthy" };
}

function AutomationRow({ item }) {
  const colours = tone(item.status);
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 12, background: "#ffffff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#0f172a" }}>{item.label}</div>
          <div style={{ marginTop: 3, fontSize: 10, color: "#64748b" }}>{item.cadence}</div>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "5px 8px", background: colours.bg, color: colours.fg, fontSize: 9, fontWeight: 900 }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: colours.dot }} />
          {colours.label}
        </span>
      </div>
      <div style={{ marginTop: 9, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(125px,1fr))", gap: 7 }}>
        <div><div style={{ fontSize: 8, fontWeight: 900, color: "#94a3b8", textTransform: "uppercase" }}>Last attempt</div><div style={{ marginTop: 2, fontSize: 10, color: "#334155" }}>{formatTime(item.last_attempt_at)}</div></div>
        <div><div style={{ fontSize: 8, fontWeight: 900, color: "#94a3b8", textTransform: "uppercase" }}>Last success</div><div style={{ marginTop: 2, fontSize: 10, color: "#334155" }}>{formatTime(item.last_success_at)}</div></div>
        <div><div style={{ fontSize: 8, fontWeight: 900, color: "#94a3b8", textTransform: "uppercase" }}>Duration</div><div style={{ marginTop: 2, fontSize: 10, color: "#334155" }}>{formatDuration(item.duration_ms)}</div></div>
        <div><div style={{ fontSize: 8, fontWeight: 900, color: "#94a3b8", textTransform: "uppercase" }}>Next expected</div><div style={{ marginTop: 2, fontSize: 10, color: "#334155" }}>{formatTime(item.next_expected_at)}</div></div>
      </div>
      {item.detail ? <div style={{ marginTop: 8, fontSize: 9, lineHeight: 1.4, color: "#64748b" }}>{item.detail}</div> : null}
      {item.last_error ? <div style={{ marginTop: 8, borderRadius: 9, padding: "7px 8px", background: "#fff7ed", color: "#9a3412", fontSize: 9, lineHeight: 1.4, fontWeight: 750 }}>{item.last_error}</div> : null}
      {item.telemetry === "schedule_only" ? <div style={{ marginTop: 6, fontSize: 8, color: "#94a3b8" }}>Schedule-only telemetry</div> : null}
    </div>
  );
}

export default function AutomationHealthCentre() {
  const [health, setHealth] = useState(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      const response = await fetch(`/api/system-health?ts=${Date.now()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not read system health.");
      setHealth(payload);
      setError("");
    } catch (err) {
      setError(err?.message || "Could not read system health.");
    }
  }

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const failed = useMemo(() => (health?.automations || []).filter((item) => String(item.status).toLowerCase() === "failed"), [health]);
  const isRed = health?.status === "red" || failed.length > 0 || Boolean(error);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Open Automation Health Centre"
        style={{
          position: "fixed",
          right: 18,
          bottom: 18,
          zIndex: 9997,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          border: `1px solid ${isRed ? "#fecaca" : "#bbf7d0"}`,
          borderRadius: 999,
          padding: "9px 12px",
          background: "rgba(255,255,255,.96)",
          color: isRed ? "#b91c1c" : "#047857",
          boxShadow: "0 10px 28px rgba(15,23,42,.14)",
          fontSize: 10,
          fontWeight: 950,
          cursor: "pointer",
          backdropFilter: "blur(12px)",
        }}
      >
        <span style={{ width: 9, height: 9, borderRadius: 999, background: isRed ? "#dc2626" : "#10b981", boxShadow: `0 0 0 3px ${isRed ? "#fee2e2" : "#d1fae5"}` }} />
        {isRed ? "System issue" : "Automation health"}
      </button>

      {open ? (
        <div role="dialog" aria-modal="true" aria-label="Automation Health Centre" onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 100000, display: "grid", placeItems: "center", padding: 18, background: "rgba(15,23,42,.48)", backdropFilter: "blur(5px)" }}>
          <div onClick={(event) => event.stopPropagation()} style={{ width: "min(920px,96vw)", maxHeight: "88vh", overflow: "auto", borderRadius: 22, background: "#f8fafc", boxShadow: "0 28px 80px rgba(2,6,23,.32)", border: "1px solid rgba(255,255,255,.7)" }}>
            <div style={{ position: "sticky", top: 0, zIndex: 2, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, padding: "18px 20px", background: "rgba(255,255,255,.96)", borderBottom: "1px solid #e2e8f0", backdropFilter: "blur(12px)" }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 950, color: isRed ? "#b91c1c" : "#047857", textTransform: "uppercase", letterSpacing: ".09em" }}>{isRed ? "Attention required" : "All core checks green"}</div>
                <div style={{ marginTop: 3, fontSize: 20, fontWeight: 950, color: "#0f172a" }}>Automation Health Centre</div>
                <div style={{ marginTop: 4, fontSize: 10, color: "#64748b" }}>One place for stock syncs, publishing, email and editorial automation.</div>
              </div>
              <button type="button" onClick={() => setOpen(false)} style={{ border: 0, borderRadius: 999, width: 31, height: 31, background: "#e2e8f0", color: "#334155", fontSize: 18, fontWeight: 800, cursor: "pointer" }}>×</button>
            </div>

            <div style={{ padding: 16 }}>
              {error ? <div style={{ marginBottom: 12, borderRadius: 12, padding: 10, background: "#fef2f2", color: "#b91c1c", fontSize: 10, fontWeight: 800 }}>{error}</div> : null}
              {health?.issues?.length ? (
                <div style={{ marginBottom: 12, display: "grid", gap: 7 }}>
                  {health.issues.map((item) => <div key={item.key} style={{ border: "1px solid #fecaca", borderRadius: 11, padding: 9, background: "#fff", color: "#991b1b", fontSize: 10 }}><strong>{item.label}:</strong> {item.message}</div>)}
                </div>
              ) : null}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(270px,1fr))", gap: 10 }}>
                {(health?.automations || []).map((item) => <AutomationRow key={item.key} item={item} />)}
              </div>
              {!health?.automations?.length && !error ? <div style={{ padding: 24, textAlign: "center", color: "#64748b", fontSize: 11 }}>Loading automation telemetry…</div> : null}
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
                <div style={{ fontSize: 9, color: "#94a3b8" }}>Checked {formatTime(health?.checked_at)}</div>
                <button type="button" onClick={refresh} style={{ border: "1px solid #cbd5e1", borderRadius: 9, padding: "7px 10px", background: "#fff", color: "#334155", fontSize: 9, fontWeight: 900, cursor: "pointer" }}>Refresh now</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

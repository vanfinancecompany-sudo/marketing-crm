import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function issueFingerprint(payload) {
  return JSON.stringify(
    (payload?.issues || []).map((issue) => [
      issue.key,
      issue.status,
      issue.message,
      issue.last_success_at,
    ]),
  );
}

function formatHealthDetails(payload) {
  const checkedAt = payload?.checked_at
    ? new Date(payload.checked_at).toLocaleString()
    : "Unknown";
  const lines = ["Marketing CRM system warning", `Checked: ${checkedAt}`, ""];

  for (const issue of payload?.issues || []) {
    lines.push(`${issue.label}: ${String(issue.status || "issue").toUpperCase()}`);
    if (issue.message) lines.push(issue.message);
    if (issue.last_success_at) {
      lines.push(`Last success: ${new Date(issue.last_success_at).toLocaleString()}`);
    }
    lines.push("");
  }

  lines.push("Please investigate the Marketing CRM health warning above.");
  return lines.join("\n");
}

export default function SystemHealthIndicator() {
  const [health, setHealth] = useState(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const lastAutoOpenedRef = useRef("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/system-health", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `Health check HTTP ${response.status}`);
      }
      setHealth(payload);

      if (payload?.status === "red") {
        const fingerprint = issueFingerprint(payload);
        if (fingerprint && fingerprint !== lastAutoOpenedRef.current) {
          lastAutoOpenedRef.current = fingerprint;
          setOpen(true);
        }
      }
    } catch (error) {
      const payload = {
        status: "red",
        checked_at: new Date().toISOString(),
        issues: [
          {
            key: "health-endpoint",
            label: "System monitor",
            status: "failed",
            message:
              error?.message || "The system monitor could not complete its checks.",
          },
        ],
      };
      setHealth(payload);
      const fingerprint = issueFingerprint(payload);
      if (fingerprint !== lastAutoOpenedRef.current) {
        lastAutoOpenedRef.current = fingerprint;
        setOpen(true);
      }
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const isGood = health?.status !== "red";
  const label = health
    ? isGood
      ? "System good"
      : "System issue"
    : "Checking system";
  const details = useMemo(() => formatHealthDetails(health || {}), [health]);

  const copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(details);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = details;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => health?.status === "red" && setOpen(true)}
        aria-label={health?.status === "red" ? "Open system warning" : label}
        title={health?.status === "red" ? "Open system warning" : label}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          border: "1px solid rgba(255,255,255,0.18)",
          borderRadius: 999,
          padding: "8px 12px",
          background: "rgba(0,0,0,0.24)",
          color: "inherit",
          font: "inherit",
          fontWeight: 800,
          cursor: health?.status === "red" ? "pointer" : "default",
          whiteSpace: "nowrap",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 11,
            height: 11,
            borderRadius: "50%",
            flex: "0 0 11px",
            background: !health ? "#f2b94b" : isGood ? "#28c76f" : "#ea4d4d",
            boxShadow: !health
              ? "0 0 0 3px rgba(242,185,75,0.16)"
              : isGood
                ? "0 0 0 3px rgba(40,199,111,0.16)"
                : "0 0 0 3px rgba(234,77,77,0.18)",
          }}
        />
        {label}
      </button>

      {open && health?.status === "red" ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="system-health-warning-title"
          onClick={(event) =>
            event.target === event.currentTarget && setOpen(false)
          }
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "grid",
            placeItems: "center",
            padding: 20,
            background: "rgba(0,0,0,0.62)",
          }}
        >
          <div
            style={{
              width: "min(620px, 100%)",
              maxHeight: "80vh",
              overflow: "auto",
              borderRadius: 18,
              border: "1px solid rgba(234,77,77,0.34)",
              background: "#171717",
              color: "#fff",
              padding: 20,
              boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 16,
                alignItems: "flex-start",
              }}
            >
              <div>
                <div
                  style={{
                    color: "#ff7474",
                    fontWeight: 900,
                    textTransform: "uppercase",
                    letterSpacing: ".08em",
                    fontSize: 12,
                  }}
                >
                  System warning
                </div>
                <h3
                  id="system-health-warning-title"
                  style={{ margin: "6px 0 6px" }}
                >
                  Marketing CRM needs attention
                </h3>
                <p style={{ margin: 0, opacity: 0.8 }}>
                  Copy the warning below and paste it into ChatGPT so the fault can be investigated quickly.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close system warning"
                style={{
                  border: 0,
                  background: "transparent",
                  color: "#fff",
                  fontSize: 24,
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            </div>

            <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
              {(health.issues || []).map((issue) => (
                <div
                  key={issue.key || issue.label}
                  style={{
                    border: "1px solid rgba(255,255,255,0.11)",
                    borderRadius: 12,
                    padding: 12,
                    background: "rgba(255,255,255,0.035)",
                  }}
                >
                  <strong>{issue.label}</strong>
                  <div style={{ marginTop: 4, opacity: 0.85 }}>
                    {issue.message || "A monitoring check failed."}
                  </div>
                  {issue.last_success_at ? (
                    <div style={{ marginTop: 4, opacity: 0.62, fontSize: 13 }}>
                      Last success: {new Date(issue.last_success_at).toLocaleString()}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                marginTop: 18,
              }}
            >
              <button
                type="button"
                className="button button--primary"
                onClick={copyDetails}
              >
                {copied ? "Copied" : "Copy warning details"}
              </button>
              <button type="button" className="button" onClick={refresh}>
                Check again
              </button>
              <button
                type="button"
                className="button"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

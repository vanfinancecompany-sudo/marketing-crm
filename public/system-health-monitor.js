(() => {
  const ROW_ID = "marketing-system-health-row";
  const MODAL_ID = "marketing-system-health-modal";
  const STORAGE_KEY = "marketingSystemHealthLastAutoOpened";
  let health = null;
  let healthTimer = null;
  let pageTimer = null;

  function dashboardRoot() {
    return document.querySelector(".content-operations-page");
  }

  function fingerprint(payload) {
    return JSON.stringify((payload?.issues || []).map((issue) => [
      issue.key,
      issue.status,
      issue.message,
      issue.last_success_at,
    ]));
  }

  function formatDetails(payload) {
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

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  function removeIndicator() {
    document.getElementById(ROW_ID)?.remove();
    closeModal();
  }

  function ensureIndicator() {
    const root = dashboardRoot();
    if (!root) {
      removeIndicator();
      return null;
    }

    let row = document.getElementById(ROW_ID);
    if (row) return row;

    row = document.createElement("div");
    row.id = ROW_ID;
    Object.assign(row.style, {
      display: "flex",
      justifyContent: "flex-end",
      alignItems: "center",
      minHeight: "36px",
    });

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.role = "health-button";
    Object.assign(button.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "8px",
      border: "1px solid rgba(255,255,255,0.16)",
      borderRadius: "999px",
      padding: "8px 12px",
      background: "rgba(0,0,0,0.28)",
      color: "inherit",
      font: "inherit",
      fontWeight: "800",
      cursor: "default",
      whiteSpace: "nowrap",
      boxShadow: "0 4px 18px rgba(0,0,0,0.12)",
    });

    const dot = document.createElement("span");
    dot.dataset.role = "health-dot";
    Object.assign(dot.style, {
      width: "11px",
      height: "11px",
      borderRadius: "50%",
      flex: "0 0 11px",
      background: "#f2b94b",
      boxShadow: "0 0 0 3px rgba(242,185,75,0.16)",
    });

    const label = document.createElement("span");
    label.dataset.role = "health-label";
    label.textContent = "Checking system";

    button.append(dot, label);
    button.addEventListener("click", () => {
      if (health?.status === "red") openModal();
    });
    row.appendChild(button);
    root.prepend(row);
    return row;
  }

  function updateIndicator() {
    const row = ensureIndicator();
    if (!row) return;
    const button = row.querySelector('[data-role="health-button"]');
    const dot = row.querySelector('[data-role="health-dot"]');
    const label = row.querySelector('[data-role="health-label"]');
    if (!button || !dot || !label) return;

    if (!health) {
      label.textContent = "Checking system";
      dot.style.background = "#f2b94b";
      dot.style.boxShadow = "0 0 0 3px rgba(242,185,75,0.16)";
      button.style.cursor = "default";
      return;
    }

    const red = health.status === "red";
    label.textContent = red ? "System issue" : "System good";
    dot.style.background = red ? "#ea4d4d" : "#28c76f";
    dot.style.boxShadow = red
      ? "0 0 0 3px rgba(234,77,77,0.18)"
      : "0 0 0 3px rgba(40,199,111,0.16)";
    button.style.cursor = red ? "pointer" : "default";
    button.title = red ? "Open system warning" : "System good";
  }

  function openModal() {
    if (!health || health.status !== "red") return;
    closeModal();

    const overlay = document.createElement("div");
    overlay.id = MODAL_ID;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "99999",
      display: "grid",
      placeItems: "center",
      padding: "20px",
      background: "rgba(0,0,0,0.66)",
    });

    const card = document.createElement("div");
    Object.assign(card.style, {
      width: "min(620px, 100%)",
      maxHeight: "80vh",
      overflow: "auto",
      borderRadius: "18px",
      border: "1px solid rgba(234,77,77,0.34)",
      background: "#171717",
      color: "#fff",
      padding: "20px",
      boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
      fontFamily: "inherit",
    });

    const heading = document.createElement("div");
    heading.innerHTML = '<div style="color:#ff7474;font-weight:900;text-transform:uppercase;letter-spacing:.08em;font-size:12px">System warning</div><h3 style="margin:6px 0">Marketing CRM needs attention</h3><p style="margin:0;opacity:.8">Copy the warning below and paste it into ChatGPT so the fault can be investigated quickly.</p>';
    card.appendChild(heading);

    const issuesWrap = document.createElement("div");
    Object.assign(issuesWrap.style, { marginTop: "18px", display: "grid", gap: "10px" });
    for (const issue of health.issues || []) {
      const item = document.createElement("div");
      Object.assign(item.style, {
        border: "1px solid rgba(255,255,255,0.11)",
        borderRadius: "12px",
        padding: "12px",
        background: "rgba(255,255,255,0.035)",
      });
      const title = document.createElement("strong");
      title.textContent = issue.label || "System warning";
      const message = document.createElement("div");
      message.textContent = issue.message || "A monitoring check failed.";
      Object.assign(message.style, { marginTop: "4px", opacity: ".85" });
      item.append(title, message);
      if (issue.last_success_at) {
        const last = document.createElement("div");
        last.textContent = `Last success: ${new Date(issue.last_success_at).toLocaleString()}`;
        Object.assign(last.style, { marginTop: "4px", opacity: ".62", fontSize: "13px" });
        item.appendChild(last);
      }
      issuesWrap.appendChild(item);
    }
    card.appendChild(issuesWrap);

    const actions = document.createElement("div");
    Object.assign(actions.style, { display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "18px" });

    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "button button--primary";
    copy.textContent = "Copy warning details";
    copy.addEventListener("click", async () => {
      const text = formatDetails(health);
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      copy.textContent = "Copied";
      setTimeout(() => { copy.textContent = "Copy warning details"; }, 1600);
    });

    const again = document.createElement("button");
    again.type = "button";
    again.className = "button";
    again.textContent = "Check again";
    again.addEventListener("click", async () => {
      again.disabled = true;
      await refreshHealth(false);
      again.disabled = false;
      if (health?.status !== "red") closeModal();
      else openModal();
    });

    const close = document.createElement("button");
    close.type = "button";
    close.className = "button";
    close.textContent = "Close";
    close.addEventListener("click", closeModal);

    actions.append(copy, again, close);
    card.appendChild(actions);
    overlay.appendChild(card);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeModal();
    });
    document.body.appendChild(overlay);
  }

  async function refreshHealth(autoOpen = true) {
    if (!dashboardRoot()) return;
    ensureIndicator();
    try {
      const response = await fetch("/api/system-health", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || `Health check HTTP ${response.status}`);
      health = payload;
    } catch (error) {
      health = {
        status: "red",
        checked_at: new Date().toISOString(),
        issues: [{
          key: "health-endpoint",
          label: "System monitor",
          status: "failed",
          message: error?.message || "The system monitor could not complete its checks.",
        }],
      };
    }

    updateIndicator();

    if (autoOpen && health?.status === "red") {
      const key = fingerprint(health);
      const previous = sessionStorage.getItem(STORAGE_KEY) || "";
      if (key && key !== previous) {
        sessionStorage.setItem(STORAGE_KEY, key);
        openModal();
      }
    }
  }

  function syncPage() {
    if (dashboardRoot()) {
      const newlyMounted = !document.getElementById(ROW_ID);
      ensureIndicator();
      updateIndicator();
      if (newlyMounted) refreshHealth(true);
      if (!healthTimer) {
        healthTimer = window.setInterval(() => refreshHealth(true), 5 * 60 * 1000);
      }
    } else {
      removeIndicator();
      if (healthTimer) {
        window.clearInterval(healthTimer);
        healthTimer = null;
      }
    }
  }

  function start() {
    syncPage();
    pageTimer = window.setInterval(syncPage, 1500);
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();

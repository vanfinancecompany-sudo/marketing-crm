const ACCESS_STORAGE_KEY = "marketingCustomerDatabaseApiKey";
const ACCESS_HEADER = "x-marketing-customer-database-key";
const STATUS_ID = "bufferFacebookLiveStatus";
const REFRESH_MS = 60 * 1000;
let lastCheckedAt = 0;
let lastPayload = null;
let inFlight = null;

function storedAccessKey() {
  try {
    return localStorage.getItem(ACCESS_STORAGE_KEY) || sessionStorage.getItem(ACCESS_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function pageKind() {
  const path = window.location.pathname;
  if (path === "/") return "operations";
  if (path === "/van-finance-facebook") return "finance";
  if (path === "/rent2buy-facebook") return "rent2buy";
  if (path.startsWith("/daily-reels")) return "daily-reels";
  return "";
}

function formatCheckedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

async function requestStatus(force = false) {
  const key = storedAccessKey();
  if (!key) return null;
  const now = Date.now();
  if (!force && lastPayload && now - lastCheckedAt < 20_000) return lastPayload;
  if (inFlight) return inFlight;

  inFlight = fetch("/api/buffer-publish-status", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [ACCESS_HEADER]: key,
    },
    body: JSON.stringify({ action: "sync" }),
  })
    .then(async (response) => {
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.ok === false) {
        throw new Error(result?.error || `Buffer status returned HTTP ${response.status}.`);
      }
      lastPayload = result;
      lastCheckedAt = Date.now();
      return result;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

function countsLine(label, group) {
  return `${label}: ${Number(group?.posts || 0)} vehicle post${Number(group?.posts || 0) === 1 ? "" : "s"} live · ${Number(group?.reels || 0)} Reel${Number(group?.reels || 0) === 1 ? "" : "s"} live`;
}

function ensureOperationsPanel() {
  let panel = document.getElementById(STATUS_ID);
  if (panel) return panel;
  const summary = document.querySelector(".operations-summary");
  if (!summary) return null;
  panel = document.createElement("section");
  panel.id = STATUS_ID;
  panel.className = "panel";
  panel.setAttribute("aria-live", "polite");
  summary.insertAdjacentElement("afterend", panel);
  return panel;
}

function ensurePostingNotice() {
  let notice = document.getElementById(STATUS_ID);
  if (notice) return notice;
  const hero = document.querySelector(".posting-destination-hero");
  if (!hero) return null;
  notice = document.createElement("div");
  notice.id = STATUS_ID;
  notice.className = "notice notice--success";
  notice.setAttribute("aria-live", "polite");
  const header = hero.querySelector(".panel__header");
  if (header) header.insertAdjacentElement("afterend", notice);
  else hero.prepend(notice);
  return notice;
}

function ensureDailyReelsNotice() {
  let notice = document.getElementById(STATUS_ID);
  if (notice) return notice;
  const statusPanel = document.querySelector(".status-panel");
  if (!statusPanel) return null;
  notice = document.createElement("div");
  notice.id = STATUS_ID;
  notice.className = "status-row";
  notice.setAttribute("aria-live", "polite");
  notice.style.marginTop = "10px";
  statusPanel.appendChild(notice);
  return notice;
}

function renderStatus(payload) {
  const kind = pageKind();
  if (!kind || !payload?.today) return;
  const checked = formatCheckedAt(payload.checked_at);
  const finance = payload.today.vanFinance || {};
  const rent = payload.today.rent2buy || {};

  if (kind === "operations") {
    const panel = ensureOperationsPanel();
    if (!panel) return;
    panel.innerHTML = `
      <div class="panel__header">
        <div>
          <h3>Facebook live today</h3>
          <p>Confirmed from Buffer, so you do not need to cross-check Facebook manually.</p>
        </div>
        <span class="status-pill">Buffer confirmed${checked ? ` · ${checked}` : ""}</span>
      </div>
      <div class="notice notice--success">${countsLine("Van Finance", finance)}</div>
      <div class="notice notice--success">${countsLine("Rent2Buy", rent)}</div>
    `;
    return;
  }

  if (kind === "finance" || kind === "rent2buy") {
    const notice = ensurePostingNotice();
    if (!notice) return;
    const group = kind === "finance" ? finance : rent;
    const label = kind === "finance" ? "Van Finance" : "Rent2Buy";
    notice.textContent = `✓ Buffer confirmed live today · ${countsLine(label, group)}${checked ? ` · checked ${checked}` : ""}`;
    return;
  }

  if (kind === "daily-reels") {
    const notice = ensureDailyReelsNotice();
    if (!notice) return;
    notice.innerHTML = `<span class="status-dot is-ready"></span><strong>Facebook live today · Finance ${Number(finance.reels || 0)} Reel${Number(finance.reels || 0) === 1 ? "" : "s"} · Rent2Buy ${Number(rent.reels || 0)} Reel${Number(rent.reels || 0) === 1 ? "" : "s"}${checked ? ` · checked ${checked}` : ""}</strong>`;
  }
}

async function refresh(force = false) {
  if (!pageKind()) return;
  try {
    const payload = await requestStatus(force);
    if (!payload) return;
    renderStatus(payload);
    window.dispatchEvent(new CustomEvent("buffer-facebook-live-status", { detail: payload }));
    if (pageKind() === "operations" && Number(payload.synced || 0) > 0) {
      window.dispatchEvent(new CustomEvent("marketing-daily-operations-refresh", {
        detail: { source: "buffer_publish" },
      }));
    }
  } catch (error) {
    const node = document.getElementById(STATUS_ID);
    if (node && !lastPayload) {
      node.textContent = error?.message || "Buffer live status is temporarily unavailable.";
    }
  }
}

const observer = new MutationObserver(() => {
  if (lastPayload) renderStatus(lastPayload);
});
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener("popstate", () => setTimeout(() => refresh(true), 50));
setInterval(() => refresh(true), REFRESH_MS);
setTimeout(() => refresh(true), 250);

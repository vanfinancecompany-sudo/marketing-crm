import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "../services/marketingAccess.js";

const PATH = "/vansco-stock-watch";
const COMPARISON_EVENT = "dealerkit-stock-comparison-refreshed";
let comparisonRequest = null;
let installed = false;

function clean(value) {
  return String(value ?? "").trim();
}

function buttonIntent(button) {
  const text = clean(button?.textContent).toLowerCase();
  if (/refresh dealer stock|refresh vansco cache/.test(text)) return "dealer_stock";
  if (/refresh comparison|reload comparison|compare with vansco/.test(text)) return "comparison";
  return "";
}

function ensureStatusHub() {
  let panel = document.getElementById("vansco-status-hub");
  if (panel) {
    panel.style.display = "grid";
    return panel;
  }

  panel = document.createElement("section");
  panel.id = "vansco-status-hub";
  panel.setAttribute("aria-live", "polite");
  panel.style.cssText = [
    "position:fixed",
    "right:18px",
    "bottom:18px",
    "z-index:99999",
    "width:min(560px,calc(100vw - 36px))",
    "max-height:min(76vh,640px)",
    "overflow:auto",
    "padding:14px",
    "border-radius:18px",
    "border:1px solid #bfdbfe",
    "background:linear-gradient(180deg,#eff6ff 0%,#ffffff 100%)",
    "box-shadow:0 18px 48px rgba(15,23,42,0.22)",
    "color:#0f172a",
    "display:grid",
    "gap:10px",
  ].join(";");
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
      <div>
        <div style="font-weight:900;font-size:15px;">Vansco Status Hub</div>
        <div data-vansco-progress-stage style="color:#475569;font-size:13px;margin-top:2px;">Ready</div>
      </div>
      <button data-vansco-status-close type="button" style="border:0;background:#dbeafe;color:#0f172a;border-radius:999px;width:28px;height:28px;font-weight:900;cursor:pointer;">×</button>
    </div>
    <div data-vansco-status-message style="font-size:13px;color:#334155;line-height:1.35;">Dealer stock refresh status will appear here.</div>
    <div style="height:12px;border-radius:999px;background:#dbeafe;overflow:hidden;">
      <div data-vansco-progress-bar style="height:100%;width:0%;background:#2563eb;transition:width .25s ease;"></div>
    </div>
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
      <div data-vansco-progress-percent style="font-weight:900;font-size:22px;color:#1d4ed8;">0%</div>
      <div data-vansco-run-id style="font-size:12px;color:#64748b;"></div>
    </div>
    <div data-vansco-progress-detail style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;font-size:13px;color:#334155;"></div>
    <div data-vansco-failed-details style="display:none;"></div>
    <div data-vansco-totals-note style="font-size:12px;color:#64748b;line-height:1.35;border-top:1px solid #dbeafe;padding-top:8px;">The original cards and tabs remain the operator view. DealerKit source checks and comparison now run behind these controls.</div>
    <div style="font-size:12px;color:#64748b;line-height:1.35;">Refresh is advisory only. It does not publish, delete or alter Wix vehicle records.</div>
  `;
  panel.querySelector("[data-vansco-status-close]")?.addEventListener("click", () => {
    panel.style.display = "none";
  });
  document.body.appendChild(panel);
  return panel;
}

function updateHub({ stage, message, percent, checked = 0, total = 0, success = 0, failed = 0, remaining = 0, complete = false }) {
  const panel = ensureStatusHub();
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  const stageEl = panel.querySelector("[data-vansco-progress-stage]");
  const messageEl = panel.querySelector("[data-vansco-status-message]");
  const percentEl = panel.querySelector("[data-vansco-progress-percent]");
  const barEl = panel.querySelector("[data-vansco-progress-bar]");
  const detailEl = panel.querySelector("[data-vansco-progress-detail]");
  if (stageEl) stageEl.textContent = stage;
  if (messageEl) messageEl.textContent = message;
  if (percentEl) percentEl.textContent = `${pct}%`;
  if (barEl) {
    barEl.style.width = `${pct}%`;
    barEl.style.background = complete ? "#16a34a" : failed ? "#f59e0b" : "#2563eb";
  }
  if (detailEl) detailEl.innerHTML = `
    <strong>Checked: ${checked} / ${total || "?"}</strong>
    <span>Success: ${success}</span>
    <span>Failed: ${failed}</span>
    <span>Remaining: ${remaining}</span>
    <span>Stage: ${stage}</span>
  `;
  if (complete) {
    panel.style.borderColor = "#86efac";
    panel.style.background = "linear-gradient(180deg,#ecfdf5 0%,#ffffff 100%)";
  }
}

async function fetchComparison() {
  if (comparisonRequest) return comparisonRequest;
  comparisonRequest = (async () => {
    const response = await fetch("/api/dealerkit-stock-comparison", {
      method: "GET",
      headers: buildMarketingAccessHeaders({ accept: "application/json" }),
      cache: "no-store",
    });
    return parseMarketingJsonResponse(response, "Could not refresh DealerKit comparison.");
  })();
  try {
    const payload = await comparisonRequest;
    window.__dealerKitStockComparison = payload;
    window.dispatchEvent(new CustomEvent(COMPARISON_EVENT, { detail: payload }));
    return payload;
  } finally {
    comparisonRequest = null;
  }
}

function comparisonTotals(payload) {
  const total = Number(payload?.source?.apiReportedTotal || payload?.source?.usableRecords || 0);
  const checked = Number(payload?.source?.usableRecords || 0);
  const failed = Math.max(0, total - checked);
  return { total, checked, failed, remaining: failed, success: checked };
}

async function refreshComparisonInOriginalHub(label = "Refreshing DealerKit comparison") {
  updateHub({ stage: label, message: "Reading DealerKit and comparing it with the current Finance / Rent2Buy stock behind the original cards.", percent: 72 });
  try {
    const payload = await fetchComparison();
    const totals = comparisonTotals(payload);
    updateHub({
      stage: payload?.source?.complete ? "Comparison complete" : "Comparison refreshed · source incomplete",
      message: payload?.source?.complete
        ? "DealerKit comparison refreshed. Review actions on the original cards now use the latest DealerKit stock identity."
        : "DealerKit comparison refreshed from the usable source records. Source completeness warnings remain advisory and publishing safeguards stay locked.",
      percent: 100,
      ...totals,
      complete: true,
    });
  } catch (error) {
    updateHub({ stage: "Comparison failed", message: error?.message || "Could not refresh DealerKit comparison.", percent: 100, failed: 1, total: 1, checked: 1 });
  }
}

function waitForOriginalRefresh(button) {
  const startedAt = Date.now();
  const poll = () => {
    if (!document.body.contains(button)) return;
    const text = clean(button.textContent).toLowerCase();
    const running = button.disabled || /refreshing|loading|reloading/.test(text);
    if (!running || Date.now() - startedAt > 12 * 60 * 1000) {
      refreshComparisonInOriginalHub("Refreshing DealerKit comparison");
      return;
    }
    window.setTimeout(poll, 500);
  };
  window.setTimeout(poll, 250);
}

function onClick(event) {
  if (window.location.pathname !== PATH) return;
  const button = event.target?.closest?.("button");
  if (!button) return;
  const intent = buttonIntent(button);
  if (!intent) return;

  if (intent === "dealer_stock") {
    // Let the original React handler run the full Vansco/Dragon cache refresh and
    // original Status Hub first. DealerKit comparison is refreshed immediately
    // afterwards so the existing cards remain the single operator surface.
    waitForOriginalRefresh(button);
    return;
  }

  updateHub({
    stage: "Refreshing comparison",
    message: "Refreshing DealerKit comparison against the current stock while the original comparison reload runs.",
    percent: 20,
  });
  refreshComparisonInOriginalHub("Refreshing DealerKit comparison");
}

function install() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("click", onClick, true);
  if (window.location.pathname === PATH) {
    // Prime the registration -> DealerKit stock identity map in the background.
    fetchComparison().catch(() => null);
  }
}

install();

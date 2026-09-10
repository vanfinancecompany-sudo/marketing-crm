import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "../services/marketingAccess.js";

const PATH = "/vansco-stock-watch";
const COMPARISON_EVENT = "dealerkit-stock-comparison-refreshed";
let comparisonRequest = null;
let sourceRequest = null;
let installed = false;
let originalFetch = null;
let allowProgrammaticComparisonClick = false;

function clean(value) {
  return String(value ?? "").trim();
}

function onStockWatchRoute() {
  return typeof window !== "undefined" && window.location.pathname === PATH;
}

function buttonIntent(button) {
  const text = clean(button?.textContent).toLowerCase();
  if (/refresh dealer stock|refresh vansco cache/.test(text)) return "dealer_stock";
  if (/refresh comparison|reload comparison|compare with vansco/.test(text)) return "comparison";
  return "";
}

function requestUrl(input) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return clean(input?.url);
}

function parsedRequestUrl(input) {
  const raw = requestUrl(input);
  if (!raw) return null;
  try {
    return new URL(raw, window.location.origin);
  } catch {
    return null;
  }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
    },
  });
}

function sourceTotals(payload = {}) {
  const total = Number(payload?.source?.apiReportedTotal || payload?.summary?.currentUrlCount || 0);
  const checked = Number(payload?.source?.usableRecords || payload?.summary?.usableCachedRegistrations || 0);
  const failed = Math.max(0, total - checked);
  return { total, checked, failed, remaining: 0, success: checked };
}

function compatibilityRefreshPayload(payload = {}) {
  const totals = sourceTotals(payload);
  return {
    ok: true,
    provider: "dealerkit",
    complete: true,
    shouldContinue: false,
    runId: "dealerkit-operator",
    refresh: {
      provider: "dealerkit",
      urlsFound: totals.total,
      rowsUpserted: totals.checked,
    },
    run: {
      id: "dealerkit-operator",
      status: "complete",
      stage: "complete",
      total_urls: totals.total,
      processed_count: totals.checked,
      success_count: totals.success,
      failure_count: totals.failed,
      remaining_count: 0,
    },
    totalRunProcessedCount: totals.checked,
    totalRunSuccessCount: totals.success,
    totalRunFailureCount: totals.failed,
    remainingThisRunCount: 0,
    processedCount: totals.checked,
    successCount: totals.success,
    failureCount: totals.failed,
    remainingCount: 0,
  };
}

async function dealerKitSourceRequest(pipeline = "finance") {
  if (sourceRequest) return sourceRequest;
  sourceRequest = (async () => {
    const response = await originalFetch(`/api/dealerkit-stock-watch-list?pipeline=${encodeURIComponent(pipeline)}`, {
      method: "GET",
      headers: buildMarketingAccessHeaders({ accept: "application/json" }),
      cache: "no-store",
    });
    return parseMarketingJsonResponse(response, "Could not refresh DealerKit stock.");
  })();
  try {
    return await sourceRequest;
  } finally {
    sourceRequest = null;
  }
}

function installDealerKitOperatorFetchBridge() {
  if (originalFetch || typeof globalThis?.fetch !== "function") return;
  originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (input, init = {}) => {
    if (!onStockWatchRoute()) return originalFetch(input, init);
    const url = parsedRequestUrl(input);
    if (!url) return originalFetch(input, init);

    if (url.pathname === "/api/vansco-cache-list") {
      const pipeline = clean(url.searchParams.get("pipeline")) || "finance";
      const replacement = new URL("/api/dealerkit-stock-watch-list", window.location.origin);
      replacement.searchParams.set("pipeline", pipeline);
      return originalFetch(replacement.toString(), {
        ...init,
        method: "GET",
        headers: buildMarketingAccessHeaders({ ...(init?.headers || {}), accept: "application/json" }),
        cache: "no-store",
      });
    }

    // The legacy page still asks for old refresh status during ordinary reads.
    // On the operator Stock Watch route, never let that poll wake the old
    // Vansco/Dragon refresh state or paint Dragon progress into the hub.
    if (url.pathname === "/api/vansco-refresh-status") {
      return jsonResponse({ ok: true, active: false, provider: "dealerkit", run: null });
    }

    // Hard fallback guard. The normal operator click is intercepted below, but
    // if old React code ever reaches the legacy live-refresh endpoint anyway,
    // answer it from DealerKit rather than making a Vansco/Dragon request.
    if (url.pathname === "/api/vansco-cache-live-refresh") {
      try {
        const payload = await dealerKitSourceRequest("finance");
        return jsonResponse(compatibilityRefreshPayload(payload));
      } catch (error) {
        return jsonResponse({ ok: false, provider: "dealerkit", message: error?.message || "DealerKit refresh failed." }, 502);
      }
    }

    return originalFetch(input, init);
  };
}

function relabelExistingHub(panel) {
  if (!panel) return;
  const title = panel.querySelector(":scope > div:first-child > div:first-child > div:first-child");
  if (title) title.textContent = "DealerKit Stock Status";
  const note = panel.querySelector("[data-vansco-totals-note]");
  if (note) note.textContent = "The original Stock Watch cards and tabs are the operator view. DealerKit is now the supplier source behind these controls.";
  const failedDetails = panel.querySelector("[data-vansco-failed-details]");
  if (failedDetails) {
    failedDetails.style.display = "none";
    failedDetails.innerHTML = "";
  }
}

function ensureStatusHub() {
  let panel = document.getElementById("vansco-status-hub");
  if (panel) {
    panel.style.display = "grid";
    relabelExistingHub(panel);
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
        <div style="font-weight:900;font-size:15px;">DealerKit Stock Status</div>
        <div data-vansco-progress-stage style="color:#475569;font-size:13px;margin-top:2px;">Ready</div>
      </div>
      <button data-vansco-status-close type="button" style="border:0;background:#dbeafe;color:#0f172a;border-radius:999px;width:28px;height:28px;font-weight:900;cursor:pointer;">×</button>
    </div>
    <div data-vansco-status-message style="font-size:13px;color:#334155;line-height:1.35;">DealerKit stock refresh status will appear here.</div>
    <div style="height:12px;border-radius:999px;background:#dbeafe;overflow:hidden;">
      <div data-vansco-progress-bar style="height:100%;width:0%;background:#2563eb;transition:width .25s ease;"></div>
    </div>
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
      <div data-vansco-progress-percent style="font-weight:900;font-size:22px;color:#1d4ed8;">0%</div>
      <div data-vansco-run-id style="font-size:12px;color:#64748b;"></div>
    </div>
    <div data-vansco-progress-detail style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;font-size:13px;color:#334155;"></div>
    <div data-vansco-failed-details style="display:none;"></div>
    <div data-vansco-totals-note style="font-size:12px;color:#64748b;line-height:1.35;border-top:1px solid #dbeafe;padding-top:8px;">The original Stock Watch cards and tabs are the operator view. DealerKit is now the supplier source behind these controls.</div>
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
    <span>Usable: ${success}</span>
    <span>Source issues: ${failed}</span>
    <span>Remaining: ${remaining}</span>
    <span>Stage: ${stage}</span>
  `;
  panel.style.borderColor = complete ? "#86efac" : "#bfdbfe";
  panel.style.background = complete
    ? "linear-gradient(180deg,#ecfdf5 0%,#ffffff 100%)"
    : "linear-gradient(180deg,#eff6ff 0%,#ffffff 100%)";
}

async function fetchComparison() {
  if (comparisonRequest) return comparisonRequest;
  comparisonRequest = (async () => {
    const response = await originalFetch("/api/dealerkit-stock-comparison", {
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
  return { total, checked, failed, remaining: 0, success: checked };
}

function activePipeline() {
  const controls = Array.from(document.querySelectorAll(".segmented-control"));
  const pipelineControl = controls.find((control) => /finance|rent2buy|cars/i.test(clean(control.textContent)));
  const active = clean(pipelineControl?.querySelector(".segment.is-active")?.textContent).toLowerCase();
  if (active.includes("rent")) return "rent2buy";
  if (active.includes("car")) return "cars";
  return "finance";
}

function findComparisonButton() {
  return Array.from(document.querySelectorAll("button")).find((button) => buttonIntent(button) === "comparison") || null;
}

async function refreshDealerStock(button) {
  const pipeline = activePipeline();
  updateHub({
    stage: "Reading DealerKit stock",
    message: "Refreshing the DealerKit supplier feed. No Vansco or Dragon detail pages are being called.",
    percent: 10,
  });

  const source = await dealerKitSourceRequest(pipeline);
  const sourceCount = sourceTotals(source);
  updateHub({
    stage: "DealerKit stock loaded",
    message: `DealerKit returned ${sourceCount.checked} usable records. Rebuilding the comparison against your live stock now.`,
    percent: 58,
    ...sourceCount,
  });

  const comparison = await fetchComparison();
  const totals = comparisonTotals(comparison);
  updateHub({
    stage: comparison?.source?.complete ? "DealerKit refresh complete" : "DealerKit refreshed · source incomplete",
    message: comparison?.source?.complete
      ? "DealerKit stock and comparison are current. Refreshing the original cards and tabs now."
      : "DealerKit usable stock has refreshed. Source completeness warnings remain visible and publishing safety stays locked.",
    percent: 100,
    ...totals,
    complete: true,
  });

  // Let the existing React comparison handler reload its local Finance/Rent2Buy
  // stock and redraw the original cards. Its source read is transparently routed
  // to DealerKit by the fetch bridge above.
  const comparisonButton = findComparisonButton();
  if (comparisonButton && comparisonButton !== button) {
    allowProgrammaticComparisonClick = true;
    comparisonButton.click();
  } else {
    window.setTimeout(() => window.location.reload(), 250);
  }
}

async function refreshComparisonInOriginalHub() {
  updateHub({
    stage: "Refreshing DealerKit comparison",
    message: "Reading DealerKit and comparing it with current Finance / Rent2Buy stock behind the original cards.",
    percent: 35,
  });
  try {
    const payload = await fetchComparison();
    const totals = comparisonTotals(payload);
    updateHub({
      stage: payload?.source?.complete ? "Comparison complete" : "Comparison refreshed · source incomplete",
      message: payload?.source?.complete
        ? "DealerKit comparison refreshed. Review actions now use the latest DealerKit stock identity."
        : "DealerKit comparison refreshed from usable source records. Publishing safeguards remain locked for incomplete source data.",
      percent: 100,
      ...totals,
      complete: true,
    });
  } catch (error) {
    updateHub({ stage: "Comparison failed", message: error?.message || "Could not refresh DealerKit comparison.", percent: 100, failed: 1, total: 1, checked: 1 });
  }
}

function onClick(event) {
  if (!onStockWatchRoute()) return;
  const button = event.target?.closest?.("button");
  if (!button) return;
  const intent = buttonIntent(button);
  if (!intent) return;

  if (intent === "dealer_stock") {
    // Stop the legacy React handler before it can start /vansco-cache-live-refresh.
    event.preventDefault();
    event.stopImmediatePropagation();
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = "Refreshing dealer stock...";
    refreshDealerStock(button)
      .catch((error) => {
        updateHub({ stage: "DealerKit refresh failed", message: error?.message || "Could not refresh DealerKit stock.", percent: 100, failed: 1, total: 1, checked: 1 });
      })
      .finally(() => {
        if (document.body.contains(button)) {
          button.disabled = false;
          button.textContent = originalText;
        }
      });
    return;
  }

  // A programmatic click after Refresh Dealer Stock is only to make the existing
  // React component redraw its cards. The comparison was already refreshed.
  if (allowProgrammaticComparisonClick) {
    allowProgrammaticComparisonClick = false;
    return;
  }

  // User-triggered Refresh Comparison keeps the original React handler and adds
  // the real DealerKit comparison refresh behind the same button.
  refreshComparisonInOriginalHub();
}

function install() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  installDealerKitOperatorFetchBridge();
  document.addEventListener("click", onClick, true);
  if (onStockWatchRoute()) {
    fetchComparison().catch(() => null);
  }
}

install();
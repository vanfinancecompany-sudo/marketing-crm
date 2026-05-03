let activeVanscoRunId = "";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureVanscoLayoutStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("vansco-stock-watch-layout-fix")) return;

  const style = document.createElement("style");
  style.id = "vansco-stock-watch-layout-fix";
  style.textContent = `
    .vansco-watch-panel .stat-grid,
    .vansco-watch-panel .stat-grid--centered {
      display: grid !important;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)) !important;
      gap: 16px !important;
      align-items: stretch !important;
      margin: 18px auto !important;
      max-width: 980px !important;
    }

    .vansco-watch-panel .stat-card {
      min-height: 112px !important;
    }

    .vansco-watch-panel .segmented-control {
      display: inline-flex !important;
      flex-wrap: wrap !important;
      width: auto !important;
      max-width: 100% !important;
    }

    .vansco-watch-panel .vansco-watch-note,
    .vansco-watch-panel .error-banner,
    .vansco-watch-panel .success-banner {
      max-width: 100% !important;
      margin-top: 10px !important;
      border-radius: 14px !important;
      padding: 10px 12px !important;
      line-height: 1.35 !important;
    }

    .vansco-card-grid {
      display: grid !important;
      grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)) !important;
      gap: 14px !important;
      align-items: start !important;
    }

    .vansco-card {
      display: grid !important;
      overflow: hidden !important;
      border-radius: 18px !important;
      background: rgba(255,255,255,0.92) !important;
      border: 1px solid rgba(148,163,184,0.22) !important;
      box-shadow: 0 14px 32px rgba(15,23,42,0.08) !important;
    }

    .vansco-card__image-wrap {
      width: 100% !important;
      overflow: hidden !important;
      background: #e2e8f0 !important;
    }

    .vansco-card__image {
      width: 100% !important;
      aspect-ratio: 16 / 10 !important;
      object-fit: cover !important;
      display: block !important;
    }

    .vansco-card__body {
      padding: 12px !important;
      display: grid !important;
      gap: 8px !important;
    }

    .vansco-card__body h3 {
      margin: 0 !important;
      font-size: 14px !important;
      line-height: 1.22 !important;
    }

    .vansco-card__badges {
      display: flex !important;
      flex-wrap: wrap !important;
      gap: 6px !important;
    }

    .vansco-card .field__textarea {
      min-height: 66px !important;
      resize: vertical !important;
    }

    .vansco-card .card-actions {
      gap: 6px !important;
    }

    .vansco-card .button {
      padding: 8px 10px !important;
      border-radius: 10px !important;
      font-size: 12px !important;
    }
  `;
  document.head.appendChild(style);
}

ensureVanscoLayoutStyles();

function stageLabel(stage) {
  const labels = {
    starting: "Starting",
    refreshing_url_list: "Refreshing URL list",
    url_list_refreshed: "URL list refreshed",
    processing_dragon_details: "Processing Dragon details",
    waiting_next_batch: "Waiting for next batch",
    complete: "Complete",
    failed: "Failed",
    superseded: "Superseded",
  };
  return labels[stage] || stage || "Running";
}

function positionStatusHub(panel) {
  if (!panel || typeof document === "undefined") return;
  ensureVanscoLayoutStyles();
  if (panel.parentElement !== document.body) document.body.appendChild(panel);
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
}

function ensureStatusHub() {
  if (typeof document === "undefined") return null;
  ensureVanscoLayoutStyles();

  let panel = document.getElementById("vansco-status-hub");
  if (panel) {
    positionStatusHub(panel);
    return panel;
  }

  panel = document.createElement("section");
  panel.id = "vansco-status-hub";
  panel.setAttribute("aria-live", "polite");

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
      <div>
        <div style="font-weight:900;font-size:15px;">Vansco Status Hub</div>
        <div data-vansco-progress-stage style="color:#475569;font-size:13px;margin-top:2px;">Ready</div>
      </div>
      <button data-vansco-status-close type="button" style="border:0;background:#dbeafe;color:#0f172a;border-radius:999px;width:28px;height:28px;font-weight:900;cursor:pointer;">×</button>
    </div>
    <div data-vansco-status-message style="font-size:13px;color:#334155;line-height:1.35;">Refresh status, progress and totals notes will appear here.</div>
    <div style="height:12px;border-radius:999px;background:#dbeafe;overflow:hidden;">
      <div data-vansco-progress-bar style="height:100%;width:0%;background:#2563eb;transition:width .25s ease;"></div>
    </div>
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
      <div data-vansco-progress-percent style="font-weight:900;font-size:22px;color:#1d4ed8;">0%</div>
      <div data-vansco-run-id style="font-size:12px;color:#64748b;"></div>
    </div>
    <div data-vansco-progress-detail style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;font-size:13px;color:#334155;"></div>
    <div data-vansco-totals-note style="font-size:12px;color:#64748b;line-height:1.35;border-top:1px solid #dbeafe;padding-top:8px;">
      Action card totals are filtered per tab. They do not add up to the full Vansco URL count because already-listed, wrong-tab type, reserved-not-advertised, blocked and no-registration rows are hidden.
    </div>
    <div style="font-size:12px;color:#64748b;line-height:1.35;">Safe advisory tool only. CRM stock, Wix, Facebook and your Ignore/Delete-Block records are not changed by refresh.</div>
  `;

  panel.querySelector("[data-vansco-status-close]")?.addEventListener("click", () => {
    panel.style.display = "none";
  });

  positionStatusHub(panel);
  return panel;
}

function showStatusHub() {
  const panel = ensureStatusHub();
  if (panel) panel.style.display = "grid";
  return panel;
}

function updateStatusHub(payload, fallbackStage = "processing_dragon_details", message = "Refresh running in safe Dragon batches.") {
  const panel = showStatusHub();
  if (!panel) return;

  const run = payload?.run || {};
  const total = Number(run.total_urls || payload?.refresh?.urlsFound || 248 || 0);
  const processed = Number(payload?.totalRunProcessedCount ?? run.processed_count ?? payload?.processedCount ?? 0);
  const success = Number(payload?.totalRunSuccessCount ?? run.success_count ?? payload?.successCount ?? 0);
  const failed = Number(payload?.totalRunFailureCount ?? run.failure_count ?? payload?.failureCount ?? 0);
  const remaining = Number(payload?.remainingThisRunCount ?? payload?.remainingUncheckedOrMissingRegCount ?? run.remaining_count ?? Math.max(total - processed, 0));
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const stage = payload?.complete ? "complete" : run.stage || fallbackStage;

  const stageEl = panel.querySelector("[data-vansco-progress-stage]");
  const messageEl = panel.querySelector("[data-vansco-status-message]");
  const percentEl = panel.querySelector("[data-vansco-progress-percent]");
  const runIdEl = panel.querySelector("[data-vansco-run-id]");
  const barEl = panel.querySelector("[data-vansco-progress-bar]");
  const detailEl = panel.querySelector("[data-vansco-progress-detail]");

  if (stageEl) stageEl.textContent = stageLabel(stage);
  if (messageEl) messageEl.textContent = message;
  if (percentEl) percentEl.textContent = `${percent}%`;
  if (runIdEl) runIdEl.textContent = activeVanscoRunId ? `Run ${activeVanscoRunId.slice(0, 8)}` : "";
  if (barEl) {
    barEl.style.width = `${percent}%`;
    barEl.style.background = payload?.complete ? "#16a34a" : failed > 0 ? "#f59e0b" : "#2563eb";
  }
  if (detailEl) {
    detailEl.innerHTML = `
      <strong>Checked: ${processed} / ${total || "?"}</strong>
      <span>Success: ${success}</span>
      <span>Failed: ${failed}</span>
      <span>Remaining: ${remaining}</span>
      <span>Stage: ${stageLabel(stage)}</span>
    `;
  }
}

function finishStatusHub(payload) {
  const complete = Boolean(payload?.complete) || Number(payload?.remainingCount || payload?.remainingThisRunCount || 0) === 0;
  updateStatusHub(
    payload,
    complete ? "complete" : "waiting_next_batch",
    complete ? "Full Vansco refresh complete. Reloaded comparison from the saved cache." : "Refresh stopped safely before completion. Press Refresh Vansco cache again to continue."
  );
  const panel = typeof document !== "undefined" ? document.getElementById("vansco-status-hub") : null;
  if (!panel) return;
  positionStatusHub(panel);
  panel.style.borderColor = complete ? "#86efac" : "#fed7aa";
  panel.style.background = complete
    ? "linear-gradient(180deg,#ecfdf5 0%,#ffffff 100%)"
    : "linear-gradient(180deg,#fff7ed 0%,#ffffff 100%)";
}

export async function fetchVanscoCacheRecords(pipeline) {
  ensureVanscoLayoutStyles();
  const response = await fetch(`/api/vansco-cache-list?pipeline=${encodeURIComponent(pipeline)}`, {
    headers: { accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    showStatusHub();
    updateStatusHub({}, "failed", payload.message || "Could not load Vansco cache records.");
    throw new Error(payload.message || "Could not load Vansco cache records.");
  }
  return payload;
}

export async function fetchVanscoRefreshStatus(runId = "") {
  const params = runId ? `?runId=${encodeURIComponent(runId)}` : "";
  const response = await fetch(`/api/vansco-refresh-status${params}`, {
    headers: { accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "Could not load Vansco refresh status.");
  }
  return payload;
}

export async function runVanscoLiveRefreshBatch({ batchSize = 10, refreshUrls = false, runId = "" } = {}) {
  const params = new URLSearchParams({
    batchSize: String(batchSize),
    refreshUrls: refreshUrls ? "true" : "false",
  });
  if (runId) params.set("runId", runId);

  const response = await fetch(`/api/vansco-cache-live-refresh?${params.toString()}`, {
    method: "POST",
    headers: { accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    updateStatusHub(payload, "failed", payload.message || "Could not run Vansco live refresh.");
    throw new Error(payload.message || "Could not run Vansco live refresh.");
  }
  if (payload.runId) activeVanscoRunId = payload.runId;
  updateStatusHub(payload, refreshUrls ? "refreshing_url_list" : "processing_dragon_details");
  return payload;
}

export async function refreshVanscoCacheUrls() {
  showStatusHub();
  updateStatusHub({}, "starting", "Starting full Vansco feed refresh. First step: refresh current URL list.");
  const payload = await runVanscoLiveRefreshBatch({ batchSize: 10, refreshUrls: true });
  return {
    ...payload,
    urlsFound: payload.refresh?.urlsFound || payload.run?.total_urls || 0,
    rowsUpserted: payload.refresh?.rowsUpserted || payload.run?.total_urls || 0,
  };
}

export async function processVanscoCacheBatch() {
  let latest = null;
  let runId = activeVanscoRunId;
  const maxBatches = 40;

  for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
    latest = await runVanscoLiveRefreshBatch({ batchSize: 10, refreshUrls: false, runId });
    runId = latest.runId || runId;
    updateStatusHub(latest, "processing_dragon_details", `Processing safe batch ${batchIndex + 1}. Keep this page open while refresh runs.`);

    if (!latest.shouldContinue || latest.complete) break;
    await wait(1000);
  }

  const result = {
    ...(latest || {}),
    processedCount: latest?.totalRunProcessedCount ?? latest?.processedCount ?? 0,
    successCount: latest?.totalRunSuccessCount ?? latest?.successCount ?? 0,
    failureCount: latest?.totalRunFailureCount ?? latest?.failureCount ?? 0,
    remainingCount: latest?.remainingThisRunCount ?? latest?.remainingUncheckedOrMissingRegCount ?? 0,
  };

  finishStatusHub(result);
  return result;
}

export async function saveVanscoWatchAction({ pipeline, record, workflowStatus, notes }) {
  const response = await fetch("/api/vansco-watch-action", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ pipeline, record, workflowStatus, notes }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    updateStatusHub({}, "failed", payload.message || "Could not save Vansco Stock Watch action.");
    throw new Error(payload.message || "Could not save Vansco Stock Watch action.");
  }
  updateStatusHub({}, "complete", "Action saved. Ignore/Delete-Block changes are stored per tab only.");
  return payload.record;
}

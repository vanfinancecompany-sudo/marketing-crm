let activeVanscoRunId = "";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function ensureProgressPanel() {
  if (typeof document === "undefined") return null;

  let panel = document.getElementById("vansco-live-refresh-progress");
  if (panel) return panel;

  const target = document.querySelector(".hero-panel") || document.querySelector(".page-stack") || document.body;
  panel = document.createElement("section");
  panel.id = "vansco-live-refresh-progress";
  panel.setAttribute("aria-live", "polite");
  panel.style.cssText = [
    "margin-top:14px",
    "padding:14px",
    "border-radius:18px",
    "border:1px solid #bfdbfe",
    "background:linear-gradient(180deg,#eff6ff 0%,#ffffff 100%)",
    "box-shadow:0 12px 32px rgba(37,99,235,0.14)",
    "color:#0f172a",
    "display:grid",
    "gap:10px",
  ].join(";");

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;">
      <div>
        <div style="font-weight:900;font-size:15px;">Vansco live refresh</div>
        <div data-vansco-progress-stage style="color:#475569;font-size:13px;margin-top:2px;">Starting...</div>
      </div>
      <div data-vansco-progress-percent style="font-weight:900;font-size:22px;color:#1d4ed8;">0%</div>
    </div>
    <div style="height:12px;border-radius:999px;background:#dbeafe;overflow:hidden;">
      <div data-vansco-progress-bar style="height:100%;width:0%;background:#2563eb;transition:width .25s ease;"></div>
    </div>
    <div data-vansco-progress-detail style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;font-size:13px;color:#334155;"></div>
    <div style="font-size:12px;color:#64748b;">Refresh in progress uses safe Dragon batches. CRM stock, Wix, Facebook and your Ignore/Delete-Block records are not changed.</div>
  `;

  if (target === document.body) {
    panel.style.position = "fixed";
    panel.style.right = "18px";
    panel.style.bottom = "18px";
    panel.style.zIndex = "9999";
    panel.style.maxWidth = "560px";
    document.body.appendChild(panel);
  } else {
    target.appendChild(panel);
  }

  return panel;
}

function updateProgressPanel(payload, fallbackStage = "processing_dragon_details") {
  const panel = ensureProgressPanel();
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
  const percentEl = panel.querySelector("[data-vansco-progress-percent]");
  const barEl = panel.querySelector("[data-vansco-progress-bar]");
  const detailEl = panel.querySelector("[data-vansco-progress-detail]");

  if (stageEl) stageEl.textContent = `${stageLabel(stage)}${activeVanscoRunId ? ` · Run ${activeVanscoRunId.slice(0, 8)}` : ""}`;
  if (percentEl) percentEl.textContent = `${percent}%`;
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

function finishProgressPanel(payload) {
  updateProgressPanel(payload, "complete");
  const panel = typeof document !== "undefined" ? document.getElementById("vansco-live-refresh-progress") : null;
  if (!panel) return;
  panel.style.borderColor = payload?.complete ? "#86efac" : "#fed7aa";
  panel.style.background = payload?.complete
    ? "linear-gradient(180deg,#ecfdf5 0%,#ffffff 100%)"
    : "linear-gradient(180deg,#fff7ed 0%,#ffffff 100%)";
}

export async function fetchVanscoCacheRecords(pipeline) {
  const response = await fetch(`/api/vansco-cache-list?pipeline=${encodeURIComponent(pipeline)}`, {
    headers: { accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
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
    throw new Error(payload.message || "Could not run Vansco live refresh.");
  }
  if (payload.runId) activeVanscoRunId = payload.runId;
  updateProgressPanel(payload, refreshUrls ? "refreshing_url_list" : "processing_dragon_details");
  return payload;
}

export async function refreshVanscoCacheUrls() {
  ensureProgressPanel();
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
    updateProgressPanel(latest);

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

  finishProgressPanel(result);
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
    throw new Error(payload.message || "Could not save Vansco Stock Watch action.");
  }
  return payload.record;
}

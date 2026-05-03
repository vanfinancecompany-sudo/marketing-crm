let activeVanscoRunId = "";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  return payload;
}

export async function refreshVanscoCacheUrls() {
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

    if (!latest.shouldContinue || latest.complete) break;
    await wait(1000);
  }

  return {
    ...(latest || {}),
    processedCount: latest?.totalRunProcessedCount ?? latest?.processedCount ?? 0,
    successCount: latest?.totalRunSuccessCount ?? latest?.successCount ?? 0,
    failureCount: latest?.totalRunFailureCount ?? latest?.failureCount ?? 0,
    remainingCount: latest?.remainingThisRunCount ?? latest?.remainingUncheckedOrMissingRegCount ?? 0,
  };
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

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

export async function refreshVanscoCacheUrls() {
  const response = await fetch("/api/vansco-cache-refresh", {
    method: "POST",
    headers: { accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "Could not refresh Vansco URL cache.");
  }
  return payload;
}

export async function processVanscoCacheBatch(batchSize = 3) {
  const response = await fetch(`/api/vansco-cache-process?batchSize=${encodeURIComponent(batchSize)}`, {
    method: "POST",
    headers: { accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "Could not process Vansco cache batch.");
  }
  return payload;
}

export async function runVanscoLiveRefreshBatch({ batchSize = 10, refreshUrls = false } = {}) {
  const params = new URLSearchParams({
    batchSize: String(batchSize),
    refreshUrls: refreshUrls ? "true" : "false",
  });
  const response = await fetch(`/api/vansco-cache-live-refresh?${params.toString()}`, {
    method: "POST",
    headers: { accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "Could not run Vansco live refresh.");
  }
  return payload;
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

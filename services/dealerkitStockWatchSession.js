export const DEALERKIT_STOCK_WATCH_SESSION_TTL_MS = 5 * 60 * 1000;

export function createDealerKitStockWatchSessionCache({
  now = Date.now,
  ttlMs = DEALERKIT_STOCK_WATCH_SESSION_TTL_MS,
} = {}) {
  let cached = null;
  let expiresAt = 0;
  let inFlight = null;
  let generation = 0;

  return {
    peek() {
      return cached;
    },
    isCurrent() {
      return Boolean(cached && now() < expiresAt);
    },
    lane(pipeline) {
      return cached?.lanes?.[pipeline] || null;
    },
    async load(fetchSession, { forceFresh = false } = {}) {
      if (!forceFresh && cached && now() < expiresAt) return { session: cached, cached: true };
      if (!forceFresh && inFlight) return inFlight;
      const requestGeneration = ++generation;
      const work = Promise.resolve().then(fetchSession).then((session) => {
        if (!session?.ok || !session?.lanes) throw new Error("DealerKit Stock Watch returned an incomplete session response.");
        if (requestGeneration === generation) {
          cached = session;
          expiresAt = now() + ttlMs;
        }
        return { session, cached: false };
      }).finally(() => {
        if (inFlight === work) inFlight = null;
      });
      inFlight = work;
      return work;
    },
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { method: "GET", cache: "no-store", headers: { accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message || "Could not load DealerKit Stock Watch data.");
  return payload;
}

export function fetchDealerKitStockWatchSession() {
  return fetchJson("/api/dealerkit-stock-watch-session");
}

export function fetchDealerKitStockWatchComparison(pipeline) {
  return fetchJson(`/api/dealerkit-stock-watch-comparison-refresh?pipeline=${encodeURIComponent(pipeline)}`);
}

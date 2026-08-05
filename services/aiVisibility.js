import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "./marketingAccess.js";

const API_ROUTE = "/api/marketing-ai-visibility";
const CONNECTIONS_API_ROUTE = "/api/marketing-ai-visibility-google";
const WIX_SYNC_API_ROUTE = "/api/marketing-ai-visibility-wix-sync";
const WIX_DIAGNOSTICS_API_ROUTE = "/api/marketing-ai-visibility-wix-diagnostics";
const MANUAL_EVIDENCE_API_ROUTE = "/api/marketing-ai-visibility-manual";
const PASSIVE_REQUEST_TIMEOUT_MS = 12000;
const STANDARD_ACTION_TIMEOUT_MS = 30000;
const SINGLE_GOOGLE_CHECK_TIMEOUT_MS = 90000;
const BULK_GOOGLE_CHECK_TIMEOUT_MS = 240000;
const WIX_SYNC_TIMEOUT_MS = 180000;
const LOAD_CACHE_MS = 30000;
const FAILURE_COOLDOWN_MS = 60000;

const inFlightRequests = new Map();
const responseCache = new Map();
const failureCooldowns = new Map();

function requestKey(route, action, payload = {}) {
  return `${route}:${action}:${JSON.stringify(payload)}`;
}

function cachedResult(key) {
  const cached = responseCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.savedAt > LOAD_CACHE_MS) {
    responseCache.delete(key);
    return null;
  }
  return cached.value;
}

function cooldownError(key) {
  const failedAt = failureCooldowns.get(key);
  if (!failedAt || Date.now() - failedAt > FAILURE_COOLDOWN_MS) {
    failureCooldowns.delete(key);
    return null;
  }
  const error = new Error("AI Visibility data is temporarily paused. Please wait a minute before trying again.");
  error.status = 503;
  return error;
}

async function request(route, action, payload = {}, options = {}) {
  const key = requestKey(route, action, payload);
  const timeoutMs = options.timeoutMs || PASSIVE_REQUEST_TIMEOUT_MS;
  const useCooldown = options.cooldown !== false;

  if (options.cache) {
    const cached = cachedResult(key);
    if (cached) return cached;
  }
  if (useCooldown) {
    const coolingDown = cooldownError(key);
    if (coolingDown) throw coolingDown;
  }
  if (inFlightRequests.has(key)) return inFlightRequests.get(key);

  const pending = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(route, {
        method: "POST",
        headers: buildMarketingAccessHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ action, ...payload }),
        signal: controller.signal,
      });
      const result = await parseMarketingJsonResponse(response, "AI Visibility request failed.");
      failureCooldowns.delete(key);
      if (options.cache) responseCache.set(key, { value: result, savedAt: Date.now() });
      return result;
    } catch (error) {
      if (useCooldown) failureCooldowns.set(key, Date.now());
      if (error?.name === "AbortError") {
        const timeoutError = new Error(
          options.timeoutMessage || "AI Visibility request timed out. Please try again shortly.",
        );
        timeoutError.status = 503;
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      inFlightRequests.delete(key);
    }
  })();

  inFlightRequests.set(key, pending);
  return pending;
}

const requestAiVisibility = (action, payload = {}, options = {}) =>
  request(API_ROUTE, action, payload, options);
const requestConnection = (action, payload = {}, options = {}) =>
  request(CONNECTIONS_API_ROUTE, action, payload, options);
const requestWixSync = (action, payload = {}, options = {}) =>
  request(WIX_SYNC_API_ROUTE, action, payload, options);

export const loadGoogleSearchConsoleConnection = () =>
  requestConnection("googleConnection", {}, { cache: true });

export const loadAiVisibility = () =>
  requestAiVisibility("load", {}, { cache: true });

export const saveVisibilityPublication = (articleId, publication) =>
  requestAiVisibility("savePublication", { article_id: articleId, publication }, { timeoutMs: STANDARD_ACTION_TIMEOUT_MS, cooldown: false });
export const deriveArticleVisibilityPrompts = (articleId) =>
  requestAiVisibility("derivePrompts", { article_id: articleId }, { timeoutMs: STANDARD_ACTION_TIMEOUT_MS, cooldown: false });
export const saveArticleVisibilityPrompt = (prompt) =>
  requestAiVisibility("savePrompt", { prompt }, { timeoutMs: STANDARD_ACTION_TIMEOUT_MS, cooldown: false });
export const recordManualVisibilityResult = (result) =>
  request(MANUAL_EVIDENCE_API_ROUTE, "recordManualEvidence", { result }, { timeoutMs: STANDARD_ACTION_TIMEOUT_MS, cooldown: false });
export const runArticleVisibilityCheck = (articleId, provider, promptId = null) =>
  requestAiVisibility("runCheck", {
    article_id: articleId,
    provider,
    prompt_id: promptId,
  }, { timeoutMs: STANDARD_ACTION_TIMEOUT_MS, cooldown: false });
export const saveAiVisibilitySettings = (attentionDays) =>
  requestAiVisibility("saveSettings", { attention_days: attentionDays }, { timeoutMs: STANDARD_ACTION_TIMEOUT_MS, cooldown: false });

function withVisibleWixDiagnostics(result = {}) {
  const summary = result.summary || {};
  return {
    ...result,
    summary: {
      ...summary,
      wix_items_checked:
        `${summary.wix_items_checked || 0} · Total article records loaded: ${summary.total_article_records_loaded || 0}`,
      wix_live_items_matched:
        `${summary.wix_live_items_matched || 0} · Wix-managed records identified: ${summary.wix_managed_records_identified || 0} · Live records matched: ${summary.live_records_matched || 0}`,
      active_records_updated:
        `${summary.active_records_updated || 0} · Active Wix-managed records before sync: ${summary.active_wix_managed_records_before_sync || 0}`,
      previously_live_records_deactivated:
        `${summary.previously_live_records_deactivated || 0} · Missing-live candidates: ${summary.missing_live_candidates || 0} · Records deactivated: ${summary.records_deactivated || 0}`,
      reactivated_records:
        `${summary.reactivated_records || 0} · Legacy Wix-managed candidates: ${summary.legacy_wix_managed_candidates || 0} · Records skipped as not Wix-managed: ${summary.records_skipped_as_not_wix_managed || 0}`,
    },
  };
}

export const syncLiveWixArticles = async () =>
  withVisibleWixDiagnostics(await requestWixSync("syncLiveWixArticles", {}, {
    timeoutMs: WIX_SYNC_TIMEOUT_MS,
    cooldown: false,
    timeoutMessage: "Wix article sync took too long and was stopped safely.",
  }));
export const loadWixLifecycleDiagnostics = () =>
  request(WIX_DIAGNOSTICS_API_ROUTE, "diagnoseLegacyWixLifecycle", {}, { timeoutMs: STANDARD_ACTION_TIMEOUT_MS, cooldown: false });
export const checkWixPublicationStatus = (articleId) =>
  requestWixSync("checkWixPublication", { article_id: articleId }, { timeoutMs: STANDARD_ACTION_TIMEOUT_MS, cooldown: false });
export const checkGoogleForArticle = (articleId, executionId = "") =>
  requestConnection("checkGoogle", {
    article_id: articleId,
    execution_id: executionId,
  }, {
    timeoutMs: SINGLE_GOOGLE_CHECK_TIMEOUT_MS,
    cooldown: false,
    timeoutMessage: "The Google check took too long and was stopped safely.",
  });
export const checkGoogleForPublishedPages = (executionId = "") =>
  requestConnection("bulkGoogleCheck", { execution_id: executionId }, {
    timeoutMs: BULK_GOOGLE_CHECK_TIMEOUT_MS,
    cooldown: false,
    timeoutMessage: "The published-pages Google check exceeded four minutes and was stopped safely.",
  });

if (typeof window !== "undefined") {
  import("../components/AIVisibilityLiveConnections.jsx")
    .then(({ installAiVisibilityLiveConnections }) => installAiVisibilityLiveConnections())
    .catch((error) => console.error("AI VISIBILITY LIVE CONNECTIONS UI ERROR", error));
  import("../components/AIVisibilityErrorDetails.jsx")
    .then(({ installAiVisibilityErrorDetails }) => installAiVisibilityErrorDetails())
    .catch((error) => console.error("AI VISIBILITY ERROR DETAILS UI ERROR", error));
  import("../components/AIVisibilityPendingState.jsx")
    .then(({ installAiVisibilityPendingState }) => installAiVisibilityPendingState())
    .catch((error) => console.error("AI VISIBILITY PENDING STATE UI ERROR", error));
}

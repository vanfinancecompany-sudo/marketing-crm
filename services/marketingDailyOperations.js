import { buildMarketingAccessHeaders, parseMarketingJsonResponse } from "./marketingAccess.js";

const API_ROUTE = "/api/marketing-daily-operations";
export const DAILY_OPERATIONS_REFRESH_EVENT = "marketing-daily-operations-refresh";
const YOUTUBE_TRACKING_WARNING = "Video downloaded, but Content Operations could not be updated.";

async function requestDailyOperations(action, payload = {}) {
  const response = await fetch(API_ROUTE, {
    method: "POST",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ action, ...payload }),
  });
  return parseMarketingJsonResponse(response, "Daily Marketing Command Centre request failed.");
}

export function getDailyOperationsOverview(activityDate) {
  return requestDailyOperations("overview", { activity_date: activityDate });
}

export function getDailyOperationsTotals(startDate, endDate) {
  return requestDailyOperations("totals", { start_date: startDate, end_date: endDate });
}

export function saveDailyTargetSchedule(effectiveFrom, schedule) {
  return requestDailyOperations("saveSchedule", { effective_from: effectiveFrom, schedule });
}

export function resetDailyTargetDefaults(effectiveFrom) {
  return requestDailyOperations("resetDefaults", { effective_from: effectiveFrom });
}

export function saveDailyTargetOverride(activityDate, targets, note = "") {
  return requestDailyOperations("saveOverride", { activity_date: activityDate, targets, note });
}

export async function recordDailyMarketingActivity(activityType, options = {}) {
  const result = await requestDailyOperations("recordActivity", {
    activity_type: activityType,
    activity_date: options.activityDate,
    quantity: options.quantity || 1,
    source: options.source || "command_centre",
    source_id: options.sourceId || "",
    metadata: options.metadata || {},
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(DAILY_OPERATIONS_REFRESH_EVENT, { detail: { activityType, source: options.source || "command_centre" } }));
  }
  return result;
}

export function undoDailyMarketingActivity(activityType, activityDate) {
  return requestDailyOperations("undoManualActivity", { activity_type: activityType, activity_date: activityDate });
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function youtubeActivityFromDownload({ filename = "", href = "", pageText = "" } = {}) {
  const lowerFilename = String(filename || "").toLowerCase();
  const format = lowerFilename.endsWith(".webm") ? "webm" : lowerFilename.endsWith(".mp4") ? "mp4" : "";
  const productKey = lowerFilename.startsWith("rent2buy-")
    ? "rent2buy"
    : lowerFilename.startsWith("van-finance-")
      ? "vanFinance"
      : lowerFilename.startsWith("car-finance-")
        ? "cars"
        : "";
  if (!format || !productKey || productKey === "cars") return null;
  const activityType = productKey === "rent2buy" ? "rent2buy_reel" : "van_finance_reel";
  const registration = lowerFilename
    .replace(productKey === "rent2buy" ? /^rent2buy-/ : /^van-finance-/, "")
    .replace(/-youtube-short\.(?:mp4|webm)$/i, "")
    .toUpperCase();
  const queueDownload = /(?:rendering|downloading|completed|failed|fallback)\s+(?:mp4\s+)?\d+\s+of\s+\d+/i.test(String(pageText || ""));
  const operationIdentity = `${productKey}|${filename}|${format}|${href}`;
  return {
    activityType,
    sourceId: `youtube-export:${stableHash(operationIdentity)}`,
    metadata: {
      product_key: productKey,
      registration,
      vehicle_id: null,
      filename,
      format,
      queue_download: queueDownload,
      export_operation_id: stableHash(href || operationIdentity),
    },
  };
}

function showYouTubeTrackingWarning(error) {
  console.error("YOUTUBE CONTENT OPERATIONS TRACKING ERROR", error);
  const page = document.querySelector(".youtube-generator");
  if (!page || page.querySelector("[data-youtube-operations-warning]")) return;
  const warning = document.createElement("div");
  warning.className = "youtube-generator__error";
  warning.dataset.youtubeOperationsWarning = "true";
  warning.textContent = YOUTUBE_TRACKING_WARNING;
  const actionsSection = [...page.querySelectorAll(".youtube-generator__section")].find((section) => section.querySelector("button")?.textContent?.includes("Generate Preview"));
  (actionsSection || page).appendChild(warning);
}

function installYouTubeDownloadActivityObserver() {
  if (typeof window === "undefined" || typeof HTMLAnchorElement === "undefined") return;
  const marker = "__youtubeContentOperationsObserverInstalled";
  if (window[marker]) return;
  window[marker] = true;
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function trackedDownloadClick(...args) {
    const filename = String(this.download || "");
    const href = String(this.href || "");
    const page = document.querySelector(".youtube-generator");
    const activity = page ? youtubeActivityFromDownload({ filename, href, pageText: page.textContent || "" }) : null;
    const result = originalClick.apply(this, args);
    if (activity) {
      Promise.resolve().then(() => recordDailyMarketingActivity(activity.activityType, {
        source: "youtube_generator",
        sourceId: activity.sourceId,
        metadata: activity.metadata,
      })).catch(showYouTubeTrackingWarning);
    }
    return result;
  };
}

installYouTubeDownloadActivityObserver();

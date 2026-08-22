import { londonDateKey } from "../lib/marketingDailyOperations.js";
import { parseMarketingJsonResponse } from "./marketingAccess.js";
import { syncBufferPublishStatus } from "./bufferPublishStatus.js";

const API_ROUTE = "/api/marketing-daily-operations-ui";
export const DAILY_OPERATIONS_REFRESH_EVENT =
  "marketing-daily-operations-refresh";
export const YOUTUBE_TRACKING_WARNING =
  "Video downloaded, but Content Operations could not be updated.";

async function requestDailyOperations(action, payload = {}) {
  const response = await fetch(API_ROUTE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...payload }),
  });
  return parseMarketingJsonResponse(
    response,
    "Daily Marketing Command Centre request failed.",
  );
}

async function refreshBufferStatusSafely() {
  try {
    return await syncBufferPublishStatus();
  } catch {
    return null;
  }
}

function bufferHistoryRow(item) {
  const destination = item?.destination || "";
  const activityType = destination === "Rent2Buy Facebook"
    ? "rent2buy_facebook_post"
    : "van_finance_facebook_post";
  const registration = String(item?.registration || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return {
    id: `buffer-${item?.id || registration}`,
    activity_date: londonDateKey(new Date(item?.sentAt || Date.now())),
    activity_type: activityType,
    source: "buffer_publish",
    source_id: `buffer:${item?.id || registration}`,
    metadata: {
      registration,
      destination,
      buffer_post_id: item?.id || "",
      buffer_status: "sent",
      facebook_live: true,
      media_kind: "image",
      external_link: item?.externalLink || "",
    },
    occurred_at: item?.sentAt || new Date().toISOString(),
  };
}

export async function getDailyOperationsOverview(activityDate) {
  await refreshBufferStatusSafely();
  return requestDailyOperations("overview", { activity_date: activityDate });
}

export function getDailyOperationsTotals(startDate, endDate) {
  return requestDailyOperations("totals", {
    start_date: startDate,
    end_date: endDate,
  });
}

export async function getRecentPostingHistory(days = 180) {
  const status = await refreshBufferStatusSafely();
  const result = await requestDailyOperations("postingHistory", {
    days: Math.max(1, Math.min(365, Number(days) || 180)),
  });
  const existing = Array.isArray(result?.history) ? result.history : [];
  const seen = new Set(existing.map((row) => String(row?.source_id || "")).filter(Boolean));
  const bufferRows = (status?.recent || [])
    .filter((item) => item?.mediaKind === "image")
    .map(bufferHistoryRow)
    .filter((row) => !seen.has(row.source_id));
  return {
    ...result,
    history: [...bufferRows, ...existing].sort(
      (a, b) => new Date(b?.occurred_at || 0) - new Date(a?.occurred_at || 0),
    ),
  };
}

export function saveDailyTargetSchedule(effectiveFrom, schedule) {
  return requestDailyOperations("saveSchedule", {
    effective_from: effectiveFrom,
    schedule,
  });
}

export function resetDailyTargetDefaults(effectiveFrom) {
  return requestDailyOperations("resetDefaults", {
    effective_from: effectiveFrom,
  });
}

export function saveDailyTargetOverride(activityDate, targets, note = "") {
  return requestDailyOperations("saveOverride", {
    activity_date: activityDate,
    targets,
    note,
  });
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
    window.dispatchEvent(
      new CustomEvent(DAILY_OPERATIONS_REFRESH_EVENT, {
        detail: { activityType, source: options.source || "command_centre" },
      }),
    );
  }

  return result;
}

export function undoDailyMarketingActivity(activityType, activityDate) {
  return requestDailyOperations("undoManualActivity", {
    activity_type: activityType,
    activity_date: activityDate,
  });
}

export function createYouTubeExportOperationId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `youtube-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function youtubeActivityTypeForProduct(productKey) {
  if (productKey === "vanFinance") return "van_finance_reel";
  if (productKey === "rent2buy") return "rent2buy_reel";
  return null;
}

export async function recordYouTubeGeneratorDownload({
  productKey,
  vehicle,
  filename,
  format,
  queueDownload,
  operationId,
}) {
  const activityType = youtubeActivityTypeForProduct(productKey);
  if (!activityType) return { recorded: false, reason: "unsupported_product" };

  const normalizedFormat = String(format || "").toLowerCase();
  if (!operationId || !["mp4", "webm"].includes(normalizedFormat)) {
    return { recorded: false, reason: "invalid_export" };
  }

  const registration = String(
    vehicle?.reg ||
      vehicle?.registration ||
      vehicle?.title ||
      vehicle?.name ||
      "",
  )
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const vehicleId =
    String(vehicle?.id || vehicle?.vehicle_id || "").trim() || null;
  const options = {
    source: "youtube_generator",
    sourceId: `youtube-export:${productKey}:${operationId}`,
    metadata: {
      product_key: productKey,
      vehicle_id: vehicleId,
      registration,
      filename: String(filename || ""),
      format: normalizedFormat,
      queue_download: Boolean(queueDownload),
      export_operation_id: operationId,
    },
  };

  try {
    await recordDailyMarketingActivity(activityType, options);
  } catch (firstError) {
    // A lost response may follow a successful insert. Retry with the same source ID;
    // the server's unique activity identity remains the final deduplication guard.
    try {
      await recordDailyMarketingActivity(activityType, options);
    } catch {
      throw firstError;
    }
  }

  return { recorded: true, activityType };
}

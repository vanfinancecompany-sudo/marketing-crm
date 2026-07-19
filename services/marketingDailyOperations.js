import { buildMarketingAccessHeaders, parseMarketingJsonResponse } from "./marketingAccess.js";

const API_ROUTE = "/api/marketing-daily-operations";

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

export function recordDailyMarketingActivity(activityType, options = {}) {
  return requestDailyOperations("recordActivity", {
    activity_type: activityType,
    activity_date: options.activityDate,
    quantity: options.quantity || 1,
    source: options.source || "command_centre",
    source_id: options.sourceId || "",
    metadata: options.metadata || {},
  });
}

export function undoDailyMarketingActivity(activityType, activityDate) {
  return requestDailyOperations("undoManualActivity", { activity_type: activityType, activity_date: activityDate });
}


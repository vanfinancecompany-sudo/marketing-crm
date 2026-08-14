import { buildMarketingAccessHeaders, parseMarketingJsonResponse } from "./marketingAccess.js";

export async function loadAssistantAnalytics(days = 28) {
  const safeDays = Math.min(90, Math.max(1, Number.parseInt(days, 10) || 28));
  const response = await fetch(`/api/marketing-ai-assistant-analytics?days=${safeDays}`, {
    method: "GET",
    cache: "no-store",
    headers: buildMarketingAccessHeaders({ "Cache-Control": "no-store" }),
  });
  return parseMarketingJsonResponse(response, "Assistant analytics could not be loaded.");
}

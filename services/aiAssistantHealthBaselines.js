import { buildMarketingAccessHeaders, parseMarketingJsonResponse } from "./marketingAccess.js";

const API_ROUTE = "/api/marketing-ai-control-centre";

async function requestBaseline(action, payload = {}, fetchImplementation = fetch) {
  const response = await fetchImplementation(API_ROUTE, {
    method: "POST",
    cache: "no-store",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json", "Cache-Control": "no-store" }),
    body: JSON.stringify({ action, ...payload }),
  });
  return parseMarketingJsonResponse(response, "Assistant Health baseline request failed.");
}

export const loadAssistantHealthBaselines = (fetchImplementation) => requestBaseline("loadHealthBaselines", {}, fetchImplementation);
export const saveAssistantHealthBaseline = (payload, fetchImplementation) => requestBaseline("saveHealthBaseline", payload, fetchImplementation);

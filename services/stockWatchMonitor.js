import { buildMarketingAccessHeaders, parseMarketingJsonResponse } from "./marketingAccess.js";

const ROUTE = "/api/stock-watch-monitor-agent";

export async function fetchStockWatchMonitorStatus(fetchImplementation = fetch) {
  const response = await fetchImplementation(ROUTE, {
    method: "GET",
    cache: "no-store",
    headers: buildMarketingAccessHeaders({ "Cache-Control": "no-store" }),
  });
  return parseMarketingJsonResponse(response, "Could not load Stock Watch Monitor status.");
}

export async function runStockWatchMonitorNow(fetchImplementation = fetch) {
  const response = await fetchImplementation(ROUTE, {
    method: "POST",
    cache: "no-store",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json", "Cache-Control": "no-store" }),
    body: JSON.stringify({ action: "run" }),
  });
  return parseMarketingJsonResponse(response, "Could not run Stock Watch Monitor.");
}

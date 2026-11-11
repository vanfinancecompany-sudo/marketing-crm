import { buildMarketingAccessHeaders } from "./marketingAccess.js";

export async function removeSoldWixStock(pipeline, registration) {
  const response = await fetch("/api/stock-watch-sold-wix-remove", {
    method: "POST",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
    body: JSON.stringify({ pipeline, registration, confirmed: true }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok !== true || Number(result.remaining) !== 0) {
    throw new Error(result.message || "Wix did not confirm that the vehicle has been removed from live listings.");
  }
  return result;
}

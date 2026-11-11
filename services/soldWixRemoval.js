import { buildMarketingAccessHeaders } from "./marketingAccess.js";

async function soldWixRequest(pipeline, registration, action, confirmed = false) {
  const response = await fetch("/api/stock-watch-sold-wix-remove", {
    method: "POST",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
    body: JSON.stringify({ pipeline, registration, action, confirmed }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok !== true) {
    throw new Error(result.message || "Wix could not verify the vehicle status.");
  }
  return result;
}

export async function checkSoldWixStock(pipeline, registration) {
  const result = await soldWixRequest(pipeline, registration, "check");
  if (result.previewOnly !== true || Number(result.changed) !== 0) {
    throw new Error("The Wix check returned an unexpected response.");
  }
  return result;
}

export async function removeSoldWixStock(pipeline, registration) {
  const result = await soldWixRequest(pipeline, registration, "remove", true);
  if (result.previewOnly === true || Number(result.remaining) !== 0) {
    throw new Error(result.message || "Wix did not confirm removal from live listings.");
  }
  return result;
}

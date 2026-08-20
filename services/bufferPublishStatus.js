import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "./marketingAccess.js";

const API_ROUTE = "/api/buffer-publish-status";

export async function syncBufferPublishStatus() {
  const response = await fetch(API_ROUTE, {
    method: "POST",
    headers: buildMarketingAccessHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ action: "sync" }),
  });
  return parseMarketingJsonResponse(
    response,
    "Could not confirm Facebook publishing status from Buffer.",
  );
}

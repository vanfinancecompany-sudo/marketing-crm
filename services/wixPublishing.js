import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "./marketingAccess.js";

export async function createOrUpdateWixDraft(articleId) {
  const response = await fetch("/api/marketing-wix-publishing", {
    method: "POST",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      action: "createOrUpdateDraft",
      article_id: articleId,
    }),
  });
  return parseMarketingJsonResponse(response, "Wix draft creation failed.");
}

import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "./marketingAccess.js";

const API_ROUTE = "/api/marketing-ai-platform";

export async function requestAiMarketingPlatform(action, payload = {}) {
  const response = await fetch(API_ROUTE, {
    method: "POST",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ action, ...payload }),
  });
  return parseMarketingJsonResponse(response, "AI Marketing Platform request failed.");
}

export function loadAiMarketingPlatform() {
  return requestAiMarketingPlatform("load");
}

export function generateContentAsset(articleId, channel, assetId = "") {
  return requestAiMarketingPlatform("generateAsset", {
    article_id: articleId,
    channel,
    asset_id: assetId,
  });
}

export function saveContentAsset(asset, status = asset?.status || "draft") {
  return requestAiMarketingPlatform("saveAsset", { asset, status });
}

export function reviewContentAsset(assetId) {
  return requestAiMarketingPlatform("reviewAsset", { asset_id: assetId });
}

export function analyseBusinessWebsite(websiteUrl) {
  return requestAiMarketingPlatform("analyseWebsite", { website_url: websiteUrl });
}

export function applyBusinessWebsiteImport(importId, selectedSections) {
  return requestAiMarketingPlatform("applyWebsiteImport", {
    import_id: importId,
    selected_sections: selectedSections,
  });
}

export function createCampaignDraftFromArticle(values) {
  return requestAiMarketingPlatform("createCampaignFromArticle", { values });
}

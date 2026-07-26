import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "./marketingAccess.js";

const API_ROUTE = "/api/marketing-ai-visibility";

async function requestAiVisibility(action, payload = {}) {
  const response = await fetch(API_ROUTE, {
    method: "POST",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ action, ...payload }),
  });
  return parseMarketingJsonResponse(response, "AI Visibility request failed.");
}

export const loadAiVisibility = () => requestAiVisibility("load");
export const saveVisibilityPublication = (articleId, publication) =>
  requestAiVisibility("savePublication", { article_id: articleId, publication });
export const deriveArticleVisibilityPrompts = (articleId) =>
  requestAiVisibility("derivePrompts", { article_id: articleId });
export const saveArticleVisibilityPrompt = (prompt) =>
  requestAiVisibility("savePrompt", { prompt });
export const recordManualVisibilityResult = (result) =>
  requestAiVisibility("recordManualResult", { result });
export const runArticleVisibilityCheck = (articleId, provider, promptId = null) =>
  requestAiVisibility("runCheck", {
    article_id: articleId,
    provider,
    prompt_id: promptId,
  });
export const saveAiVisibilitySettings = (attentionDays) =>
  requestAiVisibility("saveSettings", { attention_days: attentionDays });

import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "./marketingAccess.js";

const API_ROUTE = "/api/marketing-ai-visibility";
const CONNECTIONS_API_ROUTE = "/api/marketing-ai-visibility-connections";

async function request(route, action, payload = {}) {
  const response = await fetch(route, {
    method: "POST",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ action, ...payload }),
  });
  return parseMarketingJsonResponse(response, "AI Visibility request failed.");
}

const requestAiVisibility = (action, payload = {}) => request(API_ROUTE, action, payload);
const requestConnection = (action, payload = {}) => request(CONNECTIONS_API_ROUTE, action, payload);

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

export const syncLiveWixArticles = () => requestConnection("syncLiveWixArticles");
export const checkWixPublicationStatus = (articleId) =>
  requestConnection("checkWixPublication", { article_id: articleId });
export const loadGoogleSearchConsoleConnection = () =>
  requestConnection("googleConnection");
export const checkGoogleForArticle = (articleId, executionId = "") =>
  requestConnection("checkGoogle", {
    article_id: articleId,
    execution_id: executionId,
  });
export const checkGoogleForPublishedPages = (executionId = "") =>
  requestConnection("bulkGoogleCheck", { execution_id: executionId });

if (typeof window !== "undefined") {
  import("../components/AIVisibilityLiveConnections.jsx")
    .then(({ installAiVisibilityLiveConnections }) => installAiVisibilityLiveConnections())
    .catch((error) => console.error("AI VISIBILITY LIVE CONNECTIONS UI ERROR", error));
}

import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "./marketingAccess.js";

const API_ROUTE = "/api/marketing-ai-visibility";
const CONNECTIONS_API_ROUTE = "/api/marketing-ai-visibility-connections";
const WIX_SYNC_API_ROUTE = "/api/marketing-ai-visibility-wix-sync";
const MANUAL_EVIDENCE_API_ROUTE = "/api/marketing-ai-visibility-manual";

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
const requestWixSync = (action, payload = {}) => request(WIX_SYNC_API_ROUTE, action, payload);

export const loadGoogleSearchConsoleConnection = () =>
  requestConnection("googleConnection");

export const loadAiVisibility = async () => {
  try {
    await loadGoogleSearchConsoleConnection();
  } catch (error) {
    console.warn("GOOGLE SEARCH CONSOLE CONNECTION REFRESH ERROR", error);
  }
  return requestAiVisibility("load");
};

export const saveVisibilityPublication = (articleId, publication) =>
  requestAiVisibility("savePublication", { article_id: articleId, publication });
export const deriveArticleVisibilityPrompts = (articleId) =>
  requestAiVisibility("derivePrompts", { article_id: articleId });
export const saveArticleVisibilityPrompt = (prompt) =>
  requestAiVisibility("savePrompt", { prompt });
export const recordManualVisibilityResult = (result) =>
  request(MANUAL_EVIDENCE_API_ROUTE, "recordManualEvidence", { result });
export const runArticleVisibilityCheck = (articleId, provider, promptId = null) =>
  requestAiVisibility("runCheck", {
    article_id: articleId,
    provider,
    prompt_id: promptId,
  });
export const saveAiVisibilitySettings = (attentionDays) =>
  requestAiVisibility("saveSettings", { attention_days: attentionDays });

export const syncLiveWixArticles = () => requestWixSync("syncLiveWixArticles");
export const checkWixPublicationStatus = (articleId) =>
  requestWixSync("checkWixPublication", { article_id: articleId });
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

import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "./marketingAccess.js";

const API_ROUTE = "/api/marketing-editorial-engine";

export async function requestEditorialEngine(action, payload = {}) {
  const response = await fetch(API_ROUTE, {
    method: "POST",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ action, ...payload }),
  });
  return parseMarketingJsonResponse(response, "Editorial Engine request failed.");
}

export const loadEditorialEngine = () => requestEditorialEngine("load");

export const analyseEditorialArticle = (articleId) =>
  requestEditorialEngine("analyseArticle", { article_id: articleId });

export const saveBusinessIntentOverrides = (articleId, overrides) =>
  requestEditorialEngine("saveIntentOverrides", { article_id: articleId, overrides });

export const saveArticleEditorialOverrides = (articleId, overrides) =>
  requestEditorialEngine("saveEditorialOverrides", { article_id: articleId, overrides });

export const proposeEditorialImprovement = (articleId, recommendationKey) =>
  requestEditorialEngine("proposeImprovement", {
    article_id: articleId,
    recommendation_key: recommendationKey,
  });

export const applyEditorialImprovement = (proposalId) =>
  requestEditorialEngine("applyImprovement", { proposal_id: proposalId });

export const rejectEditorialImprovement = (proposalId) =>
  requestEditorialEngine("rejectImprovement", { proposal_id: proposalId });

export const recordArticleRevision = (articleId, changeSource, changeSummary) =>
  requestEditorialEngine("recordRevision", {
    article_id: articleId,
    change_source: changeSource,
    change_summary: changeSummary,
  });

export const recordBusinessBrainUpdate = (sectionKey, summary) =>
  requestEditorialEngine("recordBusinessBrainUpdate", {
    section_key: sectionKey,
    summary,
  });

import { buildMarketingAccessHeaders, parseMarketingJsonResponse } from "./marketingAccess.js";

const API_ROUTE = "/api/marketing-ai-knowledge-opportunities";

export async function requestKnowledgeOpportunities(action, payload = {}) {
  const response = await fetch(API_ROUTE, {
    method: "POST",
    cache: "no-store",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json", "Cache-Control": "no-store" }),
    body: JSON.stringify({ action, ...payload }),
  });
  return parseMarketingJsonResponse(response, "AI Knowledge Opportunities request failed.");
}

export const loadKnowledgeOpportunities = () => requestKnowledgeOpportunities("load");
export const analyseExistingCompetenceResults = () => requestKnowledgeOpportunities("analyseExisting");
export const updateKnowledgeOpportunity = (payload) => requestKnowledgeOpportunities("updateOpportunity", payload);
export const createOpportunityArticleDraft = (payload) => requestKnowledgeOpportunities("createArticleDraft", payload);
export const createOpportunityFaqDraft = (payload) => requestKnowledgeOpportunities("createFaqDraft", payload);
export const linkOpportunityArticle = (payload) => requestKnowledgeOpportunities("linkArticle", payload);

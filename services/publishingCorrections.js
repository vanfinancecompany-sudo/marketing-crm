import { buildMarketingAccessHeaders, parseMarketingJsonResponse } from "./marketingAccess.js";

const API_ROUTE = "/api/marketing-knowledge-corrections";

async function request(action, payload = {}) {
  const response = await fetch(API_ROUTE, {
    method: "POST",
    headers: buildMarketingAccessHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ action, ...payload }),
  });
  return parseMarketingJsonResponse(response, "Article correction request failed.");
}

export const proposePublishingCorrection = (articleId) =>
  request("propose", { article_id: articleId });

export const acceptPublishingCorrection = (proposal) =>
  request("accept", {
    article_id: proposal.article_id,
    source_updated_at: proposal.source_updated_at,
    corrected_article: proposal.after,
  });

export const proposeBulkPublishingCorrections = (articleIds) =>
  request("bulkPropose", { article_ids: articleIds });

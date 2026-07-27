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

export const proposePublishingCorrection = (articleId, unresolvedReasons = [], productScope = "") =>
  request("propose", {
    article_id: articleId,
    unresolved_reasons: unresolvedReasons,
    product_scope: productScope,
  });

export const savePublishingCorrectionScope = (articleId, productScope) =>
  request("setScope", { article_id: articleId, product_scope: productScope });

export const acceptPublishingCorrection = (proposal, confirmLargeReduction = false) =>
  request("accept", {
    article_id: proposal.article_id,
    source_updated_at: proposal.source_updated_at,
    corrected_article: proposal.after,
    product_scope: proposal.product_scope,
    excessive_content_loss: Boolean(proposal.excessive_content_loss),
    unexplained_content_loss_percent: Number(proposal.unexplained_content_loss_percent) || 0,
    confirm_large_reduction: Boolean(confirmLargeReduction),
    correction_complete: Boolean(proposal.correction_complete),
    remaining_hard_blocks: proposal.remaining_hard_blocks || [],
    markdown_structure_valid: Boolean(proposal.markdown_structure_valid),
    comparison_structure_valid: proposal.comparison_structure_valid !== false,
  });

export const proposeBulkPublishingCorrections = (articleIds) =>
  request("bulkPropose", { article_ids: articleIds });

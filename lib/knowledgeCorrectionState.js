import { compareFaqCollections } from "./faqNormalization.js";

export const KNOWLEDGE_CORRECTION_STATE_EVENT = "knowledge-correction-state";
export const KNOWLEDGE_CORRECTION_STATE_STORAGE = "knowledgeCorrectionFeedback";

const REVIEW_FIELDS = [
  "title",
  "slug",
  "seo_title",
  "meta_description",
  "excerpt",
  "content_markdown",
  "cta",
  "category",
  "article_type",
  "featured_image",
  "generation_metadata",
  "primary_product",
  "topic_product",
];

function comparable(value) {
  return JSON.stringify(value ?? null);
}

function acceptedAnchorRecords(links = []) {
  return (Array.isArray(links) ? links : [])
    .filter((link) => !link?.status || link.status === "accepted")
    .map((link) => ({
      destination: String(link?.destination_url || link?.url || link?.destination || "").trim(),
      anchor: String(link?.anchor_text || link?.label || "").trim(),
    }))
    .filter((link) => link.destination || link.anchor)
    .sort((left, right) => `${left.destination}|${left.anchor}`.localeCompare(`${right.destination}|${right.anchor}`));
}

export function verifyAcceptedCorrection(savedArticle = {}, reviewedArticle = {}, refreshedLinks = []) {
  const fieldErrors = REVIEW_FIELDS
    .filter((field) => comparable(savedArticle?.[field]) !== comparable(reviewedArticle?.[field]))
    .map((field) => ({
      field,
      saved_value: savedArticle?.[field] ?? null,
      reviewed_value: reviewedArticle?.[field] ?? null,
    }));

  const faqComparison = compareFaqCollections(reviewedArticle?.faq_json, savedArticle?.faq_json);
  if (!faqComparison.equal) fieldErrors.push(faqComparison.error);

  const savedLinks = refreshedLinks.length
    ? refreshedLinks
    : savedArticle?.internal_link_suggestions || [];
  const savedAnchors = acceptedAnchorRecords(savedLinks);
  const reviewedAnchors = acceptedAnchorRecords(reviewedArticle?.internal_link_suggestions || []);
  if (comparable(savedAnchors) !== comparable(reviewedAnchors)) {
    fieldErrors.push({
      field: "accepted_internal_link_anchors",
      saved_value: savedAnchors,
      reviewed_value: reviewedAnchors,
    });
  }

  return {
    correction_save_verified: fieldErrors.length === 0,
    correction_save_verification_errors: fieldErrors,
  };
}

export function correctionSaveEligibility(state = {}, currentArticle = {}) {
  const proposal = state?.proposal;
  if (!proposal) return { eligible: false, reason: "No correction proposal is available." };
  if (proposal.article_id && currentArticle?.id && proposal.article_id !== currentArticle.id) {
    return { eligible: false, reason: "The correction proposal belongs to a different article." };
  }
  if (proposal.source_updated_at && currentArticle?.updated_at && proposal.source_updated_at !== currentArticle.updated_at) {
    return { eligible: false, reason: "The article changed after the correction was prepared. Generate a fresh proposal." };
  }
  if (proposal.correction_complete !== true || (proposal.remaining_hard_blocks || []).length) {
    return { eligible: false, reason: "Material correction blocks must be resolved before saving." };
  }
  if (proposal.claim_confirmation_required && state.claims_confirmed !== true) {
    return { eligible: false, reason: "Confirm the flagged business or financial claim before saving." };
  }
  if (proposal.content_loss_confirmation_required && state.content_loss_confirmed !== true) {
    return { eligible: false, reason: "Confirm the reviewed content reduction before saving." };
  }
  return { eligible: true, reason: "" };
}

export function proposalStateForArticle(proposal, confirmations = {}) {
  return {
    article_id: proposal?.article_id || proposal?.after?.id || null,
    status: "proposal_ready",
    proposal_id: proposal?.proposal_id || `${proposal?.article_id || proposal?.after?.id || "article"}:${proposal?.source_updated_at || "proposal"}`,
    proposal,
    claims_confirmed: confirmations.claims === true,
    content_loss_confirmed: confirmations.contentLoss === true,
    correction_save_verified: false,
    visible_success_displayed: false,
  };
}

export function readKnowledgeCorrectionState(storage) {
  try {
    const target = storage || globalThis?.sessionStorage;
    if (!target) return null;
    const value = target.getItem(KNOWLEDGE_CORRECTION_STATE_STORAGE);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function writeKnowledgeCorrectionState(state, storage) {
  try {
    const target = storage || globalThis?.sessionStorage;
    if (!target) return false;
    target.setItem(KNOWLEDGE_CORRECTION_STATE_STORAGE, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function publishKnowledgeCorrectionState(state, storage, target = globalThis?.window) {
  writeKnowledgeCorrectionState(state, storage);
  dispatchKnowledgeCorrectionState(state, target);
  return state;
}

export function dispatchKnowledgeCorrectionState(state, target = globalThis?.window) {
  try {
    if (!target?.dispatchEvent || typeof CustomEvent === "undefined") return false;
    target.dispatchEvent(new CustomEvent(KNOWLEDGE_CORRECTION_STATE_EVENT, { detail: state }));
    return true;
  } catch {
    return false;
  }
}

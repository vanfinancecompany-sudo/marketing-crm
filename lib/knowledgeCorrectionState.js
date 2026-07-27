export const KNOWLEDGE_CORRECTION_STATE_EVENT = "knowledge-correction-state";
export const KNOWLEDGE_CORRECTION_STATE_STORAGE = "knowledgeCorrectionFeedback";

const REVIEW_FIELDS = [
  "title",
  "seo_title",
  "meta_description",
  "excerpt",
  "content_markdown",
  "faq_json",
  "cta",
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

export function readKnowledgeCorrectionState(storage = globalThis?.sessionStorage) {
  if (!storage) return null;
  try {
    const value = storage.getItem(KNOWLEDGE_CORRECTION_STATE_STORAGE);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function writeKnowledgeCorrectionState(state, storage = globalThis?.sessionStorage) {
  if (!storage) return;
  storage.setItem(KNOWLEDGE_CORRECTION_STATE_STORAGE, JSON.stringify(state));
}

export function dispatchKnowledgeCorrectionState(state, target = globalThis?.window) {
  if (!target?.dispatchEvent || typeof CustomEvent === "undefined") return;
  target.dispatchEvent(new CustomEvent(KNOWLEDGE_CORRECTION_STATE_EVENT, { detail: state }));
}

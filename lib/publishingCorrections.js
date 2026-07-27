import { evaluatePublishingSafety } from "./publishingSafety.js";
import { autoCorrectPureRent2BuyArticle, classifyArticleProduct, rent2BuyPromptRule } from "./rent2BuyRules.js";

const clean = (value) => String(value || "").trim();
const normalize = (value) => clean(value).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const SAFE_FIELDS = ["title","slug","seo_title","meta_description","excerpt","content_markdown","faq_json","cta","category","article_type","featured_image"];
const VALID_REMOVAL_REASONS = new Set(["duplicate content","raw formatting","placeholder text","unsupported claim","broken link","unsafe content","blocked content","rent2buy prohibited content"]);
const FINANCE_REASON = "Unverified financial or business claim requires confirmation.";
export const MAX_BULK_CORRECTIONS = 5;

export function limitCorrectionBatch(articleIds = []) { return [...new Set((Array.isArray(articleIds) ? articleIds : []).filter(Boolean))].slice(0, MAX_BULK_CORRECTIONS); }
export function countArticleWords(value) { return clean(value).split(/\s+/).filter(Boolean).length; }
function justifiedRemoval(reasons = []) { return reasons.length > 0 && reasons.every((reason) => [...VALID_REMOVAL_REASONS].some((allowed) => clean(reason).toLowerCase().includes(allowed))); }

export function startsWithDuplicateArticleH1(article = {}) {
  const firstMeaningfulLine = clean(article.content_markdown).split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  const match = firstMeaningfulLine.match(/^#\s+(.+?)\s*#*$/);
  return Boolean(match && normalize(match[1]) === normalize(article.title));
}
export function removeDuplicateArticleH1(article = {}) {
  if (!startsWithDuplicateArticleH1(article)) return { ...article };
  const lines = String(article.content_markdown || "").split(/\r?\n/);
  const firstIndex = lines.findIndex((line) => line.trim());
  lines.splice(firstIndex, 1);
  while (lines[0] !== undefined && !lines[0].trim()) lines.shift();
  return { ...article, content_markdown: lines.join("\n") };
}
export function assertDuplicateTitleResolved(article = {}) {
  if (startsWithDuplicateArticleH1(article)) { const error = new Error("Duplicate article title remains in corrected content."); error.code = "DUPLICATE_TITLE_REMAINS"; throw error; }
  return article;
}

export function buildSafetyCorrectionPrompt({ article, safety, businessKnowledge = [], overrides = {}, approvedLinks = [], structuredCtas = [], unresolvedReasons = [] }) {
  const requestedReasons = unresolvedReasons.length ? unresolvedReasons : safety?.hard_block_reasons || [];
  const rent2BuyRule = rent2BuyPromptRule({ ...article, primary_product: overrides?.primary_product || safety?.product });
  return `Make targeted editorial repairs only to the identified publishing-safety problems in this Knowledge Hub article.

This is not a rewriting or summarisation task.

Hard preservation rules:
- Preserve every valid section, useful heading, example, explanation, comparison, FAQ and practical detail unrelated to a detected safety failure.
- Edit only sections connected to supplied failures.
- Remove duplicated, broken, unsafe, placeholder, raw-formatting, unsupported or product-prohibited material.
- Preserve topic, meaning, search intent, article depth, Business Knowledge, overrides, valid SEO, approved links and CTA destinations.
- Preserve at least 85% of valid non-duplicated content where possible.
- Do not shorten into a summary, add keyword repetition, invent URLs or expose raw Markdown in rendered/exported output.
- If the body begins with an H1 matching the separate title, remove that body H1 only.

Finance claim rules:
- Retain or cautiously clarify only supported claims.
- Never replace one questionable finance claim with another.
- Never imply deposits or shorter terms automatically reduce APR, guarantee approval/rates/delivery, or make lender requirements universal.
${rent2BuyRule}

For pure Rent2Buy content, prohibited terms must be deleted completely, even when used negatively or as a contrast. Remove whole finance-comparison headings, paragraphs and tables. Remove every test/try/trial-before-commitment variation. Preserve unrelated useful Rent2Buy content. The exact standalone sentence “Collection only from Southampton.” must appear.

Return the full corrected article and arrays for changes, removed_links, manual_confirmation_required, removed_sections and removal_reasons.

Exact safety failures to repair in this run:
${requestedReasons.map((reason) => `- ${reason}`).join("\n") || "- Safety warning present"}

Safety states:
${JSON.stringify(safety?.checks || {}, null, 2)}

Confirmed Business Knowledge:
${JSON.stringify(businessKnowledge, null, 2)}

Saved user overrides:
${JSON.stringify(overrides || {}, null, 2)}

Approved internal links:
${JSON.stringify(approvedLinks || [], null, 2)}

Structured CTA destinations:
${JSON.stringify(structuredCtas || [], null, 2)}

Current article:
${JSON.stringify(article, null, 2)}`;
}

export function normalizeCorrectionProposal(originalArticle = {}, proposed = {}) {
  const corrected = {};
  SAFE_FIELDS.forEach((field) => {
    if (field === "faq_json") {
      corrected[field] = Array.isArray(proposed[field]) ? proposed[field].map((item) => ({ question: clean(item?.question), answer: clean(item?.answer) })).filter((item) => item.question && item.answer) : Array.isArray(originalArticle[field]) ? originalArticle[field] : [];
      return;
    }
    corrected[field] = proposed[field] === undefined ? originalArticle[field] : clean(proposed[field]);
  });
  Object.assign(corrected, removeDuplicateArticleH1(corrected));
  if (classifyArticleProduct(originalArticle) === "rent2buy") Object.assign(corrected, autoCorrectPureRent2BuyArticle(corrected));
  corrected.id = originalArticle.id;
  corrected.topic_id = originalArticle.topic_id;
  corrected.template_id = originalArticle.template_id;
  corrected.status = "draft";
  corrected.internal_link_suggestions = originalArticle.internal_link_suggestions || [];
  corrected.generation_metadata = originalArticle.generation_metadata || {};
  corrected.approved_at = null;
  return {
    corrected_article: corrected,
    changes: Array.isArray(proposed.changes) ? proposed.changes.map(clean).filter(Boolean) : [],
    removed_links: Array.isArray(proposed.removed_links) ? proposed.removed_links.map(clean).filter(Boolean) : [],
    manual_confirmation_required: Array.isArray(proposed.manual_confirmation_required) ? proposed.manual_confirmation_required.map(clean).filter(Boolean) : [],
    removed_sections: Array.isArray(proposed.removed_sections) ? proposed.removed_sections.map(clean).filter(Boolean) : [],
    removal_reasons: Array.isArray(proposed.removal_reasons) ? proposed.removal_reasons.map(clean).filter(Boolean) : [],
  };
}

export function verifyCorrectionResults({ originalSafety, proposedSafety, manualConfirmationRequired = [] }) {
  const originalReasons = [...new Set(originalSafety?.hard_block_reasons || [])];
  const remainingHardBlocks = [...new Set(proposedSafety?.hard_block_reasons || [])].filter((reason) => reason !== "Article content changed after assessment. Reanalyse before approval.");
  const financeIsManual = manualConfirmationRequired.length > 0 || proposedSafety?.requires_manual_claim_review;
  const unresolvedReasons = originalReasons.filter((reason) => remainingHardBlocks.includes(reason) && !(reason === FINANCE_REASON && financeIsManual));
  const resolvedReasons = originalReasons.filter((reason) => !unresolvedReasons.includes(reason));
  const automaticRemaining = remainingHardBlocks.filter((reason) => !(reason === FINANCE_REASON && financeIsManual));
  return { resolved_reasons: resolvedReasons, unresolved_reasons: [...new Set([...unresolvedReasons, ...automaticRemaining])], remaining_hard_blocks: automaticRemaining, correction_complete: automaticRemaining.length === 0 };
}

export function buildCorrectionPreview({ originalArticle, proposed, safetyOptions = {} }) {
  const normalized = normalizeCorrectionProposal(originalArticle, proposed);
  assertDuplicateTitleResolved(normalized.corrected_article);
  const originalWordCount = countArticleWords(originalArticle.content_markdown);
  const proposedWordCount = countArticleWords(normalized.corrected_article.content_markdown);
  const wordCountChangePercent = originalWordCount ? Math.round(((proposedWordCount - originalWordCount) / originalWordCount) * 1000) / 10 : 0;
  const reductionPercent = Math.max(0, -wordCountChangePercent);
  const removalsExplained = normalized.removed_sections.length > 0 && normalized.removed_sections.length === normalized.removal_reasons.length && justifiedRemoval(normalized.removal_reasons);
  const excessiveContentLoss = reductionPercent > 25 && !removalsExplained;
  const safetyBefore = evaluatePublishingSafety(originalArticle, safetyOptions);
  const safetyAfter = evaluatePublishingSafety(normalized.corrected_article, { ...safetyOptions, ignoreAssessmentFreshness: true });
  const verification = verifyCorrectionResults({ originalSafety: safetyBefore, proposedSafety: safetyAfter, manualConfirmationRequired: normalized.manual_confirmation_required });
  return { before: originalArticle, after: normalized.corrected_article, changes: normalized.changes, removed_links: normalized.removed_links, manual_confirmation_required: normalized.manual_confirmation_required, original_word_count: originalWordCount, proposed_word_count: proposedWordCount, word_count_change_percent: wordCountChangePercent, content_retained_percent: originalWordCount ? Math.max(0, Math.round((proposedWordCount / originalWordCount) * 1000) / 10) : 100, removed_sections: normalized.removed_sections, removal_reasons: normalized.removal_reasons, excessive_content_loss: excessiveContentLoss, safety_before: safetyBefore, safety_after: safetyAfter, ...verification };
}
export function correctionNeedsManualReview(preview = {}) { return Boolean(preview.manual_confirmation_required?.length || preview.safety_after?.requires_manual_claim_review || preview.excessive_content_loss || !preview.correction_complete); }
export function canAcceptCorrection(preview = {}, explicitContentLossConfirmation = false) { if (!preview.correction_complete) return false; if (preview.excessive_content_loss && !explicitContentLossConfirmation) return false; return true; }
export function applyAcceptedCorrection(originalArticle = {}, correctedArticle = {}) { return { ...originalArticle, ...normalizeCorrectionProposal(originalArticle, correctedArticle).corrected_article, status: "draft", approved_at: null }; }

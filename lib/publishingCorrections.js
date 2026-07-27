import { evaluatePublishingSafety } from "./publishingSafety.js";
import { classifyArticleProduct, rent2BuyPromptRule, validateMarkdownStructure } from "./rent2BuyRules.js";

const clean = (value) => String(value || "").trim();
const normalize = (value) => clean(value).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const SAFE_FIELDS = ["title","slug","seo_title","meta_description","excerpt","content_markdown","faq_json","cta","category","article_type","featured_image"];
const VALID_REMOVAL_REASONS = new Set(["duplicate content","raw formatting","placeholder text","unsupported claim","broken link","unsafe content","blocked content","rent2buy prohibited content","finance comparison section"]);
const FINANCE_REASON = "Unverified financial or business claim requires confirmation.";
export const MAX_BULK_CORRECTIONS = 5;
export function limitCorrectionBatch(articleIds = []) { return [...new Set((Array.isArray(articleIds) ? articleIds : []).filter(Boolean))].slice(0, MAX_BULK_CORRECTIONS); }
export function countArticleWords(value) { return clean(value).split(/\s+/).filter(Boolean).length; }
function justifiedRemoval(reasons = []) { return reasons.length > 0 && reasons.every((reason) => [...VALID_REMOVAL_REASONS].some((allowed) => clean(reason).toLowerCase().includes(allowed))); }
export function startsWithDuplicateArticleH1(article = {}) { const first = clean(article.content_markdown).split(/\r?\n/).map((line) => line.trim()).find(Boolean) || ""; const match = first.match(/^#\s+(.+?)\s*#*$/); return Boolean(match && normalize(match[1]) === normalize(article.title)); }
export function removeDuplicateArticleH1(article = {}) { if (!startsWithDuplicateArticleH1(article)) return { ...article }; const lines = String(article.content_markdown || "").split(/\r?\n/); const index = lines.findIndex((line) => line.trim()); lines.splice(index, 1); while (lines[0] !== undefined && !lines[0].trim()) lines.shift(); return { ...article, content_markdown: lines.join("\n") }; }
export function assertDuplicateTitleResolved(article = {}) { if (startsWithDuplicateArticleH1(article)) { const error = new Error("Duplicate article title remains in corrected content."); error.code = "DUPLICATE_TITLE_REMAINS"; throw error; } return article; }

export function buildSafetyCorrectionPrompt({ article, safety, businessKnowledge = [], overrides = {}, approvedLinks = [], structuredCtas = [], unresolvedReasons = [] }) {
  const requestedReasons = unresolvedReasons.length ? unresolvedReasons : safety?.hard_block_reasons || [];
  return `Make targeted editorial repairs only to the identified publishing-safety problems in this Knowledge Hub article.
This is not a rewriting or summarisation task.

Preserve valid Markdown exactly: headings, blank lines, paragraphs, bullet lists, sequential numbered lists, horizontal rules on their own lines, bold text, links, permitted tables and the CTA as a separate block. Never flatten lists, merge numbered items, place --- inside a paragraph, merge headings with body text or merge the CTA with surrounding text.
Preserve at least 80% of valid non-prohibited content. Remove only identified blocked wording or sections. Preserve useful Rent2Buy explanations, application steps, supported warranty facts, introduction, summary and CTA.
Report every removed section and reason. Do not shorten for neatness.
If the body starts with an H1 matching the separate title field, remove only that H1.
${rent2BuyPromptRule(article)}

Exact remaining issues to repair:
${requestedReasons.map((reason) => `- ${reason}`).join("\n") || "- Safety warning present"}

Safety states:
${JSON.stringify(safety?.checks || {}, null, 2)}
Confirmed Business Knowledge:
${JSON.stringify(businessKnowledge, null, 2)}
Saved user overrides:
${JSON.stringify(overrides, null, 2)}
Approved links:
${JSON.stringify(approvedLinks, null, 2)}
Structured CTAs:
${JSON.stringify(structuredCtas, null, 2)}
Current article:
${JSON.stringify(article, null, 2)}`;
}

export function normalizeCorrectionProposal(originalArticle = {}, proposed = {}) {
  const corrected = {};
  SAFE_FIELDS.forEach((field) => {
    if (field === "faq_json") { corrected[field] = Array.isArray(proposed[field]) ? proposed[field].map((item) => ({ question: clean(item?.question), answer: clean(item?.answer) })).filter((item) => item.question && item.answer) : Array.isArray(originalArticle[field]) ? originalArticle[field] : []; return; }
    corrected[field] = proposed[field] === undefined ? originalArticle[field] : clean(proposed[field]);
  });
  Object.assign(corrected, removeDuplicateArticleH1(corrected));
  corrected.id = originalArticle.id; corrected.topic_id = originalArticle.topic_id; corrected.template_id = originalArticle.template_id; corrected.status = "draft"; corrected.internal_link_suggestions = originalArticle.internal_link_suggestions || []; corrected.generation_metadata = originalArticle.generation_metadata || {}; corrected.approved_at = null;
  return { corrected_article: corrected, changes: Array.isArray(proposed.changes) ? proposed.changes.map(clean).filter(Boolean) : [], removed_links: Array.isArray(proposed.removed_links) ? proposed.removed_links.map(clean).filter(Boolean) : [], manual_confirmation_required: Array.isArray(proposed.manual_confirmation_required) ? proposed.manual_confirmation_required.map(clean).filter(Boolean) : [], removed_sections: Array.isArray(proposed.removed_sections) ? proposed.removed_sections.map(clean).filter(Boolean) : [], removal_reasons: Array.isArray(proposed.removal_reasons) ? proposed.removal_reasons.map(clean).filter(Boolean) : [], removed_section_word_counts: Array.isArray(proposed.removed_section_word_counts) ? proposed.removed_section_word_counts.map((value) => Math.max(0, Number(value) || 0)) : [] };
}

export function verifyCorrectionResults({ originalSafety, proposedSafety, manualConfirmationRequired = [], markdownValidation = {}, unexplainedContentLossPercent = 0 }) {
  const originalReasons = [...new Set(originalSafety?.hard_block_reasons || [])];
  const remaining = [...new Set(proposedSafety?.hard_block_reasons || [])].filter((reason) => reason !== "Article content changed after assessment. Reanalyse before approval.");
  const financeIsManual = manualConfirmationRequired.length > 0 || proposedSafety?.requires_manual_claim_review;
  const automatic = remaining.filter((reason) => !(reason === FINANCE_REASON && financeIsManual));
  const structural = markdownValidation.markdown_structure_valid === false ? ["Correction damaged article formatting.", ...(markdownValidation.markdown_structure_errors || [])] : [];
  const loss = unexplainedContentLossPercent > 20 ? ["Large unexplained content reduction"] : [];
  const unresolved = [...new Set([...automatic, ...structural, ...loss])];
  return { resolved_reasons: originalReasons.filter((reason) => !automatic.includes(reason)), unresolved_reasons: unresolved, remaining_hard_blocks: unresolved, correction_complete: unresolved.length === 0 };
}

export function buildCorrectionPreview({ originalArticle, proposed, safetyOptions = {} }) {
  const normalized = normalizeCorrectionProposal(originalArticle, proposed); assertDuplicateTitleResolved(normalized.corrected_article);
  const originalWordCount = countArticleWords(originalArticle.content_markdown); const proposedWordCount = countArticleWords(normalized.corrected_article.content_markdown);
  const totalRemoved = Math.max(0, originalWordCount - proposedWordCount);
  const validRemovedWordCount = Math.min(totalRemoved, normalized.removed_section_word_counts.reduce((sum, value, index) => sum + (justifiedRemoval([normalized.removal_reasons[index] || ""]) ? value : 0), 0));
  const unexplainedRemovedWordCount = Math.max(0, totalRemoved - validRemovedWordCount);
  const unexplainedContentLossPercent = originalWordCount ? Math.round((unexplainedRemovedWordCount / originalWordCount) * 1000) / 10 : 0;
  const wordCountChangePercent = originalWordCount ? Math.round(((proposedWordCount - originalWordCount) / originalWordCount) * 1000) / 10 : 0;
  const removalsExplained = normalized.removed_sections.length > 0 && normalized.removed_sections.length === normalized.removal_reasons.length && justifiedRemoval(normalized.removal_reasons);
  const excessiveContentLoss = Math.max(0, -wordCountChangePercent) > 25 && !removalsExplained;
  const markdownValidation = validateMarkdownStructure(normalized.corrected_article.content_markdown, normalized.corrected_article.cta);
  const safetyBefore = evaluatePublishingSafety(originalArticle, safetyOptions); const safetyAfter = evaluatePublishingSafety(normalized.corrected_article, { ...safetyOptions, ignoreAssessmentFreshness: true });
  const verification = verifyCorrectionResults({ originalSafety: safetyBefore, proposedSafety: safetyAfter, manualConfirmationRequired: normalized.manual_confirmation_required, markdownValidation, unexplainedContentLossPercent });
  return { before: originalArticle, after: normalized.corrected_article, changes: normalized.changes, removed_links: normalized.removed_links, manual_confirmation_required: normalized.manual_confirmation_required, original_word_count: originalWordCount, proposed_word_count: proposedWordCount, word_count_change_percent: wordCountChangePercent, content_retained_percent: originalWordCount ? Math.max(0, Math.round((proposedWordCount / originalWordCount) * 1000) / 10) : 100, removed_sections: normalized.removed_sections, removal_reasons: normalized.removal_reasons, valid_removed_word_count: validRemovedWordCount, unexplained_removed_word_count: unexplainedRemovedWordCount, unexplained_content_loss_percent: unexplainedContentLossPercent, excessive_content_loss: excessiveContentLoss, markdown_structure_valid: markdownValidation.markdown_structure_valid, markdown_structure_errors: markdownValidation.markdown_structure_errors, safety_before: safetyBefore, safety_after: safetyAfter, ...verification };
}

export function correctionNeedsManualReview(preview = {}) { return Boolean(preview.manual_confirmation_required?.length || preview.safety_after?.requires_manual_claim_review || preview.excessive_content_loss || preview.unexplained_content_loss_percent > 20 || !preview.markdown_structure_valid || !preview.correction_complete); }
export function canAcceptCorrection(preview = {}, explicitContentLossConfirmation = false) { if (!preview.correction_complete || !preview.markdown_structure_valid) return false; if ((preview.excessive_content_loss || preview.unexplained_content_loss_percent > 20) && !explicitContentLossConfirmation) return false; return true; }
export function applyAcceptedCorrection(originalArticle = {}, correctedArticle = {}) { return { ...originalArticle, ...normalizeCorrectionProposal(originalArticle, correctedArticle).corrected_article, status: "draft", approved_at: null }; }

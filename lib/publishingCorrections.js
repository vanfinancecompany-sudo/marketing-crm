import { evaluatePublishingSafety } from "./publishingSafety.js";
import {
  RENT2BUY_COLLECTION_SENTENCE,
  RENT2BUY_SEPARATION_SENTENCE,
  classifyArticleProduct,
  rent2BuyPromptRule,
  validateComparisonStructure,
  validateMarkdownStructure,
  validateRent2BuySemantics,
} from "./rent2BuyRules.js";

const clean = (value) => String(value || "").trim();
const normalize = (value) => clean(value).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const SAFE_FIELDS = ["title", "slug", "seo_title", "meta_description", "excerpt", "content_markdown", "faq_json", "cta", "category", "article_type", "featured_image", "internal_link_suggestions"];
const VALID_REMOVAL_REASONS = new Set(["duplicate content", "raw formatting", "placeholder text", "unsupported claim", "broken link", "unsafe content", "blocked content", "rent2buy prohibited content", "finance comparison section"]);
const FINANCE_REASON = "Unverified financial or business claim requires confirmation.";
const COMPANY_NAME = "Van Finance Company";
const URL_PATTERN = /https?:\/\/[^\s)\]>"']+/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
export const MAX_BULK_CORRECTIONS = 5;

export function limitCorrectionBatch(articleIds = []) { return [...new Set((Array.isArray(articleIds) ? articleIds : []).filter(Boolean))].slice(0, MAX_BULK_CORRECTIONS); }
export function countArticleWords(value) { return clean(value).split(/\s+/).filter(Boolean).length; }
function justifiedRemoval(reasons = []) { return reasons.length > 0 && reasons.every((reason) => [...VALID_REMOVAL_REASONS].some((allowed) => clean(reason).toLowerCase().includes(allowed))); }
export function startsWithDuplicateArticleH1(article = {}) { const first = clean(article.content_markdown).split(/\r?\n/).map((line) => line.trim()).find(Boolean) || ""; const match = first.match(/^#\s+(.+?)\s*#*$/); return Boolean(match && normalize(match[1]) === normalize(article.title)); }
export function removeDuplicateArticleH1(article = {}) { if (!startsWithDuplicateArticleH1(article)) return { ...article }; const lines = String(article.content_markdown || "").split(/\r?\n/); const index = lines.findIndex((line) => line.trim()); lines.splice(index, 1); while (lines[0] !== undefined && !lines[0].trim()) lines.shift(); return { ...article, content_markdown: lines.join("\n") }; }
export function assertDuplicateTitleResolved(article = {}) { if (startsWithDuplicateArticleH1(article)) { const error = new Error("Duplicate article title remains in corrected content."); error.code = "DUPLICATE_TITLE_REMAINS"; throw error; } return article; }

function preserveLinkDestinations(original = [], proposed = []) {
  return (Array.isArray(original) ? original : []).map((item, index) => {
    const candidate = (Array.isArray(proposed) ? proposed : [])[index] || {};
    return { ...item, anchor_text: clean(candidate.anchor_text || candidate.label || item.anchor_text || item.label), label: clean(candidate.label || candidate.anchor_text || item.label || item.anchor_text), destination_url: item.destination_url || item.url || item.destination, url: item.url || item.destination_url || item.destination, status: item.status };
  });
}

export function buildSafetyCorrectionPrompt({ article, safety, businessKnowledge = [], overrides = {}, approvedLinks = [], structuredCtas = [], unresolvedReasons = [], scopeOverride = "" }) {
  const requestedReasons = unresolvedReasons.length ? unresolvedReasons : safety?.hard_block_reasons || [];
  const scope = classifyArticleProduct(article, overrides?.effective_intent || safety?.effective_intent || {}, scopeOverride);
  return `Make targeted editorial repairs only to the identified publishing-safety problems. This is not a rewriting or summarisation task.
Product scope is fixed as: ${scope}. Do not change it.
Return corrected values for title, seo_title, meta_description, excerpt, content_markdown, faq_json, cta and internal_link_suggestions. Correct every FAQ question and answer and every link anchor. Preserve every link destination exactly. Preserve valid Markdown, useful article depth and CTA placement. Preserve at least 80% of valid non-prohibited content.
${rent2BuyPromptRule(article, { intent: overrides?.effective_intent, scopeOverride: scope })}
Exact remaining issues to repair:
${requestedReasons.map((reason) => `- ${typeof reason === "string" ? reason : JSON.stringify(reason)}`).join("\n") || "- Safety warning present"}
Confirmed Business Knowledge:${JSON.stringify(businessKnowledge)}
Saved overrides:${JSON.stringify(overrides)}
Approved links:${JSON.stringify(approvedLinks)}
Structured CTAs:${JSON.stringify(structuredCtas)}
Current complete article:${JSON.stringify({ ...article, internal_link_suggestions: approvedLinks })}`;
}

export function normalizeCorrectionProposal(originalArticle = {}, proposed = {}) {
  const corrected = {};
  SAFE_FIELDS.forEach((field) => {
    if (field === "faq_json") { corrected[field] = Array.isArray(proposed[field]) ? proposed[field].map((item) => ({ question: clean(item?.question), answer: clean(item?.answer) })).filter((item) => item.question && item.answer) : Array.isArray(originalArticle[field]) ? structuredClone(originalArticle[field]) : []; return; }
    if (field === "internal_link_suggestions") { corrected[field] = preserveLinkDestinations(originalArticle[field], proposed[field]); return; }
    corrected[field] = proposed[field] === undefined ? originalArticle[field] : clean(proposed[field]);
  });
  Object.assign(corrected, removeDuplicateArticleH1(corrected));
  corrected.id = originalArticle.id; corrected.topic_id = originalArticle.topic_id; corrected.template_id = originalArticle.template_id; corrected.status = "draft"; corrected.generation_metadata = structuredClone(originalArticle.generation_metadata || {}); corrected.primary_product = originalArticle.primary_product; corrected.topic_product = originalArticle.topic_product; corrected.approved_at = null;
  return { corrected_article: corrected, changes: Array.isArray(proposed.changes) ? proposed.changes.map(clean).filter(Boolean) : [], removed_links: Array.isArray(proposed.removed_links) ? proposed.removed_links.map(clean).filter(Boolean) : [], manual_confirmation_required: Array.isArray(proposed.manual_confirmation_required) ? proposed.manual_confirmation_required.map(clean).filter(Boolean) : [], removed_sections: Array.isArray(proposed.removed_sections) ? proposed.removed_sections.map(clean).filter(Boolean) : [], removal_reasons: Array.isArray(proposed.removal_reasons) ? proposed.removal_reasons.map(clean).filter(Boolean) : [], removed_section_word_counts: Array.isArray(proposed.removed_section_word_counts) ? proposed.removed_section_word_counts.map((value) => Math.max(0, Number(value) || 0)) : [] };
}

function normalizeMarkdown(markdown = "") { return String(markdown || "").replace(/[ \t]+$/gm, "").replace(/\n{4,}/g, "\n\n\n").trim(); }
function escapeRegex(value) { return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function articleTextValues(article = {}) {
  return [article.title, article.seo_title, article.meta_description, article.excerpt, article.content_markdown, article.cta, ...(article.faq_json || []).flatMap((faq) => [faq?.question, faq?.answer]), ...(article.internal_link_suggestions || []).flatMap((link) => [link?.anchor_text, link?.label, link?.destination_url, link?.url])].filter(Boolean).map(String);
}
function extractAll(article, pattern) { return articleTextValues(article).flatMap((value) => [...value.matchAll(new RegExp(pattern.source, pattern.flags))].map((match) => match[0])); }
function markdownDestinations(markdown = "") { return [...String(markdown || "").matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]); }
function sameMultiset(first = [], second = []) { const a = [...first].sort(); const b = [...second].sort(); return a.length === b.length && a.every((value, index) => value === b[index]); }

export function validateProtectedValues(before = {}, after = {}, options = {}) {
  const errors = [];
  const beforeUrls = extractAll(before, URL_PATTERN);
  const afterUrls = extractAll(after, URL_PATTERN);
  const beforeEmails = extractAll(before, EMAIL_PATTERN);
  const afterEmails = extractAll(after, EMAIL_PATTERN);
  const beforeMarkdownLinks = markdownDestinations(before.content_markdown);
  const afterMarkdownLinks = markdownDestinations(after.content_markdown);
  const beforeAccepted = (before.internal_link_suggestions || []).map((item) => item?.destination_url || item?.url || "");
  const afterAccepted = (after.internal_link_suggestions || []).map((item) => item?.destination_url || item?.url || "");
  if (!sameMultiset(beforeUrls, afterUrls) || !sameMultiset(beforeMarkdownLinks, afterMarkdownLinks) || !sameMultiset(beforeAccepted, afterAccepted)) errors.push("Correction attempted to alter a protected link.");
  if (!sameMultiset(beforeEmails, afterEmails)) errors.push("Correction attempted to alter a protected email address.");
  const beforeCompanyCount = articleTextValues(before).join("\n").split(COMPANY_NAME).length - 1;
  const afterCompanyCount = articleTextValues(after).join("\n").split(COMPANY_NAME).length - 1;
  if (beforeCompanyCount !== afterCompanyCount) errors.push(`Protected business name changed: ${COMPANY_NAME}.`);
  if (before.content_markdown?.includes(RENT2BUY_SEPARATION_SENTENCE) && !after.content_markdown?.includes(RENT2BUY_SEPARATION_SENTENCE)) errors.push("Approved Rent2Buy separation sentence was altered.");
  if (!options.titleTargeted && before.title !== after.title) errors.push("Untargeted article title was altered by the repair pass.");
  return { protected_values_valid: errors.length === 0, protected_value_errors: [...new Set(errors)] };
}

export function validateTargetedRepairText(article = {}) {
  const text = articleTextValues(article).join("\n");
  const errors = [];
  const patterns = [
    [/\bthe\s+usual\s+the\b/i, "Duplicated determiner: “the usual the”."],
    [/\bnot\s+(?:a|an)\s+(?:arrangements|agreements|payments|conditions)\b/i, "Broken singular/plural phrase after targeted repair."],
    [/\b(\w+)\s+\1\b/i, "Repeated word created by targeted repair."],
    [/(?:van|rent2buy|finance)(?:Rent2Buy|finance|arrangement)(?:company|\.co\.uk)/i, "Product terminology was inserted inside a protected name or domain."],
    [/https?:\/\/[^\s]*\s+[^\s]*/i, "Invalid whitespace detected in a URL."],
    [/\bVan\s+(?:ownership|Rent2Buy|arrangement)\s+Company\b/i, "Malformed protected business name."],
    [/\blease\s+Rent2Buy\b/i, "Broken phrase created from lease finance wording."],
  ];
  patterns.forEach(([pattern, message]) => { if (pattern.test(text)) errors.push(message); });
  for (const url of extractAll(article, URL_PATTERN)) { try { const parsed = new URL(url); if (!parsed.hostname || /rent2buy arrangement|\s/i.test(parsed.hostname)) errors.push(`Invalid domain name: ${url}`); } catch { errors.push(`Invalid URL: ${url}`); } }
  return { targeted_repair_text_valid: errors.length === 0, targeted_repair_text_errors: [...new Set(errors)] };
}

const SENTENCE_REWRITES = [
  { pattern: /traditional finance options/i, replacement: "If you are looking for a different route to van ownership, Rent2Buy may suit your circumstances." },
  { pattern: /credit checks associated with finance agreements|finance agreements/i, replacement: "Rent2Buy has its own eligibility process and agreement terms." },
  { pattern: /unlike traditional finance/i, replacement: "Rent2Buy works differently, with ownership subject to the agreement terms and completion of the required payments." },
  { pattern: /traditional finance barriers|credit checks or deposits are barriers/i, replacement: "Other eligibility routes may better suit your circumstances." },
  { pattern: /traditional (?:finance|credit) checks/i, replacement: "Rent2Buy has its own eligibility process. Specific eligibility criteria should be confirmed before applying." },
  { pattern: /rent before deciding to buy|rent before committing|decide later after using it|decide after trying it/i, replacement: "You make rental payments under the agreement before the ownership conditions are completed." },
  { pattern: /assess (?:if|whether) (?:the )?van (?:meets|suits) your needs|test (?:if|whether) (?:the )?van (?:meets|suits) your (?:needs|requirements)|try(?:ing)? (?:the )?van|test(?:ing)? (?:the )?van|trial(?:ling)? (?:the )?van|try before committing|try before buying|test before buying/i, replacement: "Review the vehicle details and agreement terms carefully before proceeding." },
  { pattern: /lease finance|hire purchase|lease purchase|\bpcp\b|\bapr\b|interest rates?|finance rates?|lender panels?|\blenders?\b|finance approval|finance applications?|finance deposits?|specific rates/i, replacement: "Rent2Buy eligibility, agreement terms and payment requirements should be reviewed before applying." },
];

function sentenceSpan(text, phrase) {
  const lower = text.toLowerCase(); const index = lower.indexOf(clean(phrase).toLowerCase());
  if (index < 0) return null;
  let start = index; while (start > 0 && !/[.!?\n]/.test(text[start - 1])) start -= 1;
  while (start < index && /\s/.test(text[start])) start += 1;
  let end = index + phrase.length; while (end < text.length && !/[.!?\n]/.test(text[end])) end += 1;
  if (end < text.length && /[.!?]/.test(text[end])) end += 1;
  return { start, end, sentence: text.slice(start, end) };
}
function rewriteSentenceAtError(text, error) {
  const phrase = clean(error?.phrase); if (!phrase) return { text, repaired: false };
  const span = sentenceSpan(text, phrase); if (!span) return { text, repaired: false };
  if (URL_PATTERN.test(span.sentence) || EMAIL_PATTERN.test(span.sentence) || span.sentence.includes(COMPANY_NAME) && span.sentence.trim() === COMPANY_NAME) { URL_PATTERN.lastIndex = 0; EMAIL_PATTERN.lastIndex = 0; return { text, repaired: false }; }
  URL_PATTERN.lastIndex = 0; EMAIL_PATTERN.lastIndex = 0;
  const rule = SENTENCE_REWRITES.find((item) => item.pattern.test(span.sentence) || item.pattern.test(phrase));
  if (!rule) return { text, repaired: false };
  const prefix = span.sentence.match(/^\s*(?:[-*+]\s+|\d+\.\s+|>\s*)/)?.[0] || "";
  const replacement = `${prefix}${rule.replacement}`;
  return { text: `${text.slice(0, span.start)}${replacement}${text.slice(span.end)}`, repaired: true };
}
function repairTextLocation(value, errors = []) {
  let text = String(value || ""); let repairedCount = 0;
  for (const error of errors) { const result = rewriteSentenceAtError(text, error); text = result.text; if (result.repaired) repairedCount += 1; }
  return { value: text, repairedCount };
}
function repairBodyBySection(markdown, errors, report) {
  const lines = String(markdown || "").split(/\r?\n/); let heading = "Introduction";
  for (let index = 0; index < lines.length; index += 1) {
    const headingMatch = lines[index].match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/); if (headingMatch) { heading = clean(headingMatch[1]); continue; }
    const matching = errors.filter((error) => clean(error.section) === heading && lines[index].toLowerCase().includes(clean(error.phrase).toLowerCase()));
    if (!matching.length) continue;
    const result = repairTextLocation(lines[index], matching); if (result.repairedCount) { lines[index] = result.value; report.repaired_fields.push(`Article ${heading}`); }
  }
  return lines.join("\n");
}
function ensureCollectionPlacement(markdown = "") {
  const lines = String(markdown || "").split(/\r?\n/).filter((line) => line.trim() !== RENT2BUY_COLLECTION_SENTENCE);
  const headingIndex = lines.findIndex((line) => /^#{1,6}\s+(?:Key Features(?: and Benefits)?|Practical Next Steps)\s*$/i.test(line.trim()));
  if (headingIndex < 0) return normalizeMarkdown(lines.join("\n"));
  let insertAt = headingIndex + 1; while (insertAt < lines.length && !lines[insertAt].trim()) insertAt += 1;
  lines.splice(insertAt, 0, RENT2BUY_COLLECTION_SENTENCE, ""); return normalizeMarkdown(lines.join("\n"));
}
function repairFaqs(faqs = [], errors = [], report) {
  const errorsByFaq = new Map(); errors.forEach((error) => { const match = clean(error?.field || error?.section).match(/^FAQ\s+(\d+)/i); if (match) { const index = Number(match[1]) - 1; errorsByFaq.set(index, [...(errorsByFaq.get(index) || []), error]); } });
  const output = []; let collectionFaqAdded = false;
  (Array.isArray(faqs) ? faqs : []).forEach((faq, index) => {
    const flagged = errorsByFaq.get(index) || []; if (!flagged.length) { output.push(structuredClone(faq)); return; }
    const combined = `${faq?.question || ""} ${faq?.answer || ""}`;
    if (flagged.some((item) => item.category === "delivery") || /delivery/i.test(combined)) { report.removed_faqs.push(clean(faq?.question) || `FAQ ${index + 1}`); if (!collectionFaqAdded) { output.push({ question: "Where are Rent2Buy vans collected?", answer: RENT2BUY_COLLECTION_SENTENCE }); report.rewritten_faqs.push("Where are Rent2Buy vans collected?"); collectionFaqAdded = true; } return; }
    if (/finance approval|specific rates|approval rate/i.test(combined)) { output.push({ question: "Are eligibility or vehicle availability guaranteed?", answer: "No. Eligibility and vehicle availability depend on the information provided and the terms of the Rent2Buy arrangement." }); report.rewritten_faqs.push(clean(faq?.question) || `FAQ ${index + 1}`); return; }
    if (/traditional (?:finance|credit) checks|finance checks/i.test(combined)) { output.push({ question: "How does Rent2Buy eligibility work?", answer: "Rent2Buy has its own eligibility process. Specific eligibility criteria should be confirmed before applying." }); report.rewritten_faqs.push(clean(faq?.question) || `FAQ ${index + 1}`); return; }
    const question = repairTextLocation(faq?.question, flagged); const answer = repairTextLocation(faq?.answer, flagged);
    if (!question.repairedCount && !answer.repairedCount) { output.push(structuredClone(faq)); return; }
    output.push({ question: question.value, answer: answer.value }); report.rewritten_faqs.push(clean(faq?.question) || `FAQ ${index + 1}`);
  });
  return output.filter((faq) => faq?.question && faq?.answer);
}

export function applyTargetedRent2BuyRepairs(article = {}, semanticErrors = [], options = {}) {
  const scope = classifyArticleProduct(article, options.intent || {}, options.scopeOverride); const report = { targeted_repairs_applied: false, repaired_fields: [], repaired_phrases: [], removed_faqs: [], rewritten_faqs: [] };
  if (scope !== "rent2buy" || !Array.isArray(semanticErrors) || !semanticErrors.length) return { article, ...report };
  const repaired = structuredClone(article); const byField = new Map(); semanticErrors.forEach((error) => { const field = clean(error?.field || error?.section || "Article body"); byField.set(field, [...(byField.get(field) || []), error]); report.repaired_phrases.push(clean(error?.phrase)); });
  [["Article title", "title"], ["SEO title", "seo_title"], ["Meta description", "meta_description"], ["Excerpt", "excerpt"], ["CTA", "cta"]].forEach(([label, key]) => { const result = repairTextLocation(repaired[key], byField.get(label) || []); if (result.repairedCount) { repaired[key] = result.value; report.repaired_fields.push(label); } });
  const bodyErrors = semanticErrors.filter((error) => error?.field === "Article body"); if (bodyErrors.length) repaired.content_markdown = repairBodyBySection(repaired.content_markdown, bodyErrors, report);
  repaired.content_markdown = ensureCollectionPlacement(normalizeMarkdown(repaired.content_markdown));
  if (semanticErrors.some((error) => /^FAQ\s+/i.test(clean(error?.field || error?.section)))) { repaired.faq_json = repairFaqs(repaired.faq_json, semanticErrors, report); if (JSON.stringify(repaired.faq_json) !== JSON.stringify(article.faq_json)) report.repaired_fields.push("FAQs"); }
  repaired.internal_link_suggestions = (repaired.internal_link_suggestions || []).map((link, index) => { const label = `Internal-link anchor ${index + 1}`; const result = repairTextLocation(link.anchor_text || link.label, byField.get(label) || []); if (!result.repairedCount) return link; report.repaired_fields.push(label); return { ...link, anchor_text: result.value, label: result.value }; });
  report.targeted_repairs_applied = report.repaired_fields.length > 0 || report.removed_faqs.length > 0; report.repaired_fields = [...new Set(report.repaired_fields)]; report.repaired_phrases = [...new Set(report.repaired_phrases.filter(Boolean))]; return { article: repaired, ...report };
}

export function verifyCorrectionResults({ originalSafety, proposedSafety, manualConfirmationRequired = [], markdownValidation = {}, semanticValidation = {}, comparisonValidation = {}, protectedValidation = {}, textValidation = {}, unexplainedContentLossPercent = 0 }) {
  const originalReasons = [...new Set(originalSafety?.hard_block_reasons || [])]; const remaining = [...new Set(proposedSafety?.hard_block_reasons || [])].filter((reason) => reason !== "Article content changed after assessment. Reanalyse before approval."); const financeIsManual = manualConfirmationRequired.length > 0 || proposedSafety?.requires_manual_claim_review; const automatic = remaining.filter((reason) => !(reason === FINANCE_REASON && financeIsManual)); const structural = markdownValidation.markdown_structure_valid === false ? ["Correction damaged article formatting.", ...(markdownValidation.markdown_structure_errors || [])] : []; const semantic = semanticValidation.rent2buy_semantic_valid === false ? semanticValidation.rent2buy_semantic_errors || [] : []; const comparison = comparisonValidation.comparison_structure_valid === false ? ["Comparison content does not clearly separate Rent2Buy and Van Finance.", ...(comparisonValidation.comparison_structure_errors || [])] : []; const protectedIssues = protectedValidation.protected_values_valid === false ? protectedValidation.protected_value_errors || [] : []; const textIssues = textValidation.targeted_repair_text_valid === false ? textValidation.targeted_repair_text_errors || [] : []; const loss = unexplainedContentLossPercent > 20 ? ["Large unexplained content reduction"] : []; const unresolved = [...automatic, ...structural, ...semantic, ...comparison, ...protectedIssues, ...textIssues, ...loss];
  return { resolved_reasons: originalReasons.filter((reason) => !automatic.includes(reason)), unresolved_reasons: unresolved, remaining_hard_blocks: unresolved, correction_complete: unresolved.length === 0 };
}

export function buildCorrectionPreview({ originalArticle, proposed, safetyOptions = {}, scopeOverride = "" }) {
  const normalized = normalizeCorrectionProposal(originalArticle, proposed); assertDuplicateTitleResolved(normalized.corrected_article); const scope = classifyArticleProduct(normalized.corrected_article, safetyOptions.intent || {}, scopeOverride); normalized.corrected_article.generation_metadata = { ...(normalized.corrected_article.generation_metadata || {}), product_scope_override: scope };
  const preRepairArticle = structuredClone(normalized.corrected_article); const firstSemanticValidation = validateRent2BuySemantics(preRepairArticle, { intent: safetyOptions.intent, scopeOverride: scope }); const repair = applyTargetedRent2BuyRepairs(preRepairArticle, firstSemanticValidation.rent2buy_semantic_errors, { intent: safetyOptions.intent, scopeOverride: scope }); normalized.corrected_article = repair.article;
  const titleTargeted = firstSemanticValidation.rent2buy_semantic_errors.some((error) => error.field === "Article title"); const protectedValidation = validateProtectedValues(preRepairArticle, normalized.corrected_article, { titleTargeted }); const textValidation = validateTargetedRepairText(normalized.corrected_article);
  const originalWordCount = countArticleWords(originalArticle.content_markdown); const proposedWordCount = countArticleWords(normalized.corrected_article.content_markdown); const totalRemoved = Math.max(0, originalWordCount - proposedWordCount); const validRemovedWordCount = Math.min(totalRemoved, normalized.removed_section_word_counts.reduce((sum, value, index) => sum + (justifiedRemoval([normalized.removal_reasons[index] || ""]) ? value : 0), 0)); const unexplainedRemovedWordCount = Math.max(0, totalRemoved - validRemovedWordCount); const unexplainedContentLossPercent = originalWordCount ? Math.round((unexplainedRemovedWordCount / originalWordCount) * 1000) / 10 : 0; const wordCountChangePercent = originalWordCount ? Math.round(((proposedWordCount - originalWordCount) / originalWordCount) * 1000) / 10 : 0; const removalsExplained = normalized.removed_sections.length > 0 && normalized.removed_sections.length === normalized.removal_reasons.length && justifiedRemoval(normalized.removal_reasons); const excessiveContentLoss = Math.max(0, -wordCountChangePercent) > 25 && !removalsExplained;
  const markdownValidation = validateMarkdownStructure(normalized.corrected_article.content_markdown, normalized.corrected_article.cta); const semanticValidation = validateRent2BuySemantics(normalized.corrected_article, { intent: safetyOptions.intent, scopeOverride: scope }); const comparisonValidation = validateComparisonStructure(normalized.corrected_article, { intent: safetyOptions.intent, scopeOverride: scope }); const safetyBefore = evaluatePublishingSafety(originalArticle, safetyOptions); const safetyAfter = evaluatePublishingSafety(normalized.corrected_article, { ...safetyOptions, ignoreAssessmentFreshness: true, scopeOverride: scope }); const verification = verifyCorrectionResults({ originalSafety: safetyBefore, proposedSafety: safetyAfter, manualConfirmationRequired: normalized.manual_confirmation_required, markdownValidation, semanticValidation, comparisonValidation, protectedValidation, textValidation, unexplainedContentLossPercent });
  return { product_scope: scope, before: originalArticle, after: normalized.corrected_article, changes: normalized.changes, removed_links: normalized.removed_links, manual_confirmation_required: normalized.manual_confirmation_required, original_word_count: originalWordCount, proposed_word_count: proposedWordCount, word_count_change_percent: wordCountChangePercent, content_retained_percent: originalWordCount ? Math.max(0, Math.round((proposedWordCount / originalWordCount) * 1000) / 10) : 100, removed_sections: normalized.removed_sections, removal_reasons: normalized.removal_reasons, valid_removed_word_count: validRemovedWordCount, unexplained_removed_word_count: unexplainedRemovedWordCount, unexplained_content_loss_percent: unexplainedContentLossPercent, excessive_content_loss: excessiveContentLoss, markdown_structure_valid: markdownValidation.markdown_structure_valid, markdown_structure_errors: markdownValidation.markdown_structure_errors, ...semanticValidation, ...comparisonValidation, ...protectedValidation, ...textValidation, targeted_repairs_applied: repair.targeted_repairs_applied, repaired_fields: repair.repaired_fields, repaired_phrases: repair.repaired_phrases, removed_faqs: repair.removed_faqs, rewritten_faqs: repair.rewritten_faqs, remaining_semantic_errors: semanticValidation.rent2buy_semantic_errors || [], safety_before: safetyBefore, safety_after: safetyAfter, ...verification };
}

export function correctionNeedsManualReview(preview = {}) { return Boolean(preview.manual_confirmation_required?.length || preview.safety_after?.requires_manual_claim_review || preview.excessive_content_loss || preview.unexplained_content_loss_percent > 20 || !preview.markdown_structure_valid || !preview.rent2buy_semantic_valid || !preview.comparison_structure_valid || !preview.protected_values_valid || !preview.targeted_repair_text_valid || !preview.correction_complete); }
export function canAcceptCorrection(preview = {}, explicitContentLossConfirmation = false) { if (!preview.correction_complete || !preview.markdown_structure_valid || preview.rent2buy_semantic_valid === false || preview.comparison_structure_valid === false || preview.protected_values_valid === false || preview.targeted_repair_text_valid === false) return false; if ((preview.excessive_content_loss || preview.unexplained_content_loss_percent > 20) && !explicitContentLossConfirmation) return false; return true; }
export function applyAcceptedCorrection(originalArticle = {}, correctedArticle = {}) { return { ...originalArticle, ...normalizeCorrectionProposal(originalArticle, correctedArticle).corrected_article, status: "draft", approved_at: null }; }

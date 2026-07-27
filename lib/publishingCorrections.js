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
const COMPANY_NAME = "Van Finance Company";
const URL_TOKEN_PATTERN = /https?:\/\/[^\s<>"'\])]+/gi;
const EMAIL_TOKEN_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
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
    const destination = item.destination_url || item.url || item.destination || "";
    return { ...item, anchor_text: clean(candidate.anchor_text || candidate.label || item.anchor_text || item.label), label: clean(candidate.label || candidate.anchor_text || item.label || item.anchor_text), destination_url: destination, url: item.url || destination, status: item.status };
  });
}

export function buildSafetyCorrectionPrompt({ article, safety, businessKnowledge = [], overrides = {}, approvedLinks = [], structuredCtas = [], unresolvedReasons = [], scopeOverride = "" }) {
  const requestedReasons = unresolvedReasons.length ? unresolvedReasons : safety?.hard_block_reasons || [];
  const scope = classifyArticleProduct(article, overrides?.effective_intent || safety?.effective_intent || {}, scopeOverride);
  return `Make targeted editorial repairs only to the identified publishing-safety problems. This is not a rewriting or summarisation task.
Product scope is fixed as: ${scope}. Do not change it.
Return corrected values for title, seo_title, meta_description, excerpt, content_markdown, faq_json, cta and internal_link_suggestions. Correct every FAQ question and answer and every link anchor. Preserve every link destination exactly. Preserve valid Markdown, useful article depth and CTA placement. Preserve at least 80% of valid non-prohibited content.
${rent2BuyPromptRule(article, { intent: overrides?.effective_intent, scopeOverride: scope })}
Exact remaining material issues to repair:
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
    if (field === "faq_json") { corrected[field] = Array.isArray(proposed[field]) ? proposed[field].map((item) => ({ question: clean(item?.question), answer: clean(item?.answer) })).filter((item) => item.question && item.answer) : structuredClone(originalArticle[field] || []); return; }
    if (field === "internal_link_suggestions") { corrected[field] = preserveLinkDestinations(originalArticle[field], proposed[field]); return; }
    corrected[field] = proposed[field] === undefined ? originalArticle[field] : clean(proposed[field]);
  });
  Object.assign(corrected, removeDuplicateArticleH1(corrected));
  corrected.id = originalArticle.id; corrected.topic_id = originalArticle.topic_id; corrected.template_id = originalArticle.template_id; corrected.status = "draft"; corrected.generation_metadata = structuredClone(originalArticle.generation_metadata || {}); corrected.primary_product = originalArticle.primary_product; corrected.topic_product = originalArticle.topic_product; corrected.approved_at = null;
  return { corrected_article: corrected, changes: Array.isArray(proposed.changes) ? proposed.changes.map(clean).filter(Boolean) : [], removed_links: Array.isArray(proposed.removed_links) ? proposed.removed_links.map(clean).filter(Boolean) : [], manual_confirmation_required: Array.isArray(proposed.manual_confirmation_required) ? proposed.manual_confirmation_required.map(clean).filter(Boolean) : [], removed_sections: Array.isArray(proposed.removed_sections) ? proposed.removed_sections.map(clean).filter(Boolean) : [], removal_reasons: Array.isArray(proposed.removal_reasons) ? proposed.removal_reasons.map(clean).filter(Boolean) : [], removed_section_word_counts: Array.isArray(proposed.removed_section_word_counts) ? proposed.removed_section_word_counts.map((value) => Math.max(0, Number(value) || 0)) : [] };
}

export function normalizeMarkdownSpacing(markdown = "", cta = "") {
  const source = String(markdown || "").replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "");
  const input = source.split("\n");
  const output = [];
  const pushBlank = () => { if (output.length && output[output.length - 1] !== "") output.push(""); };
  for (let index = 0; index < input.length; index += 1) {
    const line = input[index].trimEnd();
    const trimmed = line.trim();
    const isHeading = /^#{1,6}\s+\S/.test(trimmed);
    const isRule = /^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed);
    const isCta = Boolean(clean(cta) && trimmed === clean(cta));
    if (isHeading || isRule || isCta) pushBlank();
    output.push(isRule ? "---" : line);
    if (isHeading || isRule) {
      const next = input[index + 1];
      if (next !== undefined && next.trim() !== "") output.push("");
    }
  }
  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function articleFieldValues(article = {}) { const values = [["Article title", article.title], ["SEO title", article.seo_title], ["Meta description", article.meta_description], ["Excerpt", article.excerpt], ["Article body", article.content_markdown], ["CTA", article.cta]]; (article.faq_json || []).forEach((faq, index) => values.push([`FAQ ${index + 1} question`, faq?.question], [`FAQ ${index + 1} answer`, faq?.answer])); (article.internal_link_suggestions || []).forEach((link, index) => values.push([`Internal-link anchor ${index + 1}`, link?.anchor_text || link?.label], [`Internal-link destination ${index + 1}`, link?.destination_url || link?.url])); return values.filter(([, value]) => value !== undefined && value !== null).map(([field, value]) => ({ field, value: String(value) })); }
function extractTokens(value, pattern) { return [...String(value || "").matchAll(new RegExp(pattern.source, pattern.flags))].map((match) => match[0]); }
function markdownDestinations(markdown = "") { return [...String(markdown || "").matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]); }
function excerptFor(value, token) { const text = String(value || ""); const index = text.indexOf(token); return clean(index < 0 ? text.slice(0, 140) : text.slice(Math.max(0, index - 45), Math.min(text.length, index + token.length + 65))); }
function tokenRecords(article, kind) { const pattern = kind === "url" ? URL_TOKEN_PATTERN : EMAIL_TOKEN_PATTERN; return articleFieldValues(article).flatMap(({ field, value }) => extractTokens(value, pattern).map((token) => ({ field, value: token, excerpt: excerptFor(value, token) }))); }
function recordsByField(records = []) { const map = new Map(); records.forEach((record) => map.set(record.field, [...(map.get(record.field) || []), record])); return map; }
function protectedError(field, originalValue, proposedValue, errorType, excerpt) { return { field, original_protected_value: originalValue ?? "", proposed_protected_value: proposedValue ?? "", error_type: errorType, excerpt: clean(excerpt).slice(0, 180) }; }
function countExact(text, sentence) { return String(text || "").split(sentence).length - 1; }
function markdownSections(markdown = "") { const sections = []; let current = { heading: "Introduction", lines: [] }; for (const line of String(markdown || "").split(/\r?\n/)) { const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/); if (heading) { sections.push(current); current = { heading: clean(heading[1]), lines: [] }; } else current.lines.push(line); } sections.push(current); return sections; }

export function validateApprovedSentence(article = {}, options = {}) {
  const scope = classifyArticleProduct(article, options.intent || {}, options.scopeOverride);
  if (scope === "finance" || scope === "unknown") return { approved_sentence_valid: true, approved_sentence_errors: [] };
  const text = scope === "both" ? (markdownSections(article.content_markdown).find((section) => /rent\s?2\s?buy/i.test(section.heading))?.lines.join("\n") || "") : article.content_markdown;
  const count = countExact(text, RENT2BUY_SEPARATION_SENTENCE);
  const errors = [];
  if (count === 0) errors.push({ field: scope === "both" ? "Rent2Buy section" : "Article body", error_type: "approved_sentence_missing", approved_sentence: RENT2BUY_SEPARATION_SENTENCE, excerpt: clean(text).slice(0, 180) });
  if (count > 1) errors.push({ field: scope === "both" ? "Rent2Buy section" : "Article body", error_type: "approved_sentence_duplicated", approved_sentence: RENT2BUY_SEPARATION_SENTENCE, occurrence_count: count, excerpt: RENT2BUY_SEPARATION_SENTENCE });
  if (count === 1) { const line = String(text || "").split(/\r?\n/).find((item) => item.includes(RENT2BUY_SEPARATION_SENTENCE)); if (clean(line) !== RENT2BUY_SEPARATION_SENTENCE) errors.push({ field: scope === "both" ? "Rent2Buy section" : "Article body", error_type: "approved_sentence_altered_or_combined", approved_sentence: RENT2BUY_SEPARATION_SENTENCE, excerpt: clean(line) }); }
  return { approved_sentence_valid: errors.length === 0, approved_sentence_errors: errors };
}

export function validateProtectedValues(before = {}, after = {}, options = {}) {
  const errors = [];
  for (const kind of ["url", "email"]) {
    const beforeMap = recordsByField(tokenRecords(before, kind)); const afterMap = recordsByField(tokenRecords(after, kind));
    for (const field of new Set([...beforeMap.keys(), ...afterMap.keys()])) {
      const originals = (beforeMap.get(field) || []).map((item) => item.value); const proposals = (afterMap.get(field) || []).map((item) => item.value);
      for (let index = 0; index < Math.max(originals.length, proposals.length); index += 1) if (originals[index] !== proposals[index]) errors.push(protectedError(field, originals[index], proposals[index], `${kind}_changed`, (afterMap.get(field) || [])[index]?.excerpt || (beforeMap.get(field) || [])[index]?.excerpt || ""));
    }
  }
  const beforeMarkdown = markdownDestinations(before.content_markdown); const afterMarkdown = markdownDestinations(after.content_markdown);
  for (let index = 0; index < Math.max(beforeMarkdown.length, afterMarkdown.length); index += 1) if (beforeMarkdown[index] !== afterMarkdown[index]) errors.push(protectedError("Article body Markdown destination", beforeMarkdown[index], afterMarkdown[index], "markdown_destination_changed", after.content_markdown));
  const beforeLinks = before.internal_link_suggestions || []; const afterLinks = after.internal_link_suggestions || [];
  for (let index = 0; index < Math.max(beforeLinks.length, afterLinks.length); index += 1) {
    const rawOriginal = beforeLinks[index]?.destination_url || beforeLinks[index]?.url || ""; const rawProposed = afterLinks[index]?.destination_url || afterLinks[index]?.url || "";
    if (rawOriginal !== rawProposed) errors.push(protectedError(`Internal-link destination ${index + 1}`, rawOriginal, rawProposed, "internal_link_destination_changed", `${afterLinks[index]?.anchor_text || afterLinks[index]?.label || ""} → ${rawProposed}`));
    if (rawProposed && (rawProposed !== rawProposed.trim() || /\s/.test(rawProposed))) errors.push(protectedError(`Internal-link destination ${index + 1}`, rawOriginal, rawProposed, "internal_link_url_whitespace", rawProposed));
  }
  const beforeCompanyCount = articleFieldValues(before).reduce((sum, item) => sum + countExact(item.value, COMPANY_NAME), 0); const afterCompanyCount = articleFieldValues(after).reduce((sum, item) => sum + countExact(item.value, COMPANY_NAME), 0);
  if (beforeCompanyCount !== afterCompanyCount) errors.push(protectedError("Company name", COMPANY_NAME, afterCompanyCount ? COMPANY_NAME : "", "company_name_changed", articleFieldValues(after).map((item) => item.value).join(" ")));
  if (!options.titleTargeted && before.title !== after.title) errors.push(protectedError("Article title", before.title, after.title, "untargeted_title_changed", after.title));
  const approved = validateApprovedSentence(after, options);
  return { protected_values_valid: errors.length === 0 && approved.approved_sentence_valid, protected_value_errors: errors, ...approved };
}

export function validateTargetedRepairText(article = {}) {
  const errors = [];
  const patterns = [[/\bthe\s+usual\s+the\b/i, "Duplicated determiner: ‘the usual the’."], [/\bnot\s+(?:a|an)\s+(?:arrangements|agreements|payments|conditions)\b/i, "Broken singular/plural phrase after targeted repair."], [/\b(\w+)\s+\1\b/i, "Repeated word created by targeted repair."], [/\bVan\s+(?:ownership|Rent2Buy|arrangement)\s+Company\b/i, "Malformed protected business name."], [/\blease\s+Rent2Buy\b/i, "Broken phrase created from lease finance wording."]];
  articleFieldValues(article).forEach(({ field, value }) => patterns.forEach(([pattern, message]) => { const match = value.match(pattern); if (match) errors.push({ field, error_type: "replacement_corruption", excerpt: excerptFor(value, match[0]), message }); }));
  tokenRecords(article, "url").forEach((record) => { try { const parsed = new URL(record.value); if (!parsed.hostname || /\s/.test(record.value)) throw new Error(); } catch { errors.push({ field: record.field, error_type: "invalid_url", excerpt: record.excerpt, message: `Invalid URL: ${record.value}` }); } });
  return { targeted_repair_text_valid: errors.length === 0, targeted_repair_text_errors: errors };
}

const SENTENCE_REWRITES = [
  { pattern: /suitable if you have bad credit or lack finance history/i, replacement: "subject to the Rent2Buy eligibility process, including applicants with different credit backgrounds." },
  { pattern: /making it a viable option if you have bad credit or are new to finance/i, replacement: "making it accessible to applicants with a range of credit histories, subject to the Rent2Buy eligibility process." },
  { pattern: /a rent[- ]to[- ]own alternative rather than leasing or purchase finance/i, replacement: "a rent-to-own arrangement rather than purchasing a van outright." },
  { pattern: /ideal if credit issues limit traditional finance access/i, replacement: "which may suit customers looking for a different route to van ownership." },
  { pattern: /you need flexibility to test a van before ownership commitment/i, replacement: "You are looking for a rent-to-own arrangement with clearly defined agreement terms." },
  { pattern: /you need flexibility to test a van before buying/i, replacement: "You are looking for a rent-to-own arrangement with clearly defined agreement terms." },
  { pattern: /helping you verify it meets your needs/i, replacement: "Review the vehicle details and agreement terms carefully before proceeding." },
  { pattern: /allowing you to test if the van meets your business or personal requirements/i, replacement: "Review the vehicle details and agreement terms carefully before proceeding." },
  { pattern: /traditional credit checks/i, replacement: "the usual credit checks" },
  { pattern: /traditional finance options/i, replacement: "If you are looking for a different route to van ownership, Rent2Buy may suit your circumstances." },
  { pattern: /credit checks associated with finance agreements|finance agreements/i, replacement: "Rent2Buy has its own eligibility process and agreement terms." },
  { pattern: /unlike traditional finance/i, replacement: "Rent2Buy works differently, with ownership subject to the agreement terms and completion of the required payments." },
  { pattern: /traditional finance barriers|credit checks or deposits are barriers/i, replacement: "Other eligibility routes may better suit your circumstances." },
  { pattern: /traditional finance checks|finance checks/i, replacement: "Rent2Buy has its own eligibility process. Specific eligibility criteria should be confirmed before applying." },
  { pattern: /rent before deciding to buy|rent before committing|decide later after using it|decide after trying it/i, replacement: "You make rental payments under the agreement before the ownership conditions are completed." },
  { pattern: /assess (?:if|whether) (?:the )?van (?:meets|suits) your (?:business or personal )?(?:needs|requirements)|test (?:if|whether) (?:the )?van (?:meets|suits) your (?:business or personal )?(?:needs|requirements)|test a van before buying|try(?:ing)? (?:the )?van|test(?:ing)? (?:the )?van|trial(?:ling)? (?:the )?van|try before committing|try before buying|test before buying/i, replacement: "Review the vehicle details and agreement terms carefully before proceeding." },
  { pattern: /lease finance|hire purchase|lease purchase|\bpcp\b|\bapr\b|interest rates?|finance rates?|lender panels?|\blenders?\b|finance approval|finance applications?|finance deposits?|specific rates/i, replacement: "Rent2Buy eligibility, agreement terms and payment requirements should be reviewed before applying." },
];

function sentenceSpan(text, phrase) { const index = text.toLowerCase().indexOf(clean(phrase).toLowerCase()); if (index < 0) return null; let start = index; while (start > 0 && !/[.!?\n]/.test(text[start - 1])) start -= 1; while (start < index && /\s/.test(text[start])) start += 1; let end = index + phrase.length; while (end < text.length && !/[.!?\n]/.test(text[end])) end += 1; if (end < text.length && /[.!?]/.test(text[end])) end += 1; return { start, end, sentence: text.slice(start, end) }; }
function rewriteSentenceAtError(text, error) { const phrase = clean(error?.phrase); if (!phrase) return { text, repaired: false }; const span = sentenceSpan(text, phrase); if (!span || extractTokens(span.sentence, URL_TOKEN_PATTERN).length || extractTokens(span.sentence, EMAIL_TOKEN_PATTERN).length) return { text, repaired: false }; const rule = SENTENCE_REWRITES.find((item) => item.pattern.test(span.sentence) || item.pattern.test(phrase)); if (!rule) return { text, repaired: false }; const prefix = span.sentence.match(/^\s*(?:[-*+]\s+|\d+\.\s+|>\s*)/)?.[0] || ""; let replacement = rule.replacement; if (/traditional credit checks/i.test(span.sentence)) replacement = span.sentence.replace(/traditional credit checks/gi, "the usual credit checks").trim(); return { text: `${text.slice(0, span.start)}${prefix}${replacement}${text.slice(span.end)}`, repaired: true }; }
function repairTextLocation(value, errors = []) { let text = String(value || ""); let repairedCount = 0; for (const error of errors) { const result = rewriteSentenceAtError(text, error); text = result.text; if (result.repaired) repairedCount += 1; } return { value: text, repairedCount }; }
function repairBodyBySection(markdown, errors, report) { const lines = String(markdown || "").split(/\r?\n/); let heading = "Introduction"; for (let index = 0; index < lines.length; index += 1) { const headingMatch = lines[index].match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/); if (headingMatch) { heading = clean(headingMatch[1]); continue; } const matching = errors.filter((error) => clean(error.section) === heading && lines[index].toLowerCase().includes(clean(error.phrase).toLowerCase())); if (!matching.length) continue; const result = repairTextLocation(lines[index], matching); if (result.repairedCount) { lines[index] = result.value; report.repaired_fields.push(`Article ${heading}`); } } return lines.join("\n"); }
function removeDeliverySection(markdown = "") { const lines = String(markdown || "").split(/\r?\n/); const output = []; let skipping = false; let skippedLevel = 0; for (const line of lines) { const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*$/); if (heading) { const level = heading[1].length; if (/important information about collection and delivery/i.test(heading[2])) { skipping = true; skippedLevel = level; continue; } if (skipping && level <= skippedLevel) skipping = false; } if (!skipping && !/delivery is not provided as part of this scheme\.?/i.test(line)) output.push(line); } return output.join("\n"); }
function ensureRequiredStatements(markdown = "") { let text = removeDeliverySection(markdown); text = text.split(RENT2BUY_SEPARATION_SENTENCE).join(""); text = text.split(RENT2BUY_COLLECTION_SENTENCE).join(""); text = text.replace(/^\s*\*\*[^\n]*(?:rent-to-own|southampton)[^\n]*\*\*\s*$/gim, ""); const lines = text.split(/\r?\n/); let introIndex = lines.findIndex((line) => /^#{1,6}\s+Introduction\s*$/i.test(line.trim())); if (introIndex < 0) { lines.unshift("## Introduction", ""); introIndex = 0; } let introAt = introIndex + 1; while (introAt < lines.length && !lines[introAt].trim()) introAt += 1; lines.splice(introAt, 0, RENT2BUY_SEPARATION_SENTENCE, ""); let featuresIndex = lines.findIndex((line) => /^#{1,6}\s+Key Features(?: and Benefits)?\s*$/i.test(line.trim())); if (featuresIndex < 0) { const nextHeading = lines.findIndex((line, index) => index > introAt && /^#{1,6}\s+/.test(line)); featuresIndex = nextHeading >= 0 ? nextHeading : lines.length; lines.splice(featuresIndex, 0, "## Key Features and Benefits", ""); } featuresIndex = lines.findIndex((line) => /^#{1,6}\s+Key Features(?: and Benefits)?\s*$/i.test(line.trim())); let featureAt = featuresIndex + 1; while (featureAt < lines.length && !lines[featureAt].trim()) featureAt += 1; lines.splice(featureAt, 0, RENT2BUY_COLLECTION_SENTENCE, ""); return normalizeMarkdownSpacing(lines.join("\n")); }
function repairFaqs(faqs = [], errors = [], report) { const errorsByFaq = new Map(); errors.forEach((error) => { const match = clean(error?.field || error?.section).match(/^FAQ\s+(\d+)/i); if (match) { const index = Number(match[1]) - 1; errorsByFaq.set(index, [...(errorsByFaq.get(index) || []), error]); } }); const output = []; (Array.isArray(faqs) ? faqs : []).forEach((faq, index) => { const flagged = errorsByFaq.get(index) || []; const question = clean(faq?.question); const answer = clean(faq?.answer); if (/where are rent2buy vans collected/i.test(question)) { output.push({ question: "Where are Rent2Buy vans collected?", answer: RENT2BUY_COLLECTION_SENTENCE }); return; } if (!flagged.length) { output.push({ question, answer }); return; } const combined = `${question} ${answer}`; if (flagged.some((item) => item.category === "delivery") || /delivery/i.test(combined)) { report.removed_faqs.push(question || `FAQ ${index + 1}`); return; } if (/finance approval|specific rates|approval rate/i.test(combined)) { output.push({ question: "Are eligibility or vehicle availability guaranteed?", answer: "No. Eligibility and vehicle availability depend on the information provided and the terms of the Rent2Buy arrangement." }); report.rewritten_faqs.push(question || `FAQ ${index + 1}`); return; } if (/traditional (?:finance|credit) checks|finance checks/i.test(combined)) { output.push({ question: "How does Rent2Buy eligibility work?", answer: "Rent2Buy has its own eligibility process. Specific eligibility criteria should be confirmed before applying." }); report.rewritten_faqs.push(question || `FAQ ${index + 1}`); return; } const repairedQuestion = repairTextLocation(question, flagged); const repairedAnswer = repairTextLocation(answer, flagged); if (!repairedQuestion.repairedCount && !repairedAnswer.repairedCount) { output.push({ question, answer }); return; } output.push({ question: repairedQuestion.value, answer: repairedAnswer.value }); report.rewritten_faqs.push(question || `FAQ ${index + 1}`); }); return output.filter((faq) => faq.question && faq.answer); }

export function applyTargetedRent2BuyRepairs(article = {}, semanticErrors = [], options = {}) { const scope = classifyArticleProduct(article, options.intent || {}, options.scopeOverride); const report = { targeted_repairs_applied: false, repaired_fields: [], repaired_phrases: [], removed_faqs: [], rewritten_faqs: [] }; if (scope !== "rent2buy") return { article, ...report }; const repaired = structuredClone(article); const byField = new Map(); (semanticErrors || []).forEach((error) => { const field = clean(error?.field || error?.section || "Article body"); byField.set(field, [...(byField.get(field) || []), error]); report.repaired_phrases.push(clean(error?.phrase)); }); [["Article title", "title"], ["SEO title", "seo_title"], ["Meta description", "meta_description"], ["Excerpt", "excerpt"], ["CTA", "cta"]].forEach(([label, key]) => { const result = repairTextLocation(repaired[key], byField.get(label) || []); if (result.repairedCount) { repaired[key] = result.value; report.repaired_fields.push(label); } }); const bodyErrors = (semanticErrors || []).filter((error) => error?.field === "Article body"); repaired.content_markdown = repairBodyBySection(repaired.content_markdown, bodyErrors, report); repaired.content_markdown = ensureRequiredStatements(repaired.content_markdown); if ((semanticErrors || []).some((error) => /^FAQ\s+/i.test(clean(error?.field || error?.section)))) { repaired.faq_json = repairFaqs(repaired.faq_json, semanticErrors, report); if (JSON.stringify(repaired.faq_json) !== JSON.stringify(article.faq_json)) report.repaired_fields.push("FAQs"); } repaired.internal_link_suggestions = (repaired.internal_link_suggestions || []).map((link, index) => { const label = `Internal-link anchor ${index + 1}`; const result = repairTextLocation(link.anchor_text || link.label, byField.get(label) || []); if (!result.repairedCount) return link; report.repaired_fields.push(label); return { ...link, anchor_text: result.value, label: result.value }; }); report.targeted_repairs_applied = report.repaired_fields.length > 0 || report.removed_faqs.length > 0 || repaired.content_markdown !== article.content_markdown; report.repaired_fields = [...new Set(report.repaired_fields)]; report.repaired_phrases = [...new Set(report.repaired_phrases.filter(Boolean))]; return { article: repaired, ...report }; }

function classifyReviewStatus({ materialBlocks = [], manualClaimReview = false, reviewWarnings = [], contentLossReview = false }) { if (materialBlocks.length) return "blocked"; if (manualClaimReview || reviewWarnings.length || contentLossReview) return "review"; return "ready"; }

export function verifyCorrectionResults({ originalSafety, proposedSafety, manualConfirmationRequired = [], markdownValidation = {}, semanticValidation = {}, comparisonValidation = {}, protectedValidation = {}, textValidation = {}, unexplainedContentLossPercent = 0 }) {
  const automatic = [...new Set(proposedSafety?.hard_block_reasons || [])].filter((reason) => reason !== "Article content changed after assessment. Reanalyse before approval.");
  const structural = markdownValidation.markdown_structure_valid === false ? ["Correction damaged article formatting.", ...(markdownValidation.markdown_structure_errors || [])] : [];
  const semantic = semanticValidation.rent2buy_semantic_valid === false ? semanticValidation.rent2buy_semantic_errors || [] : [];
  const comparison = comparisonValidation.comparison_structure_valid === false ? ["Comparison content does not clearly separate Rent2Buy and Van Finance.", ...(comparisonValidation.comparison_structure_errors || [])] : [];
  const protectedIssues = protectedValidation.protected_values_valid === false ? [...(protectedValidation.protected_value_errors || []), ...(protectedValidation.approved_sentence_errors || [])] : [];
  const textIssues = textValidation.targeted_repair_text_valid === false ? textValidation.targeted_repair_text_errors || [] : [];
  const materialBlocks = [...automatic, ...structural, ...semantic, ...comparison, ...protectedIssues, ...textIssues];
  const reviewWarnings = [...new Set([...(proposedSafety?.review_warnings || []), ...(manualConfirmationRequired || [])])];
  const contentLossReview = unexplainedContentLossPercent > 20;
  const manualClaimReview = Boolean(proposedSafety?.requires_manual_claim_review || manualConfirmationRequired.length);
  const reviewStatus = classifyReviewStatus({ materialBlocks, manualClaimReview, reviewWarnings, contentLossReview });
  return { resolved_reasons: [...new Set(originalSafety?.hard_block_reasons || [])].filter((reason) => !automatic.includes(reason)), unresolved_reasons: materialBlocks, remaining_hard_blocks: materialBlocks, review_warnings: reviewWarnings, claim_confirmation_required: manualClaimReview, content_loss_confirmation_required: contentLossReview, correction_complete: materialBlocks.length === 0, review_status: reviewStatus };
}

export function buildCorrectionPreview({ originalArticle, proposed, safetyOptions = {}, scopeOverride = "" }) {
  const normalized = normalizeCorrectionProposal(originalArticle, proposed); assertDuplicateTitleResolved(normalized.corrected_article);
  const scope = classifyArticleProduct(normalized.corrected_article, safetyOptions.intent || {}, scopeOverride); normalized.corrected_article.generation_metadata = { ...(normalized.corrected_article.generation_metadata || {}), product_scope_override: scope };
  const preRepairArticle = structuredClone(normalized.corrected_article);
  const firstSemanticValidation = validateRent2BuySemantics(preRepairArticle, { intent: safetyOptions.intent, scopeOverride: scope });
  const repair = applyTargetedRent2BuyRepairs(preRepairArticle, firstSemanticValidation.rent2buy_semantic_errors, { intent: safetyOptions.intent, scopeOverride: scope });
  normalized.corrected_article = repair.article;
  const beforeSpacing = normalized.corrected_article.content_markdown;
  normalized.corrected_article.content_markdown = normalizeMarkdownSpacing(normalized.corrected_article.content_markdown, normalized.corrected_article.cta);
  const markdownSpacingRepaired = beforeSpacing !== normalized.corrected_article.content_markdown;
  const titleTargeted = firstSemanticValidation.rent2buy_semantic_errors.some((error) => error.field === "Article title");
  const protectedValidation = validateProtectedValues(preRepairArticle, normalized.corrected_article, { titleTargeted, intent: safetyOptions.intent, scopeOverride: scope });
  const textValidation = validateTargetedRepairText(normalized.corrected_article);
  const originalWordCount = countArticleWords(originalArticle.content_markdown); const proposedWordCount = countArticleWords(normalized.corrected_article.content_markdown); const totalRemoved = Math.max(0, originalWordCount - proposedWordCount); const validRemovedWordCount = Math.min(totalRemoved, normalized.removed_section_word_counts.reduce((sum, value, index) => sum + (justifiedRemoval([normalized.removal_reasons[index] || ""]) ? value : 0), 0)); const unexplainedRemovedWordCount = Math.max(0, totalRemoved - validRemovedWordCount); const unexplainedContentLossPercent = originalWordCount ? Math.round((unexplainedRemovedWordCount / originalWordCount) * 1000) / 10 : 0; const wordCountChangePercent = originalWordCount ? Math.round(((proposedWordCount - originalWordCount) / originalWordCount) * 1000) / 10 : 0; const excessiveContentLoss = Math.max(0, -wordCountChangePercent) > 25 && !(normalized.removed_sections.length > 0 && normalized.removed_sections.length === normalized.removal_reasons.length && justifiedRemoval(normalized.removal_reasons));
  const markdownValidation = validateMarkdownStructure(normalized.corrected_article.content_markdown, normalized.corrected_article.cta);
  const semanticValidation = validateRent2BuySemantics(normalized.corrected_article, { intent: safetyOptions.intent, scopeOverride: scope });
  const comparisonValidation = validateComparisonStructure(normalized.corrected_article, { intent: safetyOptions.intent, scopeOverride: scope });
  const safetyBefore = evaluatePublishingSafety(originalArticle, safetyOptions);
  const safetyAfter = evaluatePublishingSafety(normalized.corrected_article, { ...safetyOptions, ignoreAssessmentFreshness: true, scopeOverride: scope });
  const verification = verifyCorrectionResults({ originalSafety: safetyBefore, proposedSafety: safetyAfter, manualConfirmationRequired: normalized.manual_confirmation_required, markdownValidation, semanticValidation, comparisonValidation, protectedValidation, textValidation, unexplainedContentLossPercent });
  const automaticRepairsCount = Number(repair.targeted_repairs_applied) + Number(markdownSpacingRepaired);
  return { product_scope: scope, before: originalArticle, after: normalized.corrected_article, changes: normalized.changes, removed_links: normalized.removed_links, manual_confirmation_required: normalized.manual_confirmation_required, original_word_count: originalWordCount, proposed_word_count: proposedWordCount, word_count_change_percent: wordCountChangePercent, content_retained_percent: originalWordCount ? Math.max(0, Math.round((proposedWordCount / originalWordCount) * 1000) / 10) : 100, removed_sections: normalized.removed_sections, removal_reasons: normalized.removal_reasons, valid_removed_word_count: validRemovedWordCount, unexplained_removed_word_count: unexplainedRemovedWordCount, unexplained_content_loss_percent: unexplainedContentLossPercent, excessive_content_loss: excessiveContentLoss, markdown_structure_valid: markdownValidation.markdown_structure_valid, markdown_structure_errors: markdownValidation.markdown_structure_errors, markdown_spacing_repaired: markdownSpacingRepaired, automatic_repairs_count: automaticRepairsCount, ...semanticValidation, ...comparisonValidation, ...protectedValidation, ...textValidation, targeted_repairs_applied: repair.targeted_repairs_applied, repaired_fields: repair.repaired_fields, repaired_phrases: repair.repaired_phrases, removed_faqs: repair.removed_faqs, rewritten_faqs: repair.rewritten_faqs, remaining_semantic_errors: semanticValidation.rent2buy_semantic_errors || [], safety_before: safetyBefore, safety_after: safetyAfter, editorial_warning_count: safetyAfter.review_warnings?.length || 0, ...verification };
}

export function correctionNeedsManualReview(preview = {}) { return preview.review_status !== "ready"; }
export function canAcceptCorrection(preview = {}, confirmations = {}) { const contentConfirmed = typeof confirmations === "boolean" ? confirmations : Boolean(confirmations.contentLoss); const claimsConfirmed = typeof confirmations === "object" ? Boolean(confirmations.claims) : false; if (!preview.correction_complete || !preview.markdown_structure_valid || preview.rent2buy_semantic_valid === false || preview.comparison_structure_valid === false || preview.protected_values_valid === false || preview.approved_sentence_valid === false || preview.targeted_repair_text_valid === false) return false; if (preview.content_loss_confirmation_required && !contentConfirmed) return false; if (preview.claim_confirmation_required && !claimsConfirmed) return false; return true; }
export function applyAcceptedCorrection(originalArticle = {}, correctedArticle = {}) { return { ...originalArticle, ...normalizeCorrectionProposal(originalArticle, correctedArticle).corrected_article, status: "draft", approved_at: null }; }

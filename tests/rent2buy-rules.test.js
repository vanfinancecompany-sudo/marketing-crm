import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyArticleProduct, evaluateRent2BuyRule, RENT2BUY_COLLECTION_SENTENCE, RENT2BUY_SEPARATION_SENTENCE, validateComparisonStructure, validateRent2BuySemantics } from "../lib/rent2BuyRules.js";
import { evaluatePublishingSafety, PUBLISHING_SAFETY_MESSAGES } from "../lib/publishingSafety.js";
import { applyTargetedRent2BuyRepairs, buildCorrectionPreview, canAcceptCorrection, normalizeCorrectionProposal, normalizeMarkdownSpacing, validateApprovedSentence, validateProtectedValues, validateTargetedRepairText } from "../lib/publishingCorrections.js";

const filler = Array.from({ length: 230 }, (_, index) => `guidance${index + 1}`).join(" ");
const pureBody = `## Introduction\n\n${RENT2BUY_SEPARATION_SENTENCE}\n\n${filler}\n\n## Key Features and Benefits\n\n${RENT2BUY_COLLECTION_SENTENCE}\n\n## Practical Next Steps\n\n1. Apply\n2. Review eligibility\n3. Collect the vehicle\n\nApply for Rent2Buy`;
const pureArticle = (overrides = {}) => ({ id: "r2b", title: "What You Need to Know About Rent2Buy Vans in the UK", seo_title: "Rent2Buy vans in the UK", meta_description: "Rent2Buy agreement information", excerpt: "Review eligibility and agreement terms.", category: "Rent2Buy", article_type: "guide", content_markdown: pureBody, faq_json: [], cta: "Apply for Rent2Buy", internal_link_suggestions: [], generation_metadata: {}, ...overrides });
const financeArticle = (overrides = {}) => ({ id: "finance", title: "How Van Finance Works", seo_title: "Van finance guidance", meta_description: "A guide to van finance applications and agreement terms.", excerpt: "Review available van finance routes.", category: "Van Finance", article_type: "guide", primary_product: "finance", content_markdown: `## Introduction\n\nThis guide explains van finance for businesses and drivers.\n\n${filler}\n\n## Key Features\n\nReview the agreement and repayment information carefully.\n\n## Practical Next Steps\n\n1. Review the vehicle\n2. Submit an application\n3. Discuss the available agreement`, faq_json: [], cta: "Apply for Van Finance", internal_link_suggestions: [], generation_metadata: { product_scope_override: "finance" }, ...overrides });
const proposalFor = (article) => ({ ...article, changes: [], removed_links: [], manual_confirmation_required: [], removed_sections: [], removal_reasons: [], removed_section_word_counts: [] });

const remainingUnsafeBody = `## Introduction\n\nThis arrangement may be suitable if you have bad credit or lack finance history.\n\nIt is a rent to own alternative rather than leasing or purchase finance.\n\nVan Finance Company provides this guide. Visit [our website](https://www.vanfinancecompany.co.uk).\n\n${filler}\n\n## Key Features and Benefits\n\n${RENT2BUY_COLLECTION_SENTENCE}\n\n## Who It May Suit\n\n- It may be ideal if credit issues limit traditional finance access.\n- You need flexibility to test a van before ownership commitment.\n\n## Practical Next Steps\n\nThe process can help, helping you verify it meets your needs.\n\n## Important Information About Collection and Delivery\n\nDelivery is not provided as part of this scheme.\n\n## Summary\n\nReview all terms.\n\nApply for Rent2Buy`;
function errorsForRemaining() { return [["Introduction", "finance history", "finance"], ["Introduction", "purchase finance", "finance"], ["Who It May Suit", "traditional finance access", "finance"], ["Who It May Suit", "test a van", "trial"], ["Practical Next Steps", "verify it meets your needs", "trial"], ["Important Information About Collection and Delivery", "Delivery is not provided", "delivery"]].map(([section, phrase, category]) => ({ field: "Article body", section, phrase, category, excerpt: phrase, product_context: "rent2buy" })); }

test("scope and comparison gates remain unchanged", () => {
  assert.equal(classifyArticleProduct(pureArticle()), "rent2buy");
  const comparison = { ...pureArticle(), title: "Rent2Buy vs Van Finance: Which Is Right for You?", category: "Comparison", article_type: "comparison", content_markdown: `## Van Finance\n\nAPR may apply.\n\n## Rent2Buy\n\n${RENT2BUY_SEPARATION_SENTENCE}\n\n${RENT2BUY_COLLECTION_SENTENCE}` };
  assert.equal(classifyArticleProduct(comparison), "both");
  assert.equal(validateComparisonStructure(comparison, { scopeOverride: "both" }).comparison_structure_valid, true);
  assert.equal(evaluateRent2BuyRule(comparison, { scopeOverride: "both" }).rent2buy_semantic_valid, true);
});

test("Rent2Buy mandatory sentence and Southampton rules never leak into Van Finance", () => {
  const article = financeArticle();
  const approved = validateApprovedSentence(article, { scopeOverride: "finance" });
  const protectedResult = validateProtectedValues(article, structuredClone(article), { scopeOverride: "finance" });
  const semantic = validateRent2BuySemantics(article, { scopeOverride: "finance" });
  const rule = evaluateRent2BuyRule(article, { scopeOverride: "finance" });
  assert.equal(approved.approved_sentence_valid, true);
  assert.equal(approved.approved_sentence_errors.some((item) => item.error_type === "approved_sentence_missing"), false);
  assert.equal(protectedResult.approved_sentence_valid, true);
  assert.equal(semantic.rent2buy_semantic_valid, true);
  assert.equal(rule.passed, true);
  assert.doesNotMatch(JSON.stringify(rule), /Southampton|separation error/i);
});

test("approved sentence is restored exactly once as a standalone introduction sentence", () => {
  const original = pureArticle({ content_markdown: remainingUnsafeBody });
  const repaired = applyTargetedRent2BuyRepairs(original, errorsForRemaining(), { scopeOverride: "rent2buy" }).article;
  assert.equal(repaired.content_markdown.split(RENT2BUY_SEPARATION_SENTENCE).length - 1, 1);
  const line = repaired.content_markdown.split(/\r?\n/).find((item) => item.includes(RENT2BUY_SEPARATION_SENTENCE));
  assert.equal(line, RENT2BUY_SEPARATION_SENTENCE);
  assert.equal(validateApprovedSentence(repaired).approved_sentence_valid, true);
});

test("approved sentence validator reports missing, altered and duplicated for Rent2Buy", () => {
  assert.equal(validateApprovedSentence(pureArticle({ content_markdown: "## Introduction\n\nOther text." })).approved_sentence_errors[0].error_type, "approved_sentence_missing");
  assert.equal(validateApprovedSentence(pureArticle({ content_markdown: `## Introduction\n\n**${RENT2BUY_SEPARATION_SENTENCE}**` })).approved_sentence_errors[0].error_type, "approved_sentence_altered_or_combined");
  assert.equal(validateApprovedSentence(pureArticle({ content_markdown: `${pureBody}\n\n${RENT2BUY_SEPARATION_SENTENCE}` })).approved_sentence_errors[0].error_type, "approved_sentence_duplicated");
});

test("remaining prohibited wording and delivery section are repaired", () => {
  const repaired = applyTargetedRent2BuyRepairs(pureArticle({ content_markdown: remainingUnsafeBody }), errorsForRemaining(), { scopeOverride: "rent2buy" }).article.content_markdown;
  assert.doesNotMatch(repaired, /finance history|purchase finance|traditional finance access|test a van|verify it meets your needs|Important Information About Collection and Delivery|Delivery is not provided/i);
  assert.match(repaired, /subject to the Rent2Buy eligibility process, including applicants with different credit backgrounds\./);
  assert.match(repaired, /a rent-to-own arrangement rather than purchasing a van outright\./);
  assert.match(repaired, /which may suit customers looking for a different route to van ownership\./);
  assert.equal(repaired.split(RENT2BUY_COLLECTION_SENTENCE).length - 1, 1);
});

test("collection FAQ remains allowed without creating a delivery FAQ", () => {
  const article = pureArticle({ content_markdown: remainingUnsafeBody, faq_json: [{ question: "Where are Rent2Buy vans collected?", answer: RENT2BUY_COLLECTION_SENTENCE }, { question: "Is delivery available?", answer: "Delivery is not provided." }] });
  const errors = [...errorsForRemaining(), { field: "FAQ 2", section: "FAQ 2", phrase: "delivery", category: "delivery", excerpt: "delivery", product_context: "rent2buy" }];
  const repaired = applyTargetedRent2BuyRepairs(article, errors, { scopeOverride: "rent2buy" }).article.faq_json;
  assert.ok(repaired.some((faq) => faq.question === "Where are Rent2Buy vans collected?" && faq.answer === RENT2BUY_COLLECTION_SENTENCE));
  assert.equal(repaired.some((faq) => /delivery/i.test(`${faq.question} ${faq.answer}`)), false);
});

test("Markdown heading, rule and CTA spacing is repaired automatically", () => {
  const input = `## Introduction\nText immediately follows.\n---\n## Next Steps\n1. First\n2. Second\nApply now`;
  const output = normalizeMarkdownSpacing(input, "Apply now");
  assert.match(output, /## Introduction\n\nText immediately follows\./);
  assert.match(output, /Text immediately follows\.\n\n---\n\n## Next Steps/);
  assert.match(output, /1\. First\n2\. Second\n\nApply now/);
});

test("mild repetition is a review warning while material repetition remains blocked", () => {
  const mild = financeArticle({ content_markdown: `## Introduction\n\nThis guide explains the main agreement terms for a business van.\n\n${filler}\n\n## Key Features\n\nThis guide explains the key agreement terms for your selected business vehicle.\n\n## Next Steps\n\nReview everything before applying.` });
  const mildSafety = evaluatePublishingSafety(mild, { assessment: { created_at: new Date(Date.now() + 1000).toISOString() }, scopeOverride: "finance" });
  assert.equal(mildSafety.hard_block_reasons.includes(PUBLISHING_SAFETY_MESSAGES.repetition), false);
  assert.ok(mildSafety.review_warnings.includes(PUBLISHING_SAFETY_MESSAGES.mild_repetition));
  const repeated = "This exact detailed sentence is repeated to create material duplication across the article.";
  const material = financeArticle({ content_markdown: `## Introduction\n\n${repeated}\n\n${filler}\n\n## Key Features\n\n${repeated}\n\n## Next Steps\n\nReview the agreement.` });
  const materialSafety = evaluatePublishingSafety(material, { assessment: { created_at: new Date(Date.now() + 1000).toISOString() }, scopeOverride: "finance" });
  assert.ok(materialSafety.hard_block_reasons.includes(PUBLISHING_SAFETY_MESSAGES.repetition));
});

test("one correction preview runs targeted repair, Markdown normalisation and final status", () => {
  const original = pureArticle({ content_markdown: remainingUnsafeBody.replace("## Key Features and Benefits\n\n", "## Key Features and Benefits\n") });
  const preview = buildCorrectionPreview({ originalArticle: original, proposed: proposalFor(original), safetyOptions: { ignoreAssessmentFreshness: true }, scopeOverride: "rent2buy" });
  assert.ok(preview.automatic_repairs_count >= 1);
  assert.equal(preview.markdown_structure_valid, true);
  assert.ok(["ready", "review", "blocked"].includes(preview.review_status));
  assert.equal(preview.after.content_markdown.includes("## Key Features and Benefits\n\n"), true);
});

test("reviewed content reduction and manual claims require explicit confirmation", () => {
  const preview = { correction_complete: true, markdown_structure_valid: true, rent2buy_semantic_valid: true, comparison_structure_valid: true, protected_values_valid: true, approved_sentence_valid: true, targeted_repair_text_valid: true, content_loss_confirmation_required: true, claim_confirmation_required: true };
  assert.equal(canAcceptCorrection(preview, { contentLoss: false, claims: false }), false);
  assert.equal(canAcceptCorrection(preview, { contentLoss: true, claims: false }), false);
  assert.equal(canAcceptCorrection(preview, { contentLoss: true, claims: true }), true);
});

test("protected-link errors require an exact changed value", () => {
  const before = pureArticle({ internal_link_suggestions: [{ id: "one", anchor_text: "Old", destination_url: "https://www.vanfinancecompany.co.uk" }] });
  const unchanged = normalizeCorrectionProposal(before, { ...before, internal_link_suggestions: [{ anchor_text: "New", destination_url: "https://example.com" }] }).corrected_article;
  assert.equal(validateProtectedValues(before, unchanged, { scopeOverride: "rent2buy", titleTargeted: true }).protected_value_errors.length, 0);
  const changed = structuredClone(before); changed.internal_link_suggestions[0].destination_url = "https://example.com";
  const error = validateProtectedValues(before, changed, { scopeOverride: "rent2buy", titleTargeted: true }).protected_value_errors[0];
  assert.equal(error.original_protected_value, "https://www.vanfinancecompany.co.uk");
  assert.equal(error.proposed_protected_value, "https://example.com");
  assert.equal(error.error_type, "url_changed");
});

test("technical details are collapsed by default and bulk status labels are compact", async () => {
  const source = await readFile(new URL("../components/PublishingSafetyCorrections.jsx", import.meta.url), "utf8");
  assert.match(source, /<details[^>]*><summary><strong>Show technical details<\/strong><\/summary>/);
  assert.doesNotMatch(source, /<details[^>]*\sopen(?:=|\s|>)/);
  assert.match(source, /Ready to accept/);
  assert.match(source, /Review and confirm/);
  assert.match(source, /Blocked — material corrections required/);
  assert.match(source, /resultStatus === "ready" \? "Ready" : resultStatus === "review" \? "Review" : "Blocked"/);
});

test("unchanged links and company name remain protected", () => {
  const before = pureArticle({ content_markdown: `## Introduction\n\n${RENT2BUY_SEPARATION_SENTENCE}\n\nVan Finance Company. Visit [our website](https://www.vanfinancecompany.co.uk).\n\n## Key Features and Benefits\n\n${RENT2BUY_COLLECTION_SENTENCE}` });
  const after = structuredClone(before);
  const result = validateProtectedValues(before, after, { scopeOverride: "rent2buy" });
  assert.equal(result.protected_values_valid, true);
  assert.deepEqual(result.protected_value_errors, []);
  assert.equal(validateTargetedRepairText(after).targeted_repair_text_valid, true);
});

test("original article remains unchanged and no automatic Wix approval occurs", () => {
  const original = pureArticle({ content_markdown: remainingUnsafeBody, generation_metadata: { product_scope_override: "rent2buy" } });
  const snapshot = structuredClone(original);
  normalizeCorrectionProposal(original, proposalFor(original));
  assert.deepEqual(original, snapshot);
  assert.equal(original.wix_sync_status, undefined);
  assert.notEqual(original.status, "approved");
});

import test from "node:test";
import assert from "node:assert/strict";
import { classifyArticleProduct, evaluateRent2BuyRule, RENT2BUY_COLLECTION_SENTENCE, RENT2BUY_SEPARATION_SENTENCE, validateComparisonStructure, validateRent2BuySemantics } from "../lib/rent2BuyRules.js";
import { applyTargetedRent2BuyRepairs, buildCorrectionPreview, normalizeCorrectionProposal, validateApprovedSentence, validateProtectedValues, validateTargetedRepairText } from "../lib/publishingCorrections.js";

const filler = Array.from({ length: 230 }, (_, index) => `guidance${index + 1}`).join(" ");
const pureBody = `## Introduction\n\n${RENT2BUY_SEPARATION_SENTENCE}\n\n${filler}\n\n## Key Features and Benefits\n\n${RENT2BUY_COLLECTION_SENTENCE}\n\n## Practical Next Steps\n\n1. Apply\n2. Review eligibility\n3. Collect the vehicle\n\nApply for Rent2Buy`;
const pureArticle = (overrides = {}) => ({ id: "r2b", title: "What You Need to Know About Rent2Buy Vans in the UK", seo_title: "Rent2Buy vans in the UK", meta_description: "Rent2Buy agreement information", excerpt: "Review eligibility and agreement terms.", category: "Rent2Buy", article_type: "guide", content_markdown: pureBody, faq_json: [], cta: "Apply for Rent2Buy", internal_link_suggestions: [], generation_metadata: {}, ...overrides });
const proposalFor = (article) => ({ ...article, changes: [], removed_links: [], manual_confirmation_required: [], removed_sections: [], removal_reasons: [], removed_section_word_counts: [] });

const remainingUnsafeBody = `## Introduction\n\nThis arrangement may be suitable if you have bad credit or lack finance history.\n\nIt is a rent to own alternative rather than leasing or purchase finance.\n\nVan Finance Company provides this guide. Visit [our website](https://www.vanfinancecompany.co.uk).\n\n${filler}\n\n## Key Features and Benefits\n\n${RENT2BUY_COLLECTION_SENTENCE}\n\n## Who It May Suit\n\n- It may be ideal if credit issues limit traditional finance access.\n- You need flexibility to test a van before ownership commitment.\n\n## Practical Next Steps\n\nThe process can help, helping you verify it meets your needs.\n\n## Important Information About Collection and Delivery\n\nDelivery is not provided as part of this scheme.\n\n## Summary\n\nReview all terms.\n\nApply for Rent2Buy`;

function errorsForRemaining() {
  return [
    ["Introduction", "finance history", "finance"],
    ["Introduction", "purchase finance", "finance"],
    ["Who It May Suit", "traditional finance access", "finance"],
    ["Who It May Suit", "test a van", "trial"],
    ["Practical Next Steps", "verify it meets your needs", "trial"],
    ["Important Information About Collection and Delivery", "Delivery is not provided", "delivery"],
  ].map(([section, phrase, category]) => ({ field: "Article body", section, phrase, category, excerpt: phrase, product_context: "rent2buy" }));
}

test("scope and comparison gates remain unchanged", () => {
  assert.equal(classifyArticleProduct(pureArticle()), "rent2buy");
  const comparison = { ...pureArticle(), title: "Rent2Buy vs Van Finance: Which Is Right for You?", category: "Comparison", article_type: "comparison", content_markdown: `## Van Finance\n\nAPR may apply.\n\n## Rent2Buy\n\n${RENT2BUY_SEPARATION_SENTENCE}\n\n${RENT2BUY_COLLECTION_SENTENCE}` };
  assert.equal(classifyArticleProduct(comparison), "both");
  assert.equal(validateComparisonStructure(comparison, { scopeOverride: "both" }).comparison_structure_valid, true);
  assert.equal(evaluateRent2BuyRule(comparison, { scopeOverride: "both" }).rent2buy_semantic_valid, true);
});

test("approved sentence is restored exactly once as a standalone introduction sentence", () => {
  const original = pureArticle({ content_markdown: remainingUnsafeBody });
  const repaired = applyTargetedRent2BuyRepairs(original, errorsForRemaining(), { scopeOverride: "rent2buy" }).article;
  assert.equal(repaired.content_markdown.split(RENT2BUY_SEPARATION_SENTENCE).length - 1, 1);
  const line = repaired.content_markdown.split(/\r?\n/).find((item) => item.includes(RENT2BUY_SEPARATION_SENTENCE));
  assert.equal(line, RENT2BUY_SEPARATION_SENTENCE);
  assert.equal(validateApprovedSentence(repaired).approved_sentence_valid, true);
});

test("approved sentence validator reports missing, altered and duplicated", () => {
  assert.equal(validateApprovedSentence(pureArticle({ content_markdown: "## Introduction\n\nOther text." })).approved_sentence_errors[0].error_type, "approved_sentence_missing");
  assert.equal(validateApprovedSentence(pureArticle({ content_markdown: `## Introduction\n\n**${RENT2BUY_SEPARATION_SENTENCE}**` })).approved_sentence_errors[0].error_type, "approved_sentence_altered_or_combined");
  assert.equal(validateApprovedSentence(pureArticle({ content_markdown: `${pureBody}\n\n${RENT2BUY_SEPARATION_SENTENCE}` })).approved_sentence_errors[0].error_type, "approved_sentence_duplicated");
});

test("remaining finance-history, purchase-finance and traditional-access wording is repaired", () => {
  const repaired = applyTargetedRent2BuyRepairs(pureArticle({ content_markdown: remainingUnsafeBody }), errorsForRemaining(), { scopeOverride: "rent2buy" }).article.content_markdown;
  assert.doesNotMatch(repaired, /finance history|purchase finance|traditional finance access/i);
  assert.match(repaired, /subject to the Rent2Buy eligibility process, including applicants with different credit backgrounds\./);
  assert.match(repaired, /a rent-to-own arrangement rather than purchasing a van outright\./);
  assert.match(repaired, /which may suit customers looking for a different route to van ownership\./);
});

test("test-before-commitment and suitability-verification wording is removed", () => {
  const repaired = applyTargetedRent2BuyRepairs(pureArticle({ content_markdown: remainingUnsafeBody }), errorsForRemaining(), { scopeOverride: "rent2buy" }).article.content_markdown;
  assert.doesNotMatch(repaired, /test a van|verify it meets your needs/i);
  assert.match(repaired, /You are looking for a rent-to-own arrangement with clearly defined agreement terms\./);
  assert.match(repaired, /Review the vehicle details and agreement terms carefully before proceeding\./);
});

test("delivery section and negative delivery wording are removed", () => {
  const repaired = applyTargetedRent2BuyRepairs(pureArticle({ content_markdown: remainingUnsafeBody }), errorsForRemaining(), { scopeOverride: "rent2buy" }).article.content_markdown;
  assert.doesNotMatch(repaired, /Important Information About Collection and Delivery|Delivery is not provided/i);
  assert.equal(repaired.split(RENT2BUY_COLLECTION_SENTENCE).length - 1, 1);
  assert.ok(repaired.indexOf(RENT2BUY_COLLECTION_SENTENCE) > repaired.indexOf("## Key Features and Benefits"));
  assert.ok(repaired.indexOf(RENT2BUY_COLLECTION_SENTENCE) < repaired.indexOf("## Who It May Suit"));
});

test("collection FAQ remains allowed without creating a delivery FAQ", () => {
  const article = pureArticle({ content_markdown: remainingUnsafeBody, faq_json: [{ question: "Where are Rent2Buy vans collected?", answer: RENT2BUY_COLLECTION_SENTENCE }, { question: "Is delivery available?", answer: "Delivery is not provided." }] });
  const errors = [...errorsForRemaining(), { field: "FAQ 2", section: "FAQ 2", phrase: "delivery", category: "delivery", excerpt: "delivery", product_context: "rent2buy" }];
  const repaired = applyTargetedRent2BuyRepairs(article, errors, { scopeOverride: "rent2buy" }).article.faq_json;
  assert.ok(repaired.some((faq) => faq.question === "Where are Rent2Buy vans collected?" && faq.answer === RENT2BUY_COLLECTION_SENTENCE));
  assert.equal(repaired.some((faq) => /delivery/i.test(`${faq.question} ${faq.answer}`)), false);
});

test("unchanged links and company name remain protected", () => {
  const before = pureArticle({ content_markdown: `## Introduction\n\n${RENT2BUY_SEPARATION_SENTENCE}\n\nVan Finance Company. Visit [our website](https://www.vanfinancecompany.co.uk).\n\n## Key Features and Benefits\n\n${RENT2BUY_COLLECTION_SENTENCE}` });
  const after = structuredClone(before);
  const result = validateProtectedValues(before, after);
  assert.equal(result.protected_values_valid, true);
  assert.deepEqual(result.protected_value_errors, []);
  assert.equal(result.approved_sentence_valid, true);
  assert.equal(validateTargetedRepairText(after).targeted_repair_text_valid, true);
});

test("complete repaired proposal reruns semantic, protected and Markdown checks", () => {
  const original = pureArticle({ content_markdown: remainingUnsafeBody });
  const proposed = proposalFor(original);
  const preview = buildCorrectionPreview({ originalArticle: original, proposed, safetyOptions: { ignoreAssessmentFreshness: true }, scopeOverride: "rent2buy" });
  assert.equal(preview.approved_sentence_valid, true);
  assert.equal(preview.protected_values_valid, true);
  assert.equal(preview.markdown_structure_valid, true);
  assert.equal(preview.rent2buy_semantic_valid, true);
  assert.deepEqual(preview.remaining_semantic_errors, []);
});

test("original article remains unchanged and no automatic Wix approval occurs", () => {
  const original = pureArticle({ content_markdown: remainingUnsafeBody, generation_metadata: { product_scope_override: "rent2buy" } });
  const snapshot = structuredClone(original);
  normalizeCorrectionProposal(original, proposalFor(original));
  assert.deepEqual(original, snapshot);
  assert.equal(original.wix_sync_status, undefined);
  assert.notEqual(original.status, "approved");
});

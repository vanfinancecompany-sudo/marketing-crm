import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyArticleProduct,
  evaluateRent2BuyRule,
  RENT2BUY_COLLECTION_SENTENCE,
  RENT2BUY_SEPARATION_SENTENCE,
  validateComparisonStructure,
  validateRent2BuySemantics,
} from "../lib/rent2BuyRules.js";
import { buildCorrectionPreview, normalizeCorrectionProposal } from "../lib/publishingCorrections.js";

const filler = Array.from({ length: 230 }, (_, index) => `guidance${index + 1}`).join(" ");
const pureBody = `## Introduction\n\n${RENT2BUY_SEPARATION_SENTENCE}\n\n${filler}\n\n## Key Features\n\n${RENT2BUY_COLLECTION_SENTENCE}\n\n## Practical Next Steps\n\n1. Apply\n2. Review eligibility\n3. Collect the vehicle\n\nApply for Rent2Buy`;
const pureArticle = (overrides = {}) => ({ id: "r2b", title: "What You Need to Know About Rent2Buy Vans in the UK", seo_title: "Rent2Buy vans in the UK", meta_description: "Rent2Buy agreement information", excerpt: "Review eligibility and agreement terms.", category: "Rent2Buy", article_type: "guide", content_markdown: pureBody, faq_json: [], cta: "Apply for Rent2Buy", internal_link_suggestions: [], generation_metadata: {}, ...overrides });
const comparisonBody = `## Introduction\n\nThis guide compares two routes clearly.\n\n## Van Finance\n\nVan finance agreements may include interest and APR. Lender assessment may apply.\n\n## Rent2Buy\n\n${RENT2BUY_SEPARATION_SENTENCE}\n\n${RENT2BUY_COLLECTION_SENTENCE}\n\n## Key Differences\n\n| Feature | Van Finance | Rent2Buy |\n| --- | --- | --- |\n| Assessment | Credit checks and lender assessment may apply. | Review eligibility and agreement terms. |\n| Vehicle handover | Terms depend on the finance agreement. | Collection only from Southampton. |\n\n${filler}`;
const comparisonArticle = (overrides = {}) => ({ id: "both", title: "Rent2Buy vs Van Finance: Which Is Right for You?", seo_title: "Rent2Buy compared with Van Finance", meta_description: "Compare Rent2Buy and Van Finance", excerpt: "A clearly separated comparison.", category: "Comparison", article_type: "comparison", content_markdown: comparisonBody, faq_json: [], cta: "Compare your options", internal_link_suggestions: [], generation_metadata: {}, ...overrides });

test("pure Rent2Buy article remains strictly separated", () => {
  const unsafe = pureArticle({ content_markdown: `${pureBody}\n\n## Extra\n\nAPR varies by lender.` });
  assert.equal(classifyArticleProduct(unsafe), "rent2buy");
  assert.equal(validateRent2BuySemantics(unsafe).rent2buy_semantic_valid, false);
});

test("brief not-finance clarification does not classify article as both", () => {
  const article = { title: "How Rent2Buy works", seo_title: "Rent2Buy guide", content_markdown: RENT2BUY_SEPARATION_SENTENCE };
  assert.equal(classifyArticleProduct(article), "rent2buy");
});

test("explicit comparison title classifies as both", () => {
  assert.equal(classifyArticleProduct({ title: "Rent2Buy vs Van Finance: Which Is Right for You?", content_markdown: "" }), "both");
});

test("saved user scope overrides title inference", () => {
  const article = comparisonArticle({ generation_metadata: { product_scope_override: "rent2buy" } });
  assert.equal(classifyArticleProduct(article), "rent2buy");
});

test("comparison articles retain legitimate finance terminology", () => {
  const result = evaluateRent2BuyRule(comparisonArticle(), { scopeOverride: "both" });
  assert.equal(result.product, "both");
  assert.equal(result.rent2buy_semantic_valid, true);
  assert.equal(result.comparison_structure_valid, true);
});

test("finance terms in Van Finance sections pass", () => {
  const result = validateRent2BuySemantics(comparisonArticle(), { scopeOverride: "both" });
  assert.equal(result.rent2buy_semantic_valid, true);
});

test("finance terms in Rent2Buy sections fail with context", () => {
  const article = comparisonArticle({ content_markdown: comparisonBody.replace(RENT2BUY_COLLECTION_SENTENCE, `${RENT2BUY_COLLECTION_SENTENCE}\n\nAPR varies by lender.`) });
  const result = validateRent2BuySemantics(article, { scopeOverride: "both" });
  assert.equal(result.rent2buy_semantic_valid, false);
  assert.ok(result.rent2buy_semantic_errors.some((item) => item.product_context === "rent2buy" && item.section === "Rent2Buy"));
});

test("collection wording is required on Rent2Buy side", () => {
  const article = comparisonArticle({ content_markdown: comparisonBody.replaceAll(RENT2BUY_COLLECTION_SENTENCE, "Vehicle collection details are provided separately.") });
  assert.equal(evaluateRent2BuyRule(article, { scopeOverride: "both" }).passed, false);
});

test("trial and free-delivery wording fail on Rent2Buy side", () => {
  for (const phrase of ["Try the van before committing.", "Free UK delivery is available."]) {
    const article = comparisonArticle({ content_markdown: comparisonBody.replace(RENT2BUY_COLLECTION_SENTENCE, `${RENT2BUY_COLLECTION_SENTENCE}\n\n${phrase}`) });
    assert.equal(validateRent2BuySemantics(article, { scopeOverride: "both" }).rent2buy_semantic_valid, false);
  }
});

test("clearly separated comparison table passes", () => {
  assert.equal(validateComparisonStructure(comparisonArticle(), { scopeOverride: "both" }).comparison_structure_valid, true);
});

test("mixed unlabelled product claims fail", () => {
  const article = comparisonArticle({ content_markdown: `## Comparison\n\nRent2Buy uses a rent-to-own arrangement while van finance may include APR and lenders.\n\n${filler}` });
  const result = validateComparisonStructure(article, { scopeOverride: "both" });
  assert.equal(result.comparison_structure_valid, false);
});

test("current Rent2Buy guide remains rent2buy", () => {
  assert.equal(classifyArticleProduct(pureArticle()), "rent2buy");
});

test("corrections preserve comparison sections only for scope both", () => {
  const original = comparisonArticle();
  const proposed = { ...original, changes: ["Preserved separated comparison"], removed_links: [], manual_confirmation_required: [], removed_sections: [], removal_reasons: [], removed_section_word_counts: [] };
  const preview = buildCorrectionPreview({ originalArticle: original, proposed, safetyOptions: { ignoreAssessmentFreshness: true }, scopeOverride: "both" });
  assert.equal(preview.product_scope, "both");
  assert.match(preview.after.content_markdown, /## Van Finance/);
  assert.match(preview.after.content_markdown, /APR/);
  assert.equal(preview.comparison_structure_valid, true);
});

test("normalisation preserves saved scope, source and no Wix approval", () => {
  const original = pureArticle({ generation_metadata: { product_scope_override: "rent2buy" } });
  const snapshot = structuredClone(original);
  const normalized = normalizeCorrectionProposal(original, { ...original, content_markdown: pureBody, changes: [], removed_links: [], manual_confirmation_required: [], removed_sections: [], removal_reasons: [], removed_section_word_counts: [] }).corrected_article;
  assert.deepEqual(original, snapshot);
  assert.equal(normalized.generation_metadata.product_scope_override, "rent2buy");
  assert.equal(original.wix_sync_status, undefined);
  assert.notEqual(original.status, "approved");
});

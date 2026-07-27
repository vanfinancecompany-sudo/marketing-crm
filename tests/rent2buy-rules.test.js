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
import {
  applyTargetedRent2BuyRepairs,
  buildCorrectionPreview,
  normalizeCorrectionProposal,
  validateProtectedValues,
  validateTargetedRepairText,
} from "../lib/publishingCorrections.js";

const filler = Array.from({ length: 230 }, (_, index) => `guidance${index + 1}`).join(" ");
const pureBody = `## Introduction\n\n${RENT2BUY_SEPARATION_SENTENCE}\n\n${filler}\n\n## Key Features\n\n${RENT2BUY_COLLECTION_SENTENCE}\n\n## Practical Next Steps\n\n1. Apply\n2. Review eligibility\n3. Collect the vehicle\n\nApply for Rent2Buy`;
const pureArticle = (overrides = {}) => ({ id: "r2b", title: "What You Need to Know About Rent2Buy Vans in the UK", seo_title: "Rent2Buy vans in the UK", meta_description: "Rent2Buy agreement information", excerpt: "Review eligibility and agreement terms.", category: "Rent2Buy", article_type: "guide", content_markdown: pureBody, faq_json: [], cta: "Apply for Rent2Buy", internal_link_suggestions: [], generation_metadata: {}, ...overrides });
const comparisonBody = `## Introduction\n\nThis guide compares two routes clearly.\n\n## Van Finance\n\nVan finance agreements may include interest and APR. Lender assessment may apply.\n\n## Rent2Buy\n\n${RENT2BUY_SEPARATION_SENTENCE}\n\n${RENT2BUY_COLLECTION_SENTENCE}\n\n## Key Differences\n\n| Feature | Van Finance | Rent2Buy |\n| --- | --- | --- |\n| Assessment | Credit checks and lender assessment may apply. | Review eligibility and agreement terms. |\n| Vehicle handover | Terms depend on the finance agreement. | Collection only from Southampton. |\n\n${filler}`;
const comparisonArticle = (overrides = {}) => ({ id: "both", title: "Rent2Buy vs Van Finance: Which Is Right for You?", seo_title: "Rent2Buy compared with Van Finance", meta_description: "Compare Rent2Buy and Van Finance", excerpt: "A clearly separated comparison.", category: "Comparison", article_type: "comparison", content_markdown: comparisonBody, faq_json: [], cta: "Compare your options", internal_link_suggestions: [], generation_metadata: {}, ...overrides });

// Existing scope and comparison coverage.
test("pure Rent2Buy article remains strictly separated", () => { const unsafe = pureArticle({ content_markdown: `${pureBody}\n\n## Extra\n\nAPR varies by lender.` }); assert.equal(classifyArticleProduct(unsafe), "rent2buy"); assert.equal(validateRent2BuySemantics(unsafe).rent2buy_semantic_valid, false); });
test("brief not-finance clarification does not classify article as both", () => { assert.equal(classifyArticleProduct({ title: "How Rent2Buy works", seo_title: "Rent2Buy guide", content_markdown: RENT2BUY_SEPARATION_SENTENCE }), "rent2buy"); });
test("explicit comparison title classifies as both", () => { assert.equal(classifyArticleProduct({ title: "Rent2Buy vs Van Finance: Which Is Right for You?", content_markdown: "" }), "both"); });
test("saved user scope overrides title inference", () => { assert.equal(classifyArticleProduct(comparisonArticle({ generation_metadata: { product_scope_override: "rent2buy" } })), "rent2buy"); });
test("comparison articles retain legitimate finance terminology", () => { const result = evaluateRent2BuyRule(comparisonArticle(), { scopeOverride: "both" }); assert.equal(result.product, "both"); assert.equal(result.rent2buy_semantic_valid, true); assert.equal(result.comparison_structure_valid, true); });
test("finance terms in Van Finance sections pass", () => { assert.equal(validateRent2BuySemantics(comparisonArticle(), { scopeOverride: "both" }).rent2buy_semantic_valid, true); });
test("finance terms in Rent2Buy sections fail with context", () => { const article = comparisonArticle({ content_markdown: comparisonBody.replace(RENT2BUY_COLLECTION_SENTENCE, `${RENT2BUY_COLLECTION_SENTENCE}\n\nAPR varies by lender.`) }); const result = validateRent2BuySemantics(article, { scopeOverride: "both" }); assert.equal(result.rent2buy_semantic_valid, false); assert.ok(result.rent2buy_semantic_errors.some((item) => item.product_context === "rent2buy" && item.section === "Rent2Buy")); });
test("collection wording is required on Rent2Buy side", () => { const article = comparisonArticle({ content_markdown: comparisonBody.replaceAll(RENT2BUY_COLLECTION_SENTENCE, "Vehicle collection details are provided separately.") }); assert.equal(evaluateRent2BuyRule(article, { scopeOverride: "both" }).passed, false); });
test("trial and free-delivery wording fail on Rent2Buy side", () => { for (const phrase of ["Try the van before committing.", "Free UK delivery is available."]) { const article = comparisonArticle({ content_markdown: comparisonBody.replace(RENT2BUY_COLLECTION_SENTENCE, `${RENT2BUY_COLLECTION_SENTENCE}\n\n${phrase}`) }); assert.equal(validateRent2BuySemantics(article, { scopeOverride: "both" }).rent2buy_semantic_valid, false); } });
test("clearly separated comparison table passes", () => { assert.equal(validateComparisonStructure(comparisonArticle(), { scopeOverride: "both" }).comparison_structure_valid, true); });
test("mixed unlabelled product claims fail", () => { const article = comparisonArticle({ content_markdown: `## Comparison\n\nRent2Buy uses a rent-to-own arrangement while van finance may include APR and lenders.\n\n${filler}` }); assert.equal(validateComparisonStructure(article, { scopeOverride: "both" }).comparison_structure_valid, false); });

const unsafeBody = `## Introduction\n\n${RENT2BUY_SEPARATION_SENTENCE}\n\nIf you are concerned about traditional finance options, Rent2Buy may be relevant.\n\nVan Finance Company provides this guide. Visit [our website](https://www.vanfinancecompany.co.uk).\n\n${filler}\n\n## Key Features and Benefits\n\nCredit checks associated with finance agreements can be difficult.\n\n## Practical Next Steps\n\n1. Apply\n2. Assess if the van meets your needs\n3. Rent before deciding to buy\n\n${RENT2BUY_COLLECTION_SENTENCE}\n\nApply for Rent2Buy`;
const unsafeFaqs = [
  { question: "Do traditional finance checks apply?", answer: "Traditional finance checks may be different." },
  { question: "What should I review?", answer: "Review the agreement terms." },
  { question: "How do payments work?", answer: "Rental payments follow the agreement." },
  { question: "Is free delivery available?", answer: "Free delivery is unavailable." },
  { question: "Is finance approval guaranteed at specific rates?", answer: "Finance approval and specific rates are not guaranteed." },
];

test("location-based sentence repair preserves company name, URL and unrelated text", () => {
  const original = pureArticle({ content_markdown: unsafeBody });
  const repaired = applyTargetedRent2BuyRepairs(original, validateRent2BuySemantics(original).rent2buy_semantic_errors, { scopeOverride: "rent2buy" });
  assert.match(repaired.article.content_markdown, /Van Finance Company provides this guide/);
  assert.match(repaired.article.content_markdown, /https:\/\/www\.vanfinancecompany\.co\.uk/);
  assert.doesNotMatch(repaired.article.content_markdown, /van ownership Company|vanRent2Buy|lease Rent2Buy/i);
  assert.match(repaired.article.content_markdown, new RegExp(filler.slice(0, 50)));
});

test("Markdown and accepted link destinations remain immutable", () => {
  const original = pureArticle({ content_markdown: unsafeBody, internal_link_suggestions: [{ id: "link-1", anchor_text: "Traditional finance options", destination_url: "https://www.vanfinancecompany.co.uk", status: "accepted" }] });
  const preview = buildCorrectionPreview({ originalArticle: original, proposed: { ...original, changes: [], removed_links: [], manual_confirmation_required: [], removed_sections: [], removal_reasons: [], removed_section_word_counts: [] }, safetyOptions: { ignoreAssessmentFreshness: true }, scopeOverride: "rent2buy" });
  assert.equal(preview.after.internal_link_suggestions[0].destination_url, "https://www.vanfinancecompany.co.uk");
  assert.match(preview.after.content_markdown, /\[our website\]\(https:\/\/www\.vanfinancecompany\.co\.uk\)/);
  assert.equal(preview.protected_values_valid, true);
});

test("protected-value validator blocks URL mutation", () => {
  const before = pureArticle({ content_markdown: "Visit https://www.vanfinancecompany.co.uk" });
  const after = pureArticle({ content_markdown: "Visit https://www.vanRent2Buycompany.co.uk" });
  const result = validateProtectedValues(before, after);
  assert.equal(result.protected_values_valid, false);
  assert.ok(result.protected_value_errors.includes("Correction attempted to alter a protected link."));
});

test("grammar validation rejects known replacement corruption", () => {
  for (const phrase of ["without the usual the Rent2Buy eligibility process", "Rent2Buy is not a arrangements", "Van ownership Company", "lease Rent2Buy", "https://www.vanRent2Buycompany.co.uk"]) {
    assert.equal(validateTargetedRepairText(pureArticle({ excerpt: phrase })).targeted_repair_text_valid, false, phrase);
  }
});

test("lease finance is removed by complete sentence rewrite", () => {
  const original = pureArticle({ content_markdown: `${pureBody}\n\n## Eligibility\n\nSome readers may be considering lease finance for a van.` });
  const repaired = applyTargetedRent2BuyRepairs(original, validateRent2BuySemantics(original).rent2buy_semantic_errors, { scopeOverride: "rent2buy" });
  assert.doesNotMatch(repaired.article.content_markdown, /lease finance|lease Rent2Buy/i);
  assert.match(repaired.article.content_markdown, /Rent2Buy eligibility, agreement terms and payment requirements/);
});

test("unrecognised unsafe phrase remains unresolved rather than corrupted", () => {
  const original = pureArticle({ content_markdown: `${pureBody}\n\n## Eligibility\n\nThis guide is for customers new to finance.` });
  const preview = buildCorrectionPreview({ originalArticle: original, proposed: { ...original, changes: [], removed_links: [], manual_confirmation_required: [], removed_sections: [], removal_reasons: [], removed_section_word_counts: [] }, safetyOptions: { ignoreAssessmentFreshness: true }, scopeOverride: "rent2buy" });
  assert.match(preview.after.content_markdown, /new to finance/);
  assert.equal(preview.rent2buy_semantic_valid, false);
  assert.equal(preview.correction_complete, false);
});

test("FAQ finance wording is rewritten without token substitution", () => { const original = pureArticle({ faq_json: unsafeFaqs }); const repaired = applyTargetedRent2BuyRepairs(original, validateRent2BuySemantics(original).rent2buy_semantic_errors, { scopeOverride: "rent2buy" }); assert.ok(repaired.article.faq_json.some((faq) => faq.question === "How does Rent2Buy eligibility work?")); assert.ok(repaired.article.faq_json.some((faq) => faq.question === "Where are Rent2Buy vans collected?" && faq.answer === RENT2BUY_COLLECTION_SENTENCE)); assert.ok(repaired.article.faq_json.some((faq) => faq.question === "Are eligibility or vehicle availability guaranteed?")); assert.doesNotMatch(JSON.stringify(repaired.article.faq_json), /free delivery|finance approval|specific rates/i); });

test("approved sentences and Markdown numbering are preserved", () => { const original = pureArticle({ content_markdown: unsafeBody }); const repaired = applyTargetedRent2BuyRepairs(original, validateRent2BuySemantics(original).rent2buy_semantic_errors, { scopeOverride: "rent2buy" }); assert.match(repaired.article.content_markdown, new RegExp(RENT2BUY_SEPARATION_SENTENCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))); assert.equal(repaired.article.content_markdown.split(RENT2BUY_COLLECTION_SENTENCE).length - 1, 1); assert.match(repaired.article.content_markdown, /1\. Apply\n2\. Review the vehicle details/); });

test("safe second pass validates repaired object and can complete", () => {
  const original = pureArticle({ content_markdown: unsafeBody, faq_json: unsafeFaqs, meta_description: "Traditional finance options are discussed.", excerpt: "Unlike traditional finance, this works differently.", cta: "Start a finance application." });
  const proposed = { ...original, changes: ["AI attempted correction"], removed_links: [], manual_confirmation_required: [], removed_sections: [], removal_reasons: [], removed_section_word_counts: [] };
  const preview = buildCorrectionPreview({ originalArticle: original, proposed, safetyOptions: { ignoreAssessmentFreshness: true }, scopeOverride: "rent2buy" });
  assert.equal(preview.targeted_repairs_applied, true);
  assert.equal(preview.rent2buy_semantic_valid, true);
  assert.equal(preview.protected_values_valid, true);
  assert.equal(preview.targeted_repair_text_valid, true);
  assert.deepEqual(preview.remaining_semantic_errors, []);
  assert.equal(preview.correction_complete, true);
});

test("normalisation preserves saved source and performs no Wix approval", () => { const original = pureArticle({ generation_metadata: { product_scope_override: "rent2buy" } }); const snapshot = structuredClone(original); const normalized = normalizeCorrectionProposal(original, { ...original, content_markdown: pureBody, changes: [], removed_links: [], manual_confirmation_required: [], removed_sections: [], removal_reasons: [], removed_section_word_counts: [] }).corrected_article; assert.deepEqual(original, snapshot); assert.equal(normalized.generation_metadata.product_scope_override, "rent2buy"); assert.equal(original.wix_sync_status, undefined); assert.notEqual(original.status, "approved"); });

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
const pureBody = `## Introduction\n\n${RENT2BUY_SEPARATION_SENTENCE}\n\n${filler}\n\n## Key Features and Benefits\n\n${RENT2BUY_COLLECTION_SENTENCE}\n\n## Practical Next Steps\n\n1. Apply\n2. Review eligibility\n3. Collect the vehicle\n\nApply for Rent2Buy`;
const pureArticle = (overrides = {}) => ({ id: "r2b", title: "What You Need to Know About Rent2Buy Vans in the UK", seo_title: "Rent2Buy vans in the UK", meta_description: "Rent2Buy agreement information", excerpt: "Review eligibility and agreement terms.", category: "Rent2Buy", article_type: "guide", content_markdown: pureBody, faq_json: [], cta: "Apply for Rent2Buy", internal_link_suggestions: [], generation_metadata: {}, ...overrides });
const proposalFor = (article) => ({ ...article, changes: [], removed_links: [], manual_confirmation_required: [], removed_sections: [], removal_reasons: [], removed_section_word_counts: [] });

const finalUnsafeBody = `## Introduction\n\n${RENT2BUY_SEPARATION_SENTENCE}\n\nThis can help, making it a viable option if you have bad credit or are new to finance.\n\nVan Finance Company provides this guide. Visit [our website](https://www.vanfinancecompany.co.uk).\n\n${filler}\n\n## Key Features and Benefits\n\n${RENT2BUY_COLLECTION_SENTENCE}\n\nThe process avoids traditional credit checks in some circumstances.\n\n## Who It May Suit\n\n- You need flexibility to test a van before buying.\n- The arrangement is clearly documented.\n\n## Practical Next Steps\n\n1. Apply\n2. Review the details, allowing you to test if the van meets your business or personal requirements.\n3. Collect the vehicle\n\n## Summary\n\nReview all terms.\n\nApply for Rent2Buy\n\n**${RENT2BUY_SEPARATION_SENTENCE} ${RENT2BUY_COLLECTION_SENTENCE}**`;

function explicitErrors(article) {
  const entries = [
    ["Introduction", "new to finance", "finance"],
    ["Key Features and Benefits", "traditional credit checks", "finance"],
    ["Who It May Suit", "test a van before buying", "trial"],
    ["Practical Next Steps", "test if the van meets your business or personal requirements", "trial"],
  ];
  return entries.map(([section, phrase, category]) => ({ field: "Article body", section, phrase, category, excerpt: phrase, product_context: "rent2buy" }));
}

test("scope and comparison gates remain unchanged", () => {
  assert.equal(classifyArticleProduct(pureArticle()), "rent2buy");
  const comparison = { ...pureArticle(), title: "Rent2Buy vs Van Finance: Which Is Right for You?", category: "Comparison", article_type: "comparison", content_markdown: `## Van Finance\n\nAPR may apply.\n\n## Rent2Buy\n\n${RENT2BUY_SEPARATION_SENTENCE}\n\n${RENT2BUY_COLLECTION_SENTENCE}` };
  assert.equal(classifyArticleProduct(comparison), "both");
  assert.equal(validateComparisonStructure(comparison, { scopeOverride: "both" }).comparison_structure_valid, true);
  assert.equal(evaluateRent2BuyRule(comparison, { scopeOverride: "both" }).rent2buy_semantic_valid, true);
});

test("new-to-finance wording is rewritten exactly", () => {
  const original = pureArticle({ content_markdown: finalUnsafeBody });
  const repaired = applyTargetedRent2BuyRepairs(original, explicitErrors(original), { scopeOverride: "rent2buy" }).article;
  assert.doesNotMatch(repaired.content_markdown, /new to finance/i);
  assert.match(repaired.content_markdown, /making it accessible to applicants with a range of credit histories, subject to the Rent2Buy eligibility process\./);
});

test("test wording is removed from body and bullet without altering unrelated bullet", () => {
  const original = pureArticle({ content_markdown: finalUnsafeBody });
  const repaired = applyTargetedRent2BuyRepairs(original, explicitErrors(original), { scopeOverride: "rent2buy" }).article;
  assert.doesNotMatch(repaired.content_markdown, /test if the van|test a van before buying/i);
  assert.match(repaired.content_markdown, /- You are looking for a rent-to-own arrangement with clearly defined agreement terms\./);
  assert.match(repaired.content_markdown, /- The arrangement is clearly documented\./);
  assert.match(repaired.content_markdown, /2\. Review the vehicle details and agreement terms carefully before proceeding\./);
});

test("traditional credit checks are rewritten narrowly", () => {
  const original = pureArticle({ content_markdown: finalUnsafeBody });
  const repaired = applyTargetedRent2BuyRepairs(original, explicitErrors(original), { scopeOverride: "rent2buy" }).article;
  assert.doesNotMatch(repaired.content_markdown, /traditional credit checks/i);
  assert.match(repaired.content_markdown, /The process avoids the usual credit checks in some circumstances\./);
});

test("required statements are deduplicated and remain before summary and CTA", () => {
  const original = pureArticle({ content_markdown: finalUnsafeBody });
  const repaired = applyTargetedRent2BuyRepairs(original, explicitErrors(original), { scopeOverride: "rent2buy" }).article.content_markdown;
  assert.equal(repaired.split(RENT2BUY_SEPARATION_SENTENCE).length - 1, 1);
  assert.equal(repaired.split(RENT2BUY_COLLECTION_SENTENCE).length - 1, 1);
  assert.ok(repaired.indexOf(RENT2BUY_SEPARATION_SENTENCE) < repaired.indexOf("## Key Features and Benefits"));
  assert.ok(repaired.indexOf(RENT2BUY_COLLECTION_SENTENCE) < repaired.indexOf("## Summary"));
  assert.doesNotMatch(repaired, /\*\*\s*\*\*/);
  assert.doesNotMatch(repaired, new RegExp(`\\*\\*${RENT2BUY_SEPARATION_SENTENCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

test("unchanged visible and Markdown URLs pass protected-value validation", () => {
  const before = pureArticle({ content_markdown: `Visit [our website](https://www.vanfinancecompany.co.uk).` });
  const after = structuredClone(before);
  const result = validateProtectedValues(before, after);
  assert.equal(result.protected_values_valid, true);
  assert.deepEqual(result.protected_value_errors, []);
  assert.equal(validateTargetedRepairText(after).targeted_repair_text_valid, true);
});

test("URL mutation reports exact field, values and error type", () => {
  const before = pureArticle({ content_markdown: "Visit https://www.vanfinancecompany.co.uk" });
  const after = pureArticle({ content_markdown: "Visit https://www.vanRent2Buycompany.co.uk" });
  const result = validateProtectedValues(before, after);
  assert.equal(result.protected_values_valid, false);
  const error = result.protected_value_errors.find((item) => item.error_type === "url_changed");
  assert.equal(error.field, "Article body");
  assert.equal(error.original_protected_value, "https://www.vanfinancecompany.co.uk");
  assert.equal(error.proposed_protected_value, "https://www.vanRent2Buycompany.co.uk");
  assert.match(error.excerpt, /vanRent2Buycompany/);
});

test("empty internal-link arrays do not create URL failures", () => {
  const before = pureArticle({ internal_link_suggestions: [] });
  const after = structuredClone(before);
  assert.equal(validateProtectedValues(before, after).protected_values_valid, true);
});

test("anchor changes cannot alter accepted link destination", () => {
  const before = pureArticle({ internal_link_suggestions: [{ id: "one", anchor_text: "Old anchor", destination_url: "https://www.vanfinancecompany.co.uk", status: "accepted" }] });
  const normalized = normalizeCorrectionProposal(before, { ...before, internal_link_suggestions: [{ anchor_text: "New Rent2Buy anchor", destination_url: "https://example.com" }] }).corrected_article;
  assert.equal(normalized.internal_link_suggestions[0].anchor_text, "New Rent2Buy anchor");
  assert.equal(normalized.internal_link_suggestions[0].destination_url, "https://www.vanfinancecompany.co.uk");
  assert.equal(validateProtectedValues(before, normalized, { titleTargeted: true }).protected_values_valid, true);
});

test("known replacement corruption remains blocked", () => {
  for (const phrase of ["without the usual the process", "Rent2Buy is not a arrangements", "Van ownership Company", "lease Rent2Buy"]) assert.equal(validateTargetedRepairText(pureArticle({ excerpt: phrase })).targeted_repair_text_valid, false);
});

test("complete repaired proposal reruns all validators", () => {
  const original = pureArticle({ content_markdown: finalUnsafeBody });
  const proposed = proposalFor(original);
  const preview = buildCorrectionPreview({ originalArticle: original, proposed, safetyOptions: { ignoreAssessmentFreshness: true }, scopeOverride: "rent2buy" });
  assert.equal(preview.markdown_structure_valid, true);
  assert.equal(preview.protected_values_valid, true);
  assert.equal(preview.targeted_repair_text_valid, true);
  assert.equal(preview.after.internal_link_suggestions.length, 0);
});

test("original article remains unchanged and no automatic Wix approval occurs", () => {
  const original = pureArticle({ content_markdown: finalUnsafeBody, generation_metadata: { product_scope_override: "rent2buy" } });
  const snapshot = structuredClone(original);
  normalizeCorrectionProposal(original, proposalFor(original));
  assert.deepEqual(original, snapshot);
  assert.equal(original.wix_sync_status, undefined);
  assert.notEqual(original.status, "approved");
});

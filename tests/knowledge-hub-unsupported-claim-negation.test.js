import test from "node:test";
import assert from "node:assert/strict";

import { calculateKnowledgeQualityChecks } from "../lib/knowledgeHub.js";

function unsupportedClaimCheck(content) {
  return calculateKnowledgeQualityChecks({
    title: "Knowledge Hub Quality Check Test",
    excerpt: "Regression fixture for Knowledge Hub claim validation.",
    seo_title: "Knowledge Hub Quality Check Test Article",
    meta_description: "Regression fixture used to verify that explicit non-guarantee wording is not mistaken for an unsupported positive guarantee.",
    content_markdown: content,
    faq_json: [],
    cta: "Apply when ready.",
  }).find((check) => check.key === "unsupported_claim");
}

test("explicit non-guarantee wording is not treated as an unsupported positive guarantee", () => {
  assert.equal(unsupportedClaimCheck("## Approval\n\nApproval is never guaranteed and remains subject to lender criteria.")?.pass, true);
  assert.equal(unsupportedClaimCheck("## Approval\n\nApproval is not guaranteed and remains subject to lender criteria.")?.pass, true);
  assert.equal(unsupportedClaimCheck("## Approval\n\nThere is no guarantee of approval.")?.pass, true);
});

test("a positive guaranteed-approval claim remains blocked", () => {
  assert.equal(unsupportedClaimCheck("## Approval\n\nApproval is guaranteed for every applicant.")?.pass, false);
});

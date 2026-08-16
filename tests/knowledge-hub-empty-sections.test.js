import test from "node:test";
import assert from "node:assert/strict";

import { calculateKnowledgeQualityChecks } from "../lib/knowledgeHub.js";

function qualityCheck(content, key) {
  return calculateKnowledgeQualityChecks({
    title: "Knowledge Hub Quality Check Test",
    excerpt: "Regression fixture for Knowledge Hub section validation.",
    seo_title: "Knowledge Hub Quality Check Test Article",
    meta_description:
      "Regression fixture used to verify that normal Markdown structure and careful disclaimer wording are classified correctly.",
    content_markdown: content,
    faq_json: [],
    cta: "Apply when ready.",
  }).find((check) => check.key === key);
}

test("normal blank lines after Markdown headings do not create false empty-section failures", () => {
  const check = qualityCheck(`# Main heading

This introduction contains real content beneath the main heading.

## What happens next?

This section also contains real content after a normal blank line.

## Final section

This final section has content too.`, "empty_sections");

  assert.equal(check?.pass, true);
});

test("a parent heading may contain populated child subsections", () => {
  const check = qualityCheck(`# Main heading

Introduction content.

## Frequently Asked Questions

### Can I apply?

Yes, subject to assessment.

### Is approval guaranteed?

No. Approval is never guaranteed.`, "empty_sections");

  assert.equal(check?.pass, true);
});

test("a heading followed only by another heading at the same level is still empty", () => {
  const check = qualityCheck(`# Main heading

Introduction content.

## Empty section

## Populated section

This section contains content.`, "empty_sections");

  assert.equal(check?.pass, false);
});

test("a trailing heading with no content is treated as an empty section", () => {
  const check = qualityCheck(`# Main heading

Introduction content.

## Trailing empty section`, "empty_sections");

  assert.equal(check?.pass, false);
});

test("explicit non-guarantee wording is not mistaken for an unsupported guarantee", () => {
  assert.equal(qualityCheck("## Approval\n\nApproval is never guaranteed and remains subject to lender criteria.", "unsupported_claim")?.pass, true);
  assert.equal(qualityCheck("## Approval\n\nApproval is not guaranteed and remains subject to lender criteria.", "unsupported_claim")?.pass, true);
  assert.equal(qualityCheck("## Approval\n\nThere is no guarantee of approval.", "unsupported_claim")?.pass, true);
});

test("a positive guaranteed-approval claim remains blocked", () => {
  assert.equal(qualityCheck("## Approval\n\nApproval is guaranteed for every applicant.", "unsupported_claim")?.pass, false);
});

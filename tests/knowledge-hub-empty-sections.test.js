import test from "node:test";
import assert from "node:assert/strict";

import { calculateKnowledgeQualityChecks } from "../lib/knowledgeHub.js";

function emptySectionCheck(content) {
  return calculateKnowledgeQualityChecks({
    title: "Knowledge Hub Quality Check Test",
    excerpt: "Regression fixture for Knowledge Hub section validation.",
    seo_title: "Knowledge Hub Quality Check Test Article",
    meta_description:
      "Regression fixture used to verify that normal Markdown heading spacing is not mistaken for an empty Knowledge Hub section.",
    content_markdown: content,
    faq_json: [],
    cta: "Apply now.",
  }).find((check) => check.key === "empty_sections");
}

test("normal blank lines after Markdown headings do not create false empty-section failures", () => {
  const check = emptySectionCheck(`# Main heading

This introduction contains real content beneath the main heading.

## What happens next?

This section also contains real content after a normal blank line.

## Final section

This final section has content too.`);

  assert.equal(check?.pass, true);
});

test("a heading followed only by another heading is still treated as an empty section", () => {
  const check = emptySectionCheck(`# Main heading

Introduction content.

## Empty section

## Populated section

This section contains content.`);

  assert.equal(check?.pass, false);
});

test("a trailing heading with no content is treated as an empty section", () => {
  const check = emptySectionCheck(`# Main heading

Introduction content.

## Trailing empty section`);

  assert.equal(check?.pass, false);
});

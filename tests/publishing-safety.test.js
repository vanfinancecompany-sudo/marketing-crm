import test from "node:test";
import assert from "node:assert/strict";
import {
  auditPublishedArticles,
  evaluatePublishingSafety,
} from "../lib/publishingSafety.js";

const now = "2026-07-27T10:00:00.000Z";
const assessment = {
  article_id: "article-1",
  created_at: now,
  content_hash: "clean-hash",
  overall_score: 97,
};

function cleanArticle(overrides = {}) {
  return {
    id: "article-1",
    title: "How Van Finance Works for UK Businesses",
    status: "draft",
    updated_at: "2026-07-27T09:00:00.000Z",
    content_hash: "clean-hash",
    content_markdown: `## Understanding van finance

Van finance can help a business spread the cost of a suitable commercial vehicle while retaining working capital. The correct option depends on the applicant, the vehicle and the lender's assessment.

## What lenders normally consider

Lenders may review trading history, affordability, credit information and the proposed vehicle. Requirements vary, so applicants should provide accurate information and respond to requests for supporting evidence.

## Comparing suitable options

A useful comparison looks beyond a headline monthly figure. It considers the total amount payable, deposit, term, ownership position and any conditions that apply at the end of the agreement.

## Preparing an application

Applicants should check their business details, contact information and vehicle choice before submitting an application. Clear information helps the finance team assess the enquiry and explain the next available step.

## Questions to ask before proceeding

Ask who the lender is, how repayments are calculated, whether there are fees, and what happens if circumstances change. Read the finance documents carefully before accepting an agreement.

## Next step

Review the available vans and submit an application when the vehicle and finance route are suitable for your business.`,
    content_html: "<h2>Understanding van finance</h2><p>Van finance can help a business spread the cost.</p>",
    faq_json: [],
    cta: "View available vans",
    cta_destination: "/vans-on-finance",
    ...overrides,
  };
}

test("repeated article title creates a hard block", () => {
  const article = cleanArticle({
    content_markdown: `# How Van Finance Works for UK Businesses\n\n${cleanArticle().content_markdown}`,
  });
  const result = evaluatePublishingSafety(article, { assessment });
  assert.equal(result.hard_blocked, true);
  assert.ok(result.hard_block_reasons.includes("Duplicate title or heading detected."));
});

test("duplicate FAQ sections create a hard block", () => {
  const article = cleanArticle({
    content_markdown: `${cleanArticle().content_markdown}\n\n## FAQs\n\nWhat is van finance? It is a way to fund a commercial vehicle.\n\n## Frequently Asked Questions\n\nWhat is van finance? It is a way to fund a commercial vehicle.`,
  });
  const result = evaluatePublishingSafety(article, { assessment });
  assert.ok(result.hard_block_reasons.includes("Duplicate or repeated article sections detected."));
});

test("visible raw markdown creates a hard block", () => {
  const article = cleanArticle({
    preview_text: "## Heading **bold text** [Apply](https://example.com)",
  });
  const result = evaluatePublishingSafety(article, { assessment });
  assert.ok(result.hard_block_reasons.includes("Unprocessed formatting or raw markdown detected."));
});

test("malformed links create a hard block", () => {
  const article = cleanArticle({
    content_markdown: `${cleanArticle().content_markdown}\n\n[Apply now](javascript:alert(1))`,
  });
  const result = evaluatePublishingSafety(article, { assessment });
  assert.ok(result.hard_block_reasons.includes("Broken or malformed link detected."));
});

test("stale assessment creates a hard block", () => {
  const article = cleanArticle({
    updated_at: "2026-07-27T11:00:00.000Z",
    content_hash: "changed-hash",
  });
  const result = evaluatePublishingSafety(article, { assessment });
  assert.ok(result.hard_block_reasons.includes("Article content changed after assessment. Reanalyse before approval."));
});

test("unsupported finance claim requires confirmation", () => {
  const article = cleanArticle({
    content_markdown: `${cleanArticle().content_markdown}\n\n## Fast decisions\n\nEvery applicant is guaranteed approval within 60 minutes.`,
  });
  const result = evaluatePublishingSafety(article, { assessment, businessKnowledge: [] });
  assert.equal(result.requires_manual_claim_review, true);
  assert.ok(result.hard_block_reasons.includes("Unverified financial or business claim requires confirmation."));
});

test("excessive repetition creates a hard block", () => {
  const repeated = "Van finance can help your business choose a van and spread the cost responsibly.";
  const article = cleanArticle({
    content_markdown: `## Introduction\n\n${repeated} ${repeated} ${repeated} ${repeated}\n\n## Details\n\n${repeated} ${repeated} ${repeated} ${repeated}`,
  });
  const result = evaluatePublishingSafety(article, { assessment });
  assert.ok(result.hard_block_reasons.includes("Excessive repetition or templated wording detected."));
});

test("clean article passes all hard checks", () => {
  const result = evaluatePublishingSafety(cleanArticle(), { assessment });
  assert.equal(result.hard_blocked, false);
  assert.equal(result.formatting_hygiene_passed, true);
  assert.equal(result.requires_manual_claim_review, false);
  assert.equal(result.recommended_action, "Publish");
});

test("a 95 plus score cannot override a hard block", () => {
  const article = cleanArticle({ preview_text: "**raw markdown**" });
  const result = evaluatePublishingSafety(article, { assessment: { ...assessment, overall_score: 99 } });
  assert.equal(result.hard_blocked, true);
  assert.equal(result.recommended_action, "Hold — corrections required");
});

test("exported articles remain auditable outside the Approval Queue", () => {
  const exported = cleanArticle({ id: "exported", status: "exported", preview_text: "**raw markdown**" });
  const result = auditPublishedArticles({
    articles: [cleanArticle({ id: "draft", status: "draft" }), exported],
    assessments: [{ ...assessment, article_id: "exported" }],
  });
  assert.deepEqual(result.map((item) => item.article.id), ["exported"]);
});

test("published audit does not alter article status or content", () => {
  const article = cleanArticle({ status: "approved", preview_text: "**raw markdown**" });
  const snapshot = JSON.stringify(article);
  const result = auditPublishedArticles({ articles: [article], assessments: [assessment] });
  assert.equal(result.length, 1);
  assert.equal(JSON.stringify(article), snapshot);
  assert.equal(article.status, "approved");
});

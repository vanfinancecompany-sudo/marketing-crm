import test from "node:test";
import assert from "node:assert/strict";
import { auditPublishedArticles, evaluatePublishingSafety } from "../lib/publishingSafety.js";

const now = "2026-07-27T10:00:00.000Z";
const assessment = { article_id: "article-1", created_at: now, content_hash: "clean-hash", overall_score: 97 };
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
    generation_metadata: {},
    ...overrides,
  };
}

for (const [name, article, expected] of [
  ["duplicate title", cleanArticle({ content_markdown: `# How Van Finance Works for UK Businesses\n\n${cleanArticle().content_markdown}` }), "Duplicate title or heading detected."],
  ["duplicate FAQ sections", cleanArticle({ content_markdown: `${cleanArticle().content_markdown}\n\n## FAQs\n\nAnswer one.\n\n## Frequently Asked Questions\n\nAnswer two.` }), "Duplicate or repeated article sections detected."],
  ["rendered raw Markdown", cleanArticle({ preview_text: "## Heading **bold text**" }), "Unprocessed formatting or raw markdown detected."],
  ["stale analysis", cleanArticle({ updated_at: "2026-07-27T11:00:00.000Z", content_hash: "changed-hash" }), "Article content changed after assessment. Reanalyse before approval."],
  ["claim review", cleanArticle({ content_markdown: `${cleanArticle().content_markdown}\n\nEvery applicant is guaranteed approval within 60 minutes.` }), "Unverified financial or business claim requires confirmation."],
]) {
  test(`${name} is advisory`, () => {
    const result = evaluatePublishingSafety(article, { assessment, businessKnowledge: [] });
    assert.equal(result.hard_blocked, false);
    assert.ok(result.review_warnings.includes(expected));
    assert.equal(result.status, "warnings");
    assert.equal(result.recommended_action, "Warnings — review before sending");
  });
}

test("malformed link remains a catastrophic technical block", () => {
  const result = evaluatePublishingSafety(cleanArticle({ content_markdown: `${cleanArticle().content_markdown}\n\n[Apply now](javascript:alert(1))` }), { assessment });
  assert.equal(result.hard_blocked, true);
  assert.ok(result.hard_block_reasons.includes("Broken or malformed link detected."));
  assert.equal(result.status, "technical_error");
});

test("empty article remains a catastrophic technical block", () => {
  const result = evaluatePublishingSafety(cleanArticle({ content_markdown: "" }), { assessment });
  assert.equal(result.hard_blocked, true);
  assert.ok(result.hard_block_reasons.includes("Article body is empty."));
});

test("clean article is ready to send to Wix", () => {
  const result = evaluatePublishingSafety(cleanArticle(), { assessment });
  assert.equal(result.hard_blocked, false);
  assert.equal(result.warning_count, 0);
  assert.equal(result.recommended_action, "Ready to send to Wix");
});

test("published warnings remain auditable without changing article", () => {
  const article = cleanArticle({ status: "approved", preview_text: "**raw markdown**" });
  const snapshot = JSON.stringify(article);
  const result = auditPublishedArticles({ articles: [article], assessments: [assessment] });
  assert.equal(result.length, 1);
  assert.equal(JSON.stringify(article), snapshot);
});

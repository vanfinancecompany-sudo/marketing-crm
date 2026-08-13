import test from "node:test";
import assert from "node:assert/strict";
import {
  HISTORIC_LINK_RETROFIT_SEED_EXCLUSIONS,
  compactHistoricSuggestion,
  sourceSnippetsForSuggestion,
  validateHistoricBatchDecisions,
} from "../lib/historicLinkBulkWorkflow.js";

test("seed exclusions contain the five new articles and completed historic Batch 1", () => {
  assert.equal(HISTORIC_LINK_RETROFIT_SEED_EXCLUSIONS.includes("690ba19c-307c-47f3-b1c7-075d76512cab"), true);
  assert.equal(HISTORIC_LINK_RETROFIT_SEED_EXCLUSIONS.includes("cc4a7ff8-811f-4198-b8af-2ec9bf9415cd"), true);
  assert.equal(HISTORIC_LINK_RETROFIT_SEED_EXCLUSIONS.includes("7c47fb62-22d5-4aab-a6ca-fa5b1aa5db7b"), true);
});

test("compact suggestion reports exact anchor state and useful source snippets", () => {
  const markdown = "Choosing the right van matters for payload and load space.\n\nCompare available vans before making a final choice.";
  const compact = compactHistoricSuggestion(markdown, {
    id: "s1",
    status: "pending",
    target_type: "website_page",
    destination_title: "VIEW VANS | VAN FINANCE",
    destination_url: "https://www.vanfinancecompany.co.uk/vans-on-finance",
    anchor_text: "Compare available vans",
    confidence_score: 74,
    reason: "Stock next step",
  });
  assert.equal(compact.anchor_found, true);
  assert.equal(compact.anchor_match_count, 1);
  assert.ok(compact.source_snippets.some((item) => item.includes("Compare available vans")));
});

test("source snippets omit headings, tables and fully formatted CTA lines", () => {
  const markdown = "# Used Van Guide\n\n| Type | Payload |\n| --- | --- |\n| Luton | High |\n\n**Browse available vans now.**\n\nA compact van can be easier to park while still carrying the tools you need.";
  const snippets = sourceSnippetsForSuggestion(markdown, {
    destination_title: "Small and Medium Vans for Business",
    destination_url: "/knowledge-hub-articles/small-vs-medium-vans-business",
  });
  assert.equal(snippets.some((item) => item.includes("Browse available vans")), false);
  assert.equal(snippets.some((item) => item.includes("Payload")), false);
  assert.equal(snippets.some((item) => item.includes("compact van")), true);
});

test("batch decisions require suggestion ownership and legal transitions", () => {
  const suggestions = [
    { id: "pending-1", status: "pending" },
    { id: "accepted-1", status: "accepted" },
  ];
  assert.equal(validateHistoricBatchDecisions({
    articleId: "article-1",
    suggestions,
    decisions: [
      { suggestion_id: "pending-1", decision: "reject" },
      { suggestion_id: "accepted-1", decision: "edit_anchor", anchor_text: "existing phrase" },
    ],
  }), true);
  assert.throws(() => validateHistoricBatchDecisions({ articleId: "article-1", suggestions, decisions: [{ suggestion_id: "missing", decision: "reject" }] }), /does not belong/i);
  assert.throws(() => validateHistoricBatchDecisions({ articleId: "article-1", suggestions, decisions: [{ suggestion_id: "accepted-1", decision: "accept" }] }), /Only pending/i);
});

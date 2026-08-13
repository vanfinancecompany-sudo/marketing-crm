import test from "node:test";
import assert from "node:assert/strict";
import { planInternalLinkSuggestionWrites } from "../lib/internalLinkingService.js";

const makeSuggestion = (website_page_id) => ({ website_page_id });

test("revives same-hash superseded suggestion instead of inserting", () => {
  const sourceHash = "hash";
  const plan = planInternalLinkSuggestionWrites({
    suggestions: [makeSuggestion("stock")],
    existing: [{ id: "old", website_page_id: "stock", source_content_hash: sourceHash, status: "superseded" }],
    sourceHash,
  });
  assert.equal(plan.revive.length, 1);
  assert.equal(plan.revive[0].existing.id, "old");
  assert.equal(plan.insert.length, 0);
});

test("accepted and rejected destinations are protected", () => {
  const sourceHash = "hash";
  const plan = planInternalLinkSuggestionWrites({
    suggestions: [makeSuggestion("stock"), makeSuggestion("home")],
    existing: [
      { id: "a", website_page_id: "stock", source_content_hash: sourceHash, status: "accepted" },
      { id: "r", website_page_id: "home", source_content_hash: sourceHash, status: "rejected" },
      { id: "s1", website_page_id: "stock", source_content_hash: sourceHash, status: "superseded" },
      { id: "s2", website_page_id: "home", source_content_hash: sourceHash, status: "superseded" },
    ],
    sourceHash,
  });
  assert.equal(plan.revive.length, 0);
  assert.equal(plan.insert.length, 0);
});

test("unseen destination still inserts", () => {
  const sourceHash = "hash";
  const plan = planInternalLinkSuggestionWrites({
    suggestions: [makeSuggestion("new")],
    existing: [],
    sourceHash,
  });
  assert.deepEqual(plan.insert.map((item) => item.website_page_id), ["new"]);
});

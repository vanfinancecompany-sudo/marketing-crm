import test from "node:test";
import assert from "node:assert/strict";
import {
  findInternalLinkAnchorMatches,
  suggestInternalLinkAnchor,
} from "../lib/internalLinkAnchorValidation.js";

test("finds an exact anchor in the current article and returns an excerpt", () => {
  const markdown = "## Applying for finance\n\nYou can apply for van finance once you have chosen a suitable vehicle.";
  const result = findInternalLinkAnchorMatches(markdown, "apply for van finance");
  assert.equal(result.found, true);
  assert.equal(result.match_count, 1);
  assert.match(result.excerpts[0].excerpt, /apply for van finance/i);
});

test("matches anchor text case-insensitively while preserving the article wording", () => {
  const result = findInternalLinkAnchorMatches("Van Finance can support a second vehicle.", "van finance");
  assert.equal(result.found, true);
  assert.equal(result.excerpts[0].matched_text, "Van Finance");
});

test("does not treat a partial word as a valid anchor", () => {
  const result = findInternalLinkAnchorMatches("The application process is straightforward.", "app");
  assert.equal(result.found, false);
  assert.equal(result.reason, "anchor_text_not_found");
});

test("reports multiple matches so the reviewer is warned", () => {
  const markdown = "Van finance is available. Compare van finance options before applying.";
  const result = findInternalLinkAnchorMatches(markdown, "van finance");
  assert.equal(result.found, true);
  assert.equal(result.match_count, 2);
  assert.equal(result.reason, "multiple_matches");
});

test("returns a clear not-found result for destination titles absent from the article", () => {
  const result = findInternalLinkAnchorMatches(
    "A second van may help when workloads increase.",
    "VAN FINANCE - APPLICATION FORM"
  );
  assert.deepEqual(
    { found: result.found, count: result.match_count, reason: result.reason },
    { found: false, count: 0, reason: "anchor_text_not_found" }
  );
});

test("rejects empty and one-character anchors", () => {
  assert.equal(findInternalLinkAnchorMatches("Article", "").reason, "anchor_too_short");
  assert.equal(findInternalLinkAnchorMatches("Article", "a").reason, "anchor_too_short");
});

test("selects a matching term already present in the article", () => {
  const result = suggestInternalLinkAnchor(
    "A growing business may need a second van when workloads increase.",
    'Matching term: “second van” in article body · Intent match',
    "VAN FINANCE - APPLICATION FORM"
  );
  assert.equal(result.found, true);
  assert.equal(result.anchor_text, "second van");
});

test("preserves the article casing for an automatically selected phrase", () => {
  const result = suggestInternalLinkAnchor(
    "Compare Van Finance options before choosing.",
    'Exact match: “van finance” in article body',
    "Van Finance Application"
  );
  assert.equal(result.found, true);
  assert.equal(result.anchor_text, "Van Finance");
});

test("does not invent an anchor when no candidate appears in the article", () => {
  const result = suggestInternalLinkAnchor(
    "A second vehicle may improve capacity.",
    'Matching term: “application” in article body',
    "VAN FINANCE - APPLICATION FORM"
  );
  assert.deepEqual(
    { found: result.found, anchor: result.anchor_text },
    { found: false, anchor: "" }
  );
});

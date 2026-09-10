import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("DealerKit human review detail endpoint is access-gated and source read-only", () => {
  const endpoint = fs.readFileSync(new URL("../api/dealerkit-stock-detail.js", import.meta.url), "utf8");
  assert.match(endpoint, /Marketing CRM access is required/);
  assert.match(endpoint, /fetchDealerKitStockDetail/);
  assert.match(endpoint, /specifications:\s*true/);
  assert.match(endpoint, /loadDealerKitReviewDecision/);
  assert.doesNotMatch(endpoint, /api\.dealerkit\.uk.*(?:POST|PATCH|PUT|DELETE)|wixapis/i);
});

test("DealerKit review workspace saves internal decisions but still exposes no publishing action", () => {
  const client = fs.readFileSync(new URL("../utils/dealerKitReviewWorkspace.js", import.meta.url), "utf8");
  assert.match(client, /DEALERKIT · REVIEW WORKSPACE/);
  assert.match(client, /Review vehicle/);
  assert.match(client, /dealerkit-stock-detail/);
  assert.match(client, /Save review/);
  assert.match(client, /publishing still locked/i);
  assert.doesNotMatch(client, /Publish to Wix|Update Wix vehicle|Send live/i);
});

test("DealerKit review workspace reads the registration from bounded comparison rows", () => {
  const client = fs.readFileSync(new URL("../utils/dealerKitReviewWorkspace.js", import.meta.url), "utf8");
  assert.match(client, /dealerkit-comparison__row/);
  assert.match(client, /dealerkit-comparison__row-top strong/);
  assert.match(client, /encodeURIComponent\(registration\)/);
});

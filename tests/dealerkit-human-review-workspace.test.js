import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("DealerKit human review endpoint is access-gated and read-only", () => {
  const endpoint = fs.readFileSync(new URL("../api/dealerkit-stock-detail.js", import.meta.url), "utf8");
  assert.match(endpoint, /Marketing CRM access is required/);
  assert.match(endpoint, /fetchDealerKitStockDetail/);
  assert.match(endpoint, /specifications:\s*true/);
  assert.doesNotMatch(endpoint, /\.insert\(|\.update\(|\.delete\(|PATCH|POST\s+https:\/\/api\.dealerkit/i);
});

test("DealerKit review workspace exposes review-only controls and no publishing actions", () => {
  const client = fs.readFileSync(new URL("../utils/dealerKitReviewWorkspace.js", import.meta.url), "utf8");
  assert.match(client, /DEALERKIT · REVIEW ONLY/);
  assert.match(client, /Nothing can be saved or published from here yet/);
  assert.match(client, /Review vehicle/);
  assert.match(client, /dealerkit-stock-detail/);
  assert.doesNotMatch(client, /Publish to Wix|Update Wix|Send to Rent2Buy|saveReview|persistReview/);
});

test("DealerKit review workspace reads the registration from bounded comparison rows", () => {
  const client = fs.readFileSync(new URL("../utils/dealerKitReviewWorkspace.js", import.meta.url), "utf8");
  assert.match(client, /dealerkit-comparison__row/);
  assert.match(client, /dealerkit-comparison__row-top strong/);
  assert.match(client, /encodeURIComponent\(registration\)/);
});

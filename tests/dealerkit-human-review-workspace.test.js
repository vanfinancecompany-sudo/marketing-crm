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

test("DealerKit review workspace saves internal decisions and opens by exact registration", () => {
  const client = fs.readFileSync(new URL("../utils/dealerKitReviewWorkspace.js", import.meta.url), "utf8");
  assert.match(client, /DEALERKIT · REVIEW WORKSPACE/);
  assert.match(client, /Review vehicle/);
  assert.match(client, /dealerkit-stock-detail/);
  assert.match(client, /Save review/);
  assert.match(client, /encodeURIComponent\(registration\)/);
});

test("DealerKit review workspace reads the registration from bounded comparison rows", () => {
  const client = fs.readFileSync(new URL("../utils/dealerKitReviewWorkspace.js", import.meta.url), "utf8");
  assert.match(client, /dealerkit-comparison__row/);
  assert.match(client, /dealerkit-comparison__row-top strong/);
  assert.match(client, /encodeURIComponent\(registration\)/);
});

test("Finance Missing from my stock cards expose the same DealerKit review workspace directly", () => {
  const bridge = fs.readFileSync(new URL("../utils/dealerKitMissingStockReviewBridge.js", import.meta.url), "utf8");
  const main = fs.readFileSync(new URL("../main.jsx", import.meta.url), "utf8");
  assert.match(main, /dealerKitMissingStockReviewBridge\.js/);
  assert.match(bridge, /\.vansco-card-grid \.vansco-card/);
  assert.match(bridge, /missing from my stock/);
  assert.match(bridge, /startsWith\("finance"\)/);
  assert.match(bridge, /Review vehicle/);
  assert.match(bridge, /dealerkit-comparison__row-top/);
  assert.match(bridge, /data-dealerkit-review-button/);
  assert.doesNotMatch(bridge, /dealerkit-stock-comparison/);
});

test("direct missing-stock review bridge does not mutate stock or Wix", () => {
  const bridge = fs.readFileSync(new URL("../utils/dealerKitMissingStockReviewBridge.js", import.meta.url), "utf8");
  assert.doesNotMatch(bridge, /\/api\/dealerkit-controlled-publish|\/wix-data\/|saveVanscoWatchAction|method:\s*["'](?:POST|PUT|PATCH|DELETE)/i);
});

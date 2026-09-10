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
  assert.match(bridge, /dealerkit-stock-comparison/);
  assert.match(bridge, /supplierStockId/);
  assert.match(bridge, /dealerkitStockId/);
});

test("direct missing-stock review bridge only reads comparison data and does not mutate stock or Wix", () => {
  const bridge = fs.readFileSync(new URL("../utils/dealerKitMissingStockReviewBridge.js", import.meta.url), "utf8");
  assert.match(bridge, /method:\s*"GET"/);
  assert.doesNotMatch(bridge, /\/api\/dealerkit-controlled-publish|\/wix-data\/|saveVanscoWatchAction|method:\s*["'](?:POST|PUT|PATCH|DELETE)/i);
});

test("product gallery workspace separates Finance and Rent2Buy, previews uploads and supports drag ordering", () => {
  const client = fs.readFileSync(new URL("../utils/dealerKitProductGalleryWorkspace.js", import.meta.url), "utf8");
  const main = fs.readFileSync(new URL("../main.jsx", import.meta.url), "utf8");
  assert.match(main, /dealerKitProductGalleryWorkspace\.js/);
  assert.match(client, /Van Finance/);
  assert.match(client, /Rent2Buy/);
  assert.match(client, /van_finance_replacement/);
  assert.match(client, /rent2buy_template/);
  assert.match(client, /URL\.createObjectURL/);
  assert.match(client, /draggable = true/);
  assert.match(client, /dragstart/);
  assert.match(client, /drop/);
  assert.match(client, /Save gallery changes/);
  assert.match(client, /dealerkit-review-decision/);
  assert.match(client, /dealerkit-wix-manual-media/);
  assert.match(client, /registered\.media/);
  assert.match(client, /preserveOnError:\s*true/);
  assert.match(client, /uploaded and saved to this product workspace/);
  assert.match(client, /observer\.observe\(document\.documentElement, \{ childList: true, subtree: true \}\)/);
  assert.doesNotMatch(client, /attributeFilter:\s*\["hidden"\]/);
});

test("product gallery workspace stores review/media choices but never calls the controlled Wix publish action", () => {
  const client = fs.readFileSync(new URL("../utils/dealerKitProductGalleryWorkspace.js", import.meta.url), "utf8");
  assert.doesNotMatch(client, /dealerkit-controlled-publish|Publish new vehicle to Wix|wix-data\/v2\/items|createDataItem|updateDataItem/i);
});

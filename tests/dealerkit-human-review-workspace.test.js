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

test("DealerKit review workspace opens the product selected by the Stock Watch tab", () => {
  const client = fs.readFileSync(new URL("../utils/dealerKitReviewWorkspace.js", import.meta.url), "utf8");
  assert.match(client, /DEALERKIT · REVIEW WORKSPACE/);
  assert.match(client, /Review vehicle/);
  assert.match(client, /dealerkit-stock-detail/);
  assert.match(client, /dealerkit-open-product-review/);
  assert.match(client, /workspace\.dataset\.product/);
  assert.match(client, /params\.set\("stockId"/);
});

test("DealerKit review workspace retains the guarded legacy comparison entry point", () => {
  const client = fs.readFileSync(new URL("../utils/dealerKitReviewWorkspace.js", import.meta.url), "utf8");
  assert.match(client, /dealerkit-comparison__row/);
  assert.match(client, /dealerkit-comparison__row-top strong/);
  assert.match(client, /new URLSearchParams\(\{ registration \}\)/);
});

test("Finance and Rent2Buy Missing cards pass their active product directly to review", () => {
  const page = fs.readFileSync(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url), "utf8");
  assert.match(page, /dealerkit-open-product-review/);
  assert.match(page, /supplierStockId:\s*record\.supplierStockId/);
  assert.match(page, /product:\s*selectedPipeline/);
  assert.match(page, /selectedPipeline === "finance" \|\| selectedPipeline === "rent2buy"/);
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
  assert.match(client, /"Save"/);
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

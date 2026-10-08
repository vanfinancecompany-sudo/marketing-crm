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

test("all advertised stock uses the Wix upload editor while DealerKit matches retain an explicit supplier refresh action", () => {
  const page = fs.readFileSync(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url), "utf8");
  assert.match(page, /const canRefreshAdvertFromDealerKit = isAdvertisedStockMaintenance/);
  assert.match(page, /dealerkit-open-product-review/);
  assert.match(page, /supplierStockId:\s*record\.supplierStockId/);
  assert.match(page, /product:\s*selectedPipeline/);
  assert.match(page, /advertisedWixRecord:\s*isAdvertisedStockMaintenance \? record\.currentWixAdvert : null/);
  assert.match(page, /const canReviewWix = isAdvertisedStockMaintenance/);
  assert.match(page, /function openDealerKitSourceReview\(\)/);
  assert.match(page, /wix-open-advert-image-editor/);
  assert.match(page, /Refresh from DealerKit/);
  const defaultReview = page.split("function openDealerKitReview()")[1].split("function openDealerKitSourceReview()")[0];
  assert.match(defaultReview, /if \(isAdvertisedStockMaintenance\)/);
  assert.match(defaultReview, /wix-open-advert-image-editor/);
  assert.doesNotMatch(defaultReview, /dealerkit-open-product-review/);
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


test("Stock Watch exposes live advertised stock as a separate maintenance view", () => {
  const page = fs.readFileSync(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url), "utf8");
  assert.match(page, /value: "advertised_stock", label: "All advertised stock"/);
  assert.match(page, /mapAdvertisedLocalVehicleToWatchRecord/);
  assert.match(page, /advertisedStockRecords/);
  assert.match(page, /All advertised stock/);
  assert.match(page, /Prepare \+ Reconcile/);
  assert.match(page, /isAdvertisedStockMaintenance/);
});

test("Cars review stays in Cars mode and uses the source-image review plus controlled reconcile", () => {
  const review = fs.readFileSync(new URL("../utils/dealerKitReviewWorkspace.js", import.meta.url), "utf8");
  const gallery = fs.readFileSync(new URL("../utils/dealerKitProductGalleryWorkspace.js", import.meta.url), "utf8");
  const detail = fs.readFileSync(new URL("../api/dealerkit-stock-detail.js", import.meta.url), "utf8");
  const controlled = fs.readFileSync(new URL("../utils/dealerKitControlledPublish.js", import.meta.url), "utf8");

  assert.match(review, /\["finance", "rent2buy", "cars"\]\.includes\(product\)/);
  assert.match(review, /Save Cars review/);
  assert.match(review, /product: "cars"/);
  assert.match(gallery, /workspace\.dataset\.product === "cars"/);
  assert.match(detail, /\["finance", "rent2buy", "cars"\]\.includes\(requestedProductRaw\)/);
  assert.match(controlled, /product === "cars"/);
  assert.match(controlled, /dealerkit-car-controlled-publish-preview/);
  assert.match(controlled, /dealerkit-car-controlled-publish/);
});

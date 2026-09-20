import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);

function read(relativePath) {
  return fs.readFileSync(new URL(relativePath, root), "utf8");
}

test("DealerKit operator adapter is read-only and maps live stock into the existing contract", () => {
  const adapter = read("api/_dealerkit-stock-adapter.js");
  assert.match(adapter, /https:\/\/api\.dealerkit\.uk/);
  assert.match(adapter, /\/integrators\/stock/);
  assert.match(adapter, /authorization: `Bearer \${secret}`/);
  assert.match(adapter, /method: "GET"/);
  assert.match(adapter, /normaliseStatus/);
  assert.match(adapter, /normaliseVatStatus/);
  assert.match(adapter, /supplierStockId/);
  assert.match(adapter, /sourceStatus/);
  assert.match(adapter, /retailPrice/);
  assert.match(adapter, /primaryImage/);
  assert.doesNotMatch(adapter, /method:\s*"(?:POST|PUT|PATCH|DELETE)"/);
});

test("DealerKit stock preview is access-gated and returns summary only", () => {
  const preview = read("api/dealerkit-stock-preview.js");
  assert.match(preview, /Marketing CRM access is required/);
  assert.match(preview, /fetchDealerKitStockSnapshot/);
  assert.match(preview, /summariseDealerKitPreview/);
  assert.doesNotMatch(preview, /response\.status\(200\)\.json\(\{\s*ok:\s*true,\s*stock:/);
});

test("Stock Control Centre keeps original buttons/cards but routes the operator engine to DealerKit", () => {
  const main = fs.readFileSync(new URL("../main.jsx", import.meta.url), "utf8");
  const controls = fs.readFileSync(new URL("../utils/dealerKitOriginalStockControls.js", import.meta.url), "utf8");
  assert.doesNotMatch(main, /import\s+["']\.\/utils\/dealerKitStockControlPreview\.js["']/);
  assert.match(main, /dealerKitOriginalStockControls\.js/);
  assert.match(controls, /refresh dealer stock|refresh vansco cache/i);
  assert.match(controls, /refresh comparison|reload comparison/i);
  assert.match(controls, /DealerKit Stock Status/);
  assert.match(controls, /\/api\/dealerkit-stock-watch-list/);
  assert.match(controls, /\/api\/dealerkit-stock-comparison/);
  assert.match(controls, /url\.pathname === "\/api\/vansco-cache-list"/);
  assert.match(controls, /url\.pathname === "\/api\/vansco-cache-live-refresh"/);
  assert.match(controls, /Stop the legacy React handler before it can start \/vansco-cache-live-refresh/);
  assert.doesNotMatch(controls, /waitForOriginalRefresh|processing_dragon_details/);
  assert.doesNotMatch(controls, /dealerkit-controlled-publish|wix-data\/v2\/items/i);
});

test("DealerKit Stock Watch list is access-gated and maps the supplier feed into the original card contract", () => {
  const endpoint = fs.readFileSync(new URL("../api/dealerkit-stock-watch-list.js", import.meta.url), "utf8");
  assert.match(endpoint, /Marketing CRM access is required/);
  assert.match(endpoint, /loadSnapshot\(\{[\s\S]*allowPartial: true,[\s\S]*stabilityAttempts: 3,[\s\S]*\}\)/);
  assert.match(endpoint, /loadStockWatchSnapshot\(\{ forceFresh \}\)/);
  assert.match(endpoint, /supplierStockId/);
  assert.match(endpoint, /providerId: "dealerkit"/);
  assert.match(endpoint, /isCurrentlyOnVansco: vehicle\.isCurrentDealerKitBulkRecord === true/);
  assert.match(endpoint, /WATCH_TABLE/);
  assert.match(endpoint, /positive DealerKit registrations\/statuses even when a small number of bulk positions remain unresolved/);
  assert.match(endpoint, /dealerKitVehicleBelongsToPipeline/);
  assert.doesNotMatch(endpoint, /vansco-cache-live-refresh|fetchVanscoDetailHtml|DRAGON_SOURCE_ORIGIN|wix-data|controlled-publish/i);
});

test("Missing-card review buttons are limited to exact DealerKit finance-missing identities", () => {
  const bridge = fs.readFileSync(new URL("../utils/dealerKitMissingStockReviewBridge.js", import.meta.url), "utf8");
  const detail = fs.readFileSync(new URL("../api/dealerkit-stock-detail.js", import.meta.url), "utf8");
  assert.match(bridge, /reason !== "missing_from_finance"/);
  assert.match(bridge, /supplierStockId/);
  assert.match(bridge, /registration}::\${supplierStockId}/);
  assert.match(detail, /rawRegistration\.split\("::", 2\)/);
  assert.match(detail, /fetchDealerKitStockDetail\(supplierStockId/);
  assert.match(detail, /stock identity no longer matches this registration/i);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { summariseDealerKitPreview } from "../api/dealerkit-stock-preview.js";

test("summarises DealerKit coverage, statuses, types and image readiness without exposing source records", () => {
  const summary = summariseDealerKitPreview({
    complete: false,
    checkedAt: "2026-09-10T11:30:00.000Z",
    apiReportedTotal: 6,
    vehicleCount: 4,
    vehicles: [
      { sourceStatus: "In Stock", vehicleType: "LCV", imageCount: 0 },
      { sourceStatus: "In Stock", vehicleType: "LCV", imageCount: 1 },
      { sourceStatus: "Reserved", vehicleType: "Car", imageCount: 3 },
      { sourceStatus: "Awaiting Delivery", vehicleType: "LCV", imageCount: 8 },
    ],
    diagnostics: {
      failedPages: [{ page: 3 }],
      failedPositions: [{ position: 5 }],
      invalidRecords: [{ position: 6 }],
      duplicateRegistrations: [],
      stableReportedTotal: true,
    },
  });

  assert.equal(summary.providerId, "dealerkit");
  assert.equal(summary.complete, false);
  assert.equal(summary.apiReportedTotal, 6);
  assert.equal(summary.vehicleCount, 4);
  assert.equal(summary.coveragePercent, 66.7);
  assert.deepEqual(summary.statusCounts, {
    "In Stock": 2,
    Reserved: 1,
    "Awaiting Delivery": 1,
  });
  assert.deepEqual(summary.typeCounts, { LCV: 3, Car: 1 });
  assert.deepEqual(summary.images, {
    zero: 1,
    one: 1,
    twoToFour: 1,
    fivePlus: 1,
    withAny: 3,
  });
  assert.deepEqual(summary.issues, {
    failedPageCount: 1,
    failedPositionCount: 1,
    invalidRecordCount: 1,
    duplicateRegistrationCount: 0,
    stableReportedTotal: true,
  });
  assert.equal(Object.prototype.hasOwnProperty.call(summary, "vehicles"), false);
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
  assert.match(endpoint, /fetchDealerKitStockSnapshot\(\{ allowPartial: true \}\)/);
  assert.match(endpoint, /supplierStockId/);
  assert.match(endpoint, /providerId: "dealerkit"/);
  assert.match(endpoint, /isCurrentlyOnVansco: true/);
  assert.match(endpoint, /WATCH_TABLE/);
  assert.match(endpoint, /segmented before card classification/);
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

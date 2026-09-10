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

test("Stock Control Centre uses original buttons/cards instead of the standalone DealerKit preview", () => {
  const main = fs.readFileSync(new URL("../main.jsx", import.meta.url), "utf8");
  const controls = fs.readFileSync(new URL("../utils/dealerKitOriginalStockControls.js", import.meta.url), "utf8");
  assert.doesNotMatch(main, /import\s+["']\.\/utils\/dealerKitStockControlPreview\.js["']/);
  assert.match(main, /dealerKitOriginalStockControls\.js/);
  assert.match(controls, /refresh dealer stock|refresh vansco cache/i);
  assert.match(controls, /refresh comparison|reload comparison/i);
  assert.match(controls, /Vansco Status Hub/);
  assert.match(controls, /\/api\/dealerkit-stock-comparison/);
  assert.doesNotMatch(controls, /dealerkit-controlled-publish|wix-data\/v2\/items/i);
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

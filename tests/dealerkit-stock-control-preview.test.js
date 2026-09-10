import test from "node:test";
import assert from "node:assert/strict";
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

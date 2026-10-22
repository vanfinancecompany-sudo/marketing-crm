import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCarStockReconciliationPreview,
  publishedCarsFromWixRows,
} from "../lib/carStockReconciliation.js";

test("publishedCarsFromWixRows keeps only the latest published Cars row per registration", () => {
  const result = publishedCarsFromWixRows([
    {
      data: {
        title: "AB12 CDE",
        _publishStatus: "PUBLISHED",
        _updatedDate: "2026-10-01T10:00:00Z",
        vanDescription: "Older title",
        picture: "https://example.test/old.jpg",
      },
    },
    {
      data: {
        title: "AB12CDE",
        _publishStatus: "PUBLISHED",
        _updatedDate: "2026-10-02T10:00:00Z",
        vanDescription: "Current title",
        picture: "https://example.test/new.jpg",
      },
    },
    {
      data: {
        title: "ZZ99ZZZ",
        _publishStatus: "DRAFT",
        vanDescription: "Draft car",
      },
    },
  ]);

  assert.equal(result.vehicles.length, 1);
  assert.equal(result.vehicles[0].registration, "AB12CDE");
  assert.equal(result.vehicles[0].title, "Current title");
  assert.deepEqual(result.duplicatePublishedRegistrations, ["AB12CDE"]);
});

test("reconciliation previews keep, add, reactivate and deactivate without mutating rows", () => {
  const source = [
    { registration: "AA11AAA" },
    { registration: "BB22BBB" },
    { registration: "CC33CCC" },
  ];
  const existing = [
    { registration: "AA11AAA", is_active: true },
    { registration: "BB22BBB", is_active: false },
    { registration: "DD44DDD", is_active: true },
  ];

  const preview = buildCarStockReconciliationPreview(source, existing);

  assert.equal(preview.safeToApply, true);
  assert.deepEqual(preview.keep, ["AA11AAA"]);
  assert.deepEqual(preview.reactivate, ["BB22BBB"]);
  assert.deepEqual(preview.add, ["CC33CCC"]);
  assert.deepEqual(preview.deactivate, ["DD44DDD"]);
  assert.equal(existing[1].is_active, false);
});

test("an empty source fails closed", () => {
  const preview = buildCarStockReconciliationPreview([], [
    { registration: "AA11AAA", is_active: true },
  ]);

  assert.equal(preview.safeToApply, false);
  assert.deepEqual(preview.deactivate, ["AA11AAA"]);
  assert.match(preview.warnings.join(" "), /No published Cars/);
});

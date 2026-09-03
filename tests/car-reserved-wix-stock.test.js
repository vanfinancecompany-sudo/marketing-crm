import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CAR_WIX_STOCK_COLLECTIONS,
  assertCarWixStockCollection,
} from "../api/car-reserved-wix-stock.js";

const EXPECTED_COLLECTIONS = ["CARFINANCE", "CARPAGES"];

test("reserved Car Wix Stock Watch is restricted to exactly two approved collections", () => {
  assert.deepEqual(CAR_WIX_STOCK_COLLECTIONS.map((collection) => collection.id), EXPECTED_COLLECTIONS);
  assert.equal(new Set(EXPECTED_COLLECTIONS).size, 2);
});

test("van, Rent2Buy and arbitrary collection IDs are rejected by the car endpoint", () => {
  assert.throws(() => assertCarWixStockCollection("VANFINANCE-ALLVANS"), /not an approved/i);
  assert.throws(() => assertCarWixStockCollection("VANFINANCEPAGES"), /not an approved/i);
  assert.throws(() => assertCarWixStockCollection("ALLRENT2BUYVANS"), /not an approved/i);
  assert.throws(() => assertCarWixStockCollection("SOMETHING-ELSE"), /not an approved/i);
});

test("car endpoint uses legacy Publish-plugin draft status task and never deletes CMS records", () => {
  const source = fs.readFileSync(new URL("../api/car-reserved-wix-stock.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /method:\s*["']DELETE["']/i);
  assert.doesNotMatch(source, /wix-data\/v2\/items\/unpublish/i);
  assert.match(source, /type:\s*["']UPDATE_PUBLISH_STATUS["']/);
  assert.match(source, /operation:\s*["']SET_DRAFT_STATUS["']/);
  assert.match(source, /environment:\s*["']LIVE["']/);
  assert.match(source, /_id:\s*\{\s*\$eq:\s*itemId\s*\}/);
  assert.match(source, /CARFINANCE/);
  assert.match(source, /CARPAGES/);
});

test("Car Stock Watch UI is limited to reserved records in the cars pipeline", () => {
  const source = fs.readFileSync(new URL("../scripts/apply-car-reserved-wix-stock-watch.mjs", import.meta.url), "utf8");
  assert.match(source, /selectedPipeline === \"cars\"/);
  assert.match(source, /record\.displayStatus === \"reserved\"/);
  assert.match(source, /Check car Wix collections/);
  assert.match(source, /Set .* live car record/);
  assert.match(source, /CAR-ONLY SAFETY/);
  assert.match(source, /CARFINANCE/);
  assert.match(source, /CARPAGES/);
});

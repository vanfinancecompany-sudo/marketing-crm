import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CAR_WIX_CHECK_COLLECTIONS,
  CAR_WIX_STOCK_COLLECTIONS,
  PROTECTED_CAR_COLLECTION_ID,
  assertCarWixStockCollection,
} from "../api/car-reserved-wix-stock.js";

test("reserved Car Wix Stock Watch can only mutate CARFINANCE", () => {
  assert.deepEqual(CAR_WIX_STOCK_COLLECTIONS.map((collection) => collection.id), ["CARFINANCE"]);
  assert.deepEqual(CAR_WIX_CHECK_COLLECTIONS.map((collection) => collection.id), ["CARFINANCE", "CARPAGES"]);
});

test("CARPAGES is hard protected and rejected by every mutation guard", () => {
  assert.equal(PROTECTED_CAR_COLLECTION_ID, "CARPAGES");
  assert.equal(CAR_WIX_STOCK_COLLECTIONS.some((collection) => collection.id === PROTECTED_CAR_COLLECTION_ID), false);
  assert.throws(() => assertCarWixStockCollection(PROTECTED_CAR_COLLECTION_ID), /hard protected/i);
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
  assert.match(source, /CAR PAGES is hard protected and can never be moved to draft/);
});

test("preview can read CARPAGES but action matches exclude protected records", () => {
  const source = fs.readFileSync(new URL("../api/car-reserved-wix-stock.js", import.meta.url), "utf8");
  assert.match(source, /CAR_WIX_CHECK_COLLECTIONS/);
  assert.match(source, /filter\(\(collection\) => !collection\.protected\)/);
  assert.match(source, /protectedMatches/);
  assert.match(source, /allowedCollectionIds: CAR_WIX_STOCK_COLLECTIONS/);
});

test("Car Stock Watch UI makes CARPAGES protection explicit", () => {
  const source = fs.readFileSync(new URL("../scripts/apply-car-reserved-wix-stock-watch.mjs", import.meta.url), "utf8");
  assert.match(source, /selectedPipeline === \"cars\"/);
  assert.match(source, /record\.displayStatus === \"reserved\"/);
  assert.match(source, /Check car Wix collections/);
  assert.match(source, /Set .*CAR FINANCE record/);
  assert.match(source, /CAR PAGES is HARD PROTECTED/);
  assert.match(source, /LIVE • PROTECTED/);
  assert.match(source, /preserve existing Google\/indexed links/);
});

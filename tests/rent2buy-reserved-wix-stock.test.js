import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  RENT2BUY_WIX_SITES,
  RENT2BUY_WIX_STOCK_COLLECTIONS,
  RENT2BUY_WIX_CHECK_COLLECTIONS,
  PROTECTED_RENT2BUY_COLLECTION_ID,
  assertRent2BuyWixSite,
  assertRent2BuyWixStockCollection,
} from "../api/rent2buy-reserved-wix-stock.js";

const EXPECTED_SITE_IDS = [
  "85f11c52-ee54-495d-aaec-a351831709b5",
  "548f025b-673c-47f7-9bb6-383ab5d946e4",
];

const EXPECTED_STOCK_COLLECTIONS = [
  "ALLRENT2BUYVANS",
  "MEDIUMVANS",
  "PICKUPS",
  "SmallVans",
  "TIPPERS-LUTONS-DROPSDIES",
  "LWBVANS",
  "ELECTRICVANS",
  "CREWVANS",
  "AUTOMATICVANS",
];

test("Rent2Buy Stock Watch is restricted to exactly the two traced Wix sites", () => {
  assert.deepEqual(RENT2BUY_WIX_SITES.map((site) => site.id), EXPECTED_SITE_IDS);
  assert.deepEqual(RENT2BUY_WIX_SITES.map((site) => site.label), ["VAN FINANCE Wix", "RENT2BUY VANS Wix"]);
  assert.equal(new Set(EXPECTED_SITE_IDS).size, 2);
  assert.throws(() => assertRent2BuyWixSite("8277e317-1387-463d-91d6-b7191bc12624"), /not approved/i);
  assert.throws(() => assertRent2BuyWixSite("anything-else"), /not approved/i);
});

test("Rent2Buy Stock Watch can mutate exactly nine listing/category collections", () => {
  assert.deepEqual(RENT2BUY_WIX_STOCK_COLLECTIONS.map((collection) => collection.id), EXPECTED_STOCK_COLLECTIONS);
  assert.equal(new Set(EXPECTED_STOCK_COLLECTIONS).size, 9);
});

test("VANPAGES is hard protected and absent from every mutation allowlist", () => {
  assert.equal(PROTECTED_RENT2BUY_COLLECTION_ID, "VANPAGES");
  assert.equal(RENT2BUY_WIX_STOCK_COLLECTIONS.some((collection) => collection.id === PROTECTED_RENT2BUY_COLLECTION_ID), false);
  assert.equal(RENT2BUY_WIX_CHECK_COLLECTIONS.some((collection) => collection.id === PROTECTED_RENT2BUY_COLLECTION_ID), true);
  assert.throws(() => assertRent2BuyWixStockCollection(PROTECTED_RENT2BUY_COLLECTION_ID), /hard protected/i);
});

test("Finance, car and arbitrary collection IDs are rejected by Rent2Buy mutation guard", () => {
  assert.throws(() => assertRent2BuyWixStockCollection("VANFINANCE-ALLVANS"), /not an approved/i);
  assert.throws(() => assertRent2BuyWixStockCollection("VANFINANCEPAGES"), /not an approved/i);
  assert.throws(() => assertRent2BuyWixStockCollection("CARFINANCE"), /not an approved/i);
  assert.throws(() => assertRent2BuyWixStockCollection("CARPAGES"), /not an approved/i);
  assert.throws(() => assertRent2BuyWixStockCollection("SOMETHING-ELSE"), /not an approved/i);
});

test("Rent2Buy endpoint uses legacy Publish-plugin Draft tasks and never deletes CMS records", () => {
  const source = fs.readFileSync(new URL("../api/rent2buy-reserved-wix-stock.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /method:\s*["']DELETE["']/i);
  assert.doesNotMatch(source, /wix-data\/v2\/items\/unpublish/i);
  assert.match(source, /type:\s*["']UPDATE_PUBLISH_STATUS["']/);
  assert.match(source, /operation:\s*["']SET_DRAFT_STATUS["']/);
  assert.match(source, /environment:\s*["']LIVE["']/);
  assert.match(source, /_id:\s*\{\s*\$eq:\s*itemId\s*\}/);
});

test("preview reads VANPAGES but actionable matches exclude protected records", () => {
  const source = fs.readFileSync(new URL("../api/rent2buy-reserved-wix-stock.js", import.meta.url), "utf8");
  assert.match(source, /RENT2BUY_WIX_CHECK_COLLECTIONS/);
  assert.match(source, /filter\(\(collection\) => !collection\.protected\)/);
  assert.match(source, /protectedMatches/);
  assert.match(source, /VAN PAGES is hard protected and can never be moved to draft/);
});

test("Rent2Buy Stock Watch UI is reserved-only, dual-site and makes VAN PAGES protection explicit", () => {
  const source = fs.readFileSync(new URL("../scripts/apply-rent2buy-reserved-wix-stock-watch.mjs", import.meta.url), "utf8");
  assert.match(source, /selectedPipeline === \"rent2buy\"/);
  assert.match(source, /record\.displayStatus === \"reserved\"/);
  assert.match(source, /Check Rent2Buy Wix collections/);
  assert.match(source, /rentWixPreview\.sites/);
  assert.match(source, /site\.label/);
  assert.match(source, /VAN PAGES is HARD PROTECTED on both Wix sites/);
  assert.match(source, /LIVE • PROTECTED/);
  assert.match(source, /Set .*live Rent2Buy listing record/);
});

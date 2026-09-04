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

const FINANCE_WIX_SITE_ID = "85f11c52-ee54-495d-aaec-a351831709b5";
const LEGACY_RENT2BUY_WIX_SITE_ID = "548f025b-673c-47f7-9bb6-383ab5d946e4";

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

test("Rent2Buy Stock Watch uses only the authoritative VAN FINANCE Wix CMS", () => {
  assert.deepEqual(RENT2BUY_WIX_SITES.map((site) => site.id), [FINANCE_WIX_SITE_ID]);
  assert.match(RENT2BUY_WIX_SITES[0].label, /VAN FINANCE Wix.*Rent2Buy CMS/i);
  assert.throws(() => assertRent2BuyWixSite(LEGACY_RENT2BUY_WIX_SITE_ID), /not the authoritative Rent2Buy CMS/i);
  assert.throws(() => assertRent2BuyWixSite("anything-else"), /not the authoritative Rent2Buy CMS/i);
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

test("Rent2Buy endpoint uses direct unpublish with a publish-status fallback and never deletes CMS records", () => {
  const source = fs.readFileSync(new URL("../api/rent2buy-reserved-wix-stock.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /method:\s*["']DELETE["']/i);
  assert.match(source, /wix-data\/v2\/items\/unpublish/i);
  assert.match(source, /dataCollectionId:\s*collectionId/);
  assert.match(source, /dataItemId:\s*itemId/);
  assert.match(source, /UPDATE_PUBLISH_STATUS/);
  assert.match(source, /SET_DRAFT_STATUS/);
  assert.match(source, /cms\/v1\/tasks/);
  assert.match(source, /WDE0308\|Draft items are not enabled/);
});

test("Rent2Buy draft actions are deterministic and do not use the historic standalone Wix CMS", () => {
  const source = fs.readFileSync(new URL("../api/rent2buy-reserved-wix-stock.js", import.meta.url), "utf8");
  assert.match(source, /for \(const match of preview\.matches\)/);
  assert.match(source, /authority: "VAN FINANCE Wix Rent2Buy CMS only"/);
  assert.doesNotMatch(source, new RegExp(LEGACY_RENT2BUY_WIX_SITE_ID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("preview reads VANPAGES but actionable matches exclude protected records", () => {
  const source = fs.readFileSync(new URL("../api/rent2buy-reserved-wix-stock.js", import.meta.url), "utf8");
  assert.match(source, /RENT2BUY_WIX_CHECK_COLLECTIONS/);
  assert.match(source, /filter\(\(collection\) => !collection\.protected\)/);
  assert.match(source, /protectedMatches/);
  assert.match(source, /VAN PAGES is hard protected and can never be moved to draft/);
});

test("Rent2Buy Stock Watch UI is reserved-only and labels the one authoritative CMS", () => {
  const source = fs.readFileSync(new URL("../scripts/apply-rent2buy-reserved-wix-stock-watch.mjs", import.meta.url), "utf8");
  const singleAuthorityTransform = fs.readFileSync(new URL("../scripts/apply-rent2buy-legacy-draft-stability.mjs", import.meta.url), "utf8");
  assert.match(source, /selectedPipeline === \"rent2buy\"/);
  assert.match(source, /record\.displayStatus === \"reserved\"/);
  assert.match(source, /Check Rent2Buy Wix collections/);
  assert.match(singleAuthorityTransform, /authoritative VAN FINANCE Wix CMS/);
  assert.match(singleAuthorityTransform, /VAN PAGES is HARD PROTECTED in the authoritative Rent2Buy CMS/);
  assert.match(source, /Set .*live Rent2Buy listing record/);
});

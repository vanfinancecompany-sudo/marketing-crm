import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import "./car-reserved-wix-stock.test.js";
import {
  FINANCE_WIX_STOCK_COLLECTIONS,
  PROTECTED_FINANCE_COLLECTION_ID,
  assertFinanceWixStockCollection,
} from "../api/finance-reserved-wix-stock.js";

const EXPECTED_COLLECTIONS = [
  "VANFINANCE-ALLVANS",
  "VANFINANCE-MWB",
  "VANFINANCE-PICKUPS",
  "VANFINANCE-SMALLVANS",
  "VANFINANCE-TIPPERSDROPSIDEL",
  "VANFINANCE-LWBVANS",
  "VANFINANCE-ELECTRIC",
  "FINANCE-CREWVANS",
  "AUTOMATIC",
];

test("reserved Finance Wix Stock Watch is restricted to exactly nine approved collections", () => {
  assert.deepEqual(FINANCE_WIX_STOCK_COLLECTIONS.map((collection) => collection.id), EXPECTED_COLLECTIONS);
  assert.equal(new Set(EXPECTED_COLLECTIONS).size, 9);
});

test("VAN FINANCE PAGES is hard protected and absent from the allowlist", () => {
  assert.equal(PROTECTED_FINANCE_COLLECTION_ID, "VANFINANCEPAGES");
  assert.equal(FINANCE_WIX_STOCK_COLLECTIONS.some((collection) => collection.id === PROTECTED_FINANCE_COLLECTION_ID), false);
  assert.throws(
    () => assertFinanceWixStockCollection(PROTECTED_FINANCE_COLLECTION_ID),
    /protected/i
  );
});

test("arbitrary and Rent2Buy collection IDs are rejected", () => {
  assert.throws(() => assertFinanceWixStockCollection("ALLRENT2BUYVANS"), /not an approved/i);
  assert.throws(() => assertFinanceWixStockCollection("SOMETHING-ELSE"), /not an approved/i);
});

test("server endpoint uses legacy Publish-plugin draft status task and never deletes CMS records", () => {
  const source = fs.readFileSync(new URL("../api/finance-reserved-wix-stock.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /method:\s*["']DELETE["']/i);
  assert.doesNotMatch(source, /wix-data\/v2\/items\/unpublish/i);
  assert.match(source, /type:\s*["']UPDATE_PUBLISH_STATUS["']/);
  assert.match(source, /operation:\s*["']SET_DRAFT_STATUS["']/);
  assert.match(source, /environment:\s*["']LIVE["']/);
  assert.match(source, /_id:\s*\{\s*\$eq:\s*itemId\s*\}/);
});

test("Stock Watch UI transform exposes preview before the draft action", () => {
  const source = fs.readFileSync(new URL("../scripts/apply-finance-reserved-wix-stock-watch.mjs", import.meta.url), "utf8");
  assert.match(source, /Check Wix collections/);
  assert.match(source, /Set .* live Finance record/);
  assert.match(source, /VAN FINANCE PAGES.*HARD PROTECTED/);
  assert.match(source, /record\.displayStatus === \"reserved\"/);
  assert.match(source, /apply-car-reserved-wix-stock-watch\.mjs/);
});

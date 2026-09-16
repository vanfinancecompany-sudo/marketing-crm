import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import "./car-reserved-wix-stock.test.js";
import {
  FINANCE_WIX_STOCK_COLLECTIONS,
  PROTECTED_FINANCE_COLLECTION_ID,
  assertFinanceWixStockCollection,
  processReservedFinanceDraftMatches,
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

test("reserved Finance Wix writes are serial, rechecked and verified after each draft task", async () => {
  const matches = [
    { collectionId: "VANFINANCE-ALLVANS", collectionLabel: "ALL VANS", itemId: "all-1" },
    { collectionId: "VANFINANCE-LWBVANS", collectionLabel: "LWB", itemId: "lwb-1" },
  ];
  const drafted = new Set();
  let inFlight = 0;
  let maxInFlight = 0;
  let verifyCalls = 0;
  const draftOrder = [];

  const results = await processReservedFinanceDraftMatches("GF71OMG", matches, {
    verifyReserved: async () => {
      verifyCalls += 1;
      return { registration: "GF71OMG", sourceStatus: "reserved" };
    },
    findMatches: async (collection) => {
      const original = matches.find((match) => match.collectionId === collection.id);
      if (!original || drafted.has(original.itemId)) return [];
      return [{ ...original, publishStatus: "PUBLISHED" }];
    },
    draftMatch: async (match) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      draftOrder.push(match.collectionId);
      await new Promise((resolve) => setTimeout(resolve, 5));
      drafted.add(match.itemId);
      inFlight -= 1;
      return {
        collectionId: match.collectionId,
        collectionLabel: match.collectionLabel,
        itemId: match.itemId,
        taskId: `task-${match.itemId}`,
        taskStatus: "COMPLETED",
        itemsSucceeded: 1,
      };
    },
  });

  assert.equal(maxInFlight, 1, "Wix background-task writes must never overlap");
  assert.deepEqual(draftOrder, ["VANFINANCE-ALLVANS", "VANFINANCE-LWBVANS"]);
  assert.equal(verifyCalls, 2, "DealerKit reserved status must be rechecked before every Wix write");
  assert.equal(results.length, 2);
  assert.ok(results.every((result) => result.ok && result.changed));
});

test("already-draft collection becomes an idempotent success instead of a false failure", async () => {
  const match = { collectionId: "VANFINANCE-LWBVANS", collectionLabel: "LWB", itemId: "lwb-already-draft" };
  let draftCalls = 0;

  const results = await processReservedFinanceDraftMatches("GF71OMG", [match], {
    verifyReserved: async () => ({ registration: "GF71OMG", sourceStatus: "reserved" }),
    findMatches: async () => [],
    draftMatch: async () => {
      draftCalls += 1;
      throw new Error("should not be called");
    },
  });

  assert.equal(draftCalls, 0);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].skipped, true);
  assert.equal(results[0].changed, false);
});

test("Stock Watch UI transform exposes preview and real per-collection error details", () => {
  const source = fs.readFileSync(new URL("../scripts/apply-finance-reserved-wix-stock-watch.mjs", import.meta.url), "utf8");
  assert.match(source, /Check Wix collections/);
  assert.match(source, /Set .* live Finance record/);
  assert.match(source, /VAN FINANCE PAGES.*HARD PROTECTED/);
  assert.match(source, /record\.displayStatus === \"reserved\"/);
  assert.match(source, /item\.error \|\| \"No error detail returned\.\"/);
  assert.match(source, /result\?\.preview/);
  assert.match(source, /apply-car-reserved-wix-stock-watch\.mjs/);
});

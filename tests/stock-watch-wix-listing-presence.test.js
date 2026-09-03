import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { sourcesForPipeline } from "../api/stock-watch-wix-listing-presence.js";

const FINANCE_WIX_SITE_ID = "85f11c52-ee54-495d-aaec-a351831709b5";
const RENT2BUY_WIX_SITE_ID = "548f025b-673c-47f7-9bb6-383ab5d946e4";
const RENT2BUY_COLLECTIONS = [
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

test("Cars live-presence authority is CARFINANCE only", () => {
  const sources = sourcesForPipeline("cars");
  assert.equal(sources.length, 1);
  assert.equal(sources[0].siteId, FINANCE_WIX_SITE_ID);
  assert.equal(sources[0].collectionId, "CARFINANCE");
});

test("Rent2Buy live-presence authority is the nine listing collections on both Wix mirrors", () => {
  const sources = sourcesForPipeline("rent2buy");
  assert.equal(sources.length, 18);
  assert.deepEqual(new Set(sources.map((source) => source.siteId)), new Set([FINANCE_WIX_SITE_ID, RENT2BUY_WIX_SITE_ID]));
  assert.deepEqual(new Set(sources.map((source) => source.collectionId)), new Set(RENT2BUY_COLLECTIONS));
});

test("full-page SEO collections are never part of listing presence authority", () => {
  const source = fs.readFileSync(new URL("../api/stock-watch-wix-listing-presence.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /CARPAGES/);
  assert.doesNotMatch(source, /VANPAGES/);
  assert.doesNotMatch(source, /VANFINANCEPAGES/);
});

test("Stock Watch replaces stale Cars and Rent2Buy CRM flags only after a complete Wix presence check", () => {
  const source = fs.readFileSync(new URL("../scripts/apply-wix-authoritative-stock-presence.mjs", import.meta.url), "utf8");
  assert.match(source, /pipeline === \"cars\" \|\| pipeline === \"rent2buy\"/);
  assert.match(source, /if \(presence\.complete\)/);
  assert.match(source, /effectiveRegistrations = \(presence\.registrations \|\| \[\]\)/);
  assert.match(source, /effectiveVehicles = vehicles\.filter/);
  assert.match(source, /Marketing CRM stock fallback/);
});

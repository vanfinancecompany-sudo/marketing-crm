import test from "node:test";
import assert from "node:assert/strict";
import {
  getGoogleVehicleRows, selectedGoogleVehicleCsv, validatedSelectedVehicleIds,
} from "../lib/vanscoGoogleVehicleAdsSelection.js";

const sample = [
  "id,title,price,image_link,link,store_code,description",
  'CAR-1,"VW Caddy, Blue",9295 GBP,https://example.com/1.jpg,https://example.com/1,VANSCO-333,"Good, reliable van"',
  'CAR-2,Ford Transit,12500 GBP,https://example.com/2.jpg,https://example.com/2,VANSCO-AIRPORT,"Stock vehicle"',
  'CAR-3,Vauxhall Vivaro,9999 GBP,https://example.com/3.jpg,https://example.com/3,VANSCO-NEWFOREST,"Needs a quote"',
].join("\n");

test("lists live DealerKit vehicles using exact product id", () => {
  const items = getGoogleVehicleRows(sample);
  assert.equal(items.length, 3);
  assert.equal(items[0].title, "VW Caddy, Blue");
  assert.equal(items[2].id, "CAR-3");
});

test("filters CSV, preserving quoted columns and original header", () => {
  const result = selectedGoogleVehicleCsv(sample, ["car-1", "CAR-3"]);
  assert.equal(result.vehicleCount, 2);
  assert.match(result.csv, /"VW Caddy, Blue"/);
  assert.doesNotMatch(result.csv, /CAR-2/);
  assert.equal(getGoogleVehicleRows(result.csv).length, 2);
});

test("refuses an empty or stale selection rather than exposing all stock", () => {
  assert.throws(() => selectedGoogleVehicleCsv(sample, []), /No vehicles selected/);
  assert.throws(() => selectedGoogleVehicleCsv(sample, ["not-here"]), /None of/);
  assert.throws(() => validatedSelectedVehicleIds(["CAR-4"], ["CAR-1"]), /no longer present/);
});

test("selection normalizes and deduplicates ID casing", () => {
  assert.deepEqual(validatedSelectedVehicleIds(["car-1", "CAR-1"], ["CAR-1"]), ["CAR-1"]);
});

test("rejects a malformed DealerKit feed", () => {
  assert.throws(() => getGoogleVehicleRows("title,price\nA,5"), /missing its id/);
});

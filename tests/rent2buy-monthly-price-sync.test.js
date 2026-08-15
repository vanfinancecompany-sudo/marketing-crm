import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMonthlyPriceSyncPatch,
  parseRent2BuyMonthlyPrice,
  summarizeMonthlyPriceSync,
} from "../lib/rent2buyMonthlyPriceSync.js";

test("extracts the monthly amount from existing Rent2Buy CMS display text", () => {
  assert.equal(parseRent2BuyMonthlyPrice("£575 PM"), 575);
  assert.equal(parseRent2BuyMonthlyPrice("£559 P/M"), 559);
  assert.equal(parseRent2BuyMonthlyPrice("£1,025 PM"), 1025);
  assert.equal(parseRent2BuyMonthlyPrice(" £396 PM "), 396);
  assert.equal(parseRent2BuyMonthlyPrice("POA"), null);
  assert.equal(parseRent2BuyMonthlyPrice(""), null);
});

test("only creates a patch when the numeric mirror is missing or stale", () => {
  const missing = buildMonthlyPriceSyncPatch({ id: "one", data: { mth: "£463 PM" } });
  assert.equal(missing.dataItemId, "one");
  assert.equal(missing.fieldModifications[0].setFieldOptions.value, 463);

  assert.equal(buildMonthlyPriceSyncPatch({ id: "two", data: { mth: "£463 PM", monthlyPriceNumeric: 463 } }), null);

  const stale = buildMonthlyPriceSyncPatch({ id: "three", data: { mth: "£487 PM", monthlyPriceNumeric: 463 } });
  assert.equal(stale.fieldModifications[0].setFieldOptions.value, 487);
});

test("summary reports unparseable records without overwriting them", () => {
  const result = summarizeMonthlyPriceSync([
    { id: "one", data: { title: "AA11AAA", mth: "£400 PM", monthlyPriceNumeric: 390 } },
    { id: "two", data: { title: "BB22BBB", mth: "POA" } },
    { id: "three", data: { title: "CC33CCC", mth: "£500 PM", monthlyPriceNumeric: 500 } },
  ]);

  assert.equal(result.patches.length, 1);
  assert.equal(result.patches[0].fieldModifications[0].setFieldOptions.value, 400);
  assert.deepEqual(result.skipped, [{ id: "two", registration: "BB22BBB", mth: "POA" }]);
});

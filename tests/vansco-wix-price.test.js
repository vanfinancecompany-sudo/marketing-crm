import test from "node:test";
import assert from "node:assert/strict";
import {
  VAN_FINANCE_WIX_COLLECTIONS,
  buildFinanceWixPricePatch,
  calculateFivePercentFlatMonthly,
  normalizeFinanceRegistration,
  preserveRetailPriceAffixes,
  retailPriceWithReduction,
} from "../lib/vanscoWixPrice.js";

test("calculates 5% flat over 60 months and rounds up", () => {
  assert.equal(calculateFivePercentFlatMonthly(10995), 230);
  assert.equal(calculateFivePercentFlatMonthly(9995), 209);
  assert.equal(calculateFivePercentFlatMonthly(11495), 240);
  assert.equal(calculateFivePercentFlatMonthly(15995), 334);
});

test("normalises exact finance registrations", () => {
  assert.equal(normalizeFinanceRegistration("LA23 FHK"), "LA23FHK");
  assert.equal(normalizeFinanceRegistration(" la23-fhk "), "LA23FHK");
  assert.equal(normalizeFinanceRegistration("hello"), "");
});

test("finance allowlist contains no Rent2Buy collections", () => {
  assert.equal(VAN_FINANCE_WIX_COLLECTIONS.length, 10);
  assert.ok(VAN_FINANCE_WIX_COLLECTIONS.some((collection) => collection.id === "VANFINANCEPAGES"));
  assert.ok(VAN_FINANCE_WIX_COLLECTIONS.every((collection) => !/RENT2BUY/i.test(collection.id)));
});

test("listing patch records the original retail price on a genuine reduction", () => {
  const collection = { id: "VANFINANCE-SMALLVANS", kind: "listing" };
  const item = { id: "item-1", data: { price: "£10,995", salePrice: "FROM £230 P/M", title: "LA23FHK" } };
  assert.deepEqual(buildFinanceWixPricePatch(collection, item, 9995), {
    dataItemId: "item-1",
    fields: { price: "£9,995 [Was £10,995]", salePrice: "FROM £209 P/M" },
  });
});

test("detail patch preserves existing VAT wording and records the original price", () => {
  const collection = { id: "VANFINANCEPAGES", kind: "detail" };
  const item = { id: "item-2", data: { priceVat: "£10,995 +VAT", mthPrice: "£230", title: "LA23FHK" } };
  assert.deepEqual(buildFinanceWixPricePatch(collection, item, 9995), {
    dataItemId: "item-2",
    fields: { priceVat: "£9,995 +VAT [Was £10,995]", mthPrice: "£209" },
  });
  assert.equal(preserveRetailPriceAffixes("£10,995 NO VAT", 9495), "£9,495 NO VAT");
});

test("further reductions keep the first higher Was price", () => {
  assert.equal(
    retailPriceWithReduction("£13,995 +VAT [Was £14,995]", 12995, { preserveAffixes: true }),
    "£12,995 +VAT [Was £14,995]",
  );
});

test("a price increase clears the reduction marker", () => {
  assert.equal(
    retailPriceWithReduction("£12,995 NO VAT [Was £14,995]", 13995, { preserveAffixes: true }),
    "£13,995 NO VAT",
  );
});

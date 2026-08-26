import test from "node:test";
import assert from "node:assert/strict";
import {
  VAN_FINANCE_WIX_COLLECTIONS,
  buildFinanceWixPricePatch,
  calculateFivePercentFlatMonthly,
  normalizeFinanceRegistration,
  preserveRetailPriceAffixes,
  retailPriceWithReduction,
  separateWasPriceForReduction,
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

test("category listing patches keep Van Finance Company on one clean current price", () => {
  const collection = { id: "VANFINANCE-SMALLVANS", kind: "listing" };
  const item = { id: "item-1", data: { price: "£10,995", salePrice: "FROM £230 P/M", title: "LA23FHK" } };
  assert.deepEqual(buildFinanceWixPricePatch(collection, item, 9995), {
    dataItemId: "item-1",
    fields: { price: "£9,995", salePrice: "FROM £209 P/M" },
  });
});

test("canonical listing stores the Was price separately for VanFinance.co", () => {
  const collection = { id: "VANFINANCE-ALLVANS", kind: "listing" };
  const item = { id: "item-1", data: { price: "£10,995", vat: "+VAT", salePrice: "FROM £230 P/M", title: "LA23FHK" } };
  assert.deepEqual(buildFinanceWixPricePatch(collection, item, 9995), {
    dataItemId: "item-1",
    fields: { price: "£9,995", salePrice: "FROM £209 P/M", wasPriceVat: "£10,995 +VAT" },
  });
});

test("detail patch keeps the public price clean and stores original price separately", () => {
  const collection = { id: "VANFINANCEPAGES", kind: "detail" };
  const item = { id: "item-2", data: { priceVat: "£10,995 +VAT", mthPrice: "£230", title: "LA23FHK" } };
  assert.deepEqual(buildFinanceWixPricePatch(collection, item, 9995), {
    dataItemId: "item-2",
    fields: { priceVat: "£9,995 +VAT", mthPrice: "£209", wasPriceVat: "£10,995 +VAT" },
  });
  assert.equal(preserveRetailPriceAffixes("£10,995 NO VAT", 9495), "£9,495 NO VAT");
});

test("legacy inline Was markers migrate into the separate history field", () => {
  assert.equal(
    retailPriceWithReduction("£12,995 +VAT [Was £14,995]", 12995, { preserveAffixes: true }),
    "£12,995 +VAT",
  );
  assert.equal(
    separateWasPriceForReduction("£12,995 +VAT [Was £14,995]", "", 12995),
    "£14,995 +VAT",
  );
});

test("further reductions keep the first higher separate Was price", () => {
  assert.equal(
    separateWasPriceForReduction("£13,995 +VAT", "£14,995 +VAT", 12995),
    "£14,995 +VAT",
  );
});

test("a price increase clears separate reduction history", () => {
  const collection = { id: "VANFINANCEPAGES", kind: "detail" };
  const item = { id: "item-2", data: { priceVat: "£12,995 NO VAT", wasPriceVat: "£14,995 NO VAT", mthPrice: "£271" } };
  assert.deepEqual(buildFinanceWixPricePatch(collection, item, 13995), {
    dataItemId: "item-2",
    fields: { priceVat: "£13,995 NO VAT", mthPrice: "£292", wasPriceVat: "" },
  });
});

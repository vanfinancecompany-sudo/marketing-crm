import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mergeCarsPublishedListingVehicles } from "../lib/dealerKitCarsPublishedListing.js";
import {
  CAR_WIX_PRICE_COLLECTIONS,
  RENT2BUY_PRICE_COLLECTIONS,
  buildCarWixPricePatch,
  buildRent2BuyWixPricePatch,
  calculatePublishedRent2BuyPricing,
} from "../lib/dealerKitPublishedPrice.js";

const root = new URL("../", import.meta.url);

test("car published price patch uses the same 5% flat monthly calculation as Finance", () => {
  const listing = CAR_WIX_PRICE_COLLECTIONS.find((collection) => collection.id === "CARFINANCE");
  const patch = buildCarWixPricePatch(listing, { id: "car-1", data: { price: "£21,995", salePrice: "FROM £459 P/M" } }, 20995);
  assert.deepEqual(patch.fields, { price: "£20,995", salePrice: "FROM £438 P/M" });
});

test("car patch preserves a Was price when a car CMS row exposes the same history field as Finance", () => {
  const listing = CAR_WIX_PRICE_COLLECTIONS.find((collection) => collection.id === "CARFINANCE");
  const patch = buildCarWixPricePatch(listing, { id: "car-2", data: { price: "£22,995", salePrice: "FROM £480 P/M", wasPriceVat: "" } }, 22495);
  assert.equal(patch.fields.price, "£22,495");
  assert.equal(patch.fields.wasPriceVat, "£22,995");
});

test("Cars comparison uses the fresh published CARFINANCE price instead of stale supporting CRM price", () => {
  const first = mergeCarsPublishedListingVehicles(
    [{ registration: "AB24 CDE", price: "£21,995", picture: "car.jpg", weblink: "https://example.test/car" }],
    [{ registration: "AB24CDE", title: "Published car", price: 20995 }],
  );
  assert.equal(first.length, 1);
  assert.equal(first[0].registration, "AB24CDE");
  assert.equal(first[0].price, 20995);
  assert.equal(first[0].picture, "car.jpg");
  assert.equal(first[0].weblink, "https://example.test/car");

  const refreshed = mergeCarsPublishedListingVehicles(
    [{ registration: "AB24 CDE", price: "£21,995" }],
    [{ registration: "AB24CDE", price: "£19,995" }],
  );
  assert.equal(refreshed[0].price, 19995);
});

test("Cars comparison still works from CARFINANCE when the optional Cars CRM support table is empty", () => {
  const rows = mergeCarsPublishedListingVehicles([], [
    { registration: "XY24ZZZ", title: "CARFINANCE car", price: "£18,495" },
  ]);
  assert.deepEqual(rows.map(({ registration, price }) => ({ registration, price })), [
    { registration: "XY24ZZZ", price: 18495 },
  ]);
});

test("Cars comparison fails closed when the published CARFINANCE row has no safe price", () => {
  const rows = mergeCarsPublishedListingVehicles(
    [{ registration: "XY24ZZZ", price: "£22,995" }],
    [{ registration: "XY24ZZZ", price: "" }],
  );
  assert.equal(rows[0].price, null);
});

test("Rent2Buy recalculates monthly and initial rentals from DealerKit retail and mileage", () => {
  const pricing = calculatePublishedRent2BuyPricing({ retailPrice: 11795, mileage: 22000, vatStatus: "plus_vat", pickup: false });
  assert.equal(pricing.termMonths, 48);
  assert.equal(pricing.monthly, 467);
  assert.equal(pricing.upfront, 1401);
  assert.equal(pricing.followingPayments, 48);

  const master = RENT2BUY_PRICE_COLLECTIONS.find((collection) => collection.id === "ALLRENT2BUYVANS");
  const patch = buildRent2BuyWixPricePatch(master, { id: "r2b-master", data: {} }, pricing, { standalone: false });
  assert.equal(patch.fields.mth, "£467 PM");
  assert.equal(patch.fields.weekly, "x48");
  assert.equal(patch.fields.initialRental2250Vat, "INITIAL RENTAL £1401 +VAT");
  assert.equal(patch.fields.weeklyPrice1, undefined);
  assert.equal(patch.fields.monthlyPriceNumeric, undefined);
});

test("Rent2Buy pickup price sync keeps the four-upfront / term-minus-one rule", () => {
  const pricing = calculatePublishedRent2BuyPricing({ retailPrice: 12000, mileage: 20000, vatStatus: "plus_vat", pickup: true });
  assert.equal(pricing.termMonths, 48);
  assert.equal(pricing.upfrontMonths, 4);
  assert.equal(pricing.followingPayments, 47);
  assert.equal(pricing.upfront, pricing.monthly * 4);
});

test("Rent2Buy detail price patch updates all public rental fields together", () => {
  const pricing = calculatePublishedRent2BuyPricing({ retailPrice: 11795, mileage: 22000, vatStatus: "plus_vat", pickup: false });
  const detail = RENT2BUY_PRICE_COLLECTIONS.find((collection) => collection.id === "VANPAGES");
  const patch = buildRent2BuyWixPricePatch(detail, { id: "detail-1", data: {} }, pricing);
  assert.equal(patch.fields.intialRentalCharge, "£1401 +Vat (£1681 INC VAT)");
  assert.equal(patch.fields.numberOfMonths, "48X MONTHLY PAYMENTS");
  assert.equal(patch.fields.monthlyPayments, "£467 +Vat (£560 INC VAT)");
  assert.equal(patch.fields.weeklyPrice, "£467 P/M");
});

test("published price endpoint rechecks DealerKit and updates only the shared Rent2Buy Wix CMS", async () => {
  const source = await readFile(new URL("api/dealerkit-published-price.js", root), "utf8");
  assert.match(source, /fetchDealerKitStockDetail/);
  assert.match(source, /VAN_FINANCE_RENT2BUY_WIX_SITE_ID/);
  assert.doesNotMatch(source, /STANDALONE_RENT2BUY_WIX_SITE_ID/);
  assert.match(source, /ALLRENT2BUYVANS/);
  assert.match(source, /shared Rent2Buy ALLRENT2BUYVANS collection/);
  assert.match(source, /confirmationMatchesPreview/);
  assert.match(source, /rollback/);
});

test("published price endpoint keeps the proven VFC write key for shared Rent2Buy CMS", async () => {
  const source = await readFile(new URL("api/dealerkit-published-price.js", root), "utf8");
  assert.match(source, /firstValue\(environment, \["WIX_API_KEY", "WIX_FINANCE_API_KEY"\]\)/);
  assert.match(source, /rent2buyPrimary: \{ apiKey: financeApiKey/);
  assert.match(source, /configurationForMatch/);
  assert.match(source, /preview\.pipeline === "finance"/);
  assert.match(source, /preview\.pipeline === "cars"/);
});

test("Stock Watch price helper recognises DealerKit instead of requiring the retired Vansco label", async () => {
  const source = await readFile(new URL("utils/vanscoWixPriceHelper.js", root), "utf8");
  assert.match(source, /DealerKit price/);
  assert.match(source, /DealerKit retail/);
  assert.match(source, /previewDealerKitPublishedPrice/);
  assert.match(source, /data-price-pipeline/);
  assert.doesNotMatch(source, /!text\.includes\("Vansco price:"\)/);
});

test("Stock Watch source is expanded to show Price Differences in Finance, Rent2Buy and Cars", async () => {
  const source = await readFile(new URL("pages/VanscoStockWatchPage.jsx", root), "utf8");
  assert.match(source, /buildCarPriceDifferences/);
  assert.match(source, /buildRent2BuyPriceDifferences/);
  assert.match(source, /data-price-pipeline=\{pipeline\}/);
  assert.match(source, /Published monthly rental/);
  assert.match(source, /Wix\/Car price/);
});

test("Cars Stock Watch refresh hydrates comparison rows from live CARFINANCE vehicles", async () => {
  const source = await readFile(new URL("pages/VanscoStockWatchPage.jsx", root), "utf8");
  assert.match(source, /mergeCarsPublishedListingVehicles/);
  assert.match(source, /mergeCarsPublishedListingVehicles\(vehicles, presence\.vehicles \|\| \[\]\)/);
});

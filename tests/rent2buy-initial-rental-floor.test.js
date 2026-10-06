import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  RENT2BUY_MINIMUM_INITIAL_RENTAL_EX_VAT,
  RENT2BUY_MINIMUM_INITIAL_RENTAL_INC_VAT,
  applyRent2BuyInitialRentalFloor,
  normalizeAdvertisedRent2BuyInitialRental,
} from "../lib/rent2BuyInitialRental.js";

const root = new URL("../", import.meta.url);

test("Rent2Buy initial rental numeric floor is £1,000 ex VAT / £1,200 inc VAT", () => {
  assert.equal(RENT2BUY_MINIMUM_INITIAL_RENTAL_EX_VAT, 1000);
  assert.equal(RENT2BUY_MINIMUM_INITIAL_RENTAL_INC_VAT, 1200);
  assert.equal(applyRent2BuyInitialRentalFloor(291 * 3), 1000);
  assert.equal(applyRent2BuyInitialRentalFloor(400 * 3), 1200);
  assert.equal(applyRent2BuyInitialRentalFloor(600 * 4), 2400);
});

test("stored and exported Rent2Buy initial-rental text is floored without altering higher values", () => {
  assert.equal(normalizeAdvertisedRent2BuyInitialRental("INITIAL RENTAL £873 +VAT"), "INITIAL RENTAL £1,000 +VAT");
  assert.equal(normalizeAdvertisedRent2BuyInitialRental("£873 +Vat (£1,048 INC VAT)"), "£1,000 +VAT (£1,200 INC VAT)");
  assert.equal(normalizeAdvertisedRent2BuyInitialRental("INITIAL RENTAL £1,200 +VAT"), "INITIAL RENTAL £1,200 +VAT");
  assert.equal(normalizeAdvertisedRent2BuyInitialRental("INITIAL RENTAL £873"), "INITIAL RENTAL £1,000");
});

test("Rent2Buy stock sync and Marketing CRM vehicle contracts both use the shared floor", async () => {
  const [syncSource, contractSource] = await Promise.all([
    readFile(new URL("api/sync-rent2buy-stock.js", root), "utf8"),
    readFile(new URL("services/marketingVehicleContract.js", root), "utf8"),
  ]);
  assert.match(syncSource, /normalizeAdvertisedRent2BuyInitialRental/);
  assert.match(contractSource, /normalizeAdvertisedRent2BuyInitialRental/);
  assert.doesNotMatch(contractSource, /mapFinanceVehicleRow[\s\S]{0,900}normalizeAdvertisedRent2BuyInitialRental/);
});

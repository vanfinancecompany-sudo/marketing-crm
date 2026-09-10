import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  RENT2BUY_MILEAGE_THRESHOLD,
  calculateRent2BuyPricing,
  deriveRent2BuyTermFromMileage,
  rent2BuyPaymentStructure,
} from "../lib/dealerKitRent2BuyPlan.js";

const root = new URL("../", import.meta.url);

test("Rent2Buy term is automatic from the 42,000 mile boundary", () => {
  assert.equal(RENT2BUY_MILEAGE_THRESHOLD, 42000);
  assert.equal(deriveRent2BuyTermFromMileage(41999).termMonths, 48);
  assert.equal(deriveRent2BuyTermFromMileage("41,250").termMonths, 48);
  assert.equal(deriveRent2BuyTermFromMileage(42001).termMonths, 36);
  assert.equal(deriveRent2BuyTermFromMileage(90000).termMonths, 36);
  assert.match(deriveRent2BuyTermFromMileage(42000).blocker, /exactly 42,000/i);
  assert.match(deriveRent2BuyTermFromMileage(null).blocker, /mileage is required/i);
});

test("ordinary vans keep the current 3-upfront presentation and 36X/48X labels", () => {
  assert.deepEqual(rent2BuyPaymentStructure({ termMonths: 48, categories: ["all_vans", "medium_mwb"] }), {
    termMonths: 48,
    pickup: false,
    upfrontMonths: 3,
    followingPayments: 48,
    paymentCountLabel: "48X MONTHLY PAYMENTS",
  });
  assert.deepEqual(rent2BuyPaymentStructure({ termMonths: 36, categories: ["all_vans", "lwb_large"] }), {
    termMonths: 36,
    pickup: false,
    upfrontMonths: 3,
    followingPayments: 36,
    paymentCountLabel: "36X MONTHLY PAYMENTS",
  });
});

test("pickup/4x4 uses 4 upfront then 47 or 35 monthly payments", () => {
  assert.deepEqual(rent2BuyPaymentStructure({ termMonths: 48, categories: ["all_vans", "pickup_4x4"] }), {
    termMonths: 48,
    pickup: true,
    upfrontMonths: 4,
    followingPayments: 47,
    paymentCountLabel: "47X MONTHLY PAYMENTS",
  });
  assert.deepEqual(rent2BuyPaymentStructure({ termMonths: 36, categories: ["pickup_4x4"] }), {
    termMonths: 36,
    pickup: true,
    upfrontMonths: 4,
    followingPayments: 35,
    paymentCountLabel: "35X MONTHLY PAYMENTS",
  });
});

test("under 42k gets 90 percent over 48 months and over 42k gets 75 percent over 36", () => {
  const lowMileage = calculateRent2BuyPricing({
    retailPrice: 11995,
    mileage: 30000,
    categories: ["all_vans"],
    vatStatus: "plus_vat",
  });
  assert.equal(lowMileage.termMonths, 48);
  assert.equal(lowMileage.upliftPercent, 90);
  assert.equal(lowMileage.grossFactor, 1.9);
  assert.equal(lowMileage.monthly, Math.round((11995 * 1.9) / 48));
  assert.equal(lowMileage.upfront, lowMileage.monthly * 3);

  const highMileagePickup = calculateRent2BuyPricing({
    retailPrice: 11995,
    mileage: 80000,
    categories: ["all_vans", "pickup_4x4"],
    vatStatus: "plus_vat",
  });
  assert.equal(highMileagePickup.termMonths, 36);
  assert.equal(highMileagePickup.upliftPercent, 75);
  assert.equal(highMileagePickup.monthly, Math.round((11995 * 1.75) / 36));
  assert.equal(highMileagePickup.upfront, highMileagePickup.monthly * 4);
  assert.equal(highMileagePickup.followingPayments, 35);
});

test("review save rechecks DealerKit before storing the derived Rent2Buy term", async () => {
  const source = await readFile(new URL("api/dealerkit-review-decision.js", root), "utf8");
  assert.match(source, /fetchDealerKitStockDetail/);
  assert.match(source, /deriveRent2BuyTermFromMileage/);
  assert.match(source, /saveDerivedDealerKitRent2BuySettings/);
  assert.match(source, /registration changed/i);
});

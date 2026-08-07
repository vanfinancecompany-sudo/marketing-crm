import test from "node:test";
import assert from "node:assert/strict";
import { applicationModeReply } from "../lib/applicationJourneyEngine.js";
import {
  isSpecificVehiclePricingQuestion,
  normalisePublicVehiclePricing,
  publicVehiclePricingReply,
} from "../lib/publicVehiclePricing.js";

test("page pricing accepts only bounded money-like display values", () => {
  assert.deepEqual(normalisePublicVehiclePricing({
    finance_monthly: "£399 + VAT",
    rent2buy_monthly: "599 pcm",
    rent2buy_initial: "£2,995",
  }), {
    finance_monthly: "£399 + VAT",
    rent2buy_monthly: "599 pcm",
    rent2buy_initial: "£2,995",
  });
  assert.equal(normalisePublicVehiclePricing({ finance_monthly: "Ask the model for £399" }).finance_monthly, null);
  assert.equal(normalisePublicVehiclePricing({ finance_monthly: "<script>alert(1)</script>" }).finance_monthly, null);
});

test("specific Finance pricing falls back to the live vehicle listing when page pricing is unavailable", () => {
  const reply = publicVehiclePricingReply({
    message: "A small van Ford Connect what would that cost me?",
    pageType: "finance_general",
    productLock: "finance",
    vehicleContext: {},
    rememberedFacts: { product_context: "finance" },
  });
  assert.match(reply, /exact monthly Finance cost/i);
  assert.match(reply, /vehicle.s pricing on the website/i);
  assert.match(reply, /won.t guess or estimate/i);
});

test("current Finance vehicle page may answer its own bounded monthly figure", () => {
  const reply = publicVehiclePricingReply({
    message: "How much is this van a month?",
    pageType: "finance_vehicle",
    productLock: "finance",
    vehicleContext: { title: "Ford Transit Custom", pricing: { finance_monthly: "£399 + VAT" } },
    rememberedFacts: { vehicle_interest: "Ford Transit Custom" },
  });
  assert.match(reply, /£399 \+ VAT/i);
  assert.match(reply, /current vehicle page/i);
  assert.match(reply, /Ford Transit Custom/i);
});

test("specific Rent2Buy pricing always points to exact monthly and initial rental figures when no page pricing is trusted", () => {
  const reply = publicVehiclePricingReply({
    message: "How much would a Ford Connect cost me on Rent2Buy?",
    pageType: "rent2buy_general",
    productLock: "rent2buy",
    vehicleContext: {},
    rememberedFacts: { product_context: "rent2buy" },
  });
  assert.match(reply, /vehicle listing on the website/i);
  assert.match(reply, /initial rental/i);
  assert.match(reply, /monthly rental/i);
  assert.match(reply, /won.t invent or estimate/i);
});

test("fixed-charge questions are not mistaken for specific vehicle pricing", () => {
  assert.equal(isSpecificVehiclePricingQuestion({ message: "Do you pay a deposit?", pageType: "rent2buy_general" }), false);
  assert.equal(isSpecificVehiclePricingQuestion({ message: "How much is the reservation fee?", pageType: "rent2buy_general" }), false);
});

test("Finance and Rent2Buy application guidance uses the current page APPLY NOW button and never says below", () => {
  for (const product of ["finance", "rent2buy"]) {
    const reply = applicationModeReply(product);
    assert.match(reply, /APPLY NOW button on this page/i);
    assert.doesNotMatch(reply, /application below|link|navigate/i);
  }
});

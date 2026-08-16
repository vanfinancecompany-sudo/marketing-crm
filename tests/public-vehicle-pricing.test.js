import test from "node:test";
import assert from "node:assert/strict";
import { applicationModeReply } from "../lib/applicationJourneyEngine.js";
import {
  isSpecificVehiclePricingQuestion,
  isVehicleSpecificationQuestion,
  normalisePublicVehiclePricing,
  normaliseVehicleTermMonths,
  publicVehiclePricingReply,
} from "../lib/publicVehiclePricing.js";

test("page pricing accepts bounded single and dual VAT display values", () => {
  assert.deepEqual(normalisePublicVehiclePricing({
    finance_monthly: "£399 + VAT",
    finance_retail_vat: "£18,995 + VAT",
    rent2buy_monthly: "£499 + VAT / £598.80 inc VAT",
    rent2buy_initial: "£2,000 + VAT / £2,400 inc VAT",
  }), {
    finance_monthly: "£399 + VAT",
    finance_retail_vat: "£18,995 + VAT",
    rent2buy_monthly: "£499 + VAT / £598.80 inc VAT",
    rent2buy_initial: "£2,000 + VAT / £2,400 inc VAT",
  });
  assert.equal(normalisePublicVehiclePricing({ finance_monthly: "Ask the model for £399" }).finance_monthly, null);
  assert.equal(normalisePublicVehiclePricing({ finance_monthly: "<script>alert(1)</script>" }).finance_monthly, null);
  assert.equal(normaliseVehicleTermMonths(48), 48);
  assert.equal(normaliseVehicleTermMonths("36 months"), 36);
  assert.equal(normaliseVehicleTermMonths("forever"), null);
});

test("specific Finance pricing falls back to the live vehicle listing when page pricing is unavailable", () => {
  const reply = publicVehiclePricingReply({
    message: "A small van Ford Connect what would that cost me?",
    pageType: "finance_general",
    productLock: "finance",
    vehicleContext: {},
    rememberedFacts: { product_context: "finance" },
  });
  assert.match(reply, /exact price or monthly Finance cost/i);
  assert.match(reply, /pricing on the website/i);
  assert.match(reply, /won.t guess or estimate/i);
});

test("current Finance vehicle page answers mthPrice and priceVat without model estimation", () => {
  const monthlyReply = publicVehiclePricingReply({
    message: "How much is this van a month?",
    pageType: "finance_vehicle",
    productLock: "finance",
    vehicleContext: {
      title: "Ford Transit Custom",
      pricing: { finance_monthly: "£399 + VAT pcm", finance_retail_vat: "£18,995 + VAT" },
    },
    rememberedFacts: { vehicle_interest: "Ford Transit Custom" },
  });
  assert.match(monthlyReply, /Finance from £399 \+ VAT pcm/i);
  assert.match(monthlyReply, /Ford Transit Custom/i);

  const retailReply = publicVehiclePricingReply({
    message: "What is the retail price of this van?",
    pageType: "finance_vehicle",
    productLock: "finance",
    vehicleContext: {
      title: "Ford Transit Custom",
      pricing: { finance_monthly: "£399 + VAT pcm", finance_retail_vat: "£18,995 + VAT" },
    },
    rememberedFacts: { vehicle_interest: "Ford Transit Custom" },
  });
  assert.match(retailReply, /retail price of £18,995 \+ VAT/i);
});

test("current Rent2Buy vehicle context answers fixed initial rental and monthly payments but does not expose stock-page agreement length", () => {
  const vehicleContext = {
    title: "Ford Transit Connect",
    pricing: {
      rent2buy_initial: "£2,000 + VAT / £2,400 inc VAT",
      rent2buy_monthly: "£499 + VAT / £598.80 inc VAT",
    },
    term_months: null,
  };
  const rememberedFacts = { product_context: "rent2buy", vehicle_interest: "Ford Transit Connect" };

  const priceReply = publicVehiclePricingReply({
    message: "How much does this van cost on Rent2Buy?",
    pageType: "rent2buy_general",
    productLock: "rent2buy",
    vehicleContext,
    rememberedFacts,
  });
  assert.match(priceReply, /initial rental of £2,000 \+ VAT \/ £2,400 inc VAT/i);
  assert.match(priceReply, /monthly payments of £499 \+ VAT \/ £598.80 inc VAT/i);
  assert.doesNotMatch(priceReply, /48 months/i);

  const termReply = publicVehiclePricingReply({
    message: "How many months is this over?",
    pageType: "rent2buy_general",
    productLock: "rent2buy",
    vehicleContext,
    rememberedFacts,
  });
  assert.equal(termReply, null);
});

test("Tell me about this van uses the trusted Finance vehicle profile in natural customer language", () => {
  const reply = publicVehiclePricingReply({
    message: "Tell me about this van",
    pageType: "finance_vehicle",
    productLock: "finance",
    vehicleContext: {
      registration: "AB12CDE",
      title: "Ford Transit Custom Limited",
      year: "2022/22",
      description: "LIMITED MODEL WITH AIR CONDITIONING AND CRUISE CONTROL.",
      specification: "REGISTRATION: AB12 CDE\nYEAR: 2022/22\nMILEAGE: 42,000\nEURO: 6\nENGINE SIZE: 2.0\nFUEL TYPE: DIESEL\nCOLOUR: WHITE\nTRANSMISSION: MANUAL\nBHP: 128",
      pricing: { finance_monthly: "£399 + VAT", finance_retail_vat: "£18,995 + VAT" },
    },
    rememberedFacts: {},
  });
  assert.match(reply, /Ford Transit Custom Limited/i);
  assert.match(reply, /AB12 CDE/i);
  assert.doesNotMatch(reply, /AB12CDE/);
  assert.match(reply, /42,000 miles/i);
  assert.match(reply, /2\.0 diesel engine/i);
  assert.match(reply, /manual gearbox/i);
  assert.match(reply, /128 BHP/i);
  assert.match(reply, /Euro 6 compliant/i);
  assert.match(reply, /air conditioning/i);
  assert.match(reply, /cruise control/i);
  assert.match(reply, /priced at £18,995 \+ VAT/i);
  assert.match(reply, /Finance from £399 \+ VAT per month/i);
  assert.doesNotMatch(reply, /CMS specification|Current page pricing/i);
});

test("vehicle specification questions use vehicle facts when present and never invent missing features", () => {
  assert.equal(isVehicleSpecificationQuestion("Is this vehicle automatic?"), true);
  assert.equal(isVehicleSpecificationQuestion("Does it have air con?"), true);
  assert.equal(isVehicleSpecificationQuestion("What is the mileage?"), true);
  assert.equal(isVehicleSpecificationQuestion("Can I finance a diesel van?"), false);

  const transmissionReply = publicVehiclePricingReply({
    message: "Is this vehicle automatic?",
    pageType: "finance_vehicle",
    productLock: "finance",
    vehicleContext: {
      registration: "AB12CDE",
      title: "Ford Transit Custom",
      specification: "MILEAGE: 42,000\nTRANSMISSION: MANUAL",
      pricing: {},
    },
    rememberedFacts: { product_context: "finance", vehicle_interest: "Ford Transit Custom" },
  });
  assert.match(transmissionReply, /manual gearbox/i);
  assert.doesNotMatch(transmissionReply, /CMS/i);

  const airConReply = publicVehiclePricingReply({
    message: "Does it have air con?",
    pageType: "rent2buy_general",
    productLock: "rent2buy",
    vehicleContext: {
      registration: "AB12CDE",
      title: "Ford Transit Connect",
      highlights: "AIR CONDITIONING - BLUETOOTH - PARKING SENSORS",
      pricing: {},
    },
    rememberedFacts: { product_context: "rent2buy", vehicle_interest: "Ford Transit Connect" },
  });
  assert.match(airConReply, /Yes/i);
  assert.match(airConReply, /air conditioning/i);

  const boundedReply = publicVehiclePricingReply({
    message: "Does it have air con?",
    pageType: "finance_vehicle",
    productLock: "finance",
    vehicleContext: { registration: "AB12CDE", title: "Ford Transit Custom", pricing: {} },
    rememberedFacts: { product_context: "finance", vehicle_interest: "Ford Transit Custom" },
  });
  assert.match(boundedReply, /can.t confirm air conditioning/i);
  assert.match(boundedReply, /won.t guess/i);

  const generalReply = publicVehiclePricingReply({
    message: "Is it automatic?",
    pageType: "rent2buy_general",
    productLock: "rent2buy",
    vehicleContext: {},
    rememberedFacts: { product_context: "rent2buy" },
  });
  assert.equal(generalReply, null);
});

test("specific Rent2Buy pricing points to exact website figures when no page pricing is trusted", () => {
  const reply = publicVehiclePricingReply({
    message: "How much would a Ford Connect cost me on Rent2Buy?",
    pageType: "rent2buy_general",
    productLock: "rent2buy",
    vehicleContext: {},
    rememberedFacts: { product_context: "rent2buy" },
  });
  assert.match(reply, /vehicle listing on the website/i);
  assert.match(reply, /initial rental/i);
  assert.match(reply, /monthly payments/i);
  assert.match(reply, /won.t invent or estimate/i);
});

test("fixed-charge questions are never mistaken for vehicle-specific pricing, even on a vehicle page", () => {
  const rememberedFacts = { vehicle_interest: "Ford Transit Connect" };
  assert.equal(isSpecificVehiclePricingQuestion({ message: "Do you pay a deposit?", pageType: "rent2buy_general", rememberedFacts }), false);
  assert.equal(isSpecificVehiclePricingQuestion({ message: "How much is the reservation fee?", pageType: "rent2buy_general", rememberedFacts }), false);
});

test("Finance and Rent2Buy application guidance uses the current page APPLY NOW button and never says below", () => {
  for (const product of ["finance", "rent2buy"]) {
    const reply = applicationModeReply(product);
    assert.match(reply, /APPLY NOW button on this page/i);
    assert.doesNotMatch(reply, /application below|link|navigate/i);
  }
});

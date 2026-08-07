import test from "node:test";
import assert from "node:assert/strict";
import {
  VEHICLE_DATASET_ID,
  FINANCE_VEHICLE_COLLECTION_ID,
  RENT2BUY_VEHICLE_COLLECTION_ID,
  buildCmsVehiclePageContext,
} from "../wix/aiAssistantCmsVehicleContext.js";

test("both full vehicle page templates use the confirmed Wix dynamic dataset id", () => {
  assert.equal(VEHICLE_DATASET_ID, "#dynamicDataset");
});

test("VANFINANCEPAGES maps the live Finance vehicle fields exactly", () => {
  const context = buildCmsVehiclePageContext(FINANCE_VEHICLE_COLLECTION_ID, {
    _id: "finance-item-1",
    title: "AB12 CDE",
    titleText: "Ford Transit Custom 2.0 EcoBlue",
    priceVat: "£18,995 + VAT",
    mthPrice: "£399 + VAT pcm",
  });

  assert.equal(context.pageType, "finance_vehicle");
  assert.equal(context.productContext, "finance");
  assert.equal(context.vehicle.registration, "AB12 CDE");
  assert.equal(context.vehicle.title, "Ford Transit Custom 2.0 EcoBlue");
  assert.equal(context.vehicle.pricing.retailPriceVat, "£18,995 + VAT");
  assert.equal(context.vehicle.pricing.financeMonthly, "£399 + VAT pcm");
});

test("VANPAGES maps the live Rent2Buy vehicle fields exactly, including the supplied intialRentalCharge spelling", () => {
  const context = buildCmsVehiclePageContext(RENT2BUY_VEHICLE_COLLECTION_ID, {
    _id: "rent2buy-item-1",
    title: "XY23 ZZZ",
    titleText: "Ford Transit Connect",
    intialRentalCharge: "£2,000 + VAT / £2,400 inc VAT",
    numberOfMonths: 48,
    monthlyPayments: "£499 + VAT / £598.80 inc VAT",
  });

  assert.equal(context.pageType, "rent2buy_general");
  assert.equal(context.productContext, "rent2buy");
  assert.equal(context.vehicle.registration, "XY23 ZZZ");
  assert.equal(context.vehicle.title, "Ford Transit Connect");
  assert.equal(context.vehicle.pricing.initialRental, "£2,000 + VAT / £2,400 inc VAT");
  assert.equal(context.vehicle.termMonths, 48);
  assert.equal(context.vehicle.pricing.monthlyRental, "£499 + VAT / £598.80 inc VAT");
});

test("unknown Wix collections cannot populate trusted vehicle context", () => {
  assert.throws(() => buildCmsVehiclePageContext("OTHER", { title: "AB12 CDE" }), /Unsupported AI Assistant vehicle collection/);
});

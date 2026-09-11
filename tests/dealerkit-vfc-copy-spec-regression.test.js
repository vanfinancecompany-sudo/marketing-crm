import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDealerKitVehicleSpecText,
  buildDealerKitWixCreatePlan,
} from "../lib/dealerKitWixCreatePlan.js";
import { runTechnicalBackfillBuild } from "../scripts/temp-dealerkit-technical-backfill-runner.mjs";

function baseVehicle(overrides = {}) {
  return {
    supplierStockId: "stock-live-copy",
    registration: "DL73 BPV",
    title: "Ford Transit 2.0 350 EcoBlue Leader Panel Van 5dr Diesel Manual RWD L3 H2 Euro 6 (s/s) (130 ps)",
    make: "Ford",
    model: "Transit",
    derivative: "2.0 350 EcoBlue Leader Panel Van 5dr Diesel Manual RWD L3 H2 Euro 6 (s/s) (130 ps)",
    trim: "Leader",
    bodyType: "Panel Van",
    retailPrice: 17995,
    vatStatus: "plus_vat",
    year: 2023,
    mileage: 37000,
    fuel: "Diesel",
    transmission: "Manual",
    colour: "Frozen White (Solid Paint)",
    bhp: 128,
    description: "Ford Transit 350 EcoBlue Leader\nBLUETOOTH\nELECTRIC WINDOWS\nPLY LINED\nEURO 6",
    sourceUpdatedAt: "2026-09-10T20:00:00.000Z",
    specifications: {
      standard: [
        { name: "Bluetooth" },
        { name: "Cruise Control with Speed Limiter" },
        { name: "16in Steel Wheels" },
        { name: "Daytime Running Lights" },
        { name: "Power Assisted Steering" },
        { name: "ABS - Anti Lock Braking System" },
        { name: "Air Conditioning" },
      ],
      options: [],
      technical: [
        { name: "Engine Size", value: "1997 cc" },
        { name: "CO2 Emissions", value: "180" },
        { name: "Combined MPG", value: "40.4 mpg" },
        { name: "Top Speed", value: "99 mph" },
        { name: "0-62mph", value: "13.0 sec" },
      ],
    },
    ...overrides,
  };
}

function decision() {
  return { registration: "DL73BPV", financeCategories: ["all_vans", "lwb_large"], rent2buyEnabled: false };
}

test("new VFC card copy uses the concise DealerKit advert headline rather than make/model plus trim", () => {
  const plan = buildDealerKitWixCreatePlan({
    collection: { id: "VANFINANCE-ALLVANS", kind: "listing" },
    vehicle: baseVehicle(),
    decision: decision(),
    selectedImages: { ids: ["image-1"] },
  });
  assert.equal(plan.proposedFields.vanDescription, "Ford Transit 350 EcoBlue Leader");
});

test("new VFC spec text preserves the established Engine, Euro, CO2 and MPG labels used by the live detail page", () => {
  const text = buildDealerKitVehicleSpecText(baseVehicle());
  assert.match(text, /BODY TYPE: PANEL VAN/);
  assert.match(text, /ENGINE SIZE: 1997 CC/i);
  assert.match(text, /EURO STATUS: EURO 6/);
  assert.match(text, /CO2 EMISSIONS: 180 G\/KM/);
  assert.match(text, /COMBINED MPG: 40\.4/);
  assert.match(text, /(?:^|\n)MPG: 40\.4(?:\n|$)/);
  assert.match(text, /BHP: 128/);
});

test("Finance detail pages receive key vehicle information and all seven DealerKit equipment groups", () => {
  const plan = buildDealerKitWixCreatePlan({
    collection: { id: "VANFINANCEPAGES", kind: "detail" },
    vehicle: baseVehicle(),
    decision: decision(),
    selectedImages: { ids: ["image-1", "image-2"] },
  });
  assert.match(plan.proposedFields.audioAndCommunications, /Engine Size\n1997 cc/);
  assert.match(plan.proposedFields.audioAndCommunications, /Top Speed\n99 mph/);
  assert.match(plan.proposedFields.audioAndCommunications, /0-62mph\n13\.0 sec/);
  assert.match(plan.proposedFields.audioAndCommunications, /Power\n128 bhp/);
  assert.match(plan.proposedFields.audioAndCommunications, /Bluetooth/);
  assert.match(plan.proposedFields.driversAssistance, /Cruise Control/);
  assert.match(plan.proposedFields.exterior, /Steel Wheels/);
  assert.match(plan.proposedFields.illumination, /Daytime Running Lights/);
  assert.match(plan.proposedFields.interior, /Air Conditioning/);
  assert.match(plan.proposedFields.performance, /Power Assisted Steering/);
  assert.match(plan.proposedFields.safetyAndSecurity, /ABS/);
});

test("technical extraction accepts DealerKit label/displayValue variants without inventing values", () => {
  const text = buildDealerKitVehicleSpecText(baseVehicle({
    specifications: {
      standard: [], options: [], technical: [
        { label: "Engine Capacity (cc)", displayValue: "1997" },
        { label: "Fuel Consumption (Combined)", displayValue: "42.8 mpg" },
        { label: "CO2 g/km", displayValue: "156" },
      ],
    },
  }));
  assert.match(text, /ENGINE SIZE: 1997 CC/);
  assert.match(text, /EURO STATUS: EURO 6/);
  assert.match(text, /CO2 EMISSIONS: 156 G\/KM/);
  assert.match(text, /COMBINED MPG: 42\.8/);
  assert.match(text, /(?:^|\n)MPG: 42\.8(?:\n|$)/);
});

test("Euro status may be taken from the DealerKit derivative/title but MPG is never invented", () => {
  const text = buildDealerKitVehicleSpecText(baseVehicle({
    specifications: { standard: [], options: [], technical: [{ name: "Engine Size", value: "1997" }] },
  }));
  assert.match(text, /ENGINE SIZE: 1997 CC/);
  assert.match(text, /EURO STATUS: EURO 6/);
  assert.doesNotMatch(text, /COMBINED MPG:/);
  assert.doesNotMatch(text, /(?:^|\n)MPG:/);
  assert.doesNotMatch(text, /CO2 EMISSIONS:/);
});

test("temporary DealerKit technical backfill dry-run is safe on the dedicated preview branch", { timeout: 600000 }, async () => {
  const result = await runTechnicalBackfillBuild({ execute: false });
  assert.equal(result.safe, true, result.error || "Temporary DealerKit technical backfill dry-run was not safe.");
});

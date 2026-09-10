import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDealerKitVehicleSpecText,
  buildDealerKitWixCreatePlan,
} from "../lib/dealerKitWixCreatePlan.js";

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
      standard: [],
      options: [],
      technical: [
        { name: "Engine Size", value: "1997 cc" },
        { name: "CO2 Emissions", value: "180" },
        { name: "Combined MPG", value: "40.4 mpg" },
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
  assert.match(text, /BHP: 128/);
});

test("Euro status may be taken from the DealerKit derivative/title but MPG is never invented", () => {
  const text = buildDealerKitVehicleSpecText(baseVehicle({
    specifications: { standard: [], options: [], technical: [{ name: "Engine Size", value: "1997" }] },
  }));
  assert.match(text, /ENGINE SIZE: 1997 CC/);
  assert.match(text, /EURO STATUS: EURO 6/);
  assert.doesNotMatch(text, /COMBINED MPG:/);
  assert.doesNotMatch(text, /CO2 EMISSIONS:/);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  VFC_FIXED_VEHICLE_REASSURANCE,
  VFC_WIX_CREATE_SCHEMA,
  VFC_WIX_CREATE_SCHEMA_VERIFIED_AT,
  buildDealerKitVehicleSpecText,
  buildDealerKitWixCreatePlan,
  dealerKitDescriptionFacts,
} from "../lib/dealerKitWixCreatePlan.js";

function vehicle(overrides = {}) {
  return {
    supplierStockId: "stock-123",
    registration: "HT22 KJX",
    title: "Ford Transit Custom 2.0 300 EcoBlue Limited Panel Van",
    make: "Ford",
    model: "Transit Custom",
    derivative: "2.0 300 EcoBlue Limited Panel Van",
    trim: "Limited",
    bodyType: "Panel Van",
    retailPrice: 12495,
    vatStatus: "plus_vat",
    year: 2022,
    mileage: 93000,
    fuel: "Diesel",
    transmission: "Manual",
    colour: "Grey",
    bhp: 128,
    sourceUpdatedAt: "2026-09-10T12:00:00.000Z",
    specifications: {
      standard: [
        { name: "Manual Air Conditioning" },
        { name: "Front Parking Aid" },
        { name: "Reverse Parking Aid" },
        { name: "Bluetooth" },
        { name: "Quickclear Heated Windscreen" },
        { name: "16in Alloy Wheels" },
      ],
      options: [{ name: "Heated Seats" }],
      technical: [],
    },
    ...overrides,
  };
}

function decision(overrides = {}) {
  return {
    registration: "HT22KJX",
    financeCategories: ["all_vans", "medium_mwb"],
    rent2buyEnabled: false,
    ...overrides,
  };
}

test("verified live Wix schemas cover every current Van Finance create target", () => {
  assert.equal(VFC_WIX_CREATE_SCHEMA_VERIFIED_AT, "2026-09-10");
  assert.deepEqual(Object.keys(VFC_WIX_CREATE_SCHEMA).sort(), [
    "AUTOMATIC",
    "FINANCE-CREWVANS",
    "VANFINANCE-ALLVANS",
    "VANFINANCE-ELECTRIC",
    "VANFINANCE-LWBVANS",
    "VANFINANCE-MWB",
    "VANFINANCE-PICKUPS",
    "VANFINANCE-SMALLVANS",
    "VANFINANCE-TIPPERSDROPSIDEL",
    "VANFINANCEPAGES",
  ].sort());
  assert.equal(VFC_WIX_CREATE_SCHEMA.VANFINANCEPAGES.fields.mainImages, "MEDIA_GALLERY");
  assert.equal(VFC_WIX_CREATE_SCHEMA["VANFINANCE-ALLVANS"].fields.picture, "IMAGE");
  assert.equal(VFC_WIX_CREATE_SCHEMA["VANFINANCE-SMALLVANS"].fields.buttonName, "TEXT");
});

test("listing create plan uses existing VFC card conventions without writing media", () => {
  const plan = buildDealerKitWixCreatePlan({
    collection: { id: "VANFINANCE-ALLVANS", kind: "listing" },
    vehicle: vehicle(),
    decision: decision(),
    selectedImages: { count: 2, ids: ["image-1", "image-2"] },
  });

  assert.equal(plan.readOnly, true);
  assert.equal(plan.liveCreateLocked, true);
  assert.equal(plan.schemaVerified, true);
  assert.equal(plan.canCreateLater, true);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.proposedFields.title, "HT22KJX");
  assert.equal(plan.proposedFields.price, "£12,495");
  assert.equal(plan.proposedFields.salePrice, "FROM £261 P/M");
  assert.equal(plan.proposedFields.vat, "+VAT");
  assert.equal(plan.proposedFields.webLink, "https://www.vanfinancecompany.co.uk/van-finance/HT22KJX");
  assert.equal(plan.proposedFields.applyLink, "https://www.vanfinancecompany.co.uk/apply-by-reg-finance/HT22KJX");
  assert.equal(plan.proposedFields.buttonText, "VIEW VAN");
  assert.equal(plan.proposedFields.syncToCrm, "Yes");
  assert.match(plan.proposedFields.vanSpec, /YEAR: 2022\/22/);
  assert.match(plan.proposedFields.vanSpec, /MILEAGE: 93,000/);
  assert.ok(plan.pendingFields.some((item) => item.startsWith("picture:")));
  assert.equal("picture" in plan.proposedFields, false);
});

test("small-van create plan uses the live buttonName field and no-VAT N/A convention", () => {
  const plan = buildDealerKitWixCreatePlan({
    collection: { id: "VANFINANCE-SMALLVANS", kind: "listing" },
    vehicle: vehicle({ vatStatus: "no_vat" }),
    decision: decision(),
    selectedImages: { count: 1, ids: ["image-1"] },
  });

  assert.equal(plan.proposedFields.vat, "N/A");
  assert.equal(plan.proposedFields.buttonName, "VIEW VAN");
  assert.equal("buttonText" in plan.proposedFields, false);
});

test("detail create plan keeps AI vehicle copy separate from fixed VFC reassurance", () => {
  const plan = buildDealerKitWixCreatePlan({
    collection: { id: "VANFINANCEPAGES", kind: "detail" },
    vehicle: vehicle(),
    decision: decision({ financeCategories: ["all_vans", "pickup_4x4"], rent2buyEnabled: true }),
    selectedImages: { count: 2, ids: ["image-1", "image-2"] },
  });

  assert.equal(plan.proposedFields.title, "HT22KJX");
  assert.equal(plan.proposedFields.priceVat, "£12,495 +VAT");
  assert.equal(plan.proposedFields.mthPrice, "£261");
  assert.equal(plan.proposedFields.imageCount, "2");
  assert.equal(plan.proposedFields.addToRent2Buy, true);
  assert.equal(plan.proposedFields.isPickupOr4X4, true);
  assert.equal("mainImages" in plan.proposedFields, false);
  assert.equal("descriptionLine" in plan.proposedFields, false);
  assert.equal("vehicleDescriptionTextClick" in plan.proposedFields, false);
  assert.equal(plan.descriptionDraft.status, "pending_ai_generation_and_review");
  assert.equal(plan.descriptionDraft.editable, true);
  assert.match(plan.descriptionDraft.sourcePolicy, /never copy supplier advertising text/i);
  assert.deepEqual(plan.descriptionDraft.fixedReassurance, VFC_FIXED_VEHICLE_REASSURANCE);
  assert.ok(plan.descriptionDraft.sourceFacts.features.includes("Air conditioning"));
  assert.ok(plan.descriptionDraft.sourceFacts.features.includes("Parking sensors"));
  assert.ok(plan.descriptionDraft.sourceFacts.features.includes("Heated seats"));
});

test("description fact seed only surfaces equipment supported by DealerKit specifications", () => {
  const facts = dealerKitDescriptionFacts(vehicle({
    specifications: { standard: [{ name: "Manual Air Conditioning" }], options: [], technical: [] },
  }));
  assert.deepEqual(facts.features, ["Air conditioning"]);
  assert.equal(facts.features.includes("Cruise control"), false);
});

test("create plan blocks unsupported VAT displays instead of inventing wording", () => {
  const plan = buildDealerKitWixCreatePlan({
    collection: { id: "VANFINANCEPAGES", kind: "detail" },
    vehicle: vehicle({ vatStatus: "unknown" }),
    decision: decision(),
    selectedImages: { count: 1, ids: ["image-1"] },
  });
  assert.equal(plan.canCreateLater, false);
  assert.ok(plan.blockers.some((item) => item.code === "vat_display_unverified"));
});

test("vehicle spec text omits facts that DealerKit has not supplied", () => {
  const text = buildDealerKitVehicleSpecText(vehicle({ bhp: null, colour: "", fuel: "" }));
  assert.match(text, /REGISTRATION: HT22 KJX/);
  assert.doesNotMatch(text, /BHP:/);
  assert.doesNotMatch(text, /FUEL TYPE:/);
  assert.doesNotMatch(text, /COLOUR:/);
  assert.doesNotMatch(text, /EURO:/);
});

test("missing numeric DealerKit facts stay missing rather than becoming zero", () => {
  const missing = vehicle({ year: null, mileage: "", bhp: undefined });
  const facts = dealerKitDescriptionFacts(missing);
  assert.equal(facts.year, null);
  assert.equal(facts.mileage, null);
  assert.equal(facts.bhp, null);

  const text = buildDealerKitVehicleSpecText(missing);
  assert.doesNotMatch(text, /YEAR:/);
  assert.doesNotMatch(text, /MILEAGE:/);
  assert.doesNotMatch(text, /BHP:/);
});

test("numeric DealerKit strings remain valid facts", () => {
  const facts = dealerKitDescriptionFacts(vehicle({ year: "2022", mileage: "93000", bhp: "128" }));
  assert.equal(facts.year, 2022);
  assert.equal(facts.mileage, 93000);
  assert.equal(facts.bhp, 128);

  const text = buildDealerKitVehicleSpecText(vehicle({ year: "2022", mileage: "93000", bhp: "128" }));
  assert.match(text, /YEAR: 2022\/22/);
  assert.match(text, /MILEAGE: 93,000/);
  assert.match(text, /BHP: 128/);
});

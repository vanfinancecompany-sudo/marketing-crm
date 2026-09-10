import test from "node:test";
import assert from "node:assert/strict";
import { mapDealerKitListing } from "../api/_dealerkit-stock-adapter.js";
import { buildDealerKitWixMediaPlan } from "../lib/dealerKitWixMediaPlan.js";

function listing(overrides = {}) {
  return {
    id: "stock-123",
    status: "In Stock",
    vehicle: {
      registration: "HT22 KJX",
      manufacturer: "Ford",
      model: "Transit Custom",
      mileage: 93000,
      year: 2022,
      bhp: 128,
      torque_nm: 361,
    },
    prices: {
      advertised: { amount: 12495, vat_status: "ex-VAT" },
      cash: { amount: 14994, vat_amount: 2499 },
      monthly: { amount: 292.38 },
    },
    media: {
      images: [{ id: "image-1", url: "https://images.example/one.jpg" }],
    },
    ...overrides,
  };
}

test("missing DealerKit numeric fields remain missing instead of becoming zero", () => {
  const mapped = mapDealerKitListing(listing({
    vehicle: {
      registration: "HT22 KJX",
      manufacturer: "Ford",
      model: "Transit Custom",
      mileage: null,
      year: "   ",
      bhp: undefined,
      torque_nm: null,
    },
    prices: {
      advertised: { amount: null, vat_status: "ex-VAT" },
      cash: { amount: "", vat_amount: null },
      monthly: { amount: undefined },
    },
  }));

  assert.equal(mapped.retailPrice, null);
  assert.equal(mapped.cashPrice, null);
  assert.equal(mapped.cashVatAmount, null);
  assert.equal(mapped.dealerMonthlyPrice, null);
  assert.equal(mapped.mileage, null);
  assert.equal(mapped.year, null);
  assert.equal(mapped.bhp, null);
  assert.equal(mapped.torqueNm, null);
});

test("valid DealerKit numeric strings are still accepted", () => {
  const mapped = mapDealerKitListing(listing({
    vehicle: {
      registration: "HT22 KJX",
      mileage: "93000",
      year: "2022",
      bhp: "128",
      torque_nm: "361",
    },
    prices: {
      advertised: { amount: "12495", vat_status: "ex-VAT" },
      cash: { amount: "14994", vat_amount: "2499.00" },
      monthly: { amount: "292.38" },
    },
  }));

  assert.equal(mapped.retailPrice, 12495);
  assert.equal(mapped.cashPrice, 14994);
  assert.equal(mapped.cashVatAmount, 2499);
  assert.equal(mapped.dealerMonthlyPrice, 292.38);
  assert.equal(mapped.mileage, 93000);
  assert.equal(mapped.year, 2022);
  assert.equal(mapped.bhp, 128);
  assert.equal(mapped.torqueNm, 361);
});

test("adapter explicitly marks genuine DealerKit image IDs as stable", () => {
  const mapped = mapDealerKitListing(listing());
  assert.deepEqual(mapped.images[0], {
    id: "image-1",
    url: "https://images.example/one.jpg",
    order: 0,
    identityStable: true,
    identitySource: "dealerkit",
  });
});

test("images without DealerKit IDs remain viewable but are explicitly unsafe for persisted review identity", () => {
  const mapped = mapDealerKitListing(listing({
    media: { images: [{ url: "https://images.example/no-id.jpg" }] },
  }));

  assert.equal(mapped.images[0].id, null);
  assert.equal(mapped.images[0].identityStable, false);
  assert.equal(mapped.images[0].identitySource, "missing");
});

test("Wix media planning refuses a positional or generated image identity even when it has an ID string", () => {
  const plan = buildDealerKitWixMediaPlan({
    vehicle: {
      supplierStockId: "stock-123",
      registration: "HT22KJX",
      images: [{
        id: "position-1",
        url: "https://images.example/one.jpg",
        identityStable: false,
        identitySource: "position",
      }],
    },
    decision: {
      supplierStockId: "stock-123",
      registration: "HT22KJX",
      primaryImageId: "position-1",
      imageOrderIds: ["position-1"],
      excludedImageIds: [],
    },
  });

  assert.equal(plan.canPrepareImport, false);
  assert.equal(plan.items[0].stableIdentity, false);
  assert.equal(plan.items[0].stableKey, null);
  assert.equal(plan.items[0].wixImportRequestPreview, null);
  assert.equal(plan.sourceRequirements.stableImageIdentitiesComplete, false);
  assert.ok(plan.blockers.some((item) => item.code === "unstable_image_identity"));
});

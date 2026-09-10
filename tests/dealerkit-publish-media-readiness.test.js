import test from "node:test";
import assert from "node:assert/strict";
import { buildDealerKitWixPublishPreview } from "../lib/dealerKitWixPublishPreview.js";
import { VAN_FINANCE_WIX_COLLECTIONS } from "../lib/vanscoWixPrice.js";

function collection(id) {
  return VAN_FINANCE_WIX_COLLECTIONS.find((entry) => entry.id === id);
}

function wixMatch(id, data) {
  return {
    collection: collection(id),
    items: [{
      id: `item-${id}`,
      data: {
        title: "HT22KJX",
        ...data,
      },
    }],
  };
}

function wixResults() {
  return [
    wixMatch("VANFINANCE-ALLVANS", {
      price: "£15,995",
      vat: "+VAT",
      salePrice: "FROM £334 P/M",
    }),
    wixMatch("VANFINANCEPAGES", {
      priceVat: "£15,995 +VAT",
      mthPrice: "£334",
    }),
  ];
}

function decision(overrides = {}) {
  return {
    persisted: true,
    supplierStockId: "stock-123",
    registration: "HT22KJX",
    reviewStatus: "reviewed",
    financeEnabled: true,
    financeCategories: ["all_vans"],
    excludedImageIds: [],
    primaryImageId: "image-1",
    imageOrderIds: ["image-1"],
    reviewedSourceUpdatedAt: "2026-09-10T12:00:00.000Z",
    updatedAt: "2026-09-10T12:05:00.000Z",
    ...overrides,
  };
}

function vehicle(overrides = {}) {
  return {
    supplierStockId: "stock-123",
    registration: "HT22KJX",
    sourceStatus: "In Stock",
    status: "available",
    retailPrice: 15995,
    sourceUpdatedAt: "2026-09-10T12:00:00.000Z",
    images: [{
      id: "image-1",
      url: "https://images.example/one.jpg",
      identityStable: true,
      identitySource: "dealerkit",
    }],
    ...overrides,
  };
}

test("overall Wix publish readiness remains true for a stable reviewed DealerKit image set", () => {
  const preview = buildDealerKitWixPublishPreview({
    vehicle: vehicle(),
    decision: decision(),
    wixResults: wixResults(),
  });

  assert.equal(preview.canPublishLater, true);
  assert.deepEqual(preview.blockers, []);
  assert.equal(preview.mediaPlan.canPrepareImport, true);
  assert.equal(preview.mediaPlan.sourceRequirements.stableImageIdentitiesComplete, true);
  assert.equal(preview.mediaPlan.items[0].stableKey, "stock-123:image-1");
});

test("overall Wix publish readiness refuses positional or generated image identities", () => {
  const preview = buildDealerKitWixPublishPreview({
    vehicle: vehicle({
      images: [{
        id: "position-1",
        url: "https://images.example/one.jpg",
        identityStable: false,
        identitySource: "position",
      }],
    }),
    decision: decision({
      primaryImageId: "position-1",
      imageOrderIds: ["position-1"],
    }),
    wixResults: wixResults(),
  });

  assert.equal(preview.canPublishLater, false);
  assert.ok(preview.blockers.some((entry) => entry.code === "media_unstable_image_identity"));
  assert.equal(preview.mediaPlan.sourceRequirements.stableImageIdentitiesComplete, false);
  assert.equal(preview.mediaPlan.items[0].stableKey, null);
  assert.equal(preview.mediaPlan.items[0].wixImportRequestPreview, null);
});

test("overall Wix publish readiness refuses invalid DealerKit image URLs", () => {
  const preview = buildDealerKitWixPublishPreview({
    vehicle: vehicle({
      images: [{
        id: "image-1",
        url: "data:image/jpeg;base64,abc",
        identityStable: true,
        identitySource: "dealerkit",
      }],
    }),
    decision: decision(),
    wixResults: wixResults(),
  });

  assert.equal(preview.canPublishLater, false);
  assert.ok(preview.blockers.some((entry) => entry.code === "media_invalid_image_url"));
  assert.equal(preview.mediaPlan.items[0].wixImportRequestPreview, null);
});

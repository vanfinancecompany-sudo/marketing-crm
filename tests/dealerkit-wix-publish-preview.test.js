import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildDealerKitWixPublishPreview,
  selectedDealerKitFinanceCollections,
} from "../lib/dealerKitWixPublishPreview.js";
import { VAN_FINANCE_WIX_COLLECTIONS } from "../lib/vanscoWixPrice.js";

function collection(id) {
  return VAN_FINANCE_WIX_COLLECTIONS.find((entry) => entry.id === id);
}

function wixMatch(id, data, itemId = `item-${id}`) {
  return {
    collection: collection(id),
    items: [{
      id: itemId,
      data: {
        title: "HT22KJX",
        ...data,
      },
    }],
  };
}

function reviewedDecision(overrides = {}) {
  return {
    persisted: true,
    supplierStockId: "stock-123",
    registration: "HT22KJX",
    reviewStatus: "reviewed",
    financeEnabled: true,
    financeCategories: ["all_vans", "automatic"],
    rent2buyEnabled: false,
    rent2buyCategories: [],
    excludedImageIds: [],
    primaryImageId: "image-1",
    imageOrderIds: ["image-1", "image-2"],
    reviewedSourceUpdatedAt: "2026-09-10T12:00:00.000Z",
    notes: "",
    ...overrides,
  };
}

function dealerKitVehicle(overrides = {}) {
  return {
    supplierStockId: "stock-123",
    registration: "HT22 KJX",
    sourceStatus: "In Stock",
    status: "available",
    retailPrice: 15995,
    sourceUpdatedAt: "2026-09-10T12:00:00.000Z",
    images: [
      { id: "image-1", url: "https://images.example/one.jpg" },
      { id: "image-2", url: "https://images.example/two.jpg" },
    ],
    ...overrides,
  };
}

test("DealerKit Wix preview maps reviewed Van Finance categories and pricing without writing", () => {
  const preview = buildDealerKitWixPublishPreview({
    vehicle: dealerKitVehicle(),
    decision: reviewedDecision(),
    wixResults: [
      wixMatch("VANFINANCE-ALLVANS", {
        price: "£16,495",
        vat: "+VAT",
        salePrice: "FROM £344 P/M",
        wasPriceVat: "",
      }),
      wixMatch("AUTOMATIC", {
        price: "£16,495",
        vat: "+VAT",
        salePrice: "FROM £344 P/M",
      }),
      wixMatch("VANFINANCEPAGES", {
        priceVat: "£16,495 +VAT",
        mthPrice: "£344",
        wasPriceVat: "",
      }),
    ],
  });

  assert.equal(preview.readOnly, true);
  assert.equal(preview.registration, "HT22KJX");
  assert.equal(preview.retailPrice, 15995);
  assert.equal(preview.monthlyPrice, 334);
  assert.equal(preview.canPublishLater, true);
  assert.deepEqual(preview.blockers, []);
  assert.deepEqual(preview.warnings, []);
  assert.deepEqual(preview.selectedCategories, ["all_vans", "automatic"]);
  assert.equal(preview.images.count, 2);
  assert.equal(preview.images.primaryImageId, "image-1");

  const allVans = preview.targets.find((target) => target.collectionId === "VANFINANCE-ALLVANS");
  const automatic = preview.targets.find((target) => target.collectionId === "AUTOMATIC");
  const detail = preview.targets.find((target) => target.collectionId === "VANFINANCEPAGES");

  assert.equal(allVans.status, "matched");
  assert.deepEqual(allVans.proposed, {
    price: "£15,995",
    salePrice: "FROM £334 P/M",
    wasPriceVat: "£16,495 +VAT",
  });
  assert.deepEqual(automatic.proposed, {
    price: "£15,995",
    salePrice: "FROM £334 P/M",
  });
  assert.deepEqual(detail.proposed, {
    priceVat: "£15,995 +VAT",
    mthPrice: "£334",
    wasPriceVat: "£16,495 +VAT",
  });
});

test("preview blocks stale reviews, unsupported categories, missing images and unverified Wix creation", () => {
  const preview = buildDealerKitWixPublishPreview({
    vehicle: dealerKitVehicle({
      sourceUpdatedAt: "2026-09-10T13:00:00.000Z",
      images: [],
    }),
    decision: reviewedDecision({
      financeCategories: ["all_vans", "nine_seater"],
      primaryImageId: null,
      imageOrderIds: [],
    }),
    wixResults: [
      wixMatch("VANFINANCE-ALLVANS", {
        price: "£15,995",
        vat: "+VAT",
        salePrice: "FROM £334 P/M",
      }),
    ],
  });

  const codes = new Set(preview.blockers.map((entry) => entry.code));
  assert.equal(preview.canPublishLater, false);
  assert.ok(codes.has("stale_review"));
  assert.ok(codes.has("unmapped_category"));
  assert.ok(codes.has("no_images"));
  assert.ok(codes.has("primary_image"));
  assert.ok(codes.has("wix_create_not_verified"));
});

test("preview warns about existing Wix category rows that the saved review no longer selects", () => {
  const preview = buildDealerKitWixPublishPreview({
    vehicle: dealerKitVehicle(),
    decision: reviewedDecision({ financeCategories: ["all_vans"] }),
    wixResults: [
      wixMatch("VANFINANCE-ALLVANS", {
        price: "£15,995",
        vat: "+VAT",
        salePrice: "FROM £334 P/M",
      }),
      wixMatch("VANFINANCE-MWB", {
        price: "£15,995",
        vat: "+VAT",
        salePrice: "FROM £334 P/M",
      }),
      wixMatch("VANFINANCEPAGES", {
        priceVat: "£15,995 +VAT",
        mthPrice: "£334",
      }),
    ],
  });

  assert.equal(preview.canPublishLater, true);
  assert.equal(preview.warnings.length, 1);
  assert.equal(preview.warnings[0].code, "existing_unselected_category");
  assert.match(preview.warnings[0].message, /MWB/i);
});

test("category selection always includes All Vans and the main vehicle page for enabled Van Finance", () => {
  const selection = selectedDealerKitFinanceCollections({
    financeEnabled: true,
    financeCategories: ["automatic", "electric"],
  });

  assert.deepEqual(selection.categories, ["automatic", "electric", "all_vans"]);
  assert.ok(selection.collectionIds.includes("VANFINANCE-ALLVANS"));
  assert.ok(selection.collectionIds.includes("VANFINANCEPAGES"));
  assert.ok(selection.collectionIds.includes("AUTOMATIC"));
  assert.ok(selection.collectionIds.includes("VANFINANCE-ELECTRIC"));
});

test("publish preview endpoint and UI remain read-only with no Wix mutation route", () => {
  const endpoint = fs.readFileSync(new URL("../api/dealerkit-wix-publish-preview.js", import.meta.url), "utf8");
  const ui = fs.readFileSync(new URL("../utils/dealerKitWixPublishPreview.js", import.meta.url), "utf8");

  assert.match(endpoint, /request\.method !== \"GET\"/);
  assert.match(endpoint, /writesAttempted:\s*false/);
  assert.match(endpoint, /readOnly:\s*true/);
  assert.match(endpoint, /\/wix-data\/v2\/items\/query/);
  assert.doesNotMatch(endpoint, /fieldModifications|method:\s*\"PATCH\"|method:\s*\"PUT\"|method:\s*\"DELETE\"|\/wix-data\/v2\/items\/\$\{/i);

  assert.match(ui, /Preview Wix publish/);
  assert.match(ui, /method:\s*\"GET\"/);
  assert.match(ui, /does not create, update, delete or unpublish anything/i);
  assert.doesNotMatch(ui, /Publish to Wix|Update Wix vehicle|Send live/i);
});

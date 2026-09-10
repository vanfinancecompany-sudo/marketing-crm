import test from "node:test";
import assert from "node:assert/strict";
import {
  WIX_MEDIA_IMPORT_PUBLIC_URL,
  buildDealerKitWixMediaPlan,
} from "../lib/dealerKitWixMediaPlan.js";

function vehicle(overrides = {}) {
  return {
    supplierStockId: "stock-123",
    registration: "HT22 KJX",
    sourceUpdatedAt: "2026-09-10T12:00:00.000Z",
    images: [
      { id: "image-1", url: "https://images.example/one.jpg", mimeType: "image/jpeg" },
      { id: "image-2", url: "https://images.example/two.jpg", mimeType: "image/jpeg" },
      { id: "image-3", url: "https://images.example/three.jpg", mimeType: "image/jpeg" },
    ],
    ...overrides,
  };
}

function decision(overrides = {}) {
  return {
    registration: "HT22KJX",
    supplierStockId: "stock-123",
    primaryImageId: "image-2",
    excludedImageIds: [],
    imageOrderIds: ["image-2", "image-1", "image-3"],
    ...overrides,
  };
}

test("media plan preserves reviewed order and primary image without importing anything", () => {
  const plan = buildDealerKitWixMediaPlan({ vehicle: vehicle(), decision: decision() });

  assert.equal(plan.readOnly, true);
  assert.equal(plan.liveImportLocked, true);
  assert.equal(plan.canPrepareImport, true);
  assert.deepEqual(plan.blockers, []);
  assert.deepEqual(plan.selectedImageIds, ["image-2", "image-1", "image-3"]);
  assert.equal(plan.items[0].isPrimary, true);
  assert.equal(plan.items[0].position, 1);
  assert.equal(plan.items[0].proposedBaseName, "HT22KJX-01");
  assert.equal(plan.items[0].stableKey, "stock-123:image-2");
  assert.equal(plan.items[0].wixImportRequestPreview.mediaType, "IMAGE");
  assert.equal(plan.items[0].wixImportRequestPreview.private, false);
  assert.equal(plan.wixImportContract.publicUrl, WIX_MEDIA_IMPORT_PUBLIC_URL);
  assert.equal(plan.wixImportContract.method, "POST");
  assert.equal(plan.wixImportContract.asynchronousProcessing, true);
  assert.equal(plan.storagePolicy.destination, "wix_media");
  assert.equal(plan.storagePolicy.supabaseImageStorage, false);
  assert.equal(plan.storagePolicy.temporaryStagingMustExpire, true);
});

test("excluded images stay out of the prepared Wix order", () => {
  const plan = buildDealerKitWixMediaPlan({
    vehicle: vehicle(),
    decision: decision({ excludedImageIds: ["image-1"] }),
  });
  assert.deepEqual(plan.selectedImageIds, ["image-2", "image-3"]);
  assert.deepEqual(plan.excludedImageIds, ["image-1"]);
  assert.equal(plan.items.some((item) => item.id === "image-1"), false);
});

test("an excluded or missing primary image blocks future import", () => {
  const plan = buildDealerKitWixMediaPlan({
    vehicle: vehicle(),
    decision: decision({ excludedImageIds: ["image-2"] }),
  });
  assert.equal(plan.canPrepareImport, false);
  assert.ok(plan.blockers.some((item) => item.code === "primary_not_included"));
});

test("missing and duplicate source image IDs block because review decisions need stable identities", () => {
  const plan = buildDealerKitWixMediaPlan({
    vehicle: vehicle({
      images: [
        { id: "image-1", url: "https://images.example/one.jpg" },
        { id: "image-1", url: "https://images.example/duplicate.jpg" },
        { url: "https://images.example/no-id.jpg" },
      ],
    }),
    decision: decision({ primaryImageId: "image-1", imageOrderIds: ["image-1"] }),
  });
  assert.equal(plan.canPrepareImport, false);
  assert.ok(plan.blockers.some((item) => item.code === "duplicate_image_id"));
  assert.ok(plan.blockers.some((item) => item.code === "missing_image_id"));
});

test("non HTTP(S) source URLs are rejected", () => {
  const plan = buildDealerKitWixMediaPlan({
    vehicle: vehicle({ images: [{ id: "image-1", url: "data:image/jpeg;base64,abc" }] }),
    decision: decision({ primaryImageId: "image-1", imageOrderIds: ["image-1"] }),
  });
  assert.equal(plan.canPrepareImport, false);
  assert.ok(plan.blockers.some((item) => item.code === "invalid_image_url"));
  assert.equal(plan.items[0].wixImportRequestPreview, null);
});

test("planner does not invent a file extension or MIME type when DealerKit has not supplied one", () => {
  const plan = buildDealerKitWixMediaPlan({
    vehicle: vehicle({ images: [{ id: "image-1", url: "https://images.example/signed?asset=123" }] }),
    decision: decision({ primaryImageId: "image-1", imageOrderIds: ["image-1"] }),
  });
  assert.equal(plan.items[0].proposedBaseName, "HT22KJX-01");
  assert.equal(plan.items[0].sourceMimeType, null);
  assert.equal(plan.sourceRequirements.sourceMimeTypesComplete, false);
  assert.equal("mimeType" in plan.items[0].wixImportRequestPreview, false);
  assert.match(plan.sourceRequirements.note, /MIME metadata, filename extension or HEAD support/i);
});

test("DealerKit URL durability remains an explicit lock even when the review set is otherwise valid", () => {
  const plan = buildDealerKitWixMediaPlan({ vehicle: vehicle(), decision: decision() });
  assert.equal(plan.canPrepareImport, true);
  assert.equal(plan.liveImportLocked, true);
  assert.equal(plan.sourceRequirements.dealerKitUrlDurabilityVerified, false);
  assert.equal(plan.sourceRequirements.dealerKitHeadSupportVerified, false);
});

test("product-specific image state imports the union needed by Finance and Rent2Buy", () => {
  const plan = buildDealerKitWixMediaPlan({
    vehicle: vehicle(),
    decision: decision({
      rent2buyEnabled: true,
      imageOrderIds: [
        "__VFC_PRODUCT_IMAGES__",
        "image-2",
        "image-3",
        "image-1",
        "__R2B_PRODUCT_IMAGES__",
        "image-1",
        "image-3",
        "image-2",
      ],
      excludedImageIds: [
        "__VFC_PRODUCT_IMAGES__",
        "image-1",
        "__R2B_PRODUCT_IMAGES__",
        "image-2",
      ],
    }),
  });

  assert.deepEqual(plan.selectedImageIds, ["image-2", "image-3", "image-1"]);
  assert.deepEqual(plan.excludedImageIds, []);
  assert.equal(plan.items[0].isPrimary, true);
  assert.equal(plan.canPrepareImport, true);
});

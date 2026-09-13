import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildDealerKitImageReadinessAlerts, MAX_PLACEHOLDER_ADVERT_IMAGES } from "../api/dealerkit-image-readiness.js";
import { safeActionPayload, safeImageReadySourceStatus } from "../api/vansco-watch-action.js";

function presence(registration, title = "Vehicle") {
  return {
    registrations: [registration],
    vehicles: [{ registration, title, webLink: `https://example.test/${registration.toLowerCase()}` }],
  };
}

function dealerKitVehicle(registration, imageCount, extra = {}) {
  return {
    registration,
    supplierStockId: `stock-${registration}`,
    title: extra.title || "Ford Transit",
    vehicleType: extra.vehicleType || "LCV",
    bodyType: extra.bodyType || "Panel Van",
    imageCount,
    images: Array.from({ length: imageCount }, (_, index) => ({ url: `https://dealerkit.test/${registration}-${index + 1}.jpg` })),
    status: "available",
  };
}

test("photo readiness is a due-in placeholder alert, not a general image-count difference", () => {
  assert.equal(MAX_PLACEHOLDER_ADVERT_IMAGES, 2);

  const normalGallery = buildDealerKitImageReadinessAlerts({
    pipeline: "finance",
    listingPresenceByPipeline: {
      finance: presence("AB24CDE"),
    },
    cmsItemsByPipeline: {
      finance: [{ title: "AB24CDE", imageCount: 20 }],
    },
    dealerKitVehicles: [dealerKitVehicle("AB24CDE", 22)],
  });
  assert.equal(normalGallery.length, 0, "20 images versus 22 must not become a photo-ready task");

  const dueIn = buildDealerKitImageReadinessAlerts({
    pipeline: "finance",
    listingPresenceByPipeline: {
      finance: presence("XY24ZZZ"),
    },
    cmsItemsByPipeline: {
      finance: [{ title: "XY24ZZZ", imageCount: 2 }],
    },
    dealerKitVehicles: [dealerKitVehicle("XY24ZZZ", 10)],
  });
  assert.equal(dueIn.length, 1);
  assert.equal(dueIn[0].currentAdvertImageCount, 2);
  assert.equal(dueIn[0].sourceImageCount, 10);
  assert.equal(dueIn[0].imageReadinessAlert, true);
});

test("BD21HCX style Finance alert is not suppressed by a fuller Rent2Buy advert", () => {
  const listingPresenceByPipeline = {
    finance: presence("BD21HCX", "Ford Transit Leader TWIN WHEEL LUTON"),
    rent2buy: presence("BD21HCX", "Ford Transit"),
  };
  const cmsItemsByPipeline = {
    // The Finance image feed can report zero while the live page visibly shows its
    // primary image, so a live listing is safely treated as one displayed image.
    finance: [{ title: "BD21HCX", imageCount: 0 }],
    rent2buy: [{ title: "BD21HCX", imageCount: 18 }],
  };
  const dealerKitVehicles = [dealerKitVehicle("BD21HCX", 19)];

  const financeAlerts = buildDealerKitImageReadinessAlerts({
    pipeline: "finance",
    listingPresenceByPipeline,
    cmsItemsByPipeline,
    dealerKitVehicles,
  });
  assert.equal(financeAlerts.length, 1, "Finance 1-image advert versus DealerKit 19 must be flagged");
  assert.equal(financeAlerts[0].currentAdvertImageCount, 1);
  assert.equal(financeAlerts[0].sourceImageCount, 19);
  assert.deepEqual(financeAlerts[0].advertisedPipelines, ["finance"]);
  assert.equal(financeAlerts[0].crossProductEvidence, false);

  const rent2buyAlerts = buildDealerKitImageReadinessAlerts({
    pipeline: "rent2buy",
    listingPresenceByPipeline,
    cmsItemsByPipeline,
    dealerKitVehicles,
  });
  assert.equal(rent2buyAlerts.length, 0, "Rent2Buy 18 images versus DealerKit 19 is a normal gallery, not a due-in alert");
});

test("Cars uses the same lane-specific due-in photo rule", () => {
  const alerts = buildDealerKitImageReadinessAlerts({
    pipeline: "cars",
    listingPresenceByPipeline: {
      cars: presence("AB24CAR"),
    },
    cmsItemsByPipeline: {
      cars: [{ title: "AB24CAR", imageCount: 1 }],
    },
    dealerKitVehicles: [dealerKitVehicle("AB24CAR", 8, { vehicleType: "CAR", bodyType: "Hatchback" })],
  });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].currentAdvertImageCount, 1);
});

test("photo-ready Hide and Never show again persist a check-safe DealerKit source status in every lane", () => {
  assert.equal(safeImageReadySourceStatus({ sourceStatus: "In Stock" }), "available");

  const lanes = [
    ["finance", "AB24CDE"],
    ["rent2buy", "CD24EFG"],
    ["cars", "EF24GHJ"],
  ];

  for (const [pipeline, registration] of lanes) {
    const record = {
      id: `images-ready-${pipeline}-${registration}`,
      pipeline,
      registration,
      title: "DealerKit photo-ready vehicle",
      sourceStatus: "In Stock",
      displayStatus: "images_ready",
      matchStatus: "images_ready",
      imageReadinessAlert: true,
    };

    const hiddenPayload = safeActionPayload(pipeline, record, "ignored", "");
    assert.equal(hiddenPayload.pipeline, pipeline);
    assert.equal(hiddenPayload.source_status, "available", `${pipeline} Hide must not persist DealerKit's raw In Stock label`);
    assert.equal(hiddenPayload.match_status, "missing", `${pipeline} photo-ready status must remain DB-compatible`);

    const neverPayload = safeActionPayload(pipeline, record, "not_listing_spec", "");
    assert.equal(neverPayload.pipeline, pipeline);
    assert.equal(neverPayload.source_status, "available", `${pipeline} Never show again must use a canonical source status`);
    assert.equal(neverPayload.match_status, "missing", `${pipeline} Never show again must keep match_status DB-compatible`);
  }
});

test("photo-ready UI uses the normal actionable Stock Watch workflow across all lanes", () => {
  const transform = fs.readFileSync(new URL("../scripts/apply-dealerkit-photo-ready-workflow-fix.mjs", import.meta.url), "utf8");
  assert.match(transform, /Photo readiness runs for Finance, Rent2Buy and Cars/);
  assert.ok(transform.includes('record.displayStatus === "missing" || isImageReady'));
  assert.match(transform, /Mark as advertised/);
  assert.match(transform, /Never show again/);
  assert.match(transform, /setImageReadyByPipeline/);
  assert.match(transform, /await loadImageReadiness\(pipeline\)/);
  assert.match(transform, /Review vehicle/);
  assert.match(transform, /1–2 placeholder images/);
});

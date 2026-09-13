import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildDealerKitImageReadinessAlerts, MAX_PLACEHOLDER_ADVERT_IMAGES } from "../api/dealerkit-image-readiness.js";

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
      rent2buy: { registrations: [], vehicles: [] },
    },
    cmsItemsByPipeline: {
      finance: [{ title: "AB24CDE", imageCount: 20 }],
      rent2buy: [],
    },
    dealerKitVehicles: [dealerKitVehicle("AB24CDE", 22)],
  });
  assert.equal(normalGallery.length, 0, "20 images versus 22 must not become a photo-ready task");

  const dueIn = buildDealerKitImageReadinessAlerts({
    pipeline: "finance",
    listingPresenceByPipeline: {
      finance: presence("XY24ZZZ"),
      rent2buy: { registrations: [], vehicles: [] },
    },
    cmsItemsByPipeline: {
      finance: [{ title: "XY24ZZZ", imageCount: 2 }],
      rent2buy: [],
    },
    dealerKitVehicles: [dealerKitVehicle("XY24ZZZ", 10)],
  });
  assert.equal(dueIn.length, 1);
  assert.equal(dueIn[0].currentAdvertImageCount, 2);
  assert.equal(dueIn[0].sourceImageCount, 10);
  assert.equal(dueIn[0].imageReadinessAlert, true);
});

test("zero CMS images are treated as uncertain evidence rather than guessed photo-ready", () => {
  const alerts = buildDealerKitImageReadinessAlerts({
    pipeline: "finance",
    listingPresenceByPipeline: {
      finance: presence("AB24CDE"),
      rent2buy: { registrations: [], vehicles: [] },
    },
    cmsItemsByPipeline: {
      finance: [{ title: "AB24CDE", imageCount: 0 }],
      rent2buy: [],
    },
    dealerKitVehicles: [dealerKitVehicle("AB24CDE", 12)],
  });
  assert.equal(alerts.length, 0);
});

test("commercial photo readiness uses the fullest live Finance or Rent2Buy advert", () => {
  const alerts = buildDealerKitImageReadinessAlerts({
    pipeline: "finance",
    listingPresenceByPipeline: {
      finance: presence("AB24CDE"),
      rent2buy: presence("AB24CDE"),
    },
    cmsItemsByPipeline: {
      finance: [{ title: "AB24CDE", imageCount: 2 }],
      rent2buy: [{ title: "AB24CDE", imageCount: 18 }],
    },
    dealerKitVehicles: [dealerKitVehicle("AB24CDE", 24)],
  });
  assert.equal(alerts.length, 0, "a normal gallery on either live commercial advert blocks a false due-in alert");
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

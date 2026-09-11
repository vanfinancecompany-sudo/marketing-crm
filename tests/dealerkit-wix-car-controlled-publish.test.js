import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildDealerKitCarWixPlan,
  buildCarPublishConfirmation,
  carPublishConfirmationMatches,
} from "../lib/dealerKitCarWixPlan.js";

const root = new URL("../", import.meta.url);
const sourceUpdatedAt = "2026-09-11T08:30:00.000Z";

function vehicle(overrides = {}) {
  return {
    supplierStockId: "car-stock-1",
    registration: "AB23 CDE",
    title: "BMW 3 Series 330e M Sport Auto Euro 6",
    make: "BMW",
    model: "3 Series",
    derivative: "330e M Sport Auto Euro 6",
    year: 2023,
    mileage: 22000,
    fuel: "Petrol / Plug-in Hybrid",
    transmission: "Automatic",
    colour: "Black",
    bhp: 288,
    retailPrice: 21795,
    status: "available",
    sourceUpdatedAt,
    description: "BMW 3 Series 330e M Sport\nAutomatic\nNavigation\nParking Sensors",
    specifications: {
      technical: [
        { name: "Engine Size", value: "1998 cc" },
        { name: "Combined MPG", value: "188.3 mpg" },
        { name: "Top Speed", value: "143 mph" },
        { name: "0-62mph", value: "5.8 sec" },
      ],
      standard: [
        { name: "Bluetooth" },
        { name: "Cruise Control with Brake Function" },
        { name: "18in Alloy Wheels" },
        { name: "Adaptive LED Headlights" },
        { name: "Dynamic Stability Control" },
      ],
      options: [{ name: "Sun Protection Glass" }],
    },
    ...overrides,
  };
}

function decision(overrides = {}) {
  return {
    persisted: true,
    registration: "AB23CDE",
    supplierStockId: "car-stock-1",
    reviewStatus: "reviewed",
    reviewedSourceUpdatedAt: sourceUpdatedAt,
    imageOrderIds: ["image-1", "image-2"],
    excludedImageIds: [],
    primaryImageId: "image-1",
    ...overrides,
  };
}

function imageSet(overrides = {}) {
  return {
    dealerKitImageIds: ["image-1", "image-2"],
    mainUrl: "https://static.wixstatic.com/media/car-1.jpg",
    mainSource: "dealerkit_primary",
    listingImageUrl: "https://static.wixstatic.com/media/car-1.jpg",
    galleryUrls: ["https://static.wixstatic.com/media/car-1.jpg", "https://static.wixstatic.com/media/car-2.jpg"],
    ready: true,
    ...overrides,
  };
}

test("Cars plan creates one current listing and one detail page using live CAR fields", () => {
  const plan = buildDealerKitCarWixPlan({ vehicle: vehicle(), decision: decision(), imageSet: imageSet() });
  assert.equal(plan.mode, "cars");
  assert.equal(plan.canPublish, true);
  assert.equal(plan.targets.length, 2);

  const listing = plan.targets.find((target) => target.collectionId === "CARFINANCE");
  const detail = plan.targets.find((target) => target.collectionId === "CARPAGES");
  assert.equal(listing.operation, "create");
  assert.equal(listing.data.title, "AB23CDE");
  assert.equal(listing.data.buttonText, "VIEW CAR");
  assert.match(listing.data.vanDescription, /^BMW 3 Series/);
  assert.match(listing.data.vanSpec, /REGISTRATION: AB23 CDE/);
  assert.match(listing.data.vanSpec, /EURO: 6/);
  assert.match(listing.data.salePrice, /^FROM £\d+ P\/M$/);

  assert.equal(detail.data.title, "AB23CDE");
  assert.equal(detail.data.mainImages[0], imageSet().mainUrl);
  assert.match(detail.data.descriptionLine, /ENGINE SIZE: 2\.0/);
  assert.match(detail.data.descriptionLine, /EURO: 6/);
  assert.match(detail.data.descriptionLine, /MPG: 188\.3/);
  assert.match(detail.data.audioAndCommunications, /Engine Size\n1998 cc/);
  assert.match(detail.data.audioAndCommunications, /Bluetooth/);
  assert.match(detail.data.driversAssistance, /Cruise Control/);
  assert.match(detail.data.exterior, /Alloy Wheels/);
  assert.match(detail.data.illumination, /LED Headlights/);
  assert.match(detail.data.safetyAndSecurity, /Stability Control/);
});

test("Cars live listing is the duplicate authority while one historical detail page is reused", () => {
  const historical = [{ id: "historic-car-page", data: { title: "AB23CDE", titleText: "Old title", priceVat: "£19,995" } }];
  const reusable = buildDealerKitCarWixPlan({ vehicle: vehicle(), decision: decision(), imageSet: imageSet(), carDetailRows: historical });
  const detail = reusable.targets.find((target) => target.collectionId === "CARPAGES");
  assert.equal(reusable.canPublish, true);
  assert.equal(detail.operation, "update");
  assert.equal(detail.itemId, "historic-car-page");

  const listed = buildDealerKitCarWixPlan({
    vehicle: vehicle(), decision: decision(), imageSet: imageSet(), carDetailRows: historical,
    carListingRows: [{ id: "live-car", data: { title: "AB23CDE" } }],
  });
  assert.equal(listed.canPublish, false);
  assert.ok(listed.blockers.some((blocker) => blocker.code === "car_already_listed"));
});

test("Cars plan fails closed on stale review or incomplete Wix Media", () => {
  const stale = buildDealerKitCarWixPlan({
    vehicle: vehicle({ sourceUpdatedAt: "2026-09-11T09:00:00.000Z" }),
    decision: decision(), imageSet: imageSet(),
  });
  assert.equal(stale.canPublish, false);
  assert.ok(stale.blockers.some((blocker) => blocker.code === "stale_review"));

  const missingMedia = buildDealerKitCarWixPlan({ vehicle: vehicle(), decision: decision(), imageSet: imageSet({ ready: false, mainUrl: null }) });
  assert.equal(missingMedia.canPublish, false);
  assert.ok(missingMedia.blockers.some((blocker) => blocker.code === "car_media_not_ready"));
});

test("Cars confirmation fingerprints exact CMS payload and image identity", () => {
  const plan = buildDealerKitCarWixPlan({ vehicle: vehicle(), decision: decision(), imageSet: imageSet() });
  const confirmation = buildCarPublishConfirmation(plan);
  assert.equal(carPublishConfirmationMatches(confirmation, plan), true);
  const changed = structuredClone(plan);
  changed.targets.find((target) => target.collectionId === "CARFINANCE").data.price = "£1";
  assert.equal(carPublishConfirmationMatches(confirmation, changed), false);
});

test("Cars browser/runtime flow has separate preview, final publisher and media-only preparation", async () => {
  const [ui, preview, publish, prepare, state] = await Promise.all([
    readFile(new URL("utils/dealerKitControlledPublish.js", root), "utf8"),
    readFile(new URL("api/dealerkit-car-controlled-publish-preview.js", root), "utf8"),
    readFile(new URL("api/dealerkit-car-controlled-publish.js", root), "utf8"),
    readFile(new URL("api/dealerkit-wix-prepare-media.js", root), "utf8"),
    readFile(new URL("api/_dealerkit-car-controlled-publish-state.js", root), "utf8"),
  ]);
  assert.match(ui, /dealerkit-car-controlled-publish-preview/);
  assert.match(ui, /dealerkit-car-controlled-publish/);
  assert.match(ui, /publish_new_car/);
  assert.match(preview, /writesAttempted:\s*false/);
  assert.match(publish, /carPublishConfirmationMatches/);
  assert.match(publish, /rollbackWrites/);
  assert.match(publish, /CARFINANCE/);
  assert.match(publish, /CARPAGES/);
  assert.match(prepare, /productMode === "cars"/);
  assert.match(prepare, /cmsWritesAttempted:\s*false/);
  assert.match(state, /CARFINANCE/);
  assert.match(state, /CARPAGES/);
  assert.match(state, /WIX_CAR_API_KEY/);
});

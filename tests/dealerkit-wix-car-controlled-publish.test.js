import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildDealerKitCarWixPlan,
  buildCarPublishConfirmation,
  carPublishConfirmationMatches,
} from "../lib/dealerKitCarWixPlan.js";
import { buildCarImageSet } from "../api/_dealerkit-car-controlled-publish-state.js";

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

test("Cars can publish with READY primary while secondary photos are still processing", () => {
  const carVehicle = vehicle({
    images: [
      { id: "image-1", url: "https://dealerkit.example/car-1.jpg" },
      { id: "image-2", url: "https://dealerkit.example/car-2.jpg" },
      { id: "image-3", url: "https://dealerkit.example/car-3.jpg" },
    ],
  });
  const imported = [
    { dealerKitImageId: "image-1", wixUrl: "https://static.wixstatic.com/media/car-1.jpg", ready: true },
    { dealerKitImageId: "image-2", wixUrl: "https://static.wixstatic.com/media/car-2.jpg", ready: false },
  ];
  const { imageSet: partial } = buildCarImageSet(carVehicle, decision({ imageOrderIds: ["image-1", "image-2", "image-3"], primaryImageId: "image-1" }), imported);
  assert.equal(partial.ready, true);
  assert.deepEqual(partial.galleryUrls, ["https://static.wixstatic.com/media/car-1.jpg"]);
  const plan = buildDealerKitCarWixPlan({ vehicle: carVehicle, decision: decision(), imageSet: partial });
  assert.equal(plan.canPublish, true);
});

test("Cars excluded photos are ignored by readiness and gallery output", () => {
  const carVehicle = vehicle({
    images: [
      { id: "image-1", url: "https://dealerkit.example/car-1.jpg" },
      { id: "image-2", url: "https://dealerkit.example/car-2.jpg" },
    ],
  });
  const imported = [
    { dealerKitImageId: "image-1", wixUrl: "https://static.wixstatic.com/media/car-1.jpg", ready: true },
  ];
  const { imageSet: filtered, media } = buildCarImageSet(carVehicle, decision({ excludedImageIds: ["image-2"], primaryImageId: "image-1" }), imported);
  assert.equal(filtered.ready, true);
  assert.deepEqual(filtered.dealerKitImageIds, ["image-1"]);
  assert.deepEqual(filtered.galleryUrls, ["https://static.wixstatic.com/media/car-1.jpg"]);
  assert.equal(media.dealerKitExpected, 1);
  assert.deepEqual(media.missingDealerKitImageIds, []);
});

test("Cars still block when the chosen primary is not READY", () => {
  const carVehicle = vehicle({
    images: [
      { id: "image-1", url: "https://dealerkit.example/car-1.jpg" },
      { id: "image-2", url: "https://dealerkit.example/car-2.jpg" },
    ],
  });
  const imported = [
    { dealerKitImageId: "image-2", wixUrl: "https://static.wixstatic.com/media/car-2.jpg", ready: true },
  ];
  const { imageSet: missingPrimary } = buildCarImageSet(carVehicle, decision(), imported);
  assert.equal(missingPrimary.ready, false);
  const plan = buildDealerKitCarWixPlan({ vehicle: carVehicle, decision: decision(), imageSet: missingPrimary });
  assert.equal(plan.canPublish, false);
  assert.ok(plan.blockers.some((blocker) => blocker.code === "car_media_not_ready"));
});

test("Cars live listing switches to the controlled photo-ready repair path", () => {
  const historical = [{ id: "historic-car-page", data: { title: "AB23CDE", titleText: "Old title", priceVat: "£19,995" } }];
  const reusable = buildDealerKitCarWixPlan({ vehicle: vehicle(), decision: decision(), imageSet: imageSet(), carDetailRows: historical });
  const detail = reusable.targets.find((target) => target.collectionId === "CARPAGES");
  assert.equal(reusable.canPublish, true);
  assert.equal(detail.operation, "update");
  assert.equal(detail.itemId, "historic-car-page");

  const listed = buildDealerKitCarWixPlan({
    vehicle: vehicle(), decision: decision(), imageSet: imageSet(), carDetailRows: historical,
    carListingRows: [{ id: "live-car", data: { title: "AB23CDE", picture: "old.jpg", price: "£21,795" } }],
  });
  assert.equal(listed.canPublish, true);
  assert.equal(listed.writeIntent, "update_existing_vehicle");
  assert.deepEqual(listed.blockers, []);
  const liveListing = listed.targets.find((target) => target.collectionId === "CARFINANCE");
  const liveDetail = listed.targets.find((target) => target.collectionId === "CARPAGES");
  assert.equal(liveListing.operation, "update");
  assert.deepEqual(liveListing.data, { picture: imageSet().mainUrl });
  assert.equal(liveDetail.operation, "update");
  assert.deepEqual(liveDetail.data, { mainImages: imageSet().galleryUrls, numberOfImages: "2" });
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
  assert.match(ui, /update_existing_car/);
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

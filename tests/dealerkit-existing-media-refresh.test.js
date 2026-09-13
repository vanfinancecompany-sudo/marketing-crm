import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildControlledPublishConfirmation,
  buildControlledVehiclePublishPlan,
  buildControlledVfcTargets,
} from "../lib/dealerKitControlledPublishPlan.js";

const registration = "BD21HCX";
const galleryUrls = ["wix:image://v1/new-1.jpg", "wix:image://v1/new-2.jpg", "wix:image://v1/new-3.jpg"];
const listingImageUrl = galleryUrls[0];

function item(id, data = {}) {
  return { id, data: { title: registration, ...data } };
}

function financeResults({ duplicateCategory = false } = {}) {
  return [
    {
      collectionId: "VANFINANCE-ALLVANS",
      collection: { id: "VANFINANCE-ALLVANS", kind: "listing" },
      items: [item("all-1", { picture: "old-card.jpg", price: "£13,995", salePrice: "FROM £300 P/M" })],
    },
    {
      collectionId: "VANFINANCE-TIPPERSDROPSIDEL",
      collection: { id: "VANFINANCE-TIPPERSDROPSIDEL", kind: "listing" },
      items: duplicateCategory
        ? [item("tip-1", { picture: "old-tip.jpg" }), item("tip-2", { picture: "duplicate.jpg" })]
        : [item("tip-1", { picture: "old-tip.jpg", price: "£13,995" })],
    },
    {
      collectionId: "VANFINANCEPAGES",
      collection: { id: "VANFINANCEPAGES", kind: "detail" },
      items: [item("page-1", { mainImages: ["old-page.jpg"], imageCount: "1", priceVat: "£13,995 +VAT", descriptionLine: "Keep me" })],
    },
  ];
}

function imageSets() {
  return {
    dealerKitImageIds: ["dk-1", "dk-2", "dk-3"],
    vanFinance: {
      ready: true,
      mainUrl: listingImageUrl,
      listingImageUrl,
      galleryUrls,
      mainSource: "dealerkit_primary",
    },
    rent2buy: {},
  };
}

function vehicle() {
  return {
    supplierStockId: "dealerkit-bd21hcx",
    registration,
    title: "Ford Transit 350 EcoBlue HD Leader Chassis Cab",
    retailPrice: 13995,
    mileage: 41000,
    vatStatus: "plus_vat",
    sourceStatus: "In Stock",
    sourceUpdatedAt: "2026-09-13T09:00:00.000Z",
  };
}

function decision() {
  return {
    registration,
    persisted: true,
    reviewStatus: "reviewed",
    financeEnabled: true,
    rent2buyEnabled: false,
    financeCategories: ["all_vans", "tipper_dropside_luton"],
    reviewedSourceUpdatedAt: "2026-09-13T09:00:00.000Z",
    updatedAt: "2026-09-13T09:05:00.000Z",
  };
}

test("existing Finance vehicle refresh updates only image fields on every exact live row", () => {
  const plan = buildControlledVfcTargets({
    vehicle: vehicle(),
    decision: decision(),
    imageSets: imageSets(),
    wixResults: financeResults(),
  });

  assert.equal(plan.writeIntent, "update_existing_vehicle");
  assert.equal(plan.canPublish, true);
  assert.deepEqual(plan.blockers, []);
  assert.equal(plan.targets.length, 3);
  assert.ok(plan.targets.every((target) => target.operation === "update" && target.itemId));

  const allVans = plan.targets.find((target) => target.collectionId === "VANFINANCE-ALLVANS");
  const category = plan.targets.find((target) => target.collectionId === "VANFINANCE-TIPPERSDROPSIDEL");
  const detail = plan.targets.find((target) => target.collectionId === "VANFINANCEPAGES");

  assert.deepEqual(allVans.data, { picture: listingImageUrl });
  assert.deepEqual(category.data, { picture: listingImageUrl });
  assert.deepEqual(detail.data, { imageCount: "3", mainImages: galleryUrls });
  assert.equal("price" in allVans.data, false);
  assert.equal("salePrice" in allVans.data, false);
  assert.equal("priceVat" in detail.data, false);
  assert.equal("descriptionLine" in detail.data, false);
});

test("existing Finance vehicle image refresh blocks ambiguous duplicate Wix rows", () => {
  const plan = buildControlledVfcTargets({
    vehicle: vehicle(),
    decision: decision(),
    imageSets: imageSets(),
    wixResults: financeResults({ duplicateCategory: true }),
  });
  assert.equal(plan.canPublish, false);
  assert.ok(plan.blockers.some((blocker) => blocker.code === "vfc_existing_ambiguous"));
});

test("top-level controlled plan exposes update intent and binds it into confirmation", () => {
  const plan = buildControlledVehiclePublishPlan({
    vehicle: vehicle(),
    decision: decision(),
    imageSets: imageSets(),
    vfcWixResults: financeResults(),
    rent2buyWixResults: [],
    rent2buySites: [],
    productMode: "finance",
  });

  assert.equal(plan.writeIntent, "update_existing_vehicle");
  assert.equal(plan.newVehicleOnly, false);
  assert.equal(plan.canPublish, true);
  assert.ok(plan.targets.every((target) => target.operation === "update"));
  assert.equal(buildControlledPublishConfirmation(plan).writeIntent, "update_existing_vehicle");
});

test("controlled endpoint and workspace use the explicit existing-vehicle update action", () => {
  const api = fs.readFileSync(new URL("../api/dealerkit-controlled-publish.js", import.meta.url), "utf8");
  const ui = fs.readFileSync(new URL("../utils/dealerKitControlledPublish.js", import.meta.url), "utf8");
  assert.match(api, /\["publish_new_vehicle", "update_existing_vehicle"\]\.includes\(action\)/);
  assert.match(api, /state\.plan\.writeIntent !== requestedIntent/);
  assert.match(ui, /action: updateExisting \? "update_existing_vehicle" : "publish_new_vehicle"/);
  assert.match(ui, /Only the verified image fields on existing rows will be changed/);
});

test("existing Finance listing creates the missing detail page during photo-ready repair", () => {
  const wixResults = financeResults().map((entry) => entry.collectionId === "VANFINANCEPAGES" ? { ...entry, items: [] } : entry);
  const plan = buildControlledVfcTargets({ vehicle: vehicle(), decision: decision(), imageSets: imageSets(), wixResults });
  assert.equal(plan.writeIntent, "update_existing_vehicle");
  assert.equal(plan.canPublish, true);
  const detail = plan.targets.find((target) => target.collectionId === "VANFINANCEPAGES");
  assert.equal(detail.operation, "create");
  assert.deepEqual(detail.data.mainImages, galleryUrls);
  assert.equal(detail.data.imageCount, "3");
  assert.ok(plan.targets.filter((target) => target.kind === "listing").every((target) => target.operation === "update"));
});

test("Rent2Buy photo-ready repair creates only a missing VANPAGES detail row", () => {
  const rentDecision = { ...decision(), financeEnabled: false, rent2buyEnabled: true, rent2buyCategories: ["medium_mwb"], financeCategories: [] };
  const rentVehicle = { ...vehicle(), mileage: 41000, vatStatus: "plus_vat" };
  const rentImages = { ...imageSets(), vanFinance: {}, rent2buy: { ready: true, mainUrl: listingImageUrl, listingImageUrl, galleryUrls, mainSource: "dealerkit_primary" } };
  const site = { siteId: "85f11c52-ee54-495d-aaec-a351831709b5", siteLabel: "Van Finance Rent2Buy", siteRole: "primary" };
  const rentResults = [
    { ...site, collectionId: "ALLRENT2BUYVANS", collection: { id: "ALLRENT2BUYVANS", kind: "listing" }, items: [item("r2b-all", { picture: "old.jpg" })] },
    { ...site, collectionId: "MEDIUMVANS", collection: { id: "MEDIUMVANS", kind: "listing" }, items: [item("r2b-medium", { picture: "old.jpg" })] },
    { ...site, collectionId: "VANPAGES", collection: { id: "VANPAGES", kind: "detail" }, items: [] },
  ];
  const plan = buildControlledVehiclePublishPlan({ vehicle: rentVehicle, decision: rentDecision, imageSets: rentImages, vfcWixResults: [], rent2buyWixResults: rentResults, rent2buySites: [site], productMode: "rent2buy" });
  assert.equal(plan.writeIntent, "update_existing_vehicle");
  assert.equal(plan.canPublish, true);
  const detail = plan.targets.find((target) => target.collectionId === "VANPAGES");
  assert.equal(detail.operation, "create");
  assert.deepEqual(detail.data.mediaGallery, galleryUrls);
  assert.ok(plan.targets.filter((target) => target.kind === "listing").every((target) => target.operation === "update"));
});

test("Cars photo-ready repair updates the existing listing and creates a missing CARPAGES detail row", async () => {
  const { buildDealerKitCarWixPlan } = await import("../lib/dealerKitCarWixPlan.js");
  const carVehicle = { ...vehicle(), status: "available", mileage: 41000, year: 2022, make: "Ford", model: "Focus", description: "Ford Focus", specifications: { technical: [], standard: [], options: [] } };
  const carDecision = { registration, persisted: true, reviewStatus: "reviewed", reviewedSourceUpdatedAt: carVehicle.sourceUpdatedAt };
  const carImages = { ready: true, mainUrl: listingImageUrl, listingImageUrl, galleryUrls, dealerKitImageIds: ["dk-1", "dk-2", "dk-3"] };
  const plan = buildDealerKitCarWixPlan({ vehicle: carVehicle, decision: carDecision, imageSet: carImages, carListingRows: [item("car-list", { picture: "old.jpg", price: "£13,995" })], carDetailRows: [] });
  assert.equal(plan.writeIntent, "update_existing_vehicle");
  assert.equal(plan.canPublish, true);
  const listing = plan.targets.find((target) => target.collectionId === "CARFINANCE");
  const detail = plan.targets.find((target) => target.collectionId === "CARPAGES");
  assert.equal(listing.operation, "update");
  assert.deepEqual(listing.data, { picture: listingImageUrl });
  assert.equal(detail.operation, "create");
  assert.deepEqual(detail.data.mainImages, galleryUrls);
});

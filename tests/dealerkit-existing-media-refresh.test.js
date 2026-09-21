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

test("existing Finance vehicle refresh reuses every exact row with the full controlled payload", () => {
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

  assert.equal(allVans.data.picture, listingImageUrl);
  assert.equal(allVans.data.price, "£13,995");
  assert.equal(allVans.data.salePrice, "FROM £292 P/M");
  assert.equal(category.data.picture, listingImageUrl);
  assert.equal(detail.data.imageCount, "3");
  assert.deepEqual(detail.data.mainImages, galleryUrls);
  assert.equal(detail.data.priceVat, "£13,995 +VAT");
  assert.ok(detail.data.descriptionLine);
  assert.equal("manualOnlyField" in allVans.data, false);
});

test("existing Finance vehicle image refresh blocks ambiguous duplicate Wix rows", () => {
  const plan = buildControlledVfcTargets({
    vehicle: vehicle(),
    decision: decision(),
    imageSets: imageSets(),
    wixResults: financeResults({ duplicateCategory: true }),
  });
  assert.equal(plan.canPublish, false);
  assert.ok(plan.blockers.some((blocker) => blocker.code === "vfc_duplicate_existing"));
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

test("verified publish success is latched so delayed stale previews cannot overwrite it", () => {
  const ui = fs.readFileSync(new URL("../utils/dealerKitControlledPublish.js", import.meta.url), "utf8");
  assert.match(ui, /publishCompleted === "true"/);
  assert.match(ui, /_controlledPreviewRequestId/);
  assert.match(ui, /delayed READY response from the old CMS state must never overwrite/);
  assert.match(ui, /if \(root\.dataset\.publishCompleted === "true"\) return;/);
  assert.match(ui, /loadPreview\(root, \{ force: true \}\)/);
});

test("controlled endpoint and workspace use the explicit existing-vehicle update action", () => {
  const api = fs.readFileSync(new URL("../api/dealerkit-controlled-publish.js", import.meta.url), "utf8");
  const ui = fs.readFileSync(new URL("../utils/dealerKitControlledPublish.js", import.meta.url), "utf8");
  assert.match(api, /\["publish_new_vehicle", "update_existing_vehicle"\]\.includes\(action\)/);
  assert.match(api, /state\.plan\.writeIntent !== requestedIntent/);
  assert.match(ui, /action: updateExisting \? "update_existing_vehicle" : "publish_new_vehicle"/);
  assert.match(ui, /Existing Wix item IDs will be reused/);
  assert.doesNotMatch(ui, /try \{ await loadPreview\(root\); \} catch \{\}/);
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

test("CK70VAF Rent2Buy reconciliation can create missing listings while updating the existing detail row", () => {
  const rentDecision = {
    ...decision(),
    registration: "CK70VAF",
    financeEnabled: false,
    rent2buyEnabled: true,
    rent2buyCategories: ["medium_mwb"],
    financeCategories: [],
  };
  const rentVehicle = { ...vehicle(), registration: "CK70VAF", mileage: 41000, vatStatus: "plus_vat" };
  const rentImages = {
    ...imageSets(),
    vanFinance: {},
    rent2buy: { ready: true, mainUrl: listingImageUrl, listingImageUrl, galleryUrls, mainSource: "manual_template" },
  };
  const site = { siteId: "85f11c52-ee54-495d-aaec-a351831709b5", siteLabel: "Van Finance Rent2Buy", siteRole: "authoritative" };
  const rentResults = [
    { ...site, collectionId: "ALLRENT2BUYVANS", collection: { id: "ALLRENT2BUYVANS", kind: "listing" }, items: [] },
    { ...site, collectionId: "MEDIUMVANS", collection: { id: "MEDIUMVANS", kind: "listing" }, items: [] },
    { ...site, collectionId: "VANPAGES", collection: { id: "VANPAGES", kind: "detail" }, items: [{ id: "ck70-r2b-page", data: { title: "CK70VAF", mediaGallery: ["old.jpg"], _publishStatus: "PUBLISHED" } }] },
  ];
  const plan = buildControlledVehiclePublishPlan({
    vehicle: rentVehicle,
    decision: rentDecision,
    imageSets: rentImages,
    vfcWixResults: [],
    rent2buyWixResults: rentResults,
    rent2buySites: [site],
    productMode: "rent2buy",
  });
  assert.equal(plan.canPublish, true);
  assert.equal(plan.writeIntent, "update_existing_vehicle");
  assert.ok(!plan.blockers.some((blocker) => blocker.code === "mixed_write_intent"));
  assert.deepEqual(
    ["ALLRENT2BUYVANS", "MEDIUMVANS", "VANPAGES"].map((id) => {
      const target = plan.targets.find((item) => item.collectionId === id);
      return [id, target.operation, target.itemId || null];
    }),
    [
      ["ALLRENT2BUYVANS", "create", null],
      ["MEDIUMVANS", "create", null],
      ["VANPAGES", "update", "ck70-r2b-page"],
    ],
  );
});

test("Rent2Buy reconciliation restores selected Draft rows and drafts stale old categories", () => {
  const rentDecision = { ...decision(), financeEnabled: false, rent2buyEnabled: true, rent2buyCategories: ["medium_mwb"], financeCategories: [] };
  const rentVehicle = { ...vehicle(), mileage: 41000, vatStatus: "plus_vat" };
  const rentImages = { ...imageSets(), vanFinance: {}, rent2buy: { ready: true, mainUrl: listingImageUrl, listingImageUrl, galleryUrls, mainSource: "manual_template" } };
  const site = { siteId: "85f11c52-ee54-495d-aaec-a351831709b5", siteLabel: "Van Finance Rent2Buy", siteRole: "authoritative" };
  const rentResults = [
    { ...site, collectionId: "ALLRENT2BUYVANS", collection: { id: "ALLRENT2BUYVANS", kind: "listing" }, items: [item("r2b-all", { picture: "old.jpg", _publishStatus: "DRAFT" })] },
    { ...site, collectionId: "MEDIUMVANS", collection: { id: "MEDIUMVANS", kind: "listing" }, items: [item("r2b-medium", { picture: "old.jpg", _publishStatus: "PUBLISHED" })] },
    { ...site, collectionId: "SmallVans", collection: { id: "SmallVans", kind: "listing" }, items: [item("r2b-stale-small", { picture: "old.jpg", _publishStatus: "PUBLISHED" })] },
    { ...site, collectionId: "VANPAGES", collection: { id: "VANPAGES", kind: "detail" }, items: [item("r2b-page", { mediaGallery: ["old.jpg"], _publishStatus: "PUBLISHED" })] },
  ];
  const plan = buildControlledVehiclePublishPlan({
    vehicle: rentVehicle,
    decision: rentDecision,
    imageSets: rentImages,
    vfcWixResults: [],
    rent2buyWixResults: rentResults,
    rent2buySites: [site],
    productMode: "rent2buy",
  });
  assert.equal(plan.canPublish, true);
  const master = plan.targets.find((target) => target.collectionId === "ALLRENT2BUYVANS");
  const detail = plan.targets.find((target) => target.collectionId === "VANPAGES");
  const stale = plan.targets.find((target) => target.collectionId === "SmallVans");
  assert.equal(master.operation, "update");
  assert.equal(master.itemId, "r2b-all");
  assert.equal(master.publishStatusOperation, "publish");
  assert.equal(master.data.mth.startsWith("£"), true);
  assert.equal(detail.operation, "update");
  assert.deepEqual(detail.data.mediaGallery, galleryUrls);
  assert.equal(stale.operation, "draft");
  assert.equal(stale.itemId, "r2b-stale-small");
  assert.equal(stale.desiredPublishStatus, "DRAFT");
});

test("Cars reconciliation reuses the existing listing and creates a missing CARPAGES detail row", async () => {
  const { buildDealerKitCarWixPlan } = await import("../lib/dealerKitCarWixPlan.js");
  const carVehicle = { ...vehicle(), status: "available", mileage: 41000, year: 2022, make: "Ford", model: "Focus", description: "Ford Focus", specifications: { technical: [], standard: [], options: [] } };
  const carDecision = { registration, persisted: true, reviewStatus: "reviewed", reviewedSourceUpdatedAt: carVehicle.sourceUpdatedAt };
  const carImages = { ready: true, mainUrl: listingImageUrl, listingImageUrl, galleryUrls, dealerKitImageIds: ["dk-1", "dk-2", "dk-3"] };
  const plan = buildDealerKitCarWixPlan({
    vehicle: carVehicle,
    decision: carDecision,
    imageSet: carImages,
    carListingRows: [item("car-list", { picture: "old.jpg", price: "£13,995", _publishStatus: "DRAFT" })],
    carDetailRows: [],
  });
  assert.equal(plan.writeIntent, "update_existing_vehicle");
  assert.equal(plan.canPublish, true);
  const listing = plan.targets.find((target) => target.collectionId === "CARFINANCE");
  const detail = plan.targets.find((target) => target.collectionId === "CARPAGES");
  assert.equal(listing.operation, "update");
  assert.equal(listing.itemId, "car-list");
  assert.equal(listing.data.picture, listingImageUrl);
  assert.equal(listing.data.price, "£13,995");
  assert.equal(listing.publishStatusOperation, "publish");
  assert.equal(listing.desiredPublishStatus, "PUBLISHED");
  assert.equal(detail.operation, "create");
  assert.deepEqual(detail.data.mainImages, galleryUrls);
});

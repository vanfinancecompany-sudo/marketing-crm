import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildProductImageSets } from "../lib/dealerKitWixVehicleMedia.js";
import { buildDealerKitRent2BuyWixPlan } from "../lib/dealerKitRent2BuyWixPlan.js";
import {
  buildControlledPublishConfirmation,
  buildControlledVehiclePublishPlan,
  controlledPublishConfirmationMatches,
} from "../lib/dealerKitControlledPublishPlan.js";
import { VAN_FINANCE_WIX_COLLECTIONS } from "../lib/vanscoWixPrice.js";

const root = new URL("../", import.meta.url);
const now = "2026-09-10T17:00:00.000Z";

function vehicle(overrides = {}) {
  return {
    supplierStockId: "stock-1",
    registration: "AB23CDE",
    title: "Ford Transit Custom 2.0 Limited",
    make: "Ford",
    model: "Transit Custom",
    derivative: "2.0 Limited",
    mileage: 30000,
    year: 2023,
    fuel: "Diesel",
    transmission: "Manual",
    colour: "Silver",
    bhp: 130,
    retailPrice: 12000,
    vatStatus: "plus_vat",
    status: "available",
    sourceUpdatedAt: now,
    description: "Air conditioning, cruise control and parking sensors.",
    images: [
      { id: "dk-1", url: "https://dealerkit.example/1.jpg", identityStable: true, identitySource: "dealerkit" },
      { id: "dk-2", url: "https://dealerkit.example/2.jpg", identityStable: true, identitySource: "dealerkit" },
      { id: "dk-3", url: "https://dealerkit.example/3.jpg", identityStable: true, identitySource: "dealerkit" },
    ],
    specifications: { standard: [], options: [], technical: [] },
    ...overrides,
  };
}

function decision(overrides = {}) {
  return {
    persisted: true,
    supplierStockId: "stock-1",
    registration: "AB23CDE",
    reviewStatus: "reviewed",
    financeEnabled: true,
    rent2buyEnabled: false,
    financeCategories: ["all_vans", "medium_mwb"],
    excludedImageIds: [],
    imageOrderIds: ["dk-1", "dk-2", "dk-3"],
    primaryImageId: "dk-2",
    reviewedSourceUpdatedAt: now,
    updatedAt: "2026-09-10T17:05:00.000Z",
    ...overrides,
  };
}

function imported() {
  return ["dk-1", "dk-2", "dk-3"].map((id, index) => ({
    dealerKitImageId: id,
    wixUrl: `https://static.wixstatic.com/media/${id}.jpg`,
    ready: true,
    liveVerified: true,
    operationStatus: "READY",
    position: index + 1,
  }));
}

function manualReadiness(overrides = {}) {
  return { selections: {}, ...overrides };
}

function emptyVfcRows() {
  return VAN_FINANCE_WIX_COLLECTIONS.map((collection) => ({ collection, collectionId: collection.id, items: [] }));
}

function cleanVfcPlan() {
  const v = vehicle();
  const d = decision();
  const sets = buildProductImageSets({ vehicle: v, decision: d, importedDealerKitMedia: imported(), manualMediaReadiness: manualReadiness() });
  return buildControlledVehiclePublishPlan({ vehicle: v, decision: d, imageSets: sets, vfcWixResults: emptyVfcRows(), rent2buyWixResults: [] });
}

test("Van Finance primary image becomes both listing image and first gallery image", () => {
  const sets = buildProductImageSets({ vehicle: vehicle(), decision: decision(), importedDealerKitMedia: imported(), manualMediaReadiness: manualReadiness() });
  assert.equal(sets.vanFinance.mainUrl, "https://static.wixstatic.com/media/dk-2.jpg");
  assert.equal(sets.vanFinance.listingImageUrl, sets.vanFinance.mainUrl);
  assert.equal(sets.vanFinance.galleryUrls[0], sets.vanFinance.mainUrl);
  assert.equal(sets.vanFinance.ready, true);
});

test("Rent2Buy template is isolated from Van Finance and leads only the Rent2Buy gallery", () => {
  const template = { id: "manual-r2b", purpose: "rent2buy_template", selected: true, selectedAndReady: true, url: "https://static.wixstatic.com/media/r2b-template.png" };
  const sets = buildProductImageSets({ vehicle: vehicle(), decision: decision({ rent2buyEnabled: true }), importedDealerKitMedia: imported(), manualMediaReadiness: manualReadiness({ selections: { rent2buy_template: template } }) });
  assert.equal(sets.rent2buy.listingImageUrl, template.url);
  assert.equal(sets.rent2buy.galleryUrls[0], template.url);
  assert.equal(sets.vanFinance.listingImageUrl, "https://static.wixstatic.com/media/dk-2.jpg");
  assert.ok(!sets.vanFinance.galleryUrls.includes(template.url));
});

test("Van Finance manual replacement stays isolated from Rent2Buy template", () => {
  const vfc = { selected: true, selectedAndReady: true, url: "https://static.wixstatic.com/media/vfc-replacement.png" };
  const r2b = { selected: true, selectedAndReady: true, url: "https://static.wixstatic.com/media/r2b-template.png" };
  const sets = buildProductImageSets({ vehicle: vehicle(), decision: decision({ rent2buyEnabled: true }), importedDealerKitMedia: imported(), manualMediaReadiness: manualReadiness({ selections: { van_finance_replacement: vfc, rent2buy_template: r2b } }) });
  assert.equal(sets.vanFinance.mainUrl, vfc.url);
  assert.equal(sets.rent2buy.mainUrl, r2b.url);
  assert.ok(!sets.rent2buy.galleryUrls.includes(vfc.url));
  assert.ok(!sets.vanFinance.galleryUrls.includes(r2b.url));
});

test("Rent2Buy 4x4 under 42k uses template card image and 4 upfront plus 47", () => {
  const r2b = { selected: true, selectedAndReady: true, url: "https://static.wixstatic.com/media/r2b-template.png" };
  const d = decision({ rent2buyEnabled: true, financeCategories: ["all_vans", "pickup_4x4"] });
  const sets = buildProductImageSets({ vehicle: vehicle({ mileage: 30000 }), decision: d, importedDealerKitMedia: imported(), manualMediaReadiness: manualReadiness({ selections: { rent2buy_template: r2b } }) });
  const plan = buildDealerKitRent2BuyWixPlan({ vehicle: vehicle({ mileage: 30000 }), decision: d, imageSets: sets });
  assert.equal(plan.canPublish, true);
  assert.equal(plan.pricing.termMonths, 48);
  assert.equal(plan.pricing.upfrontMonths, 4);
  assert.equal(plan.pricing.followingPayments, 47);
  const pickup = plan.targets.find((target) => target.collectionId === "PICKUPS");
  assert.equal(pickup.data.picture, r2b.url);
  assert.equal(pickup.data.weekly, "x47");
  const detail = plan.targets.find((target) => target.collectionId === "VANPAGES");
  assert.equal(detail.data.mediaGallery[0], r2b.url);
  assert.equal(detail.data.numberOfMonths, "47X MONTHLY PAYMENTS");
});

test("Rent2Buy 4x4 over 42k uses 75 percent and 4 upfront plus 35", () => {
  const r2b = { selected: true, selectedAndReady: true, url: "https://static.wixstatic.com/media/r2b-template.png" };
  const d = decision({ rent2buyEnabled: true, financeCategories: ["all_vans", "pickup_4x4"] });
  const v = vehicle({ mileage: 80000 });
  const sets = buildProductImageSets({ vehicle: v, decision: d, importedDealerKitMedia: imported(), manualMediaReadiness: manualReadiness({ selections: { rent2buy_template: r2b } }) });
  const plan = buildDealerKitRent2BuyWixPlan({ vehicle: v, decision: d, imageSets: sets });
  assert.equal(plan.pricing.termMonths, 36);
  assert.equal(plan.pricing.upliftPercent, 75);
  assert.equal(plan.pricing.followingPayments, 35);
  assert.equal(plan.pricing.upfrontMonths, 4);
});

test("controlled publisher permits a fully new clean VFC vehicle", () => {
  const plan = cleanVfcPlan();
  assert.equal(plan.canPublish, true);
  const listing = plan.targets.find((target) => target.collectionId === "VANFINANCE-ALLVANS");
  const detail = plan.targets.find((target) => target.collectionId === "VANFINANCEPAGES");
  assert.equal(listing.data.picture, plan.imageSets.vanFinance.mainUrl);
  assert.equal(detail.data.mainImages[0], plan.imageSets.vanFinance.mainUrl);
});

test("any ghost VFC row blocks the new-vehicle publisher even when its category is not selected", () => {
  const v = vehicle();
  const d = decision();
  const sets = buildProductImageSets({ vehicle: v, decision: d, importedDealerKitMedia: imported(), manualMediaReadiness: manualReadiness() });
  const rows = emptyVfcRows();
  rows.find((entry) => entry.collection.id === "VANFINANCE-PICKUPS").items = [{ id: "ghost", data: { title: "AB23CDE" } }];
  const plan = buildControlledVehiclePublishPlan({ vehicle: v, decision: d, imageSets: sets, vfcWixResults: rows, rent2buyWixResults: [] });
  assert.equal(plan.canPublish, false);
  assert.ok(plan.blockers.some((item) => item.code === "vfc_existing_anywhere"));
});

test("an existing Rent2Buy row does not block an independent Finance-only publish", () => {
  const v = vehicle();
  const d = decision({ rent2buyEnabled: false });
  const sets = buildProductImageSets({ vehicle: v, decision: d, importedDealerKitMedia: imported(), manualMediaReadiness: manualReadiness() });
  const plan = buildControlledVehiclePublishPlan({
    vehicle: v,
    decision: d,
    imageSets: sets,
    vfcWixResults: emptyVfcRows(),
    rent2buyWixResults: [{ collectionId: "ALLRENT2BUYVANS", items: [{ id: "old-r2b", data: { title: "AB23CDE" } }] }],
  });
  assert.equal(plan.canPublish, true);
  assert.ok(!plan.blockers.some((item) => item.code === "rent2buy_existing_anywhere"));
});

test("controlled publisher permits Rent2Buy-only creation without Van Finance", () => {
  const template = { selected: true, selectedAndReady: true, url: "https://static.wixstatic.com/media/r2b-template.png" };
  const v = vehicle();
  const d = decision({ financeEnabled: false, rent2buyEnabled: true, rent2buyCategories: ["all_vans", "medium_mwb"] });
  const sets = buildProductImageSets({ vehicle: v, decision: d, importedDealerKitMedia: imported(), manualMediaReadiness: manualReadiness({ selections: { rent2buy_template: template } }) });
  const plan = buildControlledVehiclePublishPlan({ vehicle: v, decision: d, imageSets: sets, vfcWixResults: emptyVfcRows(), rent2buyWixResults: [], productMode: "rent2buy" });
  assert.equal(plan.mode, "rent2buy");
  assert.equal(plan.canPublish, true);
  assert.equal(plan.vfc.targets.length, 0);
  assert.ok(plan.targets.length >= 2);
  assert.ok(plan.targets.every((target) => target.product === "rent2buy"));
  assert.ok(!plan.blockers.some((item) => item.code === "finance_disabled"));
});

test("stale DealerKit review blocks final creation even if media and Wix rows are clean", () => {
  const v = vehicle({ sourceUpdatedAt: "2026-09-10T18:00:00.000Z" });
  const d = decision();
  const sets = buildProductImageSets({ vehicle: v, decision: d, importedDealerKitMedia: imported(), manualMediaReadiness: manualReadiness() });
  const plan = buildControlledVehiclePublishPlan({ vehicle: v, decision: d, imageSets: sets, vfcWixResults: emptyVfcRows(), rent2buyWixResults: [] });
  assert.equal(plan.canPublish, false);
  assert.ok(plan.blockers.some((item) => item.code === "stale_review"));
});

test("final confirmation fingerprints the exact CMS field payload", () => {
  const plan = cleanVfcPlan();
  const confirmation = buildControlledPublishConfirmation(plan);
  assert.equal(controlledPublishConfirmationMatches(confirmation, plan), true);
  const changed = structuredClone(plan);
  changed.targets.find((target) => target.collectionId === "VANFINANCEPAGES").data.vehicleDescriptionTextClick = "DealerKit changed this description after preview";
  assert.equal(controlledPublishConfirmationMatches(confirmation, changed), false);
});

test("confirmation remains stable when only object key insertion order differs", () => {
  const plan = cleanVfcPlan();
  const confirmation = buildControlledPublishConfirmation(plan);
  const reordered = structuredClone(plan);
  const target = reordered.targets[0];
  target.data = Object.fromEntries(Object.entries(target.data).reverse());
  assert.equal(controlledPublishConfirmationMatches(confirmation, reordered), true);
});

test("media preparation cannot write vehicle CMS rows", async () => {
  const source = await readFile(new URL("api/dealerkit-wix-prepare-media.js", root), "utf8");
  assert.match(source, /WIX_MEDIA_IMPORT_URL/);
  assert.match(source, /cmsWritesAttempted:\s*false/);
  assert.doesNotMatch(source, /dataCollectionId:\s*target\.collectionId/);
  assert.match(source, /confirmRegistration/);
});

test("fresh state queries every Rent2Buy collection even for a VFC-only decision", async () => {
  const source = await readFile(new URL("api/_dealerkit-controlled-publish-state.js", root), "utf8");
  assert.match(source, /function allRent2BuyCollectionIds\(\)/);
  assert.doesNotMatch(source, /if \(!decision\.rent2buyEnabled\) return \[\]/);
  assert.match(source, /Promise\.all\(allRent2BuyCollectionIds\(\)\.map/);
});

test("final publisher requires confirmation, inserts only new rows, verifies and rolls back", async () => {
  const source = await readFile(new URL("api/dealerkit-controlled-publish.js", root), "utf8");
  assert.match(source, /action !== "publish_new_vehicle"/);
  assert.match(source, /controlledPublishConfirmationMatches/);
  assert.match(source, /buildFreshControlledPublishState/);
  assert.match(source, /\/wix-data\/v2\/items/);
  assert.match(source, /rollbackCreated/);
  assert.match(source, /method:\s*"DELETE"/);
  assert.match(source, /consistentRead:\s*true/);
  assert.match(source, /manualAttentionRequired:\s*Boolean/);
  assert.match(source, /verified:\s*true/);
});

test("operator flow separates media preparation from final CMS publishing", async () => {
  const source = await readFile(new URL("utils/dealerKitControlledPublish.js", root), "utf8");
  assert.match(source, /Prepare images/);
  assert.match(source, /Publish to \$\{productLabel\}/);
  assert.match(source, /productMode/);
  assert.match(source, /final live-write confirmation/i);
  assert.match(source, /dealerkit-controlled-publish-preview/);
  assert.match(source, /dealerkit-wix-prepare-media/);
  assert.match(source, /dealerkit-controlled-publish/);
});

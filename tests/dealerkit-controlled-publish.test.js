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
import { reconcileControlledTargets, setTargetPublishStatus, verifyWritten } from "../api/dealerkit-controlled-publish.js";

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

test("a single stale VFC category row is preserved and scheduled for Draft", () => {
  const v = vehicle();
  const d = decision();
  const sets = buildProductImageSets({ vehicle: v, decision: d, importedDealerKitMedia: imported(), manualMediaReadiness: manualReadiness() });
  const rows = emptyVfcRows();
  rows.find((entry) => entry.collection.id === "VANFINANCE-PICKUPS").items = [{ id: "ghost", data: { title: "AB23CDE" } }];
  const plan = buildControlledVehiclePublishPlan({ vehicle: v, decision: d, imageSets: sets, vfcWixResults: rows, rent2buyWixResults: [] });
  assert.equal(plan.canPublish, true);
  const stale = plan.targets.find((target) => target.collectionId === "VANFINANCE-PICKUPS");
  assert.equal(stale.operation, "draft");
  assert.equal(stale.itemId, "ghost");
  assert.equal(stale.desiredPublishStatus, "DRAFT");
});

test("selected existing listing, category and detail rows update in place while missing collections create", () => {
  const v = vehicle();
  const d = decision({ financeCategories: ["all_vans", "medium_mwb", "automatic"] });
  const sets = buildProductImageSets({ vehicle: v, decision: d, importedDealerKitMedia: imported(), manualMediaReadiness: manualReadiness() });
  const rows = emptyVfcRows();
  rows.find((entry) => entry.collection.id === "VANFINANCE-ALLVANS").items = [{ id: "all-existing", data: { title: "AB23CDE", manualNote: "keep", _publishStatus: "PUBLISHED" } }];
  rows.find((entry) => entry.collection.id === "VANFINANCE-MWB").items = [{ id: "mwb-existing", data: { title: "AB23CDE", _publishStatus: "PUBLISHED" } }];
  rows.find((entry) => entry.collection.id === "VANFINANCEPAGES").items = [{ id: "detail-existing", data: { title: "AB23CDE", privateMemo: "keep", _publishStatus: "PUBLISHED" } }];

  const plan = buildControlledVehiclePublishPlan({ vehicle: v, decision: d, imageSets: sets, vfcWixResults: rows, rent2buyWixResults: [] });
  assert.equal(plan.canPublish, true);
  assert.equal(plan.newVehicleOnly, false);
  assert.equal(plan.writeIntent, "update_existing_vehicle");
  assert.deepEqual(
    ["VANFINANCE-ALLVANS", "VANFINANCE-MWB", "VANFINANCEPAGES"].map((id) => {
      const target = plan.targets.find((item) => item.collectionId === id);
      return [target.operation, target.itemId];
    }),
    [["update", "all-existing"], ["update", "mwb-existing"], ["update", "detail-existing"]],
  );
  const automatic = plan.targets.find((target) => target.collectionId === "AUTOMATIC");
  assert.equal(automatic.operation, "create");
  assert.equal(automatic.itemId, undefined);
  assert.ok(plan.targets.find((target) => target.collectionId === "VANFINANCEPAGES").data.vehicleDescriptionTextClick);
});

test("re-running the reconciler against the resulting identities remains update-only", () => {
  const v = vehicle();
  const d = decision();
  const sets = buildProductImageSets({ vehicle: v, decision: d, importedDealerKitMedia: imported(), manualMediaReadiness: manualReadiness() });
  const first = buildControlledVehiclePublishPlan({ vehicle: v, decision: d, imageSets: sets, vfcWixResults: emptyVfcRows(), rent2buyWixResults: [] });
  const resultingRows = emptyVfcRows();
  for (const target of first.targets.filter((item) => item.product === "van_finance")) {
    resultingRows.find((entry) => entry.collection.id === target.collectionId).items = [{ id: `saved-${target.collectionId}`, data: { ...target.data, _publishStatus: "PUBLISHED" } }];
  }
  const rerun = buildControlledVehiclePublishPlan({ vehicle: v, decision: d, imageSets: sets, vfcWixResults: resultingRows, rent2buyWixResults: [] });
  assert.equal(rerun.canPublish, true);
  assert.ok(rerun.targets.filter((target) => target.product === "van_finance").every((target) => target.operation === "update"));
});

test("two matching rows in one Finance collection fail closed", () => {
  const v = vehicle();
  const d = decision();
  const sets = buildProductImageSets({ vehicle: v, decision: d, importedDealerKitMedia: imported(), manualMediaReadiness: manualReadiness() });
  const rows = emptyVfcRows();
  rows.find((entry) => entry.collection.id === "VANFINANCE-ALLVANS").items = [
    { id: "duplicate-1", data: { title: "AB23CDE" } },
    { id: "duplicate-2", data: { title: "AB23CDE" } },
  ];
  const plan = buildControlledVehiclePublishPlan({ vehicle: v, decision: d, imageSets: sets, vfcWixResults: rows, rent2buyWixResults: [] });
  assert.equal(plan.canPublish, false);
  assert.ok(plan.blockers.some((item) => item.code === "vfc_duplicate_existing"));
});

test("a selected Draft row is updated, keeps its ID and is restored to Published", () => {
  const v = vehicle();
  const d = decision();
  const sets = buildProductImageSets({ vehicle: v, decision: d, importedDealerKitMedia: imported(), manualMediaReadiness: manualReadiness() });
  const rows = emptyVfcRows();
  rows.find((entry) => entry.collection.id === "VANFINANCE-ALLVANS").items = [{ id: "draft-all", data: { title: "AB23CDE", _publishStatus: "DRAFT" } }];
  const plan = buildControlledVehiclePublishPlan({ vehicle: v, decision: d, imageSets: sets, vfcWixResults: rows, rent2buyWixResults: [] });
  const target = plan.targets.find((item) => item.collectionId === "VANFINANCE-ALLVANS");
  assert.equal(target.operation, "update");
  assert.equal(target.itemId, "draft-all");
  assert.equal(target.currentPublishStatus, "DRAFT");
  assert.equal(target.publishStatusOperation, "publish");
  assert.equal(target.desiredPublishStatus, "PUBLISHED");
});

test("publish-status task uses the Wix background-task contract", async () => {
  const calls = [];
  const request = async (_configuration, path, options) => {
    calls.push({ path, options });
    if (path === "/cms/v1/tasks") return { task: { id: "task-1" } };
    return { task: { id: "task-1", status: "COMPLETED", itemsSucceeded: 1, itemsFailed: 0 } };
  };
  const result = await setTargetPublishStatus({ siteId: "site-1" }, { product: "van_finance", collectionId: "VANFINANCE-ALLVANS", kind: "listing", operation: "update", currentPublishStatus: "DRAFT", desiredPublishStatus: "PUBLISHED" }, "item-1", { request, wait: async () => {} });
  assert.equal(result.action, "publish");
  assert.equal(calls[0].options.body.task.updatePublishStatusOptions.operation, "SET_PUBLISHED_STATUS");
  assert.deepEqual(calls[0].options.body.task.updatePublishStatusOptions.filter, { _id: { $eq: "item-1" } });
});

test("final verification checks registration, item identity and publish status", async () => {
  const state = { configuration: { siteId: "finance-site" }, configurationsBySiteId: {} };
  const target = { product: "van_finance", collectionId: "VANFINANCE-ALLVANS", kind: "listing", operation: "update", itemId: "all-1", desiredPublishStatus: "PUBLISHED" };
  const draftResult = await verifyWritten(state, "AB23CDE", [target], [], { request: async () => ({ dataItems: [{ id: "all-1", data: { title: "AB23CDE", _publishStatus: "DRAFT" } }] }) });
  assert.equal(draftResult.verified, false);
  assert.equal(draftResult.results[0].publishStatusVerified, false);
  const liveResult = await verifyWritten(state, "AB23CDE", [target], [], { request: async () => ({ dataItems: [{ id: "all-1", data: { title: "AB23CDE", _publishStatus: "PUBLISHED" } }] }) });
  assert.equal(liveResult.verified, true);
  assert.equal(liveResult.results[0].publishStatusVerified, true);
});

test("mixed reconciliation failure rolls back fields and flags an uncertain status change", async () => {
  const targets = [
    { product: "van_finance", collectionId: "VANFINANCE-ALLVANS", kind: "listing", operation: "update", itemId: "all-1", publishStatusOperation: "publish" },
    { product: "van_finance", collectionId: "AUTOMATIC", kind: "listing", operation: "create", publishStatusOperation: "publish" },
    { product: "van_finance", collectionId: "VANFINANCE-MWB", kind: "listing", operation: "draft", itemId: "old-mwb", publishStatusOperation: "draft" },
  ];
  const applied = [];
  let statusCalls = 0;
  let rolledBackWrites = [];
  let rolledBackStatuses = [];
  await assert.rejects(
    reconcileControlledTargets({ configuration: { siteId: "finance-site" }, configurationsBySiteId: {} }, "AB23CDE", targets, {
      applyTarget: async (_configuration, target) => {
        const write = { ...target, itemId: target.itemId || "new-auto" };
        applied.push(write);
        return write;
      },
      setTargetPublishStatus: async (_configuration, target, itemId) => {
        statusCalls += 1;
        if (statusCalls === 2) {
          const error = new Error("task result unknown");
          error.details = { publishStatusChangeUncertain: true };
          throw error;
        }
        return { ...target, operation: "publish_status", sourceOperation: target.operation, itemId, previousPublishStatus: "DRAFT", desiredPublishStatus: "PUBLISHED" };
      },
      rollbackCreatedAndUpdated: async (_state, writes) => { rolledBackWrites = writes; return writes.map((item) => ({ ...item, rolledBack: true })); },
      rollbackPublishStatuses: async (_state, transitions) => { rolledBackStatuses = transitions; return transitions.map((item) => ({ ...item, rolledBack: true })); },
      verifyWritten: async () => ({ verified: true, results: [] }),
    }),
    (error) => {
      assert.equal(error.details.manualAttentionRequired, true);
      assert.equal(error.details.rollback.length, 2);
      return true;
    },
  );
  assert.equal(applied.length, 2);
  assert.equal(rolledBackWrites.length, 2);
  assert.equal(rolledBackStatuses.length, 1);
});

test("CK70VAF regression reuses its existing detail and Finance listing identities", () => {
  const v = vehicle({ registration: "CK70VAF", supplierStockId: "dealerkit-ck70vaf" });
  const d = decision({ registration: "CK70VAF", supplierStockId: "dealerkit-ck70vaf", financeCategories: ["all_vans", "medium_mwb"] });
  const sets = buildProductImageSets({ vehicle: v, decision: d, importedDealerKitMedia: imported(), manualMediaReadiness: manualReadiness() });
  const rows = emptyVfcRows();
  rows.find((entry) => entry.collection.id === "VANFINANCE-ALLVANS").items = [{ id: "ck70-all", data: { title: "CK70VAF", _publishStatus: "DRAFT" } }];
  rows.find((entry) => entry.collection.id === "VANFINANCE-MWB").items = [{ id: "ck70-mwb", data: { title: "CK70VAF", _publishStatus: "PUBLISHED" } }];
  rows.find((entry) => entry.collection.id === "VANFINANCEPAGES").items = [{ id: "ck70-page", data: { title: "CK70 VAF", _publishStatus: "DRAFT" } }];

  const plan = buildControlledVehiclePublishPlan({ vehicle: v, decision: d, imageSets: sets, vfcWixResults: rows, rent2buyWixResults: [] });
  assert.equal(plan.canPublish, true);
  assert.deepEqual(plan.targets.filter((target) => target.product === "van_finance").map((target) => [target.collectionId, target.operation, target.itemId]), [
    ["VANFINANCE-ALLVANS", "update", "ck70-all"],
    ["VANFINANCE-MWB", "update", "ck70-mwb"],
    ["VANFINANCEPAGES", "update", "ck70-page"],
  ]);
  assert.equal(plan.targets.filter((target) => target.operation === "create").length, 0);
  assert.equal(plan.targets.filter((target) => target.publishStatusOperation === "publish").length, 2);
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
  const changedStatus = structuredClone(plan);
  changedStatus.targets.find((target) => target.collectionId === "VANFINANCE-ALLVANS").desiredPublishStatus = "DRAFT";
  assert.equal(controlledPublishConfirmationMatches(confirmation, changedStatus), false);
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

test("final publisher requires confirmation, reconciles rows and publish status, verifies and rolls back", async () => {
  const source = await readFile(new URL("api/dealerkit-controlled-publish.js", root), "utf8");
  assert.match(source, /\["publish_new_vehicle", "update_existing_vehicle"\]\.includes\(action\)/);
  assert.match(source, /controlledPublishConfirmationMatches/);
  assert.match(source, /buildFreshControlledPublishState/);
  assert.match(source, /\/wix-data\/v2\/items/);
  assert.match(source, /rollbackCreated/);
  assert.match(source, /SET_PUBLISHED_STATUS/);
  assert.match(source, /SET_DRAFT_STATUS/);
  assert.match(source, /method:\s*"DELETE"/);
  assert.match(source, /consistentRead:\s*true/);
  assert.match(source, /manualAttentionRequired:\s*Boolean/);
  assert.match(source, /verified:\s*true/);
});

test("operator flow separates media preparation from final CMS publishing", async () => {
  const source = await readFile(new URL("utils/dealerKitControlledPublish.js", root), "utf8");
  assert.match(source, /Prepare images/);
  assert.match(source, /Publish to \$\{(?:labelText|productLabel)\}/);
  assert.match(source, /productMode/);
  assert.match(source, /final live-write confirmation/i);
  assert.match(source, /dealerkit-controlled-publish-preview/);
  assert.match(source, /dealerkit-wix-prepare-media/);
  assert.match(source, /dealerkit-controlled-publish/);
});

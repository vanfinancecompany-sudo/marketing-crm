import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { registrationTitleVariants } from "../lib/wixRegistrationVariants.js";
import { buildControlledVfcTargets } from "../lib/dealerKitControlledPublishPlan.js";

const registration = "BD21HCX";
const galleryUrls = ["wix:image://v1/new-1.jpg", "wix:image://v1/new-2.jpg", "wix:image://v1/new-3.jpg"];

function item(id, title = registration, data = {}) {
  return { id, data: { title, ...data } };
}

function vehicle() {
  return {
    supplierStockId: "dealerkit-bd21hcx",
    registration,
    title: "Ford Transit 350 EcoBlue HD Leader Chassis Cab",
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
  };
}

function imageSets() {
  return {
    dealerKitImageIds: ["dk-1", "dk-2", "dk-3"],
    vanFinance: {
      ready: true,
      mainUrl: galleryUrls[0],
      listingImageUrl: galleryUrls[0],
      galleryUrls,
    },
    rent2buy: {},
  };
}

test("registration title variants include the spaced Wix form for BD21HCX", () => {
  const variants = registrationTitleVariants(registration);
  assert.ok(variants.includes("BD21HCX"));
  assert.ok(variants.includes("BD21 HCX"));
});

test("final detail lookup normalises matched Wix titles back to the exact registration", () => {
  const source = fs.readFileSync(new URL("../api/_dealerkit-controlled-publish-state.js", import.meta.url), "utf8");
  assert.match(source, /registrationTitleVariants\(registration\)/);
  assert.match(source, /normalizeFinanceRegistration\(item\?\.data\?\.title \|\| ""\) !== registration/);
  assert.match(source, /collectionId === "VANFINANCEPAGES" \|\| collectionId === "VANPAGES"/);
});

test("existing Finance image refresh still requires the vehicle page so gallery updates cannot silently be skipped", () => {
  const wixResults = [
    { collectionId: "VANFINANCE-ALLVANS", collection: { id: "VANFINANCE-ALLVANS", kind: "listing" }, items: [item("all-1")] },
    { collectionId: "VANFINANCE-TIPPERSDROPSIDEL", collection: { id: "VANFINANCE-TIPPERSDROPSIDEL", kind: "listing" }, items: [item("tip-1")] },
  ];
  const plan = buildControlledVfcTargets({ vehicle: vehicle(), decision: decision(), imageSets: imageSets(), wixResults });
  assert.equal(plan.writeIntent, "update_existing_vehicle");
  assert.equal(plan.canPublish, false);
  assert.ok(plan.blockers.some((blocker) => blocker.code === "vfc_refresh_detail_missing"));
});

test("spaced detail title participates in the same safe image-only update plan once found", () => {
  const wixResults = [
    { collectionId: "VANFINANCE-ALLVANS", collection: { id: "VANFINANCE-ALLVANS", kind: "listing" }, items: [item("all-1")] },
    { collectionId: "VANFINANCE-TIPPERSDROPSIDEL", collection: { id: "VANFINANCE-TIPPERSDROPSIDEL", kind: "listing" }, items: [item("tip-1")] },
    { collectionId: "VANFINANCEPAGES", collection: { id: "VANFINANCEPAGES", kind: "detail" }, items: [item("page-1", "BD21 HCX", { mainImages: ["old.jpg"], imageCount: "1" })] },
  ];
  const plan = buildControlledVfcTargets({ vehicle: vehicle(), decision: decision(), imageSets: imageSets(), wixResults });
  assert.equal(plan.canPublish, true);
  const detail = plan.targets.find((target) => target.collectionId === "VANFINANCEPAGES");
  assert.deepEqual(detail.data, { mainImages: galleryUrls, imageCount: "3" });
  assert.equal(detail.operation, "update");
  assert.equal(detail.itemId, "page-1");
});

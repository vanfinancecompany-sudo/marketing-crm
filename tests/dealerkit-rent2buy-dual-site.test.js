import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildControlledPublishConfirmation, buildControlledVehiclePublishPlan } from "../lib/dealerKitControlledPublishPlan.js";
import { VAN_FINANCE_RENT2BUY_WIX_SITE_ID } from "../lib/dealerKitRent2BuyWixPlan.js";

const root = new URL("../", import.meta.url);
const now = "2026-09-11T00:10:00.000Z";

function vehicle() {
  return {
    supplierStockId: "r2b-shared-cms",
    registration: "FV72 DZA",
    title: "Peugeot Partner 1.5 BlueHDi 1000 Professional Premium Standard Panel Van 5dr Diesel Manual SWB Euro 6 (100 bhp)",
    make: "Peugeot",
    model: "Partner",
    derivative: "1.5 BlueHDi 1000 Professional Premium Standard Panel Van 5dr Diesel Manual SWB Euro 6 (100 bhp)",
    bodyType: "Panel Van",
    retailPrice: 11795,
    vatStatus: "plus_vat",
    year: 2022,
    mileage: 22000,
    fuel: "Diesel",
    transmission: "Manual",
    colour: "Nera Black (Metallic Paint)",
    bhp: 100,
    status: "available",
    sourceUpdatedAt: now,
    description: "Peugeot Partner BlueHDi 1000 Professional Premium\nAIR CONDITIONING\nBLUETOOTH\nEURO 6",
    specifications: {
      standard: [], options: [],
      technical: [
        { name: "Engine Size", value: "1499 cc" },
        { name: "Combined MPG", value: "55.4 mpg" },
      ],
    },
  };
}

function decision() {
  return {
    persisted: true,
    supplierStockId: "r2b-shared-cms",
    registration: "FV72DZA",
    reviewStatus: "reviewed",
    financeEnabled: false,
    rent2buyEnabled: true,
    rent2buyCategories: ["all_vans", "small"],
    reviewedSourceUpdatedAt: now,
    updatedAt: "2026-09-11T00:11:00.000Z",
  };
}

function imageSets() {
  return {
    dealerKitImageIds: ["dk-1"],
    vanFinance: {},
    rent2buy: {
      ready: true,
      mainUrl: "https://static.wixstatic.com/media/r2b-template.png",
      listingImageUrl: "https://static.wixstatic.com/media/r2b-template.png",
      galleryUrls: ["https://static.wixstatic.com/media/r2b-template.png", "https://static.wixstatic.com/media/dk-1.jpg"],
    },
  };
}

const sites = [
  { siteId: VAN_FINANCE_RENT2BUY_WIX_SITE_ID, siteLabel: "VAN FINANCE Wix · Rent2Buy shared CMS", siteRole: "authoritative" },
];

function emptyResults() {
  return ["ALLRENT2BUYVANS", "SmallVans", "VANPAGES"].map((collectionId) => ({ ...sites[0], collectionId, items: [] }));
}

test("Rent2Buy publish plan writes only to the shared Van Finance Wix CMS", () => {
  const plan = buildControlledVehiclePublishPlan({ vehicle: vehicle(), decision: decision(), imageSets: imageSets(), rent2buyWixResults: emptyResults(), rent2buySites: sites, productMode: "rent2buy" });
  assert.equal(plan.canPublish, true);
  assert.equal(plan.targets.length, 3);
  assert.ok(plan.targets.every((target) => target.siteId === VAN_FINANCE_RENT2BUY_WIX_SITE_ID));

  const master = plan.targets.find((target) => target.collectionId === "ALLRENT2BUYVANS");
  assert.equal(master.data.title, "FV72DZA");
  assert.match(master.data.mitsubishiL200Barbarian, /^Peugeot Partner/);
  assert.match(master.data.webLink, /vanfinancecompany\.co\.uk\/guaranteed-rent2buy-vans\/fv72dza$/);
});

test("Rent2Buy detail specs include source-backed Engine, Euro and MPG without replacing the registration identity", () => {
  const plan = buildControlledVehiclePublishPlan({ vehicle: vehicle(), decision: decision(), imageSets: imageSets(), rent2buyWixResults: emptyResults(), rent2buySites: sites, productMode: "rent2buy" });
  const detail = plan.targets.find((target) => target.collectionId === "VANPAGES");
  assert.equal(detail.data.title, "FV72DZA");
  assert.match(detail.data.titleText, /^Peugeot Partner 1\.5 BlueHDi/);
  assert.match(detail.data.specText, /ENGINE SIZE: 1499 CC/i);
  assert.match(detail.data.specText, /EURO: 6/i);
  assert.match(detail.data.specText, /MPG: 55\.4/i);
});

test("an existing Rent2Buy detail row is reused in the shared CMS", () => {
  const rows = emptyResults();
  const detailRow = rows.find((entry) => entry.collectionId === "VANPAGES");
  detailRow.items = [{ id: "historic-shared-detail", data: { title: "FV72DZA", titleText: "Old title" } }];
  const plan = buildControlledVehiclePublishPlan({ vehicle: vehicle(), decision: decision(), imageSets: imageSets(), rent2buyWixResults: rows, rent2buySites: sites, productMode: "rent2buy" });
  const detail = plan.targets.find((target) => target.collectionId === "VANPAGES");
  assert.equal(detail.operation, "update");
  assert.equal(detail.itemId, "historic-shared-detail");
});

test("confirmation fingerprints the shared CMS destination", () => {
  const plan = buildControlledVehiclePublishPlan({ vehicle: vehicle(), decision: decision(), imageSets: imageSets(), rent2buyWixResults: emptyResults(), rent2buySites: sites, productMode: "rent2buy" });
  const confirmation = buildControlledPublishConfirmation(plan);
  assert.deepEqual(new Set(confirmation.targetPayloads.map((target) => target.siteId)), new Set([VAN_FINANCE_RENT2BUY_WIX_SITE_ID]));
});

test("runtime controlled publisher does not require a standalone Rent2Buy Wix write target", async () => {
  const state = await readFile(new URL("api/_dealerkit-controlled-publish-state.js", root), "utf8");
  const publisher = await readFile(new URL("api/dealerkit-controlled-publish.js", root), "utf8");
  assert.match(state, /shared CMS/);
  assert.doesNotMatch(state, /STANDALONE_RENT2BUY_WIX_SITE_ID/);
  assert.match(state, /controlledRent2BuyWixConfigurations/);
  assert.match(publisher, /configurationForTarget/);
  assert.match(publisher, /rollbackCreatedAndUpdated\(state, writes\)/);
});

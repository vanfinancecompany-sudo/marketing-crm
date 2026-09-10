import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildControlledPublishConfirmation, buildControlledVehiclePublishPlan } from "../lib/dealerKitControlledPublishPlan.js";
import { VAN_FINANCE_RENT2BUY_WIX_SITE_ID, STANDALONE_RENT2BUY_WIX_SITE_ID } from "../lib/dealerKitRent2BuyWixPlan.js";

const root = new URL("../", import.meta.url);
const now = "2026-09-11T00:10:00.000Z";

function vehicle() {
  return {
    supplierStockId: "r2b-dual-site",
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
    supplierStockId: "r2b-dual-site",
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
  { siteId: VAN_FINANCE_RENT2BUY_WIX_SITE_ID, siteLabel: "VAN FINANCE Wix · Rent2Buy", siteRole: "authoritative" },
  { siteId: STANDALONE_RENT2BUY_WIX_SITE_ID, siteLabel: "RENT2BUY VANS Wix", siteRole: "mirror" },
];

function emptyResults() {
  return sites.flatMap((site) => ["ALLRENT2BUYVANS", "SmallVans", "VANPAGES"].map((collectionId) => ({ ...site, collectionId, items: [] })));
}

test("Rent2Buy publish plan mirrors every selected listing and detail target to both Wix sites", () => {
  const plan = buildControlledVehiclePublishPlan({ vehicle: vehicle(), decision: decision(), imageSets: imageSets(), rent2buyWixResults: emptyResults(), rent2buySites: sites, productMode: "rent2buy" });
  assert.equal(plan.canPublish, true);
  assert.equal(plan.targets.length, 6);
  assert.equal(plan.targets.filter((target) => target.siteId === VAN_FINANCE_RENT2BUY_WIX_SITE_ID).length, 3);
  assert.equal(plan.targets.filter((target) => target.siteId === STANDALONE_RENT2BUY_WIX_SITE_ID).length, 3);

  const vfcMaster = plan.targets.find((target) => target.siteId === VAN_FINANCE_RENT2BUY_WIX_SITE_ID && target.collectionId === "ALLRENT2BUYVANS");
  const standaloneMaster = plan.targets.find((target) => target.siteId === STANDALONE_RENT2BUY_WIX_SITE_ID && target.collectionId === "ALLRENT2BUYVANS");
  assert.equal(vfcMaster.data.title, "FV72DZA");
  assert.match(vfcMaster.data.mitsubishiL200Barbarian, /^Peugeot Partner/);
  assert.match(vfcMaster.data.webLink, /vanfinancecompany\.co\.uk\/guaranteed-rent2buy-vans\/fv72dza$/);
  assert.match(standaloneMaster.data.webLink, /rent2buyvans\.co\.uk\/van-pages\/fv72dza$/);
  assert.equal(standaloneMaster.data.weeklyPrice1, standaloneMaster.data.weekly);
  assert.equal(standaloneMaster.data.syncToCRM, "Yes");
  assert.equal(typeof standaloneMaster.data.monthlyPriceNumeric, "number");
});

test("Rent2Buy detail specs include source-backed Engine, Euro and MPG without replacing the registration identity", () => {
  const plan = buildControlledVehiclePublishPlan({ vehicle: vehicle(), decision: decision(), imageSets: imageSets(), rent2buyWixResults: emptyResults(), rent2buySites: sites, productMode: "rent2buy" });
  const detail = plan.targets.find((target) => target.siteId === VAN_FINANCE_RENT2BUY_WIX_SITE_ID && target.collectionId === "VANPAGES");
  assert.equal(detail.data.title, "FV72DZA");
  assert.match(detail.data.titleText, /^Peugeot Partner 1\.5 BlueHDi/);
  assert.match(detail.data.specText, /ENGINE SIZE: 1499 CC/i);
  assert.match(detail.data.specText, /EURO: EURO 6/i);
  assert.match(detail.data.specText, /MPG: 55\.4/i);
});

test("an existing detail row is reused only on the Wix site where it exists", () => {
  const rows = emptyResults();
  const standaloneDetail = rows.find((entry) => entry.siteId === STANDALONE_RENT2BUY_WIX_SITE_ID && entry.collectionId === "VANPAGES");
  standaloneDetail.items = [{ id: "historic-standalone-detail", data: { title: "FV72DZA", titleText: "Old title" } }];
  const plan = buildControlledVehiclePublishPlan({ vehicle: vehicle(), decision: decision(), imageSets: imageSets(), rent2buyWixResults: rows, rent2buySites: sites, productMode: "rent2buy" });
  const vfcDetail = plan.targets.find((target) => target.siteId === VAN_FINANCE_RENT2BUY_WIX_SITE_ID && target.collectionId === "VANPAGES");
  const standalone = plan.targets.find((target) => target.siteId === STANDALONE_RENT2BUY_WIX_SITE_ID && target.collectionId === "VANPAGES");
  assert.notEqual(vfcDetail.operation, "update");
  assert.equal(standalone.operation, "update");
  assert.equal(standalone.itemId, "historic-standalone-detail");
});

test("confirmation fingerprints the destination Wix site as well as collection and payload", () => {
  const plan = buildControlledVehiclePublishPlan({ vehicle: vehicle(), decision: decision(), imageSets: imageSets(), rent2buyWixResults: emptyResults(), rent2buySites: sites, productMode: "rent2buy" });
  const confirmation = buildControlledPublishConfirmation(plan);
  assert.deepEqual(new Set(confirmation.targetPayloads.map((target) => target.siteId)), new Set([VAN_FINANCE_RENT2BUY_WIX_SITE_ID, STANDALONE_RENT2BUY_WIX_SITE_ID]));
});

test("runtime controlled publisher keeps VFC stock authority separate while writing Rent2Buy to two sites", async () => {
  const state = await readFile(new URL("api/_dealerkit-controlled-publish-state.js", root), "utf8");
  const publisher = await readFile(new URL("api/dealerkit-controlled-publish.js", root), "utf8");
  assert.match(state, /WIX_RENT2BUY_API_KEY/);
  assert.match(state, /controlledRent2BuyWixConfigurations/);
  assert.match(state, /rent2buyNestedResults\.flat\(\)/);
  assert.match(publisher, /configurationForTarget/);
  assert.match(publisher, /configurationsBySiteId/);
  assert.match(publisher, /rollbackCreatedAndUpdated\(state, writes\)/);
});

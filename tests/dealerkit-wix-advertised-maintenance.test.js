import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { queryControlledRegistrationItems, assertDealerKitRegistrationUnambiguous, ControlledPublishError } from "../api/_dealerkit-controlled-publish-state.js";
import { buildCarImageSet } from "../api/_dealerkit-car-controlled-publish-state.js";
import { verifyWritten as verifyVans } from "../api/dealerkit-controlled-publish.js";
import { verifyWritten as verifyCars } from "../api/dealerkit-car-controlled-publish.js";
import { buildControlledVehiclePublishPlan } from "../lib/dealerKitControlledPublishPlan.js";
import { buildDealerKitCarWixPlan } from "../lib/dealerKitCarWixPlan.js";
import { encodeDealerKitProductImageState, decodeDealerKitProductImageState } from "../lib/dealerKitProductImageState.js";

const registration = "AB23CDE";
const sourceUpdatedAt = "2026-09-30T09:00:00.000Z";
const vehicle = { supplierStockId: "stock-1", registration, title: "Ford Transit", make: "Ford", model: "Transit", retailPrice: 13995, mileage: 30000, vatStatus: "plus_vat", status: "available", sourceUpdatedAt, images: [{ id: "one" }, { id: "two" }, { id: "three" }], specifications: {} };
const decision = { persisted: true, registration, supplierStockId: "stock-1", reviewStatus: "reviewed", reviewedSourceUpdatedAt: sourceUpdatedAt, financeEnabled: true, rent2buyEnabled: false, financeCategories: ["all_vans"], imageOrderIds: ["one", "two", "three"], primaryImageId: "three" };
const images = { ready: true, mainUrl: "wix-primary", listingImageUrl: "wix-primary", galleryUrls: ["wix-primary", "wix-secondary"] };
const row = (id, title = "AB23 CDE") => ({ id, data: { title, _publishStatus: "PUBLISHED" } });

function wixRequest(rows, calls = []) {
  return async (_configuration, _path, { body }) => {
    calls.push(body);
    const { limit, offset } = body.query.paging;
    return { dataItems: rows.filter((item) => item.data.title === body.query.filter.title.$eq).slice(offset, offset + limit) };
  };
}

test("every Finance, Rent2Buy and Cars collection finds a spaced row and keeps its Wix ID", async () => {
  for (const collectionId of ["VANFINANCE-ALLVANS", "VANFINANCEPAGES", "ALLRENT2BUYVANS", "VANPAGES", "CARFINANCE", "CARPAGES"]) {
    const calls = [];
    const items = await queryControlledRegistrationItems({}, collectionId, registration, { request: wixRequest([row("existing")], calls) });
    assert.deepEqual(items.map((item) => item.id), ["existing"]);
    assert.ok(calls.some((body) => body.query.filter.title.$eq === registration));
    assert.ok(calls.some((body) => body.query.filter.title.$eq === "AB23 CDE"));
    assert.ok(calls.every((body) => body.consistentRead && body.dataCollectionId === collectionId));
  }
  const items = await queryControlledRegistrationItems({}, "VANFINANCE-ALLVANS", registration, { request: wixRequest([row("listing")]) });
  const plan = buildControlledVehiclePublishPlan({ vehicle, decision, imageSets: { dealerKitImageIds: ["one"], vanFinance: images }, vfcWixResults: [{ collectionId: "VANFINANCE-ALLVANS", items }, { collectionId: "VANFINANCEPAGES", items: [row("detail")] }], productMode: "finance" });
  assert.equal(plan.canPublish, true);
  assert.equal(plan.targets.find((target) => target.collectionId === "VANFINANCE-ALLVANS").operation, "update");
  assert.equal(plan.targets.find((target) => target.collectionId === "VANFINANCE-ALLVANS").itemId, "listing");
  assert.ok(plan.targets.every((target) => target.product === "van_finance"));

  const rentRows = await Promise.all(["ALLRENT2BUYVANS", "VANPAGES"].map(async (collectionId) => ({
    collectionId,
    items: await queryControlledRegistrationItems({}, collectionId, registration, { request: wixRequest([row(`existing-${collectionId}`)]) }),
  })));
  const rentPlan = buildControlledVehiclePublishPlan({
    vehicle, decision: { ...decision, financeEnabled: false, rent2buyEnabled: true, rent2buyCategories: ["all_vans"] },
    imageSets: { dealerKitImageIds: ["one"], rent2buy: images }, rent2buyWixResults: rentRows, productMode: "rent2buy",
  });
  assert.equal(rentPlan.canPublish, true);
  assert.ok(rentPlan.targets.every((target) => target.product === "rent2buy" && target.operation === "update"));
  assert.deepEqual(rentPlan.targets.map((target) => [target.collectionId, target.itemId]), [
    ["ALLRENT2BUYVANS", "existing-ALLRENT2BUYVANS"], ["VANPAGES", "existing-VANPAGES"],
  ]);

  const carListingRows = await queryControlledRegistrationItems({}, "CARFINANCE", registration, { request: wixRequest([row("car-listing")]) });
  const carDetailRows = await queryControlledRegistrationItems({}, "CARPAGES", registration, { request: wixRequest([row("car-detail")]) });
  const carPlan = buildDealerKitCarWixPlan({ vehicle, decision, imageSet: images, carListingRows, carDetailRows });
  assert.equal(carPlan.canPublish, true);
  assert.ok(carPlan.targets.every((target) => target.product === "cars" && target.operation === "update"));
  assert.deepEqual(carPlan.targets.map((target) => [target.collectionId, target.itemId]), [
    ["CARFINANCE", "car-listing"], ["CARPAGES", "car-detail"],
  ]);
});

test("all variants and pages are collected, with repeated IDs deduplicated and ID-less rows retained", async () => {
  const rows = Array.from({ length: 101 }, (_, index) => row(`id-${index}`));
  rows.push(row("canonical", registration));
  const calls = [];
  const items = await queryControlledRegistrationItems({}, "CARFINANCE", registration, { request: wixRequest(rows, calls) });
  assert.equal(items.length, 102);
  assert.ok(calls.some((body) => body.query.paging.offset === 100));
  const repeated = await queryControlledRegistrationItems({}, "CARFINANCE", registration, { request: async () => ({ dataItems: [row("same"), row("same"), { data: { title: registration } }] }) });
  assert.equal(repeated.filter((item) => item.id === "same").length, 1);
  assert.ok(repeated.some((item) => !item.id));
});

test("canonical and spaced rows with distinct IDs block every controlled product plan", async () => {
  const items = await queryControlledRegistrationItems({}, "VANFINANCE-ALLVANS", registration, { request: wixRequest([row("canonical", registration), row("spaced")]) });
  assert.equal(items.length, 2);
  const finance = buildControlledVehiclePublishPlan({ vehicle, decision, imageSets: { dealerKitImageIds: ["one"], vanFinance: images }, vfcWixResults: [{ collectionId: "VANFINANCE-ALLVANS", items }], productMode: "finance" });
  assert.equal(finance.canPublish, false);
  assert.ok(finance.blockers.some((item) => item.code === "vfc_duplicate_existing"));
  const rent2buy = buildControlledVehiclePublishPlan({ vehicle, decision: { ...decision, financeEnabled: false, rent2buyEnabled: true, rent2buyCategories: ["all_vans"] }, imageSets: { dealerKitImageIds: ["one"], rent2buy: images }, rent2buyWixResults: [{ collectionId: "ALLRENT2BUYVANS", items }], productMode: "rent2buy" });
  assert.equal(rent2buy.canPublish, false);
  assert.ok(rent2buy.blockers.some((item) => item.code === "rent2buy_existing_ambiguous"));
  const cars = buildDealerKitCarWixPlan({ vehicle, decision, imageSet: images, carListingRows: items });
  assert.equal(cars.canPublish, false);
  assert.ok(cars.blockers.some((item) => item.code === "car_listing_ambiguous"));
});

test("post-write verification checks all title variants for listing and detail rows in every lane", async () => {
  for (const collectionId of ["VANFINANCE-ALLVANS", "VANFINANCEPAGES", "ALLRENT2BUYVANS", "VANPAGES", "CARFINANCE", "CARPAGES"]) {
    const target = { collectionId, kind: collectionId.endsWith("PAGES") ? "detail" : "listing", operation: "update", itemId: "existing", desiredPublishStatus: "PUBLISHED" };
    const verify = collectionId.startsWith("CAR")
      ? (request) => verifyCars({}, registration, [target], [], { request })
      : (request) => verifyVans({ configuration: {}, configurationsBySiteId: {} }, registration, [target], [], { request });
    assert.equal((await verify(wixRequest([row("existing")]))).verified, true);
    const ambiguous = await verify(wixRequest([row("existing", registration), row("other")]));
    assert.equal(ambiguous.verified, false);
    assert.equal(ambiguous.results[0].count, 2);
  }
});

async function watchHelpers() {
  const page = await readFile(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url), "utf8");
  const code = page.slice(page.indexOf("function normalizeWatchRegistration("), page.indexOf("function classifyWatchRecord("));
  const helpers = new Function(`${code}; return { buildDealerKitByRegistration, mapAdvertisedLocalVehicleToWatchRecord, dedupeDisplayRecords };`)();
  const watchCard = page.slice(page.indexOf("function WatchCard("));
  const expression = watchCard.match(/const canReviewDealerKit = ([\s\S]*?);/)[1];
  helpers.canReview = new Function("record", "selectedPipeline", "isLocalNotVansco", "isAdvertisedStockMaintenance", `return ${expression};`);
  return helpers;
}

test("advertised-stock identity uses distinct raw DealerKit IDs before display deduplication", async () => {
  const helpers = await watchHelpers();
  const raw = [{ registration, supplierStockId: "one" }, { registration: "AB23 CDE", supplierStockId: "two" }];
  assert.equal(helpers.dedupeDisplayRecords(raw).length, 1);
  const identity = helpers.buildDealerKitByRegistration(raw).get(registration);
  assert.equal(identity.ambiguous, true);
  for (const pipeline of ["finance", "rent2buy", "cars"]) {
    const card = helpers.mapAdvertisedLocalVehicleToWatchRecord({ registration }, 0, pipeline, identity.record, identity.ambiguous);
    assert.equal(card.pipeline, pipeline);
    assert.equal(card.matchStatus, "advertised_stock_ambiguous_dealerkit");
    assert.equal(helpers.canReview(card, pipeline, false, true), false);
  }
  const repeated = helpers.buildDealerKitByRegistration([raw[0], { ...raw[0] }]).get(registration);
  assert.equal(repeated.ambiguous, false);
  const card = helpers.mapAdvertisedLocalVehicleToWatchRecord({ registration }, 0, "cars", repeated.record, repeated.ambiguous);
  assert.equal(helpers.canReview(card, "cars", false, true), true);
  assert.equal(helpers.canReview({ registration, supplierStockId: "one", displayStatus: "missing" }, "finance", false, false), true);
});

async function loadHandler(path, dependencies) {
  let source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  source = source.replace(/^import[\s\S]*?;\r?\n/gm, "").replace("export default async function handler", "async function handler");
  return new Function(...Object.keys(dependencies), `${source}; return handler;`)(...Object.values(dependencies));
}

function response() {
  return { statusCode: 0, payload: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
}

test("detail API rejects ambiguous registration even with a supplied stock ID, and allows repeated same-ID rows", async () => {
  for (const query of [{ registration }, { registration, stockId: "stock-1" }, { stockId: "stock-1" }]) {
    const handler = await loadHandler("api/dealerkit-stock-detail.js", {
      process: { env: { MARKETING_CUSTOMER_DATABASE_API_KEY: "test-key" } },
      normalizeRegistration: (value) => String(value || "").replace(/[^a-z0-9]/gi, "").toUpperCase(),
      fetchDealerKitStockSnapshot: async () => ({ vehicles: [vehicle, { ...vehicle, supplierStockId: "stock-2", registration: "AB23 CDE" }] }),
      fetchDealerKitStockDetail: async () => vehicle,
      getSupabaseServiceAdmin: () => { throw new Error("Ambiguous review must not read saved decisions"); },
      loadDealerKitReviewDecision: async () => null,
      defaultDealerKitReviewDecision: () => ({}),
    });
    const res = response();
    await handler({ method: "GET", headers: { "x-marketing-customer-database-key": "test-key" }, query }, res);
    assert.equal(res.statusCode, 409);
    assert.match(res.payload.message, /More than one DealerKit/);
  }
  const supabase = { from() { return { select() { return this; }, eq() { return this; }, limit() { return Promise.resolve({ data: [], error: null }); } }; } };
  const handler = await loadHandler("api/dealerkit-stock-detail.js", {
    process: { env: { MARKETING_CUSTOMER_DATABASE_API_KEY: "test-key" } },
    normalizeRegistration: (value) => String(value || "").replace(/[^a-z0-9]/gi, "").toUpperCase(),
    fetchDealerKitStockSnapshot: async () => ({ vehicles: [vehicle, { ...vehicle }] }),
    fetchDealerKitStockDetail: async () => vehicle,
    getSupabaseServiceAdmin: () => supabase,
    loadDealerKitReviewDecision: async () => null,
    defaultDealerKitReviewDecision: () => ({}),
  });
  const res = response();
  await handler({ method: "GET", headers: { "x-marketing-customer-database-key": "test-key" }, query: { registration, stockId: "stock-1", product: "cars" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.product, "cars");
});

test("Cars moves the READY chosen primary to gallery index zero while preserving secondary order", () => {
  const imported = ["one", "two", "three"].map((id) => ({ dealerKitImageId: id, ready: true, wixUrl: `wix-${id}` }));
  const { imageSet } = buildCarImageSet(vehicle, decision, imported);
  assert.deepEqual(imageSet.galleryUrls, ["wix-three", "wix-one", "wix-two"]);
  assert.equal(imageSet.mainUrl, imageSet.galleryUrls[0]);
  const plan = buildDealerKitCarWixPlan({ vehicle, decision, imageSet });
  assert.equal(plan.canPublish, true);
  assert.deepEqual(plan.targets.find((target) => target.collectionId === "CARPAGES").data.mainImages, imageSet.galleryUrls);
  assert.equal(plan.targets.find((target) => target.collectionId === "CARFINANCE").data.picture, imageSet.galleryUrls[0]);
  const processing = buildCarImageSet(vehicle, decision, imported.map((item) => item.dealerKitImageId === "three" ? { ...item, ready: false } : item));
  assert.equal(processing.imageSet.ready, false);
});

test("saving review only persists decisions and cannot publish stock", async () => {
  const calls = [];
  const handler = await loadHandler("api/dealerkit-review-decision.js", {
    process: { env: { MARKETING_CUSTOMER_DATABASE_API_KEY: "test-key" } },
    getSupabaseServiceAdmin: () => ({}),
    normalizeRegistration: (value) => value,
    normalizeDealerKitReviewInput: (input) => input,
    saveDealerKitReviewDecision: async (_supabase, input) => { calls.push("save-review"); return input; },
    saveDerivedDealerKitRent2BuySettings: async () => { calls.push("derive-settings"); return null; },
    fetchDealerKitStockDetail: async () => { throw new Error("Finance review save must not mutate or publish supplier stock"); },
    loadDealerKitReviewDecision: async () => null,
    loadDealerKitRent2BuySettings: async () => null,
    deriveRent2BuyTermFromMileage: () => ({}),
    fetch: async () => { throw new Error("Review save must not contact Wix"); },
  });
  const res = response();
  await handler({ method: "PUT", headers: { "x-marketing-customer-database-key": "test-key" }, body: decision }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.saved, true);
  assert.equal(res.payload.published, undefined);
  assert.deepEqual(calls, ["save-review", "derive-settings"]);
});

test("Finance and Rent2Buy image selections remain separate during review saving", () => {
  const saved = encodeDealerKitProductImageState({ finance: { orderIds: ["one", "two", "three"], primaryId: "three", excludedIds: ["two"] }, rent2buy: { orderIds: ["two", "one", "three"], excludedIds: ["three"] } });
  const decoded = decodeDealerKitProductImageState(saved, ["one", "two", "three"]);
  assert.deepEqual(decoded.finance.includedOrderIds, ["one", "three"]);
  assert.equal(decoded.finance.primaryId, "three");
  assert.deepEqual(decoded.rent2buy.includedOrderIds, ["two", "one"]);
  assert.equal(decoded.rent2buy.primaryId, "two");
});

async function loadFreshStateBuilder(path, name, dependencies) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `Missing ${name}`);
  const code = source.slice(start).replace(/^export /gm, "");
  return new Function(...Object.keys(dependencies), `${code}; return ${name};`)(...Object.values(dependencies));
}

for (const productMode of ["finance", "rent2buy", "cars"]) {
  test(`final ${productMode} reconciliation rechecks DealerKit identity after a successful saved review`, async () => {
    const events = [];
    let snapshotVehicles = [vehicle, { ...vehicle }];
    const configuration = { siteId: "85f11c52-ee54-495d-aaec-a351831709b5" };
    const imported = ["one", "two", "three"].map((id) => ({ dealerKitImageId: id, ready: true, wixUrl: `wix-${id}` }));
    const dependencies = {
      normalizeFinanceRegistration: (value) => String(value || "").replace(/[^a-z0-9]/gi, "").toUpperCase(),
      ControlledPublishError,
      getSupabaseServiceAdmin: () => ({}),
      loadDecision: async () => { events.push("saved-review"); return decision; },
      fetchDealerKitStockDetail: async () => { events.push("detail"); return vehicle; },
      assertDealerKitRegistrationUnambiguous: (reg) => assertDealerKitRegistrationUnambiguous(reg, {
        fetchSnapshot: async (options) => {
          events.push("snapshot");
          assert.deepEqual(options, { allowPartial: true });
          return { vehicles: snapshotVehicles };
        },
      }),
      controlledWixConfiguration: () => configuration,
      controlledRent2BuyWixConfigurations: () => [configuration],
      controlledCarWixConfiguration: () => configuration,
      VAN_FINANCE_WIX_COLLECTIONS: [{ id: "VANFINANCE-ALLVANS" }, { id: "VANFINANCEPAGES" }],
      allRent2BuyCollectionIds: () => ["ALLRENT2BUYVANS", "VANPAGES"],
      loadManualReadiness: async () => ({}),
      loadImportedReadiness: async () => imported,
      queryRegistration: async (site, collectionId) => {
        events.push("wix-read");
        const items = [row(collectionId)];
        return productMode === "cars" ? items : { siteId: site.siteId, collectionId, items };
      },
      buildProductImageSets: () => ({ dealerKitImageIds: ["one", "two", "three"], vanFinance: images, rent2buy: images }),
      buildCarImageSet,
      buildControlledVehiclePublishPlan: (input) => { events.push("build-plan"); return buildControlledVehiclePublishPlan(input); },
      buildDealerKitCarWixPlan: (input) => { events.push("build-plan"); return buildDealerKitCarWixPlan(input); },
      buildControlledPublishConfirmation: () => ({}),
      buildCarPublishConfirmation: () => ({}),
    };
    const isCars = productMode === "cars";
    const builder = await loadFreshStateBuilder(
      isCars ? "api/_dealerkit-car-controlled-publish-state.js" : "api/_dealerkit-controlled-publish-state.js",
      isCars ? "buildFreshCarControlledPublishState" : "buildFreshControlledPublishState",
      dependencies,
    );
    const earlierState = await builder(registration, {}, { productMode });
    assert.equal(earlierState.decision.persisted, true);
    assert.equal(earlierState.plan.canPublish, true);
    assert.deepEqual(events.slice(0, 3), ["saved-review", "detail", "snapshot"]);
    assert.ok(events.indexOf("snapshot") < events.indexOf("wix-read"));

    // The saved review and detail version remain valid, but current stock now has two identities.
    snapshotVehicles = [vehicle, { ...vehicle, registration: "AB23 CDE", supplierStockId: "stock-2" }];
    events.length = 0;
    await assert.rejects(
      () => builder(registration, {}, { productMode }),
      (error) => error instanceof ControlledPublishError && error.status === 409
        && /More than one DealerKit vehicle/.test(error.message)
        && error.details.supplierStockIds.join(",") === "stock-1,stock-2",
    );
    assert.deepEqual(events, ["saved-review", "detail", "snapshot"]);
  });
}

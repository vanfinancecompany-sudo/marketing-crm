import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadLiveWixListingPresence, publishedListingVehicle } from "../api/stock-watch-wix-listing-presence.js";
import { advertisedWixVehicles, fetchAdvertisedWixVehicles } from "../services/stockWatchWixListingPresence.js";
import { mergePublishedListingVehicles } from "../lib/dealerKitCarsPublishedListing.js";

const collections = { finance: "VANFINANCE-ALLVANS", rent2buy: "ALLRENT2BUYVANS", cars: "CARFINANCE" };
const registration = "AB23CDE";
function item(id, reg = "AB23 CDE", overrides = {}) {
  return { id, data: { title: reg, vanDescription: "Current Wix vehicle description", picture: "https://images.example/wix.jpg",
    webLink: "https://stock.example/current-advert", price: "£13,995", mth: "£499 PM", status: "Available", _publishStatus: "PUBLISHED", ...overrides } };
}
async function presence(pipeline, rows, requests = []) {
  return loadLiveWixListingPresence(pipeline, { fetchImplementation: async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const { offset, limit } = body.query.paging;
    return { ok: true, json: async () => ({ dataItems: rows.slice(offset, offset + limit) }) };
  } });
}
function functionSource(source, name) {
  const start = source.indexOf("function " + name + "(");
  assert.ok(start >= 0, "Missing " + name);
  const open = source.indexOf(") {", start) + 2;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) {
      return (source.slice(Math.max(0, start - 6), start).trim() === "async" ? "async " : "") + source.slice(start, index + 1);
    }
  }
  throw new Error("Unclosed " + name);
}
async function pageController(pipeline, support, listingPresence, dealerKitRecords = []) {
  const source = await readFile(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url), "utf8");
  const helpersCode = source.slice(source.indexOf("function normalizeWatchRegistration("), source.indexOf("function classifyWatchRecord("));
  const helpers = new Function(helpersCode + "; return { normalizeLocalStockRegistration, buildDealerKitByRegistration, mapAdvertisedLocalVehicleToWatchRecord };")();
  const model = { advertised: {}, errors: {}, local: {}, localErrors: {}, registrations: {}, debug: {} };
  const set = (key) => (update) => { model[key] = typeof update === "function" ? update(model[key]) : update; };
  const dependencies = {
    selectedPipeline: pipeline,
    fetchAdvertisedWixVehicles: (lane, comparison) => fetchAdvertisedWixVehicles(lane, comparison, { loadPresence: async () => listingPresence }),
    fetchLocalVehiclesForPipeline: async () => { if (support instanceof Error) throw support; return support; },
    fetchStockWatchWixListingPresence: async () => listingPresence,
    mergePublishedListingVehicles,
    normalizeLocalStockRegistration: helpers.normalizeLocalStockRegistration,
    pipelineLabel: (value) => value,
    setAdvertisedWixVehiclesByPipeline: set("advertised"),
    setAdvertisedStockErrorByPipeline: set("errors"),
    setLocalVehiclesByPipeline: set("local"),
    setLocalLoadErrorByPipeline: set("localErrors"),
    setLocalRegistrationsByPipeline: set("registrations"),
    setDebugByPipeline: set("debug"),
    performance: { now: () => 0 },
  };
  const code = ["clearAdvertisedStock", "loadAdvertisedStock", "loadLocalStock"].map((name) => functionSource(source, name)).join("\n");
  const controller = new Function(...Object.keys(dependencies), code + ";return { loadAdvertisedStock, loadLocalStock };")(...Object.values(dependencies));
  const memo = source.match(/const advertisedStockRecords = useMemo\(([\s\S]*?), \[activeAdvertisedWixVehicles, dealerKitByRegistration, selectedPipeline\]\);/);
  assert.ok(memo, "Advertised cards must use the independent Wix records");
  controller.cards = () => new Function("activeAdvertisedWixVehicles", "dealerKitByRegistration", "selectedPipeline", "mapAdvertisedLocalVehicleToWatchRecord",
    "return (" + memo[1] + ")();")(model.advertised[pipeline] || [], helpers.buildDealerKitByRegistration(dealerKitRecords), pipeline, helpers.mapAdvertisedLocalVehicleToWatchRecord);
  controller.display = (paused) => {
    const start = source.indexOf("  const displayRecords = useMemo(");
    const block = source.slice(start, source.indexOf("\n  const summary =", start));
    const dependencies = { useMemo: (callback) => callback(), positiveComparisonPaused: paused, localLoadError: paused ? "Support unavailable" : "",
      imageReadyRecords: [{ id: "photos" }], visiblePhotoReadyRecords: [], activeRecords: [{ id: "missing" }], visibleLocalNotVanscoRecords: [{ id: "reverse" }],
      localNotVanscoRecords: [{ id: "reverse" }], priceDifferenceRecords: [{ id: "price" }], advertisedStockRecords: controller.cards() };
    return new Function(...Object.keys(dependencies), block + ";return displayRecords;")(...Object.values(dependencies));
  };
  return { controller, model, source };
}

for (const pipeline of Object.keys(collections)) {
  test(pipeline + " advertised membership and displayed card fields come from published Wix rows, never support rows", async () => {
    const calls = [];
    const wix = await presence(pipeline, [item("existing"), item("wix-only", "CD24EFG"), item("draft", "EF25GHI", { _publishStatus: "DRAFT" })], calls);
    assert.equal(wix.publishedListingsComplete, true);
    assert.ok(calls.every((body) => body.dataCollectionId === collections[pipeline] && body.consistentRead));
    const support = [
      { registration, image: "https://images.example/crm.jpg", picture: "https://images.example/crm.jpg", title: "CRM title", weblink: "https://stock.example/crm" },
      { registration: "GH26JKL", image: "https://images.example/support-only.jpg" },
    ];
    const dealerKit = [{ registration, supplierStockId: "stock-1", title: "DealerKit title", imageUrl: "https://images.example/dealerkit.jpg" }];
    const { controller, model, source } = await pageController(pipeline, support, wix, dealerKit);
    await controller.loadLocalStock(pipeline, () => true, { presence: wix });
    const cards = controller.cards();
    assert.deepEqual(cards.map((card) => card.registration), [registration, "CD24EFG"]);
    const card = cards[0];
    assert.equal(card.imageUrl, "https://images.example/wix.jpg", "The Wix picture must win over the different CRM and DealerKit pictures");
    assert.equal(card.picture, "https://images.example/wix.jpg");
    assert.equal(card.title, "Current Wix vehicle description");
    assert.equal(card.localStockUrl, "https://stock.example/current-advert");
    assert.equal(card.wixItemId, "existing");
    assert.equal(card.wixCollectionId, collections[pipeline]);
    assert.equal(card.wixPublishStatus, "PUBLISHED");
    assert.equal(card.supplierStockId, "stock-1");
    assert.equal(cards[1].supplierStockId, undefined, "An advert without a DealerKit match still appears");
    // Exercise the actual image binding used by WatchCard.
    const watchCard = source.slice(source.indexOf("function WatchCard("));
    const imageBinding = watchCard.match(/<img src=\{([^}]+)\}/);
    assert.ok(imageBinding);
    assert.equal(new Function("record", "return " + imageBinding[1])(card), "https://images.example/wix.jpg");
    assert.equal(model.local[pipeline][0].image, "https://images.example/crm.jpg", "Other Stock Watch support-card composition stays unchanged");
    assert.deepEqual(controller.display(false).slice(-2), cards);
  });
}

test("a support/CRM read failure cannot suppress a verified Wix maintenance card", async () => {
  const wix = await presence("finance", [item("wix-only")]);
  const { controller, model } = await pageController("finance", new Error("CRM unavailable"), wix);
  await assert.rejects(() => controller.loadLocalStock("finance", () => true, { presence: wix }), /CRM unavailable/);
  assert.equal(controller.cards().length, 1);
  assert.equal(controller.cards()[0].imageUrl, "https://images.example/wix.jpg");
  assert.ok(model.localErrors.finance);
  assert.deepEqual(controller.display(true), controller.cards(), "Other action tabs remain paused; Wix maintenance uses its own authority");
});

test("published record metadata is additive; existing comparison vehicles retain their previous contract", async () => {
  const row = item("wix-id");
  const wix = await presence("rent2buy", [row]);
  assert.deepEqual(wix.vehicles, [publishedListingVehicle(row, "rent2buy", { collectionId: "ALLRENT2BUYVANS" })]);
  const live = wix.publishedListings[0];
  assert.equal(live.registration, registration);
  assert.equal(live.wixItemId, "wix-id");
  assert.equal(live.cmsTitle, "AB23 CDE");
  assert.equal(live.monthly, 499);
  assert.equal(live.priceText, "£13,995");
  assert.equal(live.status, "Available");
  assert.equal(live.site_id, "85f11c52-ee54-495d-aaec-a351831709b5");
});

test("Wix picture conversion uses only the stored Wix picture and an empty picture has no image fallback", async () => {
  const wix = await presence("cars", [item("native", "AB23 CDE", { picture: "wix:image://v1/media-id/photo.jpg#originWidth=100" }), item("empty", "CD24EFG", { picture: "" })]);
  const support = [{ registration: "CD24EFG", image: "https://images.example/crm.jpg" }];
  const { controller } = await pageController("cars", support, wix, [{ registration: "CD24EFG", supplierStockId: "stock-2", imageUrl: "https://images.example/dealerkit.jpg" }]);
  await controller.loadLocalStock("cars", () => true, { presence: wix });
  assert.equal(controller.cards()[0].imageUrl, "https://static.wixstatic.com/media/media-id");
  assert.equal(controller.cards()[1].imageUrl, "");
});

test("distinct published Wix items sharing a registration remain separate cards with their own pictures and keys", async () => {
  const wix = await presence("cars", [item("first"), item("second", "AB23CDE", { picture: "https://images.example/second.jpg" })]);
  assert.equal(wix.vehicles.length, 1, "Existing registration-based comparison contract is unchanged");
  assert.equal(wix.publishedListings.length, 2);
  const { controller, source } = await pageController("cars", [], wix);
  await controller.loadLocalStock("cars", () => true, { presence: wix });
  const cards = controller.cards();
  assert.equal(cards.length, 2);
  assert.notEqual(cards[0].id, cards[1].id);
  assert.deepEqual(cards.map((card) => card.imageUrl), ["https://images.example/wix.jpg", "https://images.example/second.jpg"]);
  const keyExpression = source.match(/key=\{(record\.isAdvertisedStockMaintenance[^}]+)\}/);
  assert.ok(keyExpression, "Generated React keys must identify the actual Wix listing item");
  const key = new Function("record", "normalizeWatchRegistration", "return " + keyExpression[1]);
  assert.notEqual(key(cards[0], () => registration), key(cards[1], () => registration));
});

test("incomplete or failed Wix authority clears previously displayed adverts and cannot fall back to CRM", async () => {
  const wix = await presence("finance", [item("existing")]);
  const support = [{ registration, image: "https://images.example/crm.jpg" }];
  const { controller, model } = await pageController("finance", support, wix);
  await controller.loadLocalStock("finance", () => true, { presence: wix });
  assert.equal(controller.cards().length, 1);
  for (const incomplete of [{ ...wix, complete: false }, { ...wix, publishedListingsComplete: false }, { ...wix, ok: false }, { ...wix, publishedListings: undefined }]) {
    await controller.loadAdvertisedStock("finance", () => true, { presence: incomplete });
    assert.deepEqual(controller.cards(), []);
    assert.ok(model.errors.finance);
    await controller.loadAdvertisedStock("finance", () => true, { presence: wix });
  }
  const failed = await loadLiveWixListingPresence("finance", { fetchImplementation: async () => { throw new Error("Wix unavailable"); } });
  await controller.loadAdvertisedStock("finance", () => true, { presence: failed });
  assert.deepEqual(controller.cards(), []);
  assert.equal(failed.publishedListingsComplete, false);
  await assert.rejects(() => fetchAdvertisedWixVehicles("finance", null, { loadPresence: async () => { throw new Error("Wix unavailable"); } }), /Wix unavailable/);
});

test("maintenance fails closed for a wrong lane, collection, draft status or missing Wix identity", async () => {
  const wix = await presence("finance", [item("existing")]);
  for (const pipeline of ["rent2buy", "cars"]) assert.throws(() => advertisedWixVehicles(wix, pipeline), /unavailable or incomplete/);
  for (const overrides of [{ collection_id: "CARFINANCE" }, { publishStatus: "DRAFT" }, { wixItemId: "" }, { registration: "" }]) {
    assert.throws(() => advertisedWixVehicles({ ...wix, publishedListings: [{ ...wix.publishedListings[0], ...overrides }] }, "finance"), /identity is not verified/);
  }
});

test("unknown publication status, missing Wix IDs and malformed page data fail maintenance closed without changing other presence logic", async () => {
  for (const row of [item("unknown", "AB23 CDE", { _publishStatus: "" }), item("")]) {
    const wix = await presence("finance", [row]);
    assert.equal(wix.complete, true);
    assert.equal(wix.vehicles.length, 1);
    assert.equal(wix.publishedListingsComplete, false);
    assert.throws(() => advertisedWixVehicles(wix, "finance"), /unavailable or incomplete/);
  }
  const unidentifiable = await presence("finance", [item("missing-registration", "", { vanDescription: "A published vehicle with no registration" })]);
  assert.deepEqual(unidentifiable.vehicles, [], "The other comparison views keep their existing missing-registration handling");
  assert.equal(unidentifiable.publishedListingsComplete, false);
  assert.throws(() => advertisedWixVehicles(unidentifiable, "finance"), /unavailable or incomplete/);
  const malformed = await loadLiveWixListingPresence("finance", { fetchImplementation: async () => ({ ok: true, json: async () => ({}) }) });
  assert.equal(malformed.publishedListingsComplete, false);
});

test("a capped Wix scan cannot claim complete advertised-stock authority", async () => {
  let calls = 0;
  const wix = await loadLiveWixListingPresence("finance", { fetchImplementation: async (_url, options) => {
    calls += 1;
    const { offset } = JSON.parse(options.body).query.paging;
    return { ok: true, json: async () => ({ dataItems: Array.from({ length: 100 }, (_, index) => item("id-" + (offset + index))) }) };
  } });
  assert.equal(calls, 20);
  assert.equal(wix.complete, true, "The other comparison views retain their existing completeness contract");
  assert.equal(wix.publishedListingsComplete, false);
  assert.throws(() => advertisedWixVehicles(wix, "finance"), /unavailable or incomplete/);
});

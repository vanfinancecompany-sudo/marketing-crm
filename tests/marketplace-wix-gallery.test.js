import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { createWixAdvertImageHandler } from "../api/wix-advert-images.js";
import { WIX_ADVERT_IMAGE_LANES } from "../lib/wixAdvertImageEditor.js";
import { buildVanFinanceMarketplaceJob, buildRent2BuyMarketplaceJob, sendMarketplaceJobToExtension } from "../services/marketplaceAutomation.js";
import { prepareFacebookGroupPost, GROUP_POST_JOB, GROUP_POST_JOB_ACK } from "../services/facebookGroupsAgent.js";

const registration = "EA21TSZ";
const environment = { MARKETING_CUSTOMER_DATABASE_API_KEY: "test-access", WIX_API_KEY: "test-wix" };
const publicUrl = (name) => `https://static.wixstatic.com/media/${name}.jpg`;
const gallery = ["wix:image://v1/first.jpg/First.jpg#originWidth=960&originHeight=720", { type: "image", src: publicUrl("second") }, publicUrl("first"), { url: publicUrl("third") }];
const builders = { finance: buildVanFinanceMarketplaceJob, rent2buy: buildRent2BuyMarketplaceJob };

function fixture(t, pipeline, options = {}) {
  const lane = WIX_ADVERT_IMAGE_LANES[pipeline];
  const calls = [], wixCalls = [];
  const rows = {
    [lane.listing]: [{ id: "listing", data: { title: "EA21 TSZ", _publishStatus: "PUBLISHED", picture: publicUrl("listing-primary") } }],
    [lane.detail]: [{ id: "detail", data: { title: registration, _publishStatus: "PUBLISHED", [lane.gallery]: options.gallery ?? gallery } }],
  };
  const originalRows = JSON.stringify(rows);
  const handler = createWixAdvertImageHandler({ environment, logger() {}, request: async (config, path, request) => {
    wixCalls.push({ path, ...request });
    assert.equal(config.siteId, "85f11c52-ee54-495d-aaec-a351831709b5");
    assert.equal(path, "/wix-data/v2/items/query", "Read only: no uploads, edits, syncs or publishing");
    assert.ok(!request.method || request.method === "POST");
    if (options.apiFailure) throw new Error("Simulated Wix API outage");
    const collection = request.body.dataCollectionId;
    assert.ok(Object.hasOwn(rows, collection), "Never scan category or other-lane collections");
    const found = options.wrongWixRow ? [{ id: "foreign", data: { title: "EA21TSX", _publishStatus: "PUBLISHED" } }]
      : options.notFound ? [] : rows[collection].filter(row => row.data.title === request.body.query.filter.title.$eq);
    return { dataItems: structuredClone(found) };
  } });
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window;
  globalThis.window = { location: { pathname: "/van-finance-marketplace", origin: "https://crm.example" },
    localStorage: { getItem(key) { return key === "marketingCustomerDatabaseApiKey" ? environment.MARKETING_CUSTOMER_DATABASE_API_KEY : null; }, setItem() {} } };
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, ...init });
    const target = new URL(url, "https://crm.example");
    if (target.pathname === "/api/dealerkit-stock-detail") return Response.json({ ok: true, vehicle: {
      make: "Ford", model: "Transit", year: "2021", mileage: "38,000", retailPrice: "14995", supplierStockId: "dk-1", images: [publicUrl("dealerkit-not-authoritative")],
    } });
    if (target.pathname === "/api/wix-advert-images") {
      if (options.responseOverride) return Response.json(options.responseOverride);
      const response = { setHeader() {}, status(status) { this.statusCode = status; return this; }, json(body) { this.body = body; } };
      await handler({ method: init.method || "GET", headers: init.headers, query: Object.fromEntries(target.searchParams) }, response);
      return Response.json(response.body, { status: response.statusCode });
    }
    if (target.pathname.startsWith("/_functions/marketing")) return Response.json({ message: "Retired bridge" }, { status: 404 });
    throw new Error("Unexpected request: " + target.pathname);
  };
  t.after(() => { globalThis.fetch = oldFetch; if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    assert.equal(JSON.stringify(rows), originalRows, "No Wix vehicle data may change"); });
  const vehicle = { registration: " ea21 tsz ", id: "crm-1", price: "14995", monthly: "536", image: publicUrl("stock-not-authoritative"), name: "Ford Transit" };
  return { calls, wixCalls, rows, vehicle, build: () => builders[pipeline](vehicle, "Operator caption") };
}

for (const pipeline of Object.keys(builders)) {
  test(`${pipeline} regression: retired public bridge must not prevent the current ordered Wix gallery`, async t => {
    const f = fixture(t, pipeline);
    const job = await f.build();
    assert.deepEqual(job.images, [publicUrl("first"), publicUrl("second"), publicUrl("third")]);
    assert.equal(job.leadImage, job.images[0]);
    assert.equal(job.imageCount, 3);
    assert.equal(job.registration, registration);
    assert.equal(job.pipeline, pipeline);
    assert.equal(job.source.cmsMatchRegistration, registration);
    assert.equal(job.source.cms, "wix-advert-images");
    assert.equal(f.calls.length, 2, "One DealerKit detail and one CRM gallery request, no legacy bridge");
    const read = f.calls.find(call => call.url.startsWith("/api/wix-advert-images"));
    assert.equal(read.method, "GET");
    assert.equal(read.cache, "no-store");
    assert.equal(read.headers["x-marketing-customer-database-key"], environment.MARKETING_CUSTOMER_DATABASE_API_KEY);
    assert.equal(new URL(read.url, "https://crm.example").searchParams.get("pipeline"), pipeline);
    assert.ok(f.wixCalls.every(call => [WIX_ADVERT_IMAGE_LANES[pipeline].listing, WIX_ADVERT_IMAGE_LANES[pipeline].detail].includes(call.body.dataCollectionId)));
  });
  test(`${pipeline} deduplicates before limiting to 20 without reordering`, async t => {
    const images = Array.from({ length: 25 }, (_, index) => publicUrl(String(index)));
    const f = fixture(t, pipeline, { gallery: [images[0], images[0], ...images.slice(1)] });
    const job = await f.build();
    assert.deepEqual(job.images, images.slice(0, 20));
    assert.equal(job.imageCount, 20);
    assert.equal(job.leadImage, images[0]);
  });
  test(`${pipeline} a genuinely empty gallery never substitutes DealerKit images`, async t => {
    const f = fixture(t, pipeline, { gallery: [] });
    await assert.rejects(f.build, /Wix gallery is empty/i);
  });
  test(`${pipeline} reports vehicle not found separately from Wix API failure`, async t => {
    const f = fixture(t, pipeline, { notFound: true });
    await assert.rejects(f.build, /vehicle .*not found in Wix/i);
  });
  test(`${pipeline} reports a Wix read/API failure safely`, async t => {
    const f = fixture(t, pipeline, { apiFailure: true });
    await assert.rejects(f.build, /Wix read\/API failed/i);
  });
  test(`${pipeline} rejects an approximate registration returned by Wix`, async t => {
    const f = fixture(t, pipeline, { wrongWixRow: true });
    await assert.rejects(f.build, /unverified vehicle identity/i);
  });
  for (const field of ["registration", "pipeline"]) {
    test(`${pipeline} rejects a cross-vehicle/cross-lane CRM response (${field})`, async t => {
      const lane = WIX_ADVERT_IMAGE_LANES[pipeline];
      const response = { ok: true, registration, pipeline, detailCollection: lane.detail, galleryField: lane.gallery, gallery };
      response[field] = field === "registration" ? "EA21TSX" : pipeline === "finance" ? "rent2buy" : "finance";
      const f = fixture(t, pipeline, { responseOverride: response });
      await assert.rejects(f.build, /Wix gallery identity/i);
    });
  }
  test(`${pipeline} preserves the actual extension handoff and stored job contract`, async t => {
    const f = fixture(t, pipeline);
    const job = await f.build();
    const expectedKeys = ["version", "id", "createdAt", "destination", "postingDestination", "pipeline", "registration", "vehicleId", "location", "vehicleType", "year", "make", "model", "mileage", "price", "bodyStyle", "exteriorColor", "interiorColor", "vehicleCondition", "fuelType", "transmission", "description", "images", "imageCount", "leadImage", "source"];
    if (pipeline === "finance") expectedKeys.push("monthlyPrice", "priceContext");
    assert.deepEqual(Object.keys(job).sort(), expectedKeys.sort());
    assert.deepEqual(Object.keys(job.source).sort(), ["cms", "cmsMatchRegistration", "dealerKitStockId"]);
    assert.equal(job.version, 1);
    let listener;
    const stored = {};
    const event = { addListener() {} };
    const chrome = { runtime: { onMessage: { addListener(fn) { listener = fn; } }, onInstalled: event, onStartup: event },
      storage: { local: { async get(key) { return { [key]: stored[key] }; }, async set(value) { Object.assign(stored, value); } } },
      alarms: { create() {}, onAlarm: event }, action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} }, tabs: { onUpdated: event } };
    vm.runInNewContext(fs.readFileSync(new URL("../browser-extension/marketplace-helper/background.js", import.meta.url), "utf8"), { chrome, console, Date, setTimeout, clearTimeout, URL });
    let ack;
    Object.assign(window, { setTimeout, clearTimeout, addEventListener(type, fn) { ack = fn; }, removeEventListener() {},
      postMessage(message, origin) {
        assert.equal(message.type, "VFC_MARKETPLACE_JOB");
        assert.equal(origin, window.location.origin);
        assert.strictEqual(message.job, job);
        listener({ type: "STORE_MARKETPLACE_JOB", job: message.job }, { tab: { id: 7 } }, result => {
          assert.equal(result.ok, true);
          ack({ source: window, origin, data: { type: "VFC_MARKETPLACE_JOB_STORED", jobId: result.jobId } });
        });
      } });
    await sendMarketplaceJobToExtension(job);
    assert.strictEqual(stored.vfcPendingMarketplaceJob.job, job);
    assert.deepEqual(stored.vfcPendingMarketplaceJob.job.images, job.images);
    assert.equal(stored.vfcPendingMarketplaceJob.publishClickedAt, 0, "Handoff must not publish");
  });
  test(`${pipeline} Facebook Groups still uses the selected primary image without Marketplace preflight`, async t => {
    const f = fixture(t, pipeline);
    let ack, groupJob;
    Object.assign(window, { setTimeout, clearTimeout, addEventListener(type, fn) { ack = fn; }, removeEventListener() {},
      postMessage(message, origin) {
        assert.equal(message.type, GROUP_POST_JOB);
        groupJob = message.job;
        ack({ source: window, origin, data: { source: "vfc-facebook-helper", type: GROUP_POST_JOB_ACK, id: message.id, ok: true } });
      } });
    await prepareFacebookGroupPost({ group: { url: "https://www.facebook.com/groups/test-vehicle-group/" }, vehicle: f.vehicle, productKey: pipeline, caption: "Operator caption" });
    assert.equal(groupJob.imageUrl, f.vehicle.image);
    assert.equal(groupJob.registration, registration);
    assert.equal(f.calls.length, 0, "Groups image handoff has no ordered-gallery preflight or HTTP requests");
  });
}

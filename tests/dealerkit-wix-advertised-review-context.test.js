import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { currentWixAdvertForReview, currentWixAdvertPrice } from "../lib/dealerKitAdvertisedReviewContext.js";
import { decodeDealerKitProductImageState, encodeDealerKitProductImageState } from "../lib/dealerKitProductImageState.js";
import { calculateRent2BuyPricing } from "../lib/dealerKitRent2BuyPlan.js";

const collections = { finance: "VANFINANCE-ALLVANS", rent2buy: "ALLRENT2BUYVANS", cars: "CARFINANCE" };
const registration = "OY72YSJ";
const sourceImages = [{ id: "source-one", url: "https://images.example/dealerkit-primary.jpg" }, { id: "source-two", url: "https://images.example/dealerkit-other.jpg" }];
function advert(product, overrides = {}) {
  return { registration, wixItemId: product + "-listing", collection_id: collections[product], publishStatus: "PUBLISHED",
    title: registration, vehicleDescription: "Current Wix Transit", picture: "https://images.example/" + product + "-live.jpg",
    advertUrl: "https://stock.example/" + product + "/" + registration, price: 18995, priceText: "£18,995", monthly: product === "rent2buy" ? 599 : null,
    salePrice: product === "finance" ? "£333" : "", ...overrides };
}

// Small DOM fixture: execute the actual review/gallery clients, including their
// click handlers and network boundary, without a browser or production writes.
class Node {
  constructor(tag = "div") { this.tagName = tag.toLowerCase(); this.children = []; this.parentElement = null; this.dataset = {}; this.attributes = {}; this.listeners = {}; this.className = ""; this.text = ""; this.hidden = false;
    this.classList = { contains: (name) => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(" "); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(" "); },
      toggle: (name, force) => { const add = force ?? !this.classList.contains(name); if (add) this.classList.add(name); else this.classList.remove(name); return add; } };
  }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this.text = String(value); this.children.forEach((child) => { child.parentElement = null; }); this.children = []; }
  get childElementCount() { return this.children.length; }
  get isConnected() { return Boolean(this.connected || this.parentElement?.isConnected); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  appendChild(node) { this.append(node); return node; }
  prepend(...nodes) { for (const node of nodes.reverse()) { node.remove(); node.parentElement = this; this.children.unshift(node); } }
  replaceChildren(...nodes) { this.children.forEach((child) => { child.parentElement = null; }); this.children = []; this.text = ""; this.append(...nodes); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((node) => node !== this); this.parentElement = null; }
  replaceWith(node) { const parent = this.parentElement; if (!parent) return; const index = parent.children.indexOf(this); this.remove(); node.remove(); node.parentElement = parent; parent.children.splice(index, 0, node); }
  insertAdjacentElement(position, node) { assert.equal(position, "afterend"); const parent = this.parentElement; const index = parent.children.indexOf(this); node.remove(); node.parentElement = parent; parent.children.splice(index + 1, 0, node); }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  async fire(type) { for (const listener of this.listeners[type] || []) await listener({ target: this }); }
  async click() { await this.fire("click"); }
  matches(selector) {
    const attribute = selector.match(/\[([^=\]]+)(?:="([^"]*)")?\]/);
    if (attribute && (!(attribute[1] in this.attributes) || (attribute[2] !== undefined && this.attributes[attribute[1]] !== attribute[2]))) return false;
    const tag = selector.match(/^[a-z]+/i)?.[0];
    if (tag && this.tagName !== tag) return false;
    return [...selector.matchAll(/\.([\w-]+)/g)].every((match) => this.classList.contains(match[1]));
  }
  querySelectorAll(selector) {
    const parts = selector.trim().split(/\s+/);
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches(parts[parts.length - 1])) {
          let parent = child.parentElement;
          let index = parts.length - 2;
          while (index >= 0 && parent) { if (parent.matches(parts[index])) index -= 1; parent = parent.parentElement; }
          if (index < 0) found.push(child);
        }
        visit(child);
      }
    };
    visit(this); return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
class ReviewEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } }

async function clients({ picture = undefined, local = undefined } = {}) {
  const document = new Node("document");
  document.readyState = "loading";
  document.createElement = (tag) => new Node(tag);
  document.body = new Node("body"); document.body.connected = true; document.append(document.body);
  document.documentElement = document;
  const events = {};
  const window = { location: { pathname: "/vansco-stock-watch" }, addEventListener(type, listener) { (events[type] ||= []).push(listener); },
    dispatchEvent(event) { for (const listener of events[event.type] || []) listener(event); } };
  const calls = [];
  const templates = [
    { id: "finance-template", purpose: "van_finance_replacement", ready: true, selected: false, url: "https://images.example/finance-template.jpg", displayName: "Finance template" },
    { id: "rent-template", purpose: "rent2buy_template", ready: true, selected: false, url: "https://images.example/rent-template.jpg", displayName: "Rent2Buy template" },
  ];
  const payload = { vehicle: { registration, supplierStockId: "stock-oy72", title: "DealerKit description", retailPrice: 23995, mileage: 30000, vatStatus: "plus_vat", sourceUpdatedAt: "2026-09-30T10:00:00Z", sourceStatus: "Available", images: sourceImages, specifications: {} },
    local: local ?? { finance: { picture: "https://images.example/crm.jpg", price: 999, monthly: 777, url: "https://stock.example/crm" }, rent2buy: { picture: "https://images.example/crm-rent.jpg", monthly: 888 } },
    reviewDecision: { persisted: true, supplierStockId: "stock-oy72", registration, financeEnabled: true, rent2buyEnabled: true, financeCategories: ["all_vans"], rent2buyCategories: ["all_vans"], imageOrderIds: ["source-one", "source-two"], primaryImageId: "source-one" } };
  let detailOverride = null;
  const fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : null });
    if (url.startsWith("/api/dealerkit-stock-detail?")) return { ok: true, json: async () => detailOverride ? await detailOverride() : payload };
    if (url.startsWith("/api/dealerkit-wix-manual-media?")) return { ok: true, json: async () => ({ media: templates }) };
    if (url === "/api/dealerkit-review-decision") return { ok: true, json: async () => ({ decision: { ...JSON.parse(options.body), persisted: true } }) };
    if (url === "/api/dealerkit-wix-manual-media" && JSON.parse(options.body).action === "select_media") {
      const selected = templates.find((item) => item.id === JSON.parse(options.body).mediaId);
      selected.selected = true;
      return { ok: true, json: async () => ({ media: selected }) };
    }
    throw new Error("Unexpected network request: " + url);
  };
  const dependencies = { document, window, fetch, URLSearchParams, CustomEvent: ReviewEvent,
    MutationObserver: class { observe() {} }, queueMicrotask: () => {},
    buildMarketingAccessHeaders: (headers) => headers, parseMarketingJsonResponse: async (response) => response.json(),
    currentWixAdvertForReview, currentWixAdvertPrice, decodeDealerKitProductImageState, encodeDealerKitProductImageState, calculateRent2BuyPricing };
  async function loadClient(path, names) {
    const code = (await readFile(new URL("../" + path, import.meta.url), "utf8")).replace(/^import[\s\S]*?;\s*/gm, "");
    return new Function(...Object.keys(dependencies), code + "; return { " + names.join(",") + " };")(...Object.values(dependencies));
  }
  const review = await loadClient("utils/dealerKitReviewWorkspace.js", ["openWorkspace", "renderVehicle"]);
  const gallery = await loadClient("utils/dealerKitProductGalleryWorkspace.js", ["initialiseWorkspace", "renderActiveProduct", "saveProductState", "scan"]);
  const page = await readFile(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url), "utf8");
  const helperCode = page.slice(page.indexOf("function normalizeWatchRegistration("), page.indexOf("function classifyWatchRecord("));
  const map = new Function(helperCode + "; return mapAdvertisedLocalVehicleToWatchRecord;")();
  const start = page.indexOf("  function openDealerKitReview()", page.indexOf("function WatchCard("));
  const handoff = page.slice(start, page.indexOf("\n  return (", start));
  async function fromCard(product, record = advert(product, picture === undefined ? {} : { picture })) {
    const card = map(record, 0, product, { registration, supplierStockId: "stock-oy72", imageUrl: sourceImages[0].url });
    new Function("record", "selectedPipeline", "isAdvertisedStockMaintenance", "window", "CustomEvent", handoff + ";openDealerKitReview();")(card, product, true, window, ReviewEvent);
    for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
    return document.querySelector("[data-dealerkit-review-workspace]");
  }
  return { review, gallery, fromCard, document, calls, templates, payload, overrideDetail: (callback) => { detailOverride = callback; } };
}

for (const product of Object.keys(collections)) {
  test(product + " OY72YSJ review preserves the live Wix image and price through detail reload, replacement choices and save", async () => {
    const client = await clients();
    const workspace = await client.fromCard(product);
    assert.equal(workspace._dealerKitReviewReady, true);
    const body = workspace.querySelector("[data-dealerkit-review-body]");
    const hero = body.querySelector(".dealerkit-review__hero");
    const liveUrl = advert(product).picture;
    assert.equal(hero.querySelector("img").src, liveUrl, "The different DealerKit and CRM images cannot replace the current Wix image");
    assert.equal(hero.querySelector(".dealerkit-review__current-image-label").textContent, "Current Wix image");
    assert.ok(hero.textContent.includes("Published in Wix"));
    assert.ok(hero.textContent.includes(product === "rent2buy" ? "£599 p/m" : "£18,995"));
    assert.equal(workspace.querySelector("[data-dealerkit-review-subtitle]").textContent, "Current Wix Transit");
    assert.equal(hero.querySelector("a").href, advert(product).advertUrl);
    const replacement = body.querySelectorAll(".dealerkit-review__image-primary")[1];
    await replacement.click();
    assert.equal(replacement.textContent, "Replacement primary");
    assert.equal(hero.querySelector("img").src, liveUrl, "Changing a replacement choice must not change what is labelled live");

    if (product === "cars") {
      await body.querySelector(".dealerkit-review__save").click();
      const saved = client.calls.find((call) => call.url === "/api/dealerkit-review-decision");
      assert.equal(saved.body.primaryImageId, "source-two");
    } else {
      await client.gallery.initialiseWorkspace(workspace, body, registration);
      const state = workspace._dealerKitProductGalleryState;
      assert.equal(state.currentWixAdvert.imageUrl, liveUrl, "The second DealerKit detail reload must retain the verified Wix context");
      assert.equal(state.currentWixAdvert.collection_id, collections[product]);
      const pricing = state.root.querySelector("[data-product-gallery-pricing]");
      assert.ok(pricing.textContent.includes("Published in Wix"));
      assert.ok(pricing.textContent.includes(product === "rent2buy" ? "£599 p/m" : "£18,995"));
      assert.ok(!pricing.textContent.includes("£999") && !pricing.textContent.includes("£777") && !pricing.textContent.includes("£888"));
      const manual = state.root.querySelector("[data-product-gallery-manual]");
      assert.equal(manual.querySelector("img").src, product === "finance" ? client.templates[0].url : client.templates[1].url);
      assert.equal(manual.querySelectorAll("img").length, 1, "Other product templates remain isolated");
      assert.equal(state.root.querySelectorAll("[data-product-gallery-source] img").length, 2);
      const sourceCards = state.root.querySelectorAll("[data-product-gallery-source] article");
      await sourceCards[1].querySelector("button").click();
      assert.equal(state.imageState[product].primaryId, "source-two");
      assert.equal(hero.querySelector("img").src, liveUrl, "Source-primary changes are replacement choices, not live changes");
      assert.ok(state.root.textContent.includes("Optional uploaded replacement"));
      assert.ok(state.root.querySelector("[data-product-gallery-primary-note]").textContent.includes("Current Wix image above remains live"));
      assert.ok(!state.sourceIds.includes(state.currentWixAdvert.wixItemId));
      assert.ok(!state.manualMedia.some((item) => item.url === liveUrl), "The live picture must not be registered as an uploaded template");
      await manual.querySelector("button").click();
      assert.ok(state.root.querySelector("[data-product-gallery-primary-note]").textContent.includes("optional replacement primary"));
      assert.equal(hero.querySelector("img").src, liveUrl);
      await client.gallery.saveProductState(state);
    }
    assert.equal(hero.querySelector("img").src, liveUrl);
    const writes = client.calls.filter((call) => call.method !== "GET");
    assert.ok(writes.every((call) => call.url === "/api/dealerkit-review-decision" || (call.url === "/api/dealerkit-wix-manual-media" && call.body.action === "select_media")));
    const decisionWrite = writes.find((call) => call.url === "/api/dealerkit-review-decision");
    assert.ok(decisionWrite);
    assert.equal(decisionWrite.body.picture, undefined);
    assert.equal(decisionWrite.body.currentWixAdvert, undefined);
    assert.ok(!client.calls.some((call) => /controlled-publish|wixapis|wix-data/.test(call.url)));
  });
}

test("Wix-only advert remains recognised when detail reload has no CRM support match", async () => {
  const client = await clients({ local: {} });
  const workspace = await client.fromCard("finance");
  const body = workspace.querySelector("[data-dealerkit-review-body]");
  await client.gallery.initialiseWorkspace(workspace, body, registration);
  const pricing = workspace._dealerKitProductGalleryState.root.querySelector("[data-product-gallery-pricing]").textContent;
  assert.ok(pricing.includes("£18,995") && pricing.includes("Published in Wix"));
  assert.ok(!pricing.includes("Not advertised"));
});

test("an existing Wix advert with unknown price is published, never shown as an absent advert or priced from CRM", async () => {
  const client = await clients();
  const workspace = await client.fromCard("finance", advert("finance", { price: null, priceText: "", salePrice: "" }));
  const body = workspace.querySelector("[data-dealerkit-review-body]");
  await client.gallery.initialiseWorkspace(workspace, body, registration);
  const pricing = workspace._dealerKitProductGalleryState.root.querySelector("[data-product-gallery-pricing]").textContent;
  assert.ok(pricing.includes("Price unavailable") && pricing.includes("Published in Wix"));
  assert.ok(!pricing.includes("Not advertised") && !pricing.includes("£999"));
});

test("an empty Wix picture never falls back to a DealerKit, CRM or uploaded template image", async () => {
  const client = await clients({ picture: "" });
  const workspace = await client.fromCard("finance");
  const hero = workspace.querySelector(".dealerkit-review__hero");
  assert.equal(hero.querySelector("img"), null);
  assert.ok(hero.textContent.includes("No picture stored on the current Wix advert"));
  await client.gallery.initialiseWorkspace(workspace, workspace.querySelector("[data-dealerkit-review-body]"), registration);
  assert.equal(hero.querySelector("img"), null);
});

test("review rejects an unpublished, unidentified, wrong-registration or wrong-lane advert before requesting detail", async () => {
  for (const overrides of [{ publishStatus: "DRAFT" }, { wixItemId: "" }, { registration: "AB23CDE" }, { collection_id: "ALLRENT2BUYVANS" }, { collection_id: "CARFINANCE" }]) {
    const client = await clients();
    await client.review.openWorkspace(registration, "stock-oy72", "finance", advert("finance", overrides));
    const workspace = client.document.querySelector("[data-dealerkit-review-workspace]");
    assert.equal(workspace._dealerKitReviewReady, false);
    assert.ok(workspace.textContent.includes("could not be verified"));
    assert.deepEqual(client.calls, []);
  }
  for (const product of Object.keys(collections)) {
    for (const other of Object.keys(collections).filter((lane) => lane !== product)) {
      assert.throws(() => currentWixAdvertForReview(advert(other), registration, product), /could not be verified/);
    }
  }
});

test("reopening a different lane resets live context; an ordinary Missing review keeps its source-image behaviour", async () => {
  const client = await clients();
  const workspace = await client.fromCard("finance");
  await client.fromCard("rent2buy");
  assert.equal(workspace.querySelector(".dealerkit-review__hero img").src, advert("rent2buy").picture);
  await client.review.openWorkspace(registration, "stock-oy72", "finance");
  assert.equal(workspace._dealerKitCurrentWixAdvert, null);
  assert.equal(workspace.querySelector(".dealerkit-review__hero img").src, sourceImages[0].url);
  assert.equal(workspace.querySelector(".dealerkit-review__current-image-label"), null);
  await workspace.querySelectorAll(".dealerkit-review__image-primary")[1].click();
  assert.equal(workspace.querySelector(".dealerkit-review__hero img").src, sourceImages[1].url);
});

test("a delayed product-detail response cannot restore a previous lane's advert after another review opens", async () => {
  const client = await clients();
  const workspace = await client.fromCard("finance");
  let resolveDetail;
  client.overrideDetail(() => new Promise((resolve) => { resolveDetail = resolve; }));
  const loading = client.gallery.initialiseWorkspace(workspace, workspace.querySelector("[data-dealerkit-review-body]"), registration);
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
  client.overrideDetail(null);
  await client.fromCard("rent2buy");
  resolveDetail(client.payload);
  await loading;
  assert.equal(workspace._dealerKitProductGalleryState, null);
  assert.equal(workspace.querySelector(".dealerkit-review__hero img").src, advert("rent2buy").picture);
  await client.gallery.initialiseWorkspace(workspace, workspace.querySelector("[data-dealerkit-review-body]"), registration);
  assert.equal(workspace._dealerKitProductGalleryState.activeProduct, "rent2buy");
  assert.equal(workspace._dealerKitProductGalleryState.currentWixAdvert.collection_id, "ALLRENT2BUYVANS");
});

test("native Wix picture conversion and lane-specific prices come only from the published context", () => {
  const live = currentWixAdvertForReview(advert("cars", { picture: "wix:image://v1/live-file/current.jpg", imageUrl: "https://images.example/crm.jpg" }), "OY72 YSJ", "cars");
  assert.equal(live.imageUrl, "https://static.wixstatic.com/media/live-file");
  assert.equal(currentWixAdvertPrice(live), "£18,995");
  assert.equal(currentWixAdvertPrice(currentWixAdvertForReview(advert("rent2buy"), registration, "rent2buy")), "£599 p/m");
});

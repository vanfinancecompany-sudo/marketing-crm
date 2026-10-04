import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseMarketingJsonResponse } from "../services/marketingAccess.js";
import { convertWixImage } from "../services/marketingVehicleContract.js";
import { WIX_ADVERT_IMAGE_LANES, createWixImageDraft, appendWixImage, prependWixImages, moveWixImage, removeWixImage, wixImageProposal, wixGalleryImageSource } from "../lib/wixAdvertImageEditor.js";

const registration = "OY72YSJ";
const urls = ["https://static.wixstatic.com/media/current-van.jpg", "https://static.wixstatic.com/media/current-interior.jpg"];
const uploadUrl = "https://static.wixstatic.com/media/due-in-soon.jpg";

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
  async fire(type, extra = {}) { for (const listener of this.listeners[type] || []) await listener({ target: this, preventDefault() {}, ...extra }); }
  async click() { if (!this.disabled) await this.fire("click"); }
  focus() { this.focused = true; }
  scrollIntoView() { this.scrolledIntoView = true; }
  get firstElementChild() { return this.children[0] || null; }
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



async function clients(pipeline) {
  const document = new Node("document");
  document.createElement = (tag) => new Node(tag);
  document.body = new Node("body"); document.body.connected = true; document.appendChild(document.body);
  const events = {};
  const window = { addEventListener(type, listener) { (events[type] ||= []).push(listener); },
    dispatchEvent(event) { for (const listener of events[event.type] || []) listener(event); } };
  const lane = WIX_ADVERT_IMAGE_LANES[pipeline];
  const extra = pipeline === "finance"
    ? [{ collectionId: "VANFINANCE-SMALLVANS", label: "Small Vans", imageField: "picture" }, { collectionId: "AUTOMATIC", label: "Automatic", imageField: "picture" }]
    : pipeline === "rent2buy"
      ? [{ collectionId: "CREWVANS", label: "Crew Vans", imageField: "image" }, { collectionId: "SmallVans", label: "Small Vans", imageField: "picture" }] : [];
  let snapshot = { registration, pipeline, baseline: "live-baseline-" + pipeline, gallery: [...urls], picture: urls[0], title: "Published Ford Transit Custom",
    priceText: "£18,995", advertUrl: "https://live.example/" + pipeline, imageCount: { exists: true, value: "2" },
    listingId: "listing", detailId: "detail", listingCollection: lane.listing, detailCollection: lane.detail, galleryField: lane.gallery,
    galleryDestination: { collectionId: lane.detail, itemId: "detail", field: lane.gallery, label: lane.label + " vehicle gallery" },
    destinations: [{ collectionId: lane.listing, label: pipeline === "cars" ? "Car Finance" : "All Vans", imageField: "picture", required: true }, ...extra]
      .map((item, index) => ({ ...item, itemId: "row-" + index, selected: true, currentImage: urls[0] })),
  };
  const calls = [];
  const control = { fail: {}, unverified: false, reloadMismatch: false, reloadFailure: false, processing: false, beforeAction: null };
  let submitted = false;
  const fetch = async (url, options = {}) => {
    if (url === "https://upload.example/signed") { calls.push({ url, method: options.method }); return { ok: true, json: async () => ({ file: { id: "new-file" } }) }; }
    assert.equal(url, "/api/wix-advert-images", "The maintenance UI must never call DealerKit, CRM or review decisions");
    const body = JSON.parse(options.body); calls.push({ url, ...body });
    assert.equal(body.pipeline, pipeline); assert.equal(body.registration, registration);
    if (control.beforeAction) await control.beforeAction(body);
    if (control.fail[body.action]) return { ok: false, status: 409, json: async () => ({ ok: false, message: control.fail[body.action] }) };
    let result;
    if (body.action === "load") {
      if (submitted && control.reloadFailure) return { ok: false, status: 502, json: async () => ({ ok: false, message: "Wix identity read is incomplete." }) };
      result = { ...snapshot, gallery: submitted && control.reloadMismatch ? [...snapshot.gallery].reverse() : [...snapshot.gallery] };
    }
    else if (body.action === "prepareUpload") result = { uploadUrl: "https://upload.example/signed", mimeType: body.mimeType, uploadTicket: "lane-upload-ticket" };
    else if (body.action === "finishUpload") result = control.processing ? { ready: false, status: "PROCESSING" }
      : { ready: true, fileId: "new-file", url: uploadUrl, token: "new-image-token" };
    else if (body.action === "prepare") {
      const gallery = body.images.map((image) => image.kind === "existing" ? snapshot.gallery[image.index] : uploadUrl);
      result = { confirmation: "confirmed-gallery", gallery, picture: gallery[0], galleryDestination: snapshot.galleryDestination,
        destinations: snapshot.destinations.map((item) => ({ ...item, selected: body.selectedDestinations.includes(item.collectionId) })) };
    }
    else if (body.action === "reconcile") {
      assert.equal(body.confirmed, true); assert.equal(body.confirmRegistration, undefined, "No registration typing is required");
      assert.equal(body.confirmation, "confirmed-gallery");
      const gallery = body.images.map((image) => image.kind === "existing" ? snapshot.gallery[image.index] : uploadUrl);
      snapshot = { ...snapshot, gallery, picture: gallery[0], baseline: "updated-baseline", imageCount: { exists: true, value: String(gallery.length) },
        destinations: snapshot.destinations.map((item) => body.selectedDestinations.includes(item.collectionId) ? { ...item, currentImage: gallery[0] } : item) };
      submitted = true;
      result = { verified: !control.unverified, snapshot };
    } else throw new Error("Unexpected image action");
    return { ok: true, status: 200, json: async () => ({ ok: true, ...result }) };
  };
  const dependencies = { document, window, fetch, CustomEvent: ReviewEvent, convertWixImage,
    buildMarketingAccessHeaders: (headers) => headers, parseMarketingJsonResponse,
    WIX_ADVERT_IMAGE_LANES, createWixImageDraft, appendWixImage, prependWixImages, moveWixImage, removeWixImage, wixImageProposal, wixGalleryImageSource };
  const code = (await readFile(new URL("../utils/wixAdvertImageWorkspace.js", import.meta.url), "utf8"))
    .replace(/^import[\s\S]*?;\s*/gm, "").replace(/^export /gm, "");
  const editor = new Function(...Object.keys(dependencies), code + ";return { openWixImageEditor, render, uploadImage, prepareReconciliation, reconcileImages };")(...Object.values(dependencies));
  const page = await readFile(new URL("../pages/VanscoStockWatchPage.jsx", import.meta.url), "utf8");
  const watch = page.slice(page.indexOf("function WatchCard("));
  const start = watch.indexOf("  function openDealerKitReview()");
  const handoff = watch.slice(start, watch.indexOf("\n  return (", start));
  const gate = watch.match(/const canReviewWix = ([\s\S]*?);/)[1];
  async function fromCard() {
    // Deliberately no supplierStockId or DealerKit match.
    const record = { registration, displayStatus: "advertised_stock", wixItemId: "listing", wixCollectionId: lane.listing, wixPublishStatus: "PUBLISHED", dealerKitIdentityAmbiguous: true };
    assert.equal(new Function("record", "isAdvertisedStockMaintenance", "selectedPipeline", "return " + gate)(record, true, pipeline), true);
    new Function("record", "selectedPipeline", "isAdvertisedStockMaintenance", "window", "CustomEvent", handoff + ";openDealerKitReview();")(record, pipeline, true, window, ReviewEvent);
    for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
    return document.querySelector("[data-wix-advert-image-editor]")._wixImageEditorState;
  }
  return { editor, fromCard, calls, document, control, live: () => snapshot };
}

for (const pipeline of Object.keys(WIX_ADVERT_IMAGE_LANES)) {
  test(pipeline + " review uses the familiar Wix-only two-step update and reloads the verified stored gallery", async () => {
    const client = await clients(pipeline);
    const state = await client.fromCard();
    assert.deepEqual(state.draft.items.map((item) => item.src), urls);
    assert.equal(state.current.querySelector("img").src, urls[0]);
    assert.ok(state.title.textContent.includes(registration));
    assert.equal(state.subtitle.textContent, "Published Ford Transit Custom");
    assert.ok(state.current.textContent.includes("Current published Wix advert") && state.current.textContent.includes("£18,995"));
    assert.equal(state.current.querySelector("a").href, "https://live.example/" + pipeline);
    assert.ok(state.gallery.textContent.includes("#1 · Primary"));
    assert.equal(client.document.querySelector("[data-dealerkit-review-workspace]"), null);
    for (const removed of ["DealerKit source photos", "template image", "Save draft locally", "Prepare reconciliation",
      "Type OY72YSJ", "Reconcile advert images", "Update only this Wix gallery"]) assert.ok(!state.body.textContent.includes(removed));
    assert.equal(state.body.querySelectorAll("input").filter((input) => input.type === "text").length, 0);
    assert.ok(state.destinationInputs.every((input) => input.checked));
    assert.ok(state.destinationInputs.find((input) => input.dataset.collectionId === WIX_ADVERT_IMAGE_LANES[pipeline].listing).disabled);
    assert.equal(state.uploadInput.multiple, true, "The Wix image picker supports Ctrl/Cmd multi-select");

    state.uploadInput.files = [{ name: "Due in Soon.jpg", type: "image/jpeg", size: 1200 }];
    await state.uploadInput.fire("change");
    assert.deepEqual(state.draft.items.map((item) => item.src), [uploadUrl, ...urls]);
    assert.equal(state.current.querySelector("img").src, urls[0], "Uploading does not replace current primary");
    const cards = state.gallery.querySelectorAll("figure");
    await cards[2].fire("dragstart", { dataTransfer: { setData() {} } });
    await cards[1].fire("drop");
    assert.deepEqual(state.draft.items.map((item) => item.src), [uploadUrl, urls[1], urls[0]]);
    await state.gallery.querySelectorAll("figure")[2].querySelector("button").click();
    assert.deepEqual(state.draft.items.map((item) => item.src), [uploadUrl, urls[1]]);
    assert.deepEqual(client.live().gallery, urls);
    assert.equal(client.calls.filter((call) => call.action === "reconcile").length, 0);

    await state.updateButton.click();
    assert.ok(state.prepared);
    assert.equal(state.confirmationPanel.hidden, false);
    assert.ok(state.confirmationPanel.textContent.includes("2 images") && state.confirmationPanel.textContent.includes(WIX_ADVERT_IMAGE_LANES[pipeline].detail));
    assert.equal(state.confirmationPanel.querySelector("img").src, uploadUrl);
    for (const destination of client.live().destinations) assert.ok(state.confirmationPanel.textContent.includes(destination.collectionId + "." + destination.imageField));
    assert.deepEqual(client.live().gallery, urls, "Update Wix images prepares only");
    assert.equal(client.calls.filter((call) => call.action === "reconcile").length, 0);
    await state.confirmButton.click();
    assert.deepEqual(client.live().gallery, [uploadUrl, urls[1]]);
    assert.equal(client.live().picture, uploadUrl);
    assert.equal(client.calls.filter((call) => call.action === "reconcile").length, 1);
    assert.equal(client.calls.filter((call) => call.action === "load").length, 2, "Reload after verification, rather than rendering the optimistic draft");
    assert.deepEqual(state.draft.items.map((item) => item.src), [uploadUrl, urls[1]]);
    assert.equal(state.message.textContent, "✓ Wix images updated successfully");
    assert.equal(state.message.dataset.kind, "success");
    assert.equal(state.message.scrolledIntoView, true);
    assert.equal(state.confirmationPanel.hidden, true);
    assert.equal(state.hasLocalChanges, false);
  });
}

for (const pipeline of ["finance", "rent2buy"]) {
  test(pipeline + " shows only actual published destinations and confirms the user's selected existing sections", async () => {
    const client = await clients(pipeline);
    const state = await client.fromCard();
    assert.equal(state.destinationInputs.length, 3);
    assert.ok(!state.destinations.textContent.includes("Electric"), "No classification guesses or absent category destinations");
    if (pipeline === "rent2buy") assert.ok(state.destinations.textContent.includes("CREWVANS.image"));
    const excluded = client.live().destinations[1];
    const input = state.destinationInputs.find((item) => item.dataset.collectionId === excluded.collectionId);
    input.checked = false; await input.fire("change");
    await state.gallery.querySelectorAll("figure")[1].querySelectorAll("button")[1].click();
    await state.updateButton.click();
    assert.ok(!state.confirmationPanel.textContent.includes(excluded.collectionId + "." + excluded.imageField));
    const selected = client.live().destinations.filter((item) => item.collectionId !== excluded.collectionId).map((item) => item.collectionId);
    assert.deepEqual(state.prepared.input.selectedDestinations, selected);
    await state.confirmButton.click();
    assert.equal(client.live().destinations.length, 3, "No category membership is created or removed");
    assert.equal(client.live().destinations.find((item) => item.collectionId === excluded.collectionId).currentImage, urls[0]);
    assert.ok(client.live().destinations.filter((item) => item.collectionId !== excluded.collectionId).every((item) => item.currentImage === urls[1]));
    assert.equal(state.current.querySelector("img").src, urls[1]);
    assert.equal(state.message.dataset.kind, "success");
  });
}

test("editing after preparation invalidates confirmation until a new two-step update", async () => {
  const client = await clients("cars");
  const state = await client.fromCard();
  await state.updateButton.click();
  await state.gallery.querySelectorAll("figure")[1].querySelectorAll("button")[1].click();
  assert.equal(state.prepared, null);
  assert.equal(state.draft.confirmation, null);
  assert.equal(state.confirmationPanel.hidden, true);
  assert.equal(state.current.querySelector("img").src, urls[0]);
  await assert.rejects(() => client.editor.reconcileImages(state), /Click Update Wix images/);
  assert.equal(client.calls.filter((call) => call.action === "reconcile").length, 0);
  await state.updateButton.click();
  await state.confirmButton.click();
  assert.deepEqual(state.draft.items.map((item) => item.src), [urls[1], urls[0]]);
  assert.equal(state.current.querySelector("img").src, urls[1]);
});

test("Cancel after uploading and preparing performs no live CMS write", async () => {
  const client = await clients("finance");
  const state = await client.fromCard();
  await client.editor.uploadImage(state, { name: "Extra.jpg", type: "image/jpeg", size: 1200 });
  client.editor.render(state);
  await state.updateButton.click();
  await state.cancelButton.click();
  assert.equal(client.document.querySelector("[data-wix-advert-image-editor]"), null);
  assert.equal(client.calls.filter((call) => call.action === "reconcile").length, 0);
  assert.deepEqual(client.live().gallery, urls);
});

test("prepare failures show their exact reason prominently and never expose Confirm update", async () => {
  const client = await clients("rent2buy");
  const state = await client.fromCard();
  client.control.fail.prepare = "The Wix category identity in CREWVANS is ambiguous. No images were changed.";
  await state.updateButton.click();
  assert.equal(state.confirmButton, null);
  assert.equal(state.message.getAttribute("role"), "alert");
  assert.ok(state.message.textContent.includes("CREWVANS is ambiguous"));
  assert.equal(state.message.scrolledIntoView, true);
  assert.equal(client.calls.filter((call) => call.action === "reconcile").length, 0);
  assert.ok(!state.message.textContent.includes("successfully"));
});

test("failed verification, failed reload or a different stored order can never display success", async () => {
  for (const failure of ["reconcile", "unverified", "reloadFailure", "reloadMismatch"]) {
    const client = await clients("cars");
    const state = await client.fromCard();
    await state.gallery.querySelectorAll("figure")[1].querySelectorAll("button")[1].click();
    await state.updateButton.click();
    if (failure === "reconcile") client.control.fail.reconcile = "Wix image update failed: exact detail identity changed. Completed image changes were rolled back.";
    else client.control[failure] = true;
    await state.confirmButton.click();
    assert.equal(state.message.getAttribute("role"), "alert");
    assert.equal(state.message.dataset.kind, "error");
    assert.ok(!state.message.textContent.includes("successfully"));
    assert.equal(state.current.querySelector("img").src, urls[0], "Do not display an optimistic current image");
    if (failure !== "reconcile") assert.equal(state.updateButton.disabled, true, "Require a fresh reopen after uncertain saved state");
  }
});

test("busy confirmation blocks repeated updates and closing while a guarded write is running", async () => {
  const client = await clients("cars");
  const state = await client.fromCard();
  await state.updateButton.click();
  let release;
  client.control.beforeAction = async (body) => { if (body.action === "reconcile") await new Promise((resolve) => { release = resolve; }); };
  const confirm = state.confirmButton;
  const pending = confirm.click();
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
  assert.equal(state.busy, true);
  assert.equal(state.cancelButton.disabled, true);
  await confirm.click();
  await state.cancelButton.click();
  assert.ok(client.document.querySelector("[data-wix-advert-image-editor]"));
  assert.equal(client.calls.filter((call) => call.action === "reconcile").length, 1);
  release(); await pending;
  assert.equal(state.message.dataset.kind, "success");
});

test("processing uploads keep the live primary unchanged and block update until the Wix image is READY", async () => {
  const client = await clients("finance");
  const state = await client.fromCard();
  client.control.processing = true;
  state.uploadInput.files = [{ name: "Extra.jpg", type: "image/png", size: 800 }];
  await state.uploadInput.fire("change");
  assert.deepEqual(state.draft.items.map((item) => item.src), urls);
  assert.equal(state.updateButton.disabled, true);
  assert.equal(state.recheckButton.hidden, false);
  client.control.processing = false;
  await state.recheckButton.click();
  assert.deepEqual(state.draft.items.map((item) => item.src), [uploadUrl, ...urls]);
  assert.equal(state.draft.items[0].src, uploadUrl);
  assert.equal(state.updateButton.disabled, false);
  assert.equal(client.calls.filter((call) => call.action === "reconcile").length, 0);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { convertWixImage } from "../services/marketingVehicleContract.js";
import { WIX_ADVERT_IMAGE_LANES, createWixImageDraft, appendWixImage, moveWixImage, removeWixImage, wixImageProposal, wixGalleryImageSource } from "../lib/wixAdvertImageEditor.js";

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



async function clients(pipeline) {
  const document = new Node("document");
  document.createElement = (tag) => new Node(tag);
  document.body = new Node("body"); document.body.connected = true; document.appendChild(document.body);
  const events = {};
  const window = { addEventListener(type, listener) { (events[type] ||= []).push(listener); },
    dispatchEvent(event) { for (const listener of events[event.type] || []) listener(event); } };
  const storage = new Map();
  const localStorage = { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
  const lane = WIX_ADVERT_IMAGE_LANES[pipeline];
  let snapshot = { registration, pipeline, baseline: "live-baseline-" + pipeline, gallery: [...urls], picture: urls[0], priceText: "£18,995",
    listingId: "listing", detailId: "detail", listingCollection: lane.listing, detailCollection: lane.detail, galleryField: lane.gallery };
  const calls = [];
  const fetch = async (url, options = {}) => {
    if (url === "https://upload.example/signed") { calls.push({ url, method: options.method }); return { ok: true, json: async () => ({ file: { id: "new-file" } }) }; }
    assert.equal(url, "/api/wix-advert-images", "The maintenance UI must never call DealerKit, CRM or review decisions");
    const body = JSON.parse(options.body); calls.push({ url, ...body });
    assert.equal(body.pipeline, pipeline); assert.equal(body.registration, registration);
    let result;
    if (body.action === "load") result = { ...snapshot, gallery: [...snapshot.gallery] };
    else if (body.action === "prepareUpload") result = { uploadUrl: "https://upload.example/signed", mimeType: body.mimeType, uploadTicket: "lane-upload-ticket" };
    else if (body.action === "finishUpload") result = { ready: true, fileId: "new-file", url: uploadUrl, token: "new-image-token" };
    else if (body.action === "prepare") result = { confirmation: "confirmed-gallery", gallery: body.images.map((image) => image.kind === "existing" ? snapshot.gallery[image.index] : uploadUrl) };
    else if (body.action === "reconcile") {
      assert.equal(body.confirmed, true); assert.equal(body.confirmRegistration, registration); assert.equal(body.confirmation, "confirmed-gallery");
      const gallery = body.images.map((image) => image.kind === "existing" ? snapshot.gallery[image.index] : uploadUrl);
      snapshot = { ...snapshot, gallery, picture: gallery[0], baseline: "updated-baseline" };
      result = { verified: true, snapshot };
    } else throw new Error("Unexpected image action");
    return { ok: true, json: async () => ({ ok: true, ...result }) };
  };
  const dependencies = { document, window, localStorage, fetch, CustomEvent: ReviewEvent, convertWixImage,
    buildMarketingAccessHeaders: (headers) => headers, parseMarketingJsonResponse: async (response) => response.json(),
    WIX_ADVERT_IMAGE_LANES, createWixImageDraft, appendWixImage, moveWixImage, removeWixImage, wixImageProposal, wixGalleryImageSource };
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
  return { editor, fromCard, calls, document, storage, live: () => snapshot };
}

for (const pipeline of Object.keys(WIX_ADVERT_IMAGE_LANES)) {
  test(pipeline + " advertised Review vehicle opens only Current Wix images without a DealerKit stock ID", async () => {
    const client = await clients(pipeline);
    const state = await client.fromCard();
    assert.deepEqual(state.draft.items.map((item) => item.src), urls);
    assert.equal(state.current.querySelector("img").src, urls[0]);
    assert.ok(state.gallery.textContent.includes("#1 · Current gallery primary"));
    assert.equal(client.document.querySelector("[data-dealerkit-review-workspace]"), null, "Legacy review/gallery/publisher observers cannot attach");
    assert.ok(!state.body.textContent.includes("DealerKit source photos") && !state.body.textContent.includes("template image"));
    assert.equal(client.calls.filter((call) => call.action === "load").length, 1);

    await client.editor.uploadImage(state, { name: "Due in Soon.jpg", type: "image/jpeg", size: 1200 });
    client.editor.render(state);
    assert.deepEqual(state.draft.items.map((item) => item.src), [...urls, uploadUrl]);
    assert.equal(state.current.querySelector("img").src, urls[0]);
    assert.deepEqual(client.live().gallery, urls);
    const cards = state.gallery.querySelectorAll("figure");
    await cards[2].fire("dragstart", { dataTransfer: { setData() {} } });
    await cards[1].fire("drop");
    assert.deepEqual(state.draft.items.map((item) => item.src), [urls[0], uploadUrl, urls[1]]);
    await state.gallery.querySelectorAll("figure")[2].querySelector("button").click();
    assert.deepEqual(state.draft.items.map((item) => item.src), [urls[0], uploadUrl]);
    await state.saveButton.click();
    assert.equal(client.storage.size, 1);
    assert.equal(client.calls.filter((call) => call.action === "reconcile").length, 0);
    await state.prepareButton.click();
    assert.equal(state.reconcileButton.disabled, true);
    assert.deepEqual(client.live().gallery, urls);
    assert.equal(client.calls.filter((call) => call.action === "reconcile").length, 0);
    state.confirmInput.value = registration; state.confirmCheck.checked = true; client.editor.render(state);
    assert.equal(state.reconcileButton.disabled, false);
    await state.reconcileButton.click();
    assert.deepEqual(client.live().gallery, [urls[0], uploadUrl]);
    assert.equal(client.live().picture, urls[0]);
    assert.equal(client.calls.filter((call) => call.action === "reconcile").length, 1);
    assert.equal(state.current.querySelector("img").src, urls[0]);
  });
}

test("a later reorder invalidates the prepared confirmation and changes primary only on the next explicit reconcile", async () => {
  const client = await clients("cars");
  const state = await client.fromCard();
  await state.prepareButton.click();
  state.confirmInput.value = registration; state.confirmCheck.checked = true;
  await state.gallery.querySelectorAll("figure")[1].querySelectorAll("button")[1].click();
  assert.equal(state.draft.confirmation, null);
  assert.equal(state.reconcileButton.disabled, true);
  assert.equal(state.current.querySelector("img").src, urls[0]);
  assert.deepEqual(state.draft.items.map((item) => item.src), [urls[1], urls[0]]);
  await assert.rejects(() => client.editor.reconcileImages(state), /Prepare/);
  await state.prepareButton.click();
  state.confirmInput.value = registration; state.confirmCheck.checked = true;
  await client.editor.reconcileImages(state);
  assert.equal(client.live().picture, urls[1]);
  assert.deepEqual(client.live().gallery, [urls[1], urls[0]]);
});

test("saved local drafts never replace the current gallery on opening and require an explicit verified restore", async () => {
  const client = await clients("finance");
  const state = await client.fromCard();
  await state.gallery.querySelectorAll("figure")[1].querySelectorAll("button")[1].click();
  await state.saveButton.click();
  const reopened = await client.editor.openWixImageEditor(registration, "finance");
  assert.deepEqual(reopened.draft.items.map((item) => item.src), urls, "Opening always shows the current stored order");
  const restore = reopened.body.querySelectorAll("button").find((button) => button.textContent === "Restore local draft");
  assert.ok(restore);
  await restore.click();
  assert.deepEqual(reopened.draft.items.map((item) => item.src), [urls[1], urls[0]]);
  assert.equal(reopened.draft.confirmation, null);
  assert.equal(client.calls.filter((call) => call.action === "reconcile").length, 0);
});

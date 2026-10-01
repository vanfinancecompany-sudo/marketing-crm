import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { normalizeFinanceRegistration } from "../lib/vanscoWixPrice.js";
import { registrationTitleVariants } from "../lib/wixRegistrationVariants.js";
import { WIX_ADVERT_IMAGE_LANES, WIX_ADVERT_CATEGORY_IMAGE_FIELDS, wixGalleryImageSource } from "../lib/wixAdvertImageEditor.js";

const SITE_ID = "85f11c52-ee54-495d-aaec-a351831709b5";
const clean = (value) => String(value ?? "").trim();
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const same = (left, right) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));
const fingerprint = (value) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");

export class WixImageEditorError extends Error {
  constructor(status, message, details = {}) { super(message); this.status = status; this.details = details; }
}

function sign(payload, secret) {
  const text = encodeURIComponent(JSON.stringify(payload));
  return text + "." + createHmac("sha256", secret).update(text).digest("hex");
}

function readToken(token, secret, purpose, scope) {
  if (typeof token !== "string" || token.length > 16000) throw new WixImageEditorError(409, "Wix image confirmation is missing or invalid.");
  const split = token.lastIndexOf(".");
  const text = token.slice(0, split);
  const signature = token.slice(split + 1);
  const expected = createHmac("sha256", secret).update(text).digest("hex");
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new WixImageEditorError(409, "Wix image confirmation is invalid. Prepare again.");
  }
  let value;
  try { value = JSON.parse(decodeURIComponent(text)); } catch { throw new WixImageEditorError(409, "Invalid Wix image confirmation."); }
  if (value.purpose !== purpose || value.registration !== scope.registration || value.pipeline !== scope.pipeline
    || value.siteId !== SITE_ID || !Number.isFinite(value.expires) || value.expires < Date.now()) {
    throw new WixImageEditorError(409, "Wix image confirmation is expired or belongs to another vehicle/lane. Prepare again.");
  }
  return value;
}

async function wixRequest(configuration, path, { method = "POST", body } = {}) {
  const response = await fetch(configuration.baseUrl + path, {
    method, headers: { Authorization: configuration.apiKey, "wix-site-id": SITE_ID, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new WixImageEditorError(502, clean(payload.message) || "Wix request failed.");
  return payload;
}

async function queryRows(configuration, request, collection, registration, optional = false) {
  const byId = new Map();
  for (const title of registrationTitleVariants(registration)) {
    let exhausted = false;
    for (let offset = 0; offset < 2000; offset += 100) {
      const payload = await request(configuration, "/wix-data/v2/items/query", {
        body: { dataCollectionId: collection, query: { filter: { title: { $eq: title } }, paging: { limit: 100, offset } }, consistentRead: true },
      });
      if (!Array.isArray(payload.dataItems)) throw new WixImageEditorError(409, "Wix identity read is incomplete.");
      for (const row of payload.dataItems) {
        if (!row?.id || normalizeFinanceRegistration(row.data?.title || "") !== registration) throw new WixImageEditorError(409, "Wix returned an unverified vehicle identity.");
        byId.set(row.id, row);
      }
      if (payload.dataItems.length < 100) { exhausted = true; break; }
    }
    if (!exhausted) throw new WixImageEditorError(409, "Wix identity scan is incomplete.");
  }
  const rows = [...byId.values()];
  if (optional && rows.length === 0) return null;
  if (rows.length !== 1) throw new WixImageEditorError(409, optional
    ? "The Wix category identity in " + collection + " is ambiguous. No images were changed."
    : "The Wix listing/detail identity is missing or ambiguous. No images were changed.");
  const status = clean(rows[0].data?._publishStatus || rows[0]._publishStatus).toUpperCase();
  if (optional && status === "DRAFT") return null;
  if (status !== "PUBLISHED") {
    throw new WixImageEditorError(409, "Both Wix listing and detail must be verified as published. No images were changed.");
  }
  return rows[0];
}

export function createWixAdvertImageService({ environment = process.env, request = wixRequest } = {}) {
  const apiKey = clean(environment.WIX_FINANCE_API_KEY || environment.WIX_API_KEY);
  // Confirmation signatures use a backend-only key, never the browser access credential.
  const secret = apiKey;
  const configuration = { apiKey, siteId: SITE_ID, baseUrl: clean(environment.WIX_API_BASE_URL) || "https://www.wixapis.com" };
  if (!apiKey || !secret) throw new WixImageEditorError(500, "Wix image editing is not configured.");

  function scopeFor(input) {
    const registration = normalizeFinanceRegistration(input?.registration || "");
    const pipeline = clean(input?.pipeline);
    if (!registration || !WIX_ADVERT_IMAGE_LANES[pipeline]) throw new WixImageEditorError(400, "A valid registration and stock lane are required.");
    return { registration, pipeline, siteId: SITE_ID };
  }

  async function load(input) {
    const scope = scopeFor(input);
    const lane = WIX_ADVERT_IMAGE_LANES[scope.pipeline];
    const [listing, detail] = await Promise.all([
      queryRows(configuration, request, lane.listing, scope.registration),
      queryRows(configuration, request, lane.detail, scope.registration),
    ]);
    const gallery = detail.data[lane.gallery];
    if (!Array.isArray(gallery) || gallery.length > 80 || gallery.some((entry) => !wixGalleryImageSource(entry))) {
      throw new WixImageEditorError(409, "The current Wix gallery is missing or contains unsupported media. No images were changed.");
    }
    const state = { ...scope, listingId: listing.id, detailId: detail.id, picture: listing.data.picture ?? "", gallery,
      listingCollection: lane.listing, detailCollection: lane.detail, galleryField: lane.gallery, countField: lane.count,
      imageCount: fieldState(detail.data, lane.count), listingImage: fieldState(listing.data, "picture") };
    return { ...state, baseline: fingerprint(state), title: listing.data.vanDescription || listing.data.title,
      priceText: clean(listing.data.price ?? listing.data.priceVat), monthly: clean(listing.data.mth || listing.data.salePrice) };
  }

  function ticket(payload, purpose, scope, lifetime) {
    return sign({ ...payload, ...scope, purpose, expires: Date.now() + lifetime }, secret);
  }

  async function uploadedFile(scope, fileId) {
    const payload = await request(configuration, "/site-media/v1/files/get-file-by-id?fileId=" + encodeURIComponent(fileId), { method: "GET" });
    const file = payload.file;
    if (!file || file.id !== fileId || (file.siteId && file.siteId !== SITE_ID) || file.mediaType !== "IMAGE" || file.private === true
      || !/^https:\/\/static\.wixstatic\.com\/media\//i.test(file.url || "")) throw new WixImageEditorError(409, "Uploaded Wix image identity could not be verified.");
    return file;
  }

  async function proposal(input, snapshot) {
    if (input.baseline !== snapshot.baseline) throw new WixImageEditorError(409, "Wix images changed after this editor loaded. Reopen before reconciling.");
    if (!Array.isArray(input.images) || !input.images.length || input.images.length > 80) throw new WixImageEditorError(400, "Keep between 1 and 80 images in the proposed gallery.");
    const seen = new Set();
    const gallery = [];
    for (const image of input.images) {
      if (image?.kind === "existing" && Number.isInteger(image.index) && image.index >= 0 && image.index < snapshot.gallery.length) {
        const key = "existing:" + image.index;
        if (seen.has(key)) throw new WixImageEditorError(400, "A gallery image was proposed more than once.");
        seen.add(key); gallery.push(snapshot.gallery[image.index]);
      } else if (image?.kind === "upload") {
        const proof = readToken(image.token, secret, "uploaded_image", snapshot);
        if (seen.has(proof.fileId)) throw new WixImageEditorError(400, "An uploaded image was proposed more than once.");
        seen.add(proof.fileId);
        const file = await uploadedFile(snapshot, proof.fileId);
        if (file.operationStatus !== "READY" || file.url !== proof.url) throw new WixImageEditorError(409, "An uploaded image is not verified READY in Wix Media.");
        // Retain the live collection's gallery representation for new entries.
        const objectEntry = snapshot.gallery.find((entry) => entry && typeof entry === "object");
        gallery.push(objectEntry ? { type: "image", src: file.url, title: clean(file.displayName) } : file.url);
      } else throw new WixImageEditorError(400, "Only current Wix gallery entries and verified uploads can be reconciled.");
    }
    return { gallery, picture: wixGalleryImageSource(gallery[0]) };
  }

  async function prepareUpload(input) {
    const snapshot = await load(input);
    const mimeType = clean(input.mimeType).toLowerCase();
    const size = Number(input.sizeInBytes);
    if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType) || !Number.isSafeInteger(size) || size <= 0 || size > 10 * 1024 * 1024) {
      throw new WixImageEditorError(400, "Choose a JPEG, PNG or WebP image up to 10 MB.");
    }
    const extension = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" }[mimeType];
    const fileName = snapshot.registration + "-" + snapshot.pipeline + "-advert-" + randomUUID() + extension;
    const payload = await request(configuration, "/site-media/v1/files/generate-upload-url", {
      body: { mimeType, fileName, sizeInBytes: String(size), private: false },
    });
    if (!payload.uploadUrl) throw new WixImageEditorError(502, "Wix did not return an upload URL.");
    return { uploadUrl: payload.uploadUrl, mimeType, fileName, uploadTicket: ticket({ fileName }, "upload", snapshot, 60 * 60 * 1000) };
  }

  async function finishUpload(input) {
    const scope = scopeFor(input);
    await load(input);
    const proof = readToken(input.uploadTicket, secret, "upload", scope);
    const file = await uploadedFile(scope, clean(input.fileId));
    if (file.displayName !== proof.fileName) throw new WixImageEditorError(409, "This uploaded image does not belong to this vehicle/lane.");
    if (file.operationStatus !== "READY") return { ready: false, fileId: file.id, status: file.operationStatus || "UNKNOWN" };
    return { ready: true, fileId: file.id, url: file.url, token: ticket({ fileId: file.id, url: file.url }, "uploaded_image", scope, 24 * 60 * 60 * 1000) };
  }

  function fieldState(data, field) {
    return Object.hasOwn(data, field) ? { exists: true, value: data[field] } : { exists: false };
  }

  async function reconciliationState(input) {
    const snapshot = await load(input);
    const categories = await Promise.all(Object.entries(WIX_ADVERT_CATEGORY_IMAGE_FIELDS[snapshot.pipeline])
      .map(async ([collection, field]) => {
        const row = await queryRows(configuration, request, collection, snapshot.registration, true);
        return row ? { collection, id: row.id, fields: { [field]: fieldState(row.data, field) } } : null;
      }));
    const rows = [
      { collection: snapshot.detailCollection, id: snapshot.detailId,
        fields: { [snapshot.galleryField]: { exists: true, value: snapshot.gallery }, [snapshot.countField]: snapshot.imageCount } },
      { collection: snapshot.listingCollection, id: snapshot.listingId, fields: { picture: snapshot.listingImage } },
      ...categories.filter(Boolean),
    ];
    return { snapshot, rows };
  }

  async function prepare(input) {
    const { snapshot, rows } = await reconciliationState(input);
    const proposed = await proposal(input, snapshot);
    return { ...proposed, confirmation: ticket({ baseline: snapshot.baseline, proposal: fingerprint(proposed), targets: fingerprint(rows) },
      "reconcile", snapshot, 5 * 60 * 1000) };
  }

  async function patch(collection, itemId, fields) {
    await request(configuration, "/wix-data/v2/items/" + encodeURIComponent(itemId), {
      method: "PATCH", body: { dataCollectionId: collection, patch: { dataItemId: itemId,
        fieldModifications: Object.entries(fields).map(([fieldPath, state]) => state.exists
          ? { fieldPath, action: "SET_FIELD", setFieldOptions: { value: state.value } }
          : { fieldPath, action: "REMOVE_FIELD" }) } },
    });
  }

  async function reconcile(input) {
    const scope = scopeFor(input);
    if (input.confirmed !== true || normalizeFinanceRegistration(input.confirmRegistration || "") !== scope.registration) {
      throw new WixImageEditorError(400, "Confirm the image-only change and type the registration before reconciling.");
    }
    const proof = readToken(input.confirmation, secret, "reconcile", scope);
    const { snapshot, rows } = await reconciliationState(input);
    const proposed = await proposal(input, snapshot);
    if (proof.baseline !== snapshot.baseline || proof.proposal !== fingerprint(proposed) || proof.targets !== fingerprint(rows)) {
      throw new WixImageEditorError(409, "The confirmed images changed or category targets changed. Prepare again.");
    }
    const targets = rows.map((row) => {
      const desired = row.collection === snapshot.detailCollection
        ? { [snapshot.galleryField]: { exists: true, value: proposed.gallery },
          [snapshot.countField]: { exists: true, value: String(proposed.gallery.length) } }
        : Object.fromEntries(Object.keys(row.fields).map((field) => [field, { exists: true, value: proposed.picture }]));
      const fields = Object.fromEntries(Object.entries(desired).filter(([field, state]) => !same(state, row.fields[field])));
      return { ...row, fields, previous: Object.fromEntries(Object.keys(fields).map((field) => [field, row.fields[field]])) };
    }).filter((target) => Object.keys(target.fields).length);
    let expected = rows;
    const attempted = [];
    try {
      for (const target of targets) {
        const before = await reconciliationState(input);
        if (!same(before.rows, expected)) throw new WixImageEditorError(409, "Wix identity or images changed before the write.");
        attempted.push(target);
        // Gallery and count share one detail-row patch; category/canonical patches touch only their image field.
        await patch(target.collection, target.id, target.fields);
        expected = expected.map((row) => row.collection === target.collection && row.id === target.id
          ? { ...row, fields: { ...row.fields, ...target.fields } } : row);
      }
      const after = await reconciliationState(input);
      if (!same(after.rows, expected)) throw new WixImageEditorError(502, "The exact Wix image result could not be verified.");
      return { snapshot: after.snapshot, verified: true };
    } catch (error) {
      const rollback = [];
      for (const target of attempted.reverse()) {
        try {
          const fresh = await reconciliationState(input);
          const row = fresh.rows.find((item) => item.collection === target.collection && item.id === target.id);
          if (!row) throw new Error("Wix identity changed; automatic rollback is blocked.");
          const restore = {};
          for (const [field, original] of Object.entries(target.previous)) {
            const current = row.fields[field];
            if (same(current, original)) continue;
            if (!same(current, target.fields[field])) throw new Error("Wix images changed concurrently; automatic rollback is blocked.");
            restore[field] = original;
          }
          if (Object.keys(restore).length) await patch(target.collection, target.id, restore);
          const verified = await reconciliationState(input);
          const restored = verified.rows.find((item) => item.collection === target.collection && item.id === target.id);
          if (!restored || Object.entries(target.previous).some(([field, original]) => !same(restored.fields[field], original))) {
            throw new Error("Rollback could not be verified.");
          }
          rollback.push({ collection: target.collection, id: target.id, fields: Object.keys(target.previous), restored: true });
        } catch (rollbackError) {
          rollback.push({ collection: target.collection, id: target.id, fields: Object.keys(target.previous), restored: false, message: rollbackError.message });
        }
      }
      throw new WixImageEditorError(error.status || 502, "Wix image reconciliation failed. " + (rollback.some((item) => !item.restored)
        ? "A partial change needs manual attention." : "Completed image changes were rolled back."),
        { rollback, manualAttentionRequired: rollback.some((item) => !item.restored), cause: error.message });
    }
  }

  return { load, prepareUpload, finishUpload, prepare, reconcile };
}

export function createWixAdvertImageHandler(dependencies = {}) {
  return async function handler(request, response) {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    const environment = dependencies.environment || process.env;
    const secret = clean(environment.MARKETING_CUSTOMER_DATABASE_API_KEY);
    const supplied = clean(request.headers?.["x-marketing-customer-database-key"] || clean(request.headers?.authorization).replace(/^Bearer\s+/i, ""));
    if (!secret || supplied !== secret) return response.status(401).json({ ok: false, message: "Marketing CRM access is required." });
    if (!["GET", "POST"].includes(request.method)) return response.status(405).json({ ok: false, message: "Method not allowed." });
    try {
      const service = createWixAdvertImageService({ ...dependencies, environment });
      const input = request.method === "GET" ? request.query : request.body || {};
      const action = request.method === "GET" ? "load" : input.action;
      if (!["load", "prepareUpload", "finishUpload", "prepare", "reconcile"].includes(action)) throw new WixImageEditorError(400, "Unsupported image action.");
      const result = await service[action](input);
      return response.status(200).json({ ok: true, ...result });
    } catch (error) {
      return response.status(error.status || 502).json({ ok: false, message: error.message || "Wix image editing failed.", ...error.details });
    }
  };
}

export default createWixAdvertImageHandler();

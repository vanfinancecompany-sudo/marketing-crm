import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { normalizeFinanceRegistration } from "../lib/vanscoWixPrice.js";
import { registrationTitleVariants } from "../lib/wixRegistrationVariants.js";
import { WIX_ADVERT_IMAGE_LANES, WIX_ADVERT_CATEGORY_IMAGE_FIELDS, WIX_ADVERT_SECTION_LABELS, wixGalleryImageSource } from "../lib/wixAdvertImageEditor.js";

const SITE_ID = "85f11c52-ee54-495d-aaec-a351831709b5";
const clean = (value) => String(value ?? "").trim();
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const same = (left, right) => JSON.stringify(stable(left)) === JSON.stringify(stable(right));
const fingerprint = (value) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");

export class WixImageEditorError extends Error {
  constructor(status, message, details = {}) { super(message); this.status = status; this.details = details; }
}

function editorLogger(environment, logger, traceId) {
  const write = logger || ((entry) => console.info(JSON.stringify(entry)));
  const secrets = [environment.WIX_FINANCE_API_KEY, environment.WIX_API_KEY, environment.MARKETING_CUSTOMER_DATABASE_API_KEY].filter(Boolean);
  return (event, fields = {}) => {
    const entry = { service: "wix-advert-images", traceId, event, ...fields };
    if (entry.message) {
      let message = clean(entry.message);
      for (const secret of secrets) message = message.split(String(secret)).join("[redacted]");
      entry.message = message.replace(/%7B\S+|https?:\/\/\S+/gi, "[redacted]").slice(0,800);
    }
    // Only explicitly supplied metadata is logged: never request bodies, URLs, tokens or binary data.
    try { write(entry); } catch {}
  };
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
    throw new WixImageEditorError(409, "Wix image confirmation is invalid. Click Update Wix images again.");
  }
  let value;
  try { value = JSON.parse(decodeURIComponent(text)); } catch { throw new WixImageEditorError(409, "Invalid Wix image confirmation."); }
  if (value.purpose !== purpose || value.registration !== scope.registration || value.pipeline !== scope.pipeline
    || value.siteId !== SITE_ID || !Number.isFinite(value.expires) || value.expires < Date.now()) {
    throw new WixImageEditorError(409, "Wix image confirmation is expired or belongs to another vehicle/lane. Click Update Wix images again.");
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
  if (optional) {
    if (rows.length === 0) return [];
    const classified = rows.map((row) => ({
      row,
      status: clean(row.data?._publishStatus || row._publishStatus).toUpperCase(),
    }));
    const unknown = classified.filter((item) => !["PUBLISHED", "DRAFT"].includes(item.status));
    if (unknown.length) {
      throw new WixImageEditorError(409, "The Wix category in " + collection + " could not be verified as published. No images were changed.");
    }
    return classified.filter((item) => item.status === "PUBLISHED").map((item) => item.row);
  }
  if (rows.length !== 1) {
    throw new WixImageEditorError(409, "The Wix listing/detail identity is missing or ambiguous. No images were changed.");
  }
  const status = clean(rows[0].data?._publishStatus || rows[0]._publishStatus).toUpperCase();
  if (status !== "PUBLISHED") {
    throw new WixImageEditorError(409, "Both Wix listing and detail must be verified as published. No images were changed.");
  }
  return rows[0];
}

export function createWixAdvertImageService({ environment = process.env, request = wixRequest, logger, traceId = randomUUID() } = {}) {
  const emit = editorLogger(environment, logger, traceId);
  let logScope = {};
  const apiKey = clean(environment.WIX_FINANCE_API_KEY || environment.WIX_API_KEY);
  // Confirmation signatures use a backend-only key, never the browser access credential.
  const secret = apiKey;
  const configuration = { apiKey, siteId: SITE_ID, baseUrl: clean(environment.WIX_API_BASE_URL) || "https://www.wixapis.com" };
  if (!apiKey || !secret) throw new WixImageEditorError(500, "Wix image editing is not configured.");

  function scopeFor(input) {
    const registration = normalizeFinanceRegistration(input?.registration || "");
    const pipeline = clean(input?.pipeline);
    if (!registration || !Object.hasOwn(WIX_ADVERT_IMAGE_LANES, pipeline)) throw new WixImageEditorError(400, "A valid registration and stock lane are required.");
    logScope = { registration, pipeline };
    return { registration, pipeline, siteId: SITE_ID };
  }

  async function loadSnapshot(input) {
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
    const advertUrl = clean(listing.data.webLink || listing.data.weblink || listing.data.websiteLink || listing.data.vehicleUrl
      || listing.data.link || listing.data.url || Object.entries(listing.data).find(([key, value]) => key.startsWith("link-") && typeof value === "string")?.[1]);
    const state = { ...scope, listingId: listing.id, detailId: detail.id, picture: listing.data.picture ?? "", gallery,
      listingCollection: lane.listing, detailCollection: lane.detail, galleryField: lane.gallery, countField: lane.count,
      imageCount: fieldState(detail.data, lane.count), listingImage: fieldState(listing.data, "picture") };
    return { ...state, baseline: fingerprint(state), title: listing.data.vanDescription || listing.data.mitsubishiL200Barbarian || detail.data.titleText || listing.data.title,
      advertUrl: /^https?:\/\//i.test(advertUrl) ? advertUrl : "",
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
    if (input.baseline !== snapshot.baseline) throw new WixImageEditorError(409, "Wix images changed after this editor loaded. Reopen before updating Wix images.");
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
    const snapshot = await loadSnapshot(input);
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

  function generatedUploadNameForScope(scope, value) {
    const fileName = clean(value);
    const prefix = scope.registration + "-" + scope.pipeline + "-advert-";
    if (!fileName.startsWith(prefix)) return "";
    const suffix = fileName.slice(prefix.length);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i.test(suffix)
      ? fileName
      : "";
  }

  async function finishUpload(input) {
    const scope = scopeFor(input);
    await loadSnapshot(input);
    const file = await uploadedFile(scope, clean(input.fileId));
    let expectedFileName = "";
    if (typeof input.uploadTicket === "string" && input.uploadTicket) {
      expectedFileName = readToken(input.uploadTicket, secret, "upload", scope).fileName;
    } else {
      expectedFileName = generatedUploadNameForScope(scope, file.displayName);
      if (!expectedFileName) throw new WixImageEditorError(409, "Wix image confirmation is missing or invalid.");
      if (clean(input.fileName) && clean(input.fileName) !== file.displayName) {
        throw new WixImageEditorError(409, "This uploaded image does not belong to this vehicle/lane.");
      }
      emit("upload_ticket_recovered", { ...logScope, method: "verified_wix_generated_filename" });
    }
    if (file.displayName !== expectedFileName) throw new WixImageEditorError(409, "This uploaded image does not belong to this vehicle/lane.");
    if (file.operationStatus !== "READY") return { ready: false, fileId: file.id, status: file.operationStatus || "UNKNOWN" };
    return { ready: true, fileId: file.id, url: file.url, token: ticket({ fileId: file.id, url: file.url }, "uploaded_image", scope, 24 * 60 * 60 * 1000) };
  }

  function fieldState(data, field) {
    return Object.hasOwn(data, field) ? { exists: true, value: data[field] } : { exists: false };
  }

  async function reconciliationState(input) {
    const snapshot = await loadSnapshot(input);
    const categories = await Promise.all(Object.entries(WIX_ADVERT_CATEGORY_IMAGE_FIELDS[snapshot.pipeline])
      .map(async ([collection, field]) => {
        const categoryRows = await queryRows(configuration, request, collection, snapshot.registration, true);
        return categoryRows.map((row) => ({ collection, id: row.id, fields: { [field]: fieldState(row.data, field) } }));
      }));
    const rows = [
      { collection: snapshot.detailCollection, id: snapshot.detailId,
        fields: { [snapshot.galleryField]: { exists: true, value: snapshot.gallery }, [snapshot.countField]: snapshot.imageCount } },
      { collection: snapshot.listingCollection, id: snapshot.listingId, fields: { picture: snapshot.listingImage } },
      ...categories.flat(),
    ];
    return { snapshot, rows };
  }

  function destinationsFor({ snapshot, rows }, selected) {
    const byCollection = new Map();
    for (const row of rows.filter((item) => item.collection !== snapshot.detailCollection)) {
      if (!byCollection.has(row.collection)) byCollection.set(row.collection, []);
      byCollection.get(row.collection).push(row);
    }
    return [...byCollection.entries()].map(([collection, collectionRows]) => ({
      collectionId: collection,
      itemId: collectionRows[0].id,
      itemIds: collectionRows.map((row) => row.id),
      label: WIX_ADVERT_SECTION_LABELS[collection] || collection,
      imageField: Object.keys(collectionRows[0].fields)[0],
      required: collection === snapshot.listingCollection,
      currentImage: Object.values(collectionRows[0].fields)[0].value || "",
      selected: !selected || selected.includes(collection),
    }));
  }

  function selectedDestinations(input, { snapshot, rows }) {
    const available = [...new Set(rows.filter((row) => row.collection !== snapshot.detailCollection).map((row) => row.collection))];
    const selected = input.selectedDestinations ?? available;
    if (!Array.isArray(selected) || selected.some((id) => typeof id !== "string" || !available.includes(id))
      || new Set(selected).size !== selected.length || !selected.includes(snapshot.listingCollection)) {
      throw new WixImageEditorError(409, "Select only existing published Wix sections and keep the required canonical listing selected.");
    }
    return available.filter((id) => selected.includes(id));
  }

  function galleryDestination(snapshot) {
    return { collectionId: snapshot.detailCollection, itemId: snapshot.detailId, field: snapshot.galleryField,
      countField: snapshot.countField, label: WIX_ADVERT_IMAGE_LANES[snapshot.pipeline].label + " vehicle gallery" };
  }

  async function load(input) {
    const state = await reconciliationState(input);
    return { ...state.snapshot, destinations: destinationsFor(state), galleryDestination: galleryDestination(state.snapshot) };
  }

  async function prepare(input) {
    const { snapshot, rows } = await reconciliationState(input);
    const proposed = await proposal(input, snapshot);
    const selection = selectedDestinations(input, { snapshot, rows });
    return { ...proposed, imageCount: proposed.gallery.length, destinations: destinationsFor({ snapshot, rows }, selection),
      galleryDestination: galleryDestination(snapshot), confirmation: ticket({ baseline: snapshot.baseline, proposal: fingerprint(proposed), targets: fingerprint(rows), selection: fingerprint(selection) },
      "reconcile", snapshot, 5 * 60 * 1000) };
  }

  async function patch(collection, itemId, fields, phase = "apply") {
    await request(configuration, "/wix-data/v2/items/" + encodeURIComponent(itemId), {
      method: "PATCH", body: { dataCollectionId: collection, patch: { dataItemId: itemId,
        fieldModifications: Object.entries(fields).map(([fieldPath, state]) => state.exists
          ? { fieldPath, action: "SET_FIELD", setFieldOptions: { value: state.value } }
          : { fieldPath, action: "REMOVE_FIELD" }) } },
    });
    emit("wix_write_succeeded", { ...logScope, phase, collectionId: collection, itemId, fields: Object.keys(fields) });
  }

  async function reconcile(input) {
    const scope = scopeFor(input);
    if (input.confirmed !== true) {
      throw new WixImageEditorError(400, "Confirm the Wix image update before continuing.");
    }
    const proof = readToken(input.confirmation, secret, "reconcile", scope);
    const { snapshot, rows } = await reconciliationState(input);
    const proposed = await proposal(input, snapshot);
    const selection = selectedDestinations(input, { snapshot, rows });
    if (proof.baseline !== snapshot.baseline || proof.proposal !== fingerprint(proposed) || proof.targets !== fingerprint(rows) || proof.selection !== fingerprint(selection)) {
      throw new WixImageEditorError(409, "The confirmed images changed or category targets changed. Click Update Wix images again.");
    }
    const targets = rows.filter((row) => row.collection === snapshot.detailCollection || selection.includes(row.collection)).map((row) => {
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
      emit("reconciliation_verification", { ...logScope, outcome: "success", imageCount: proposed.gallery.length,
        listingCollections: selection, detailCollection: snapshot.detailCollection, writeCount: targets.length });
      return { snapshot: { ...after.snapshot, destinations: destinationsFor(after), galleryDestination: galleryDestination(after.snapshot) }, verified: true };
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
          if (Object.keys(restore).length) await patch(target.collection, target.id, restore, "rollback");
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
      emit("reconciliation_verification", { ...logScope, outcome: "failed", status: error.status || 502,
        message: error.message, manualAttentionRequired: rollback.some((item) => !item.restored),
        rollback: rollback.map(({ collection, id, fields, restored }) => ({ collection, id, fields, restored })) });
      throw new WixImageEditorError(error.status || 502, "Wix image update failed: " + error.message + ". " + (rollback.some((item) => !item.restored)
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
    const traceId = randomUUID();
    const emit = editorLogger(environment, dependencies.logger, traceId);
    const inputForLog = request.method === "GET" ? request.query || {} : request.body || {};
    const knownActions = ["load", "prepareUpload", "finishUpload", "prepare", "reconcile"];
    const actionForLog = request.method === "GET" ? "load" : knownActions.includes(inputForLog.action) ? inputForLog.action : "unknown";
    const logScope = { action: actionForLog, registration: normalizeFinanceRegistration(inputForLog.registration || ""),
      pipeline: Object.hasOwn(WIX_ADVERT_IMAGE_LANES, inputForLog.pipeline) ? inputForLog.pipeline : "unknown" };
    emit("action_started", logScope);
    try {
      const service = createWixAdvertImageService({ ...dependencies, environment, traceId });
      const input = request.method === "GET" ? request.query : request.body || {};
      const action = request.method === "GET" ? "load" : input.action;
      if (!["load", "prepareUpload", "finishUpload", "prepare", "reconcile"].includes(action)) throw new WixImageEditorError(400, "Unsupported image action.");
      if (action === "finishUpload") {
        emit("finish_upload_request_shape", {
          ...logScope,
          bodyKeys: Object.keys(input || {}).sort(),
          hasFileId: typeof input.fileId === "string" && input.fileId.length > 0,
          fileId: typeof input.fileId === "string" ? input.fileId : "",
          hasFileName: typeof input.fileName === "string" && input.fileName.length > 0,
          fileNameLength: typeof input.fileName === "string" ? input.fileName.length : 0,
          hasUploadTicket: typeof input.uploadTicket === "string" && input.uploadTicket.length > 0,
          uploadTicketLength: typeof input.uploadTicket === "string" ? input.uploadTicket.length : 0,
        });
      }
      const result = await service[action](input);
      if (action === "prepareUpload") {
        emit("prepare_upload_response_shape", {
          ...logScope,
          resultKeys: Object.keys(result || {}).sort(),
          hasFileName: typeof result.fileName === "string" && result.fileName.length > 0,
          fileNameLength: typeof result.fileName === "string" ? result.fileName.length : 0,
          hasUploadTicket: typeof result.uploadTicket === "string" && result.uploadTicket.length > 0,
          uploadTicketLength: typeof result.uploadTicket === "string" ? result.uploadTicket.length : 0,
        });
      }
      emit("action_completed", { ...logScope, status: 200,
        ...(action === "reconcile" ? { verified: result.verified } : {}),
        ...(action === "finishUpload" ? { ready: result.ready } : {}),
        ...(Array.isArray(result.gallery || result.snapshot?.gallery) ? { imageCount: (result.gallery || result.snapshot.gallery).length } : {}) });
      return response.status(200).json({ ok: true, ...result });
    } catch (error) {
      emit("action_failed", { ...logScope, status: error.status || 502, message: error.message });
      return response.status(error.status || 502).json({ ok: false, message: error.message || "Wix image editing failed.", ...error.details });
    }
  };
}

export default createWixAdvertImageHandler();

import test from "node:test";
import assert from "node:assert/strict";
import { createWixAdvertImageService, createWixAdvertImageHandler } from "../api/wix-advert-images.js";
import { WIX_ADVERT_IMAGE_LANES, createWixImageDraft, appendWixImage, moveWixImage, removeWixImage, wixImageProposal } from "../lib/wixAdvertImageEditor.js";

const registration = "OY72YSJ";
const environment = { MARKETING_CUSTOMER_DATABASE_API_KEY: "test-editor-key", WIX_API_KEY: "test-wix-key" };
const urls = ["https://static.wixstatic.com/media/van.jpg", "https://static.wixstatic.com/media/inside.jpg", "https://static.wixstatic.com/media/rear.jpg"];
const uploadedUrl = "https://static.wixstatic.com/media/due-in-soon.jpg";
const copy = (value) => JSON.parse(JSON.stringify(value));

function fixture(pipeline, gallery = urls) {
  const lane = WIX_ADVERT_IMAGE_LANES[pipeline];
  const untouched = { price: "£18,995", salePrice: "£333", vanDescription: "Existing vehicle description", categories: ["existing"], engine: "2.0", _publishStatus: "PUBLISHED" };
  const rows = {
    [lane.listing]: [{ id: "listing-" + pipeline, data: { ...copy(untouched), title: "OY72 YSJ", picture: urls[0] } }],
    [lane.detail]: [{ id: "detail-" + pipeline, data: { ...copy(untouched), title: "OY72YSJ", [lane.gallery]: copy(gallery), numberOfImages: "unchanged" } }],
  };
  const calls = [];
  const files = {};
  let fileCounter = 0;
  const state = { failListingOnce: false, mutateThenFail: false, beforePatch: null };
  const request = async (configuration, path, options = {}) => {
    assert.equal(configuration.siteId, "85f11c52-ee54-495d-aaec-a351831709b5");
    calls.push({ path, ...copy(options) });
    if (path === "/wix-data/v2/items/query") {
      const { dataCollectionId, query } = options.body;
      assert.ok(dataCollectionId === lane.listing || dataCollectionId === lane.detail, "Never query another product collection");
      const result = rows[dataCollectionId].filter((row) => row.data.title === query.filter.title.$eq);
      return { dataItems: copy(result.slice(query.paging.offset, query.paging.offset + query.paging.limit)) };
    }
    if (path === "/site-media/v1/files/generate-upload-url") {
      const fileId = "uploaded-" + (++fileCounter);
      files[fileId] = { id: fileId, displayName: options.body.fileName, mediaType: "IMAGE", operationStatus: "READY", siteId: configuration.siteId, url: uploadedUrl, private: false };
      return { uploadUrl: "https://upload.example/" + fileId };
    }
    if (path.startsWith("/site-media/v1/files/get-file-by-id?")) return { file: copy(files[decodeURIComponent(path.split("fileId=")[1])] || {}) };
    if (options.method === "PATCH") {
      const { dataCollectionId, patch } = options.body;
      assert.ok(dataCollectionId === lane.listing || dataCollectionId === lane.detail);
      assert.equal(patch.fieldModifications.length, 1, "Patch exactly one image field");
      const field = patch.fieldModifications[0];
      assert.equal(field.action, "SET_FIELD");
      assert.equal(field.fieldPath, dataCollectionId === lane.listing ? "picture" : lane.gallery);
      const row = rows[dataCollectionId].find((item) => item.id === patch.dataItemId);
      assert.ok(row, "Only an existing verified ID can be updated");
      if (state.beforePatch) await state.beforePatch(dataCollectionId);
      const shouldFail = dataCollectionId === lane.listing && state.failListingOnce;
      if (shouldFail) state.failListingOnce = false;
      if (!shouldFail || state.mutateThenFail) row.data[field.fieldPath] = copy(field.setFieldOptions.value);
      if (shouldFail) throw new Error("Simulated failed listing patch");
      return { dataItem: copy(row) };
    }
    throw new Error("Unexpected request; CMS creates/publish-status tasks/DealerKit are forbidden: " + path);
  };
  return { pipeline, lane, rows, calls, files, state, request, service: createWixAdvertImageService({ environment, request }),
    input: { registration, pipeline }, untouched, writes: () => calls.filter((call) => call.method === "PATCH") };
}

async function upload(f) {
  const prepared = await f.service.prepareUpload({ ...f.input, mimeType: "image/jpeg", sizeInBytes: 1200, fileName: "Due in Soon.jpg" });
  const fileId = prepared.uploadUrl.split("/").pop();
  return { prepared, fileId, media: await f.service.finishUpload({ ...f.input, fileId, uploadTicket: prepared.uploadTicket }) };
}
async function confirm(f, draft) {
  const proposal = { ...f.input, ...wixImageProposal(draft) };
  const prepared = await f.service.prepare(proposal);
  return f.service.reconcile({ ...proposal, confirmation: prepared.confirmation, confirmRegistration: registration, confirmed: true });
}

for (const pipeline of Object.keys(WIX_ADVERT_IMAGE_LANES)) {
  test(pipeline + " loads the exact stored Wix gallery without DealerKit and reconciles only the two image fields", async () => {
    const f = fixture(pipeline);
    const originalRows = copy(f.rows);
    const snapshot = await f.service.load(f.input);
    assert.deepEqual(snapshot.gallery, urls);
    assert.equal(snapshot.picture, urls[0]);
    const draft = createWixImageDraft(snapshot);
    assert.deepEqual(draft.items.map((item) => item.src), urls);
    const { media } = await upload(f);
    appendWixImage(draft, media);
    assert.deepEqual(draft.items.map((item) => item.src), [...urls, uploadedUrl], "Upload appends without replacing primary");
    moveWixImage(draft, draft.items[3].key, draft.items[1].key);
    removeWixImage(draft, "existing-2");
    assert.deepEqual(draft.items.map((item) => item.src), [urls[0], uploadedUrl, urls[1]]);
    assert.equal(f.writes().length, 0, "Opening, uploading, reordering and removal do not write the vehicle CMS");
    const prepared = await f.service.prepare({ ...f.input, ...wixImageProposal(draft) });
    assert.deepEqual(prepared.gallery, [urls[0], uploadedUrl, urls[1]]);
    assert.equal(f.writes().length, 0, "Prepare does not write CMS");
    await assert.rejects(() => f.service.reconcile({ ...f.input, ...wixImageProposal(draft), confirmation: prepared.confirmation, confirmRegistration: registration }), /Confirm/);
    assert.equal(f.writes().length, 0);
    const result = await confirm(f, draft);
    assert.equal(result.verified, true);
    assert.deepEqual(f.rows[f.lane.detail][0].data[f.lane.gallery], [urls[0], uploadedUrl, urls[1]]);
    assert.equal(f.rows[f.lane.listing][0].data.picture, urls[0], "Keep current primary while inserting image #2");
    assert.deepEqual(f.writes().map((write) => write.body.dataCollectionId), [f.lane.detail, f.lane.listing]);
    for (const collection of [f.lane.listing, f.lane.detail]) {
      const original = copy(originalRows[collection][0].data);
      const actual = copy(f.rows[collection][0].data);
      const imageField = collection === f.lane.listing ? "picture" : f.lane.gallery;
      delete original[imageField]; delete actual[imageField];
      assert.deepEqual(actual, original, "Price, description, categories, vehicle data and image-count helpers are untouched");
    }
    assert.ok(f.calls.every((call) => /^(\/wix-data\/|\/site-media\/)/.test(call.path)));
  });

  test(pipeline + " final gallery position #1 controls the listing picture and complete stored order", async () => {
    const f = fixture(pipeline, [urls[0]]);
    const snapshot = await f.service.load(f.input);
    const draft = createWixImageDraft(snapshot);
    appendWixImage(draft, (await upload(f)).media);
    assert.equal(draft.items[0].src, urls[0], "OY72YSJ upload leaves the original van first");
    moveWixImage(draft, draft.items[1].key, draft.items[0].key);
    await confirm(f, draft);
    assert.equal(f.rows[f.lane.listing][0].data.picture, uploadedUrl);
    assert.deepEqual(f.rows[f.lane.detail][0].data[f.lane.gallery], [uploadedUrl, urls[0]]);
  });
}

test("object gallery metadata and duplicate stored images retain their exact current order and representation", async () => {
  const entries = [{ type: "image", src: "wix:image://v1/a/van.jpg", title: "Van", description: "Original caption", custom: { keep: true } }, { type: "image", src: urls[1], title: "Inside" }, { type: "image", src: urls[1], title: "Same image with another caption" }];
  const f = fixture("finance", entries);
  const snapshot = await f.service.load(f.input);
  assert.deepEqual(snapshot.gallery, entries);
  const draft = createWixImageDraft(snapshot);
  const media = (await upload(f)).media;
  appendWixImage(draft, media);
  moveWixImage(draft, "existing-2", "existing-0");
  removeWixImage(draft, "existing-1");
  const expected = [entries[2], entries[0], { type: "image", src: uploadedUrl, title: f.files[media.fileId].displayName }];
  await confirm(f, draft);
  assert.deepEqual(f.rows[f.lane.detail][0].data.mainImages, expected);
  assert.equal(f.rows[f.lane.listing][0].data.picture, urls[1]);
});

test("missing, draft, malformed or ambiguous Wix listing/detail identities fail closed before any write or upload", async () => {
  for (const target of ["listing", "detail"]) {
    for (const condition of ["missing", "ambiguous", "draft", "no-id"]) {
      const f = fixture("cars"); const collection = f.lane[target];
      if (condition === "missing") f.rows[collection] = [];
      if (condition === "ambiguous") f.rows[collection].push({ ...copy(f.rows[collection][0]), id: "duplicate", data: { ...copy(f.rows[collection][0].data), title: "OY72 YSJ" } });
      if (condition === "draft") f.rows[collection][0].data._publishStatus = "DRAFT";
      if (condition === "no-id") delete f.rows[collection][0].id;
      await assert.rejects(() => f.service.load(f.input), /missing or ambiguous|published|unverified/);
      await assert.rejects(() => f.service.prepareUpload({ ...f.input, mimeType: "image/jpeg", sizeInBytes: 100 }), /missing or ambiguous|published|unverified/);
      assert.equal(f.writes().length, 0);
      assert.ok(!f.calls.some((call) => call.path.includes("generate-upload-url")));
    }
  }
  const service = createWixAdvertImageService({ environment, request: async () => ({}) });
  await assert.rejects(() => service.load({ registration, pipeline: "finance" }), /incomplete/);
});

test("arbitrary images, empty galleries, stale previews and changed proposals cannot be written", async () => {
  const f = fixture("finance");
  const draft = createWixImageDraft(await f.service.load(f.input));
  const input = { ...f.input, ...wixImageProposal(draft) };
  await assert.rejects(() => f.service.prepare({ ...input, images: [{ kind: "url", url: "https://images.example/dealerkit.jpg" }] }), /Only current Wix/);
  await assert.rejects(() => f.service.prepare({ ...input, images: [] }), /Keep between/);
  const prepared = await f.service.prepare(input);
  await assert.rejects(() => f.service.reconcile({ ...input, confirmation: prepared.confirmation, confirmed: true, confirmRegistration: "OTHER" }), /Confirm/);
  await assert.rejects(() => f.service.reconcile({ ...input, images: [{ kind: "existing", index: 1 }], confirmation: prepared.confirmation, confirmed: true, confirmRegistration: registration }), /confirmed images changed/);
  f.rows[f.lane.detail][0].data.mainImages.push(uploadedUrl);
  await assert.rejects(() => f.service.reconcile({ ...input, confirmation: prepared.confirmation, confirmed: true, confirmRegistration: registration }), /changed after/);
  assert.equal(f.writes().length, 0);
});

test("upload and reconciliation confirmations cannot cross product lanes or registrations or be forged", async () => {
  const f = fixture("finance");
  const rent = fixture("rent2buy");
  const { media, prepared, fileId } = await upload(f);
  rent.files[fileId] = f.files[fileId];
  await assert.rejects(() => rent.service.finishUpload({ ...rent.input, fileId, uploadTicket: prepared.uploadTicket }), /another vehicle\/lane/);
  const rentDraft = createWixImageDraft(await rent.service.load(rent.input));
  appendWixImage(rentDraft, media);
  await assert.rejects(() => rent.service.prepare({ ...rent.input, ...wixImageProposal(rentDraft) }), /another vehicle\/lane/);
  const draft = createWixImageDraft(await f.service.load(f.input));
  const input = { ...f.input, ...wixImageProposal(draft) };
  const preview = await f.service.prepare(input);
  await assert.rejects(() => f.service.reconcile({ ...input, confirmation: preview.confirmation + "x", confirmed: true, confirmRegistration: registration }), /invalid/);
  assert.equal(f.writes().length + rent.writes().length, 0);
});

test("only READY, public images from the correct Wix Media site and upload ticket may be appended", async () => {
  const f = fixture("finance");
  const prepared = await f.service.prepareUpload({ ...f.input, mimeType: "image/png", sizeInBytes: 500 });
  const fileId = prepared.uploadUrl.split("/").pop();
  f.files[fileId].operationStatus = "PROCESSING";
  assert.equal((await f.service.finishUpload({ ...f.input, fileId, uploadTicket: prepared.uploadTicket })).ready, false);
  f.files[fileId].operationStatus = "READY";
  f.files[fileId].displayName = "a-different-upload.jpg";
  await assert.rejects(() => f.service.finishUpload({ ...f.input, fileId, uploadTicket: prepared.uploadTicket }), /does not belong/);
  f.files[fileId].displayName = prepared.fileName;
  f.files[fileId].siteId = "other-site";
  await assert.rejects(() => f.service.finishUpload({ ...f.input, fileId, uploadTicket: prepared.uploadTicket }), /could not be verified/);
  assert.equal(f.writes().length, 0);
});

test("a failed listing patch restores the image-only detail write, including an uncertain applied listing write", async () => {
  for (const mutateThenFail of [false, true]) {
    const f = fixture("finance");
    const original = copy(f.rows);
    const draft = createWixImageDraft(await f.service.load(f.input));
    moveWixImage(draft, "existing-1", "existing-0");
    const proposal = { ...f.input, ...wixImageProposal(draft) };
    const prepared = await f.service.prepare(proposal);
    f.state.failListingOnce = true; f.state.mutateThenFail = mutateThenFail;
    let error;
    try { await f.service.reconcile({ ...proposal, confirmation: prepared.confirmation, confirmRegistration: registration, confirmed: true }); } catch (caught) { error = caught; }
    assert.ok(error);
    assert.equal(error.details.manualAttentionRequired, false);
    assert.deepEqual(f.rows, original);
  }
});

test("the HTTP endpoint is authenticated and rejects non-confirmed writes without DealerKit or Supabase credentials", async () => {
  const f = fixture("finance");
  const handler = createWixAdvertImageHandler({ environment, request: f.request });
  function response() { return { code: 0, payload: null, setHeader() {}, status(code) { this.code = code; return this; }, json(payload) { this.payload = payload; return this; } }; }
  const denied = response();
  await handler({ method: "GET", headers: {}, query: f.input }, denied);
  assert.equal(denied.code, 401);
  const res = response();
  await handler({ method: "GET", headers: { "x-marketing-customer-database-key": environment.MARKETING_CUSTOMER_DATABASE_API_KEY }, query: f.input }, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.payload.gallery, urls);
  const noConfirmation = response();
  await handler({ method: "POST", headers: { "x-marketing-customer-database-key": environment.MARKETING_CUSTOMER_DATABASE_API_KEY }, body: { ...f.input, action: "reconcile" } }, noConfirmation);
  assert.equal(noConfirmation.code, 400);
  assert.equal(f.writes().length, 0);
});

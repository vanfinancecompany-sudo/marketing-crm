import test from "node:test";
import assert from "node:assert/strict";
import { createWixAdvertImageService, createWixAdvertImageHandler } from "../api/wix-advert-images.js";
import { WIX_ADVERT_IMAGE_LANES, WIX_ADVERT_CATEGORY_IMAGE_FIELDS, createWixImageDraft, appendWixImage, prependWixImages, moveWixImage, removeWixImage, wixImageProposal } from "../lib/wixAdvertImageEditor.js";

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
    [lane.detail]: [{ id: "detail-" + pipeline, data: { ...copy(untouched), title: "OY72YSJ", [lane.gallery]: copy(gallery), [lane.count]: "old-count" } }],
  };
  for (const collection of Object.keys(WIX_ADVERT_CATEGORY_IMAGE_FIELDS[pipeline])) rows[collection] = [];
  const calls = [];
  const logs = [];
  const files = {};
  let fileCounter = 0;
  const state = { failListingOnce: false, failCollectionOnce: "", mutateThenFail: false, beforePatch: null, beforeQuery: null };
  const request = async (configuration, path, options = {}) => {
    assert.equal(configuration.siteId, "85f11c52-ee54-495d-aaec-a351831709b5");
    calls.push({ path, ...copy(options) });
    if (path === "/wix-data/v2/items/query") {
      const { dataCollectionId, query } = options.body;
      assert.ok(Object.hasOwn(rows, dataCollectionId), "Never query another product collection");
      if (state.beforeQuery) await state.beforeQuery(dataCollectionId);
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
      assert.ok(Object.hasOwn(rows, dataCollectionId), "Never patch another lane");
      const allowed = dataCollectionId === lane.detail ? [lane.gallery, lane.count]
        : [dataCollectionId === lane.listing ? "picture" : WIX_ADVERT_CATEGORY_IMAGE_FIELDS[pipeline][dataCollectionId]];
      assert.ok(patch.fieldModifications.length > 0 && patch.fieldModifications.length <= allowed.length);
      assert.equal(new Set(patch.fieldModifications.map((field) => field.fieldPath)).size, patch.fieldModifications.length);
      for (const field of patch.fieldModifications) {
        assert.ok(allowed.includes(field.fieldPath), "Patch only image fields/count, never unrelated data");
        assert.ok(["SET_FIELD", "REMOVE_FIELD"].includes(field.action));
      }
      const row = rows[dataCollectionId].find((item) => item.id === patch.dataItemId);
      assert.ok(row, "Only an existing verified ID can be updated");
      if (state.beforePatch) await state.beforePatch(dataCollectionId);
      const shouldFail = (dataCollectionId === lane.listing && state.failListingOnce) || dataCollectionId === state.failCollectionOnce;
      if (shouldFail) { state.failListingOnce = false; state.failCollectionOnce = ""; }
      if (!shouldFail || state.mutateThenFail) {
        // Query aliases of the same Wix ID refer to one underlying item.
        for (const alias of rows[dataCollectionId].filter((item) => item.id === patch.dataItemId)) {
          for (const field of patch.fieldModifications) {
            if (field.action === "REMOVE_FIELD") delete alias.data[field.fieldPath];
            else alias.data[field.fieldPath] = copy(field.setFieldOptions.value);
          }
        }
      }
      if (shouldFail) throw new Error("Simulated failed image patch");
      return { dataItem: copy(row) };
    }
    throw new Error("Unexpected request; CMS creates/publish-status tasks/DealerKit are forbidden: " + path);
  };
  return { pipeline, lane, rows, calls, logs, files, state, request, service: createWixAdvertImageService({ environment, request, logger: (entry) => logs.push(entry) }),
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
  return f.service.reconcile({ ...proposal, confirmation: prepared.confirmation, confirmed: true });
}

test("a selected upload batch is inserted ahead of the existing Wix gallery in selection order", async () => {
  const f = fixture("finance");
  const draft = createWixImageDraft(await f.service.load(f.input));
  const first = (await upload(f)).media;
  const second = (await upload(f)).media;
  prependWixImages(draft, [first, second]);
  assert.deepEqual(draft.items.slice(0, 2).map((item) => item.key), ["upload-" + first.fileId, "upload-" + second.fileId]);
  assert.deepEqual(draft.items.slice(2).map((item) => item.src), urls);
  await confirm(f, draft);
  assert.equal(f.rows[f.lane.listing][0].data.picture, first.url, "The first selected upload becomes Primary");
  assert.deepEqual(f.rows[f.lane.detail][0].data[f.lane.gallery].slice(2), urls, "Existing Wix images stay behind the new upload batch");
});

for (const pipeline of Object.keys(WIX_ADVERT_IMAGE_LANES)) {
  test(pipeline + " loads the exact stored Wix gallery without DealerKit and reconciles only image fields and the image count", async () => {
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
    await assert.rejects(() => f.service.reconcile({ ...f.input, ...wixImageProposal(draft), confirmation: prepared.confirmation }), /Confirm/);
    assert.equal(f.writes().length, 0);
    const result = await confirm(f, draft);
    assert.equal(result.verified, true);
    assert.deepEqual(f.rows[f.lane.detail][0].data[f.lane.gallery], [urls[0], uploadedUrl, urls[1]]);
    assert.equal(f.rows[f.lane.listing][0].data.picture, urls[0], "Keep current primary while inserting image #2");
    assert.deepEqual(f.writes().map((write) => write.body.dataCollectionId), [f.lane.detail], "Unchanged listing primary is not rewritten");
    assert.equal(f.rows[f.lane.detail][0].data[f.lane.count], "3");
    for (const collection of [f.lane.listing, f.lane.detail]) {
      const original = copy(originalRows[collection][0].data);
      const actual = copy(f.rows[collection][0].data);
      const imageField = collection === f.lane.listing ? "picture" : f.lane.gallery;
      delete original[imageField]; delete actual[imageField];
      if (collection === f.lane.detail) { delete original[f.lane.count]; delete actual[f.lane.count]; }
      assert.deepEqual(actual, original, "Price, description, categories and vehicle data are untouched");
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
  await assert.rejects(() => f.service.reconcile({ ...input, confirmation: prepared.confirmation, confirmed: false }), /Confirm/);
  await assert.rejects(() => f.service.reconcile({ ...input, images: [{ kind: "existing", index: 1 }], confirmation: prepared.confirmation, confirmed: true }), /confirmed images changed/);
  f.rows[f.lane.detail][0].data.mainImages.push(uploadedUrl);
  await assert.rejects(() => f.service.reconcile({ ...input, confirmation: prepared.confirmation, confirmed: true }), /changed after/);
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
  await assert.rejects(() => f.service.reconcile({ ...input, confirmation: preview.confirmation + "x", confirmed: true }), /invalid/);
  assert.equal(f.writes().length + rent.writes().length, 0);
});

test("only READY, public images from the correct Wix Media site and scoped upload proof may be appended", async () => {
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

test("a missing browser upload ticket recovers from the verified Wix-generated vehicle filename", async () => {
  const f = fixture("finance");
  const prepared = await f.service.prepareUpload({ ...f.input, mimeType: "image/jpeg", sizeInBytes: 500 });
  const fileId = prepared.uploadUrl.split("/").pop();

  const recovered = await f.service.finishUpload({ ...f.input, fileId });
  assert.equal(recovered.ready, true);
  assert.equal(recovered.fileId, fileId);
  assert.ok(recovered.token);
  assert.ok(f.logs.some((entry) => entry.event === "upload_ticket_recovered"));

  await assert.rejects(() => f.service.finishUpload({
    ...f.input,
    fileId,
    fileName: prepared.fileName.replace(registration, "ZZ99ZZZ"),
  }), /does not belong/);

  const rent = fixture("rent2buy");
  rent.files[fileId] = copy(f.files[fileId]);
  await assert.rejects(() => rent.service.finishUpload({ ...rent.input, fileId }), /missing or invalid/);

  f.files[fileId].displayName = "random-upload.jpg";
  await assert.rejects(() => f.service.finishUpload({ ...f.input, fileId }), /missing or invalid/);
  assert.equal(f.writes().length + rent.writes().length, 0);
});

test("a failed listing patch restores the image-only detail write, including an uncertain applied listing write", async () => {
  for (const pipeline of ["finance", "rent2buy", "cars"]) {
  for (const mutateThenFail of [false, true]) {
    const f = fixture(pipeline);
    const original = copy(f.rows);
    const draft = createWixImageDraft(await f.service.load(f.input));
    moveWixImage(draft, "existing-1", "existing-0");
    const proposal = { ...f.input, ...wixImageProposal(draft) };
    const prepared = await f.service.prepare(proposal);
    f.state.failListingOnce = true; f.state.mutateThenFail = mutateThenFail;
    let error;
    try { await f.service.reconcile({ ...proposal, confirmation: prepared.confirmation, confirmed: true }); } catch (caught) { error = caught; }
    assert.ok(error);
    assert.equal(error.details.manualAttentionRequired, false);
    assert.deepEqual(f.rows, original);
  }
  }
});

test("the HTTP endpoint is authenticated and rejects non-confirmed writes without DealerKit or Supabase credentials", async () => {
  const f = fixture("finance");
  const handler = createWixAdvertImageHandler({ environment, request: f.request, logger: (entry) => f.logs.push(entry) });
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


function addCategories(f) {
  let index = 0;
  for (const [collection, field] of Object.entries(WIX_ADVERT_CATEGORY_IMAGE_FIELDS[f.pipeline])) {
    f.rows[collection] = [{ id: "category-" + index, data: { ...copy(f.untouched),
      title: index++ % 2 ? "OY72YSJ" : "OY72 YSJ", [field]: urls[0],
      link: "https://existing.example/advert", custom: { keep: true } } }];
  }
}

for (const pipeline of ["finance", "rent2buy"]) {
  test(pipeline + " synchronises all published category cards to gallery #1 without touching unrelated fields", async () => {
    const f = fixture(pipeline); addCategories(f);
    const original = copy(f.rows);
    const draft = createWixImageDraft(await f.service.load(f.input));
    moveWixImage(draft, "existing-1", "existing-0");
    removeWixImage(draft, "existing-2");
    await confirm(f, draft);
    assert.equal(f.rows[f.lane.listing][0].data.picture, urls[1]);
    assert.deepEqual(f.rows[f.lane.detail][0].data[f.lane.gallery], [urls[1], urls[0]]);
    assert.equal(f.rows[f.lane.detail][0].data[f.lane.count], "2");
    for (const [collection, imageField] of Object.entries(WIX_ADVERT_CATEGORY_IMAGE_FIELDS[pipeline])) {
      assert.equal(f.rows[collection][0].data[imageField], urls[1], collection);
      const before = copy(original[collection][0].data), after = copy(f.rows[collection][0].data);
      delete before[imageField]; delete after[imageField];
      assert.deepEqual(after, before, collection + " preserves prices, descriptions, categories, links and all other fields");
      const writes = f.writes().filter((call) => call.body.dataCollectionId === collection);
      assert.equal(writes.length, 1);
      assert.deepEqual(writes[0].body.patch.fieldModifications.map((field) => field.fieldPath), [imageField]);
    }
    if (pipeline === "rent2buy") {
      assert.equal(f.rows.CREWVANS[0].data.image, urls[1]);
      assert.equal(Object.hasOwn(f.rows.CREWVANS[0].data, "picture"), false, "Never invent CREWVANS.picture");
    }
    const detailWrite = f.writes().find((call) => call.body.dataCollectionId === f.lane.detail);
    assert.deepEqual(detailWrite.body.patch.fieldModifications.map((field) => field.fieldPath), [f.lane.gallery, f.lane.count],
      "Ordered gallery and image count are committed in the same detail patch");
  });

  test(pipeline + " ignores absent and draft optional category rows without weakening mandatory identities", async () => {
    const f = fixture(pipeline);
    const [collection, field] = Object.entries(WIX_ADVERT_CATEGORY_IMAGE_FIELDS[pipeline])[0];
    f.rows[collection] = [{ id: "draft-category", data: { ...copy(f.untouched), title: "OY72YSJ", _publishStatus: "DRAFT", [field]: urls[2] } }];
    const originalCategory = copy(f.rows[collection]);
    const draft = createWixImageDraft(await f.service.load(f.input));
    moveWixImage(draft, "existing-1", "existing-0");
    await confirm(f, draft);
    assert.deepEqual(f.rows[collection], originalCategory, "Draft category image stays untouched");
    assert.deepEqual(f.writes().map((call) => call.body.dataCollectionId), [f.lane.detail, f.lane.listing]);
    assert.ok(f.calls.filter((call) => call.path === "/wix-data/v2/items/query").every((call) => Object.hasOwn(f.rows, call.body.dataCollectionId)));
  });

  test(pipeline + " updates every published category row for the same verified registration", async () => {
    for (const [collection, field] of Object.entries(WIX_ADVERT_CATEGORY_IMAGE_FIELDS[pipeline])) {
      const f = fixture(pipeline); addCategories(f);
      f.rows[collection] = [
        { id: "canonical-category", data: { ...copy(f.untouched), title: "OY72YSJ", [field]: urls[0] } },
        { id: "spaced-category", data: { ...copy(f.untouched), title: "OY72 YSJ", [field]: urls[0], _publishStatus: "PUBLISHED" } },
      ];
      const draft = createWixImageDraft(await f.service.load(f.input));
      moveWixImage(draft, "existing-1", "existing-0");
      await confirm(f, draft);

      assert.equal(f.rows[collection][0].data[field], urls[1]);
      assert.equal(f.rows[collection][1].data[field], urls[1]);
      assert.equal(
        f.writes().filter((call) => call.body.dataCollectionId === collection).length,
        2,
        collection + " updates both published duplicate category cards",
      );
    }
  });

  test(pipeline + " ignores a draft duplicate when exactly one category row is published", async () => {
    const f = fixture(pipeline); addCategories(f);
    const [collection, field] = Object.entries(WIX_ADVERT_CATEGORY_IMAGE_FIELDS[pipeline])[0];
    const published = { id: "published-category", data: { ...copy(f.untouched), title: "OY72YSJ", [field]: urls[0] } };
    const draftDuplicate = { id: "draft-category", data: { ...copy(f.untouched), title: "OY72 YSJ", [field]: urls[2], _publishStatus: "DRAFT" } };
    f.rows[collection] = [published, draftDuplicate];
    const originalDraft = copy(draftDuplicate);

    const draft = createWixImageDraft(await f.service.load(f.input));
    moveWixImage(draft, "existing-1", "existing-0");
    await confirm(f, draft);

    assert.equal(f.rows[collection].find((row) => row.id === "published-category").data[field], urls[1]);
    assert.deepEqual(f.rows[collection].find((row) => row.id === "draft-category"), originalDraft);
    assert.equal(
      f.writes().filter((call) => call.body.dataCollectionId === collection).length,
      1,
      "Only the single published category row is updated",
    );
  });

  test(pipeline + " deduplicates the same category ID seen under canonical/spaced title variants", async () => {
    const f = fixture(pipeline);
    const [collection, field] = Object.entries(WIX_ADVERT_CATEGORY_IMAGE_FIELDS[pipeline])[0];
    f.rows[collection] = ["OY72YSJ", "OY72 YSJ"].map((title) => ({ id: "same-category", data: { ...copy(f.untouched), title, [field]: urls[0] } }));
    const draft = createWixImageDraft(await f.service.load(f.input));
    moveWixImage(draft, "existing-1", "existing-0");
    await confirm(f, draft);
    assert.equal(f.writes().filter((call) => call.body.dataCollectionId === collection).length, 1);
  });

  test(pipeline + " restores gallery, count, canonical and earlier category images after a later category failure", async () => {
    for (const mutateThenFail of [false, true]) {
      for (const missingCount of [false, true]) {
        const f = fixture(pipeline); addCategories(f);
        if (missingCount) delete f.rows[f.lane.detail][0].data[f.lane.count];
        const original = copy(f.rows);
        const draft = createWixImageDraft(await f.service.load(f.input));
        moveWixImage(draft, "existing-1", "existing-0");
        removeWixImage(draft, "existing-2");
        const input = { ...f.input, ...wixImageProposal(draft) };
        const prepared = await f.service.prepare(input);
        f.state.failCollectionOnce = Object.keys(WIX_ADVERT_CATEGORY_IMAGE_FIELDS[pipeline]).at(-1);
        f.state.mutateThenFail = mutateThenFail;
        let error;
        try { await f.service.reconcile({ ...input, confirmation: prepared.confirmation, confirmed: true }); }
        catch (caught) { error = caught; }
        assert.ok(error);
        assert.equal(error.details.manualAttentionRequired, false);
        assert.deepEqual(f.rows, original, "Restore all touched fields, including original absence of the count");
        assert.equal(error.details.rollback.length, Object.keys(WIX_ADVERT_CATEGORY_IMAGE_FIELDS[pipeline]).length + 2);
        if (missingCount) assert.ok(f.writes().some((call) => call.body.dataCollectionId === f.lane.detail
          && call.body.patch.fieldModifications.some((field) => field.fieldPath === f.lane.count && field.action === "REMOVE_FIELD")));
      }
    }
  });
}

for (const pipeline of ["finance", "rent2buy", "cars"]) {
  test(pipeline + " keeps unchanged primary images untouched while correcting the detail count", async () => {
    const f = fixture(pipeline); addCategories(f);
    const draft = createWixImageDraft(await f.service.load(f.input));
    removeWixImage(draft, "existing-2");
    await confirm(f, draft);
    assert.equal(f.rows[f.lane.detail][0].data[f.lane.count], "2");
    assert.deepEqual(f.writes().map((call) => call.body.dataCollectionId), [f.lane.detail], "No redundant listing/category primary writes");
    for (const [collection, field] of Object.entries(WIX_ADVERT_CATEGORY_IMAGE_FIELDS[pipeline])) {
      assert.equal(f.rows[collection][0].data[field], urls[0]);
    }
    const nextDraft = createWixImageDraft(await f.service.load(f.input));
    f.calls.length = 0;
    await confirm(f, nextDraft);
    assert.equal(f.writes().length, 0, "Already consistent gallery/count/primary require no writes");
    if (pipeline === "cars") assert.ok(f.calls.every((call) => !call.body?.dataCollectionId || ["CARFINANCE", "CARPAGES"].includes(call.body.dataCollectionId)));
  });
}

test("new or changed published category identities invalidate confirmation before any write", async () => {
  const f = fixture("rent2buy");
  const draft = createWixImageDraft(await f.service.load(f.input));
  moveWixImage(draft, "existing-1", "existing-0");
  const input = { ...f.input, ...wixImageProposal(draft) };
  const prepared = await f.service.prepare(input);
  f.rows.CREWVANS = [{ id: "new-category", data: { ...copy(f.untouched), title: "OY72YSJ", image: urls[0] } }];
  await assert.rejects(() => f.service.reconcile({ ...input, confirmation: prepared.confirmation,
    confirmed: true }), /category targets changed/);
  assert.equal(f.writes().length, 0);
});

test("unverifiable category publication fails closed rather than treating it as absent", async () => {
  const f = fixture("finance");
  f.rows.AUTOMATIC = [{ id: "unknown-status", data: { title: "OY72YSJ", picture: urls[0] } }];
  await assert.rejects(() => f.service.load(f.input), /published/);
  assert.equal(f.writes().length, 0);
});


test("published destinations and header facts come only from the verified current Wix rows", async () => {
  for (const pipeline of ["finance", "rent2buy", "cars"]) {
    const f = fixture(pipeline); addCategories(f);
    f.rows[f.lane.listing][0].data.webLink = "https://live.example/" + pipeline;
    const snapshot = await f.service.load(f.input);
    assert.equal(snapshot.title, f.untouched.vanDescription);
    assert.equal(snapshot.priceText, f.untouched.price);
    assert.equal(snapshot.advertUrl, "https://live.example/" + pipeline);
    assert.equal(snapshot.galleryDestination.collectionId, f.lane.detail);
    assert.equal(snapshot.galleryDestination.field, f.lane.gallery);
    assert.deepEqual(snapshot.destinations.map((item) => item.collectionId), [f.lane.listing, ...Object.keys(WIX_ADVERT_CATEGORY_IMAGE_FIELDS[pipeline])]);
    assert.ok(snapshot.destinations.every((item) => item.selected));
    assert.equal(snapshot.destinations.filter((item) => item.required).length, 1);
    assert.equal(snapshot.destinations[0].collectionId, f.lane.listing);
    if (pipeline === "finance") assert.ok(snapshot.destinations.some((item) => item.label === "Medium / MWB"));
    if (pipeline === "rent2buy") assert.equal(snapshot.destinations.find((item) => item.collectionId === "CREWVANS").imageField, "image");
    if (pipeline === "cars") assert.deepEqual(snapshot.destinations.map((item) => item.collectionId), ["CARFINANCE"]);
    assert.equal(f.writes().length, 0);
  }
});

for (const pipeline of ["finance", "rent2buy"]) {
  test(pipeline + " updates only selected existing published destinations and never removes category membership", async () => {
    const f = fixture(pipeline); addCategories(f);
    const original = copy(f.rows);
    const draft = createWixImageDraft(await f.service.load(f.input));
    moveWixImage(draft, "existing-1", "existing-0");
    const chosen = Object.keys(WIX_ADVERT_CATEGORY_IMAGE_FIELDS[pipeline])[0];
    const input = { ...f.input, ...wixImageProposal(draft), selectedDestinations: [f.lane.listing, chosen] };
    const prepared = await f.service.prepare(input);
    assert.deepEqual(prepared.destinations.filter((item) => item.selected).map((item) => item.collectionId), [f.lane.listing, chosen]);
    assert.equal(f.writes().length, 0, "Update button preparation cannot publish");
    await f.service.reconcile({ ...input, confirmation: prepared.confirmation, confirmed: true });
    assert.deepEqual(f.writes().map((call) => call.body.dataCollectionId), [f.lane.detail, f.lane.listing, chosen]);
    for (const collection of Object.keys(WIX_ADVERT_CATEGORY_IMAGE_FIELDS[pipeline]).filter((id) => id !== chosen)) {
      assert.deepEqual(f.rows[collection], original[collection], "Unselected category remains present and unchanged");
    }
    assert.equal(f.rows[chosen][0].data[WIX_ADVERT_CATEGORY_IMAGE_FIELDS[pipeline][chosen]], urls[1]);
  });
}

test("required canonical destination cannot be unchecked and unknown, duplicate or cross-lane destinations cannot be written", async () => {
  for (const pipeline of ["finance", "rent2buy", "cars"]) {
    const f = fixture(pipeline); addCategories(f);
    const draft = createWixImageDraft(await f.service.load(f.input));
    const input = { ...f.input, ...wixImageProposal(draft) };
    for (const selectedDestinations of [[], ["invented-category"], [f.lane.listing, f.lane.listing],
      [f.lane.listing, pipeline === "cars" ? "VANFINANCE-ALLVANS" : "CARFINANCE"]]) {
      await assert.rejects(() => f.service.prepare({ ...input, selectedDestinations }), /existing published Wix sections/);
    }
    assert.equal(f.writes().length, 0);
  }
});

test("changing destination selection after prepare invalidates the signed confirmation before writes", async () => {
  const f = fixture("rent2buy"); addCategories(f);
  const draft = createWixImageDraft(await f.service.load(f.input));
  moveWixImage(draft, "existing-1", "existing-0");
  const input = { ...f.input, ...wixImageProposal(draft), selectedDestinations: [f.lane.listing, "CREWVANS"] };
  const prepared = await f.service.prepare(input);
  await assert.rejects(() => f.service.reconcile({ ...input, selectedDestinations: [f.lane.listing], confirmation: prepared.confirmation, confirmed: true }), /confirmed images changed/);
  assert.equal(f.writes().length, 0);
});

test("category target changes after prepare still block before any write", async () => {
  const f = fixture("finance"); addCategories(f);
  const draft = createWixImageDraft(await f.service.load(f.input));
  const input = { ...f.input, ...wixImageProposal(draft), selectedDestinations: [f.lane.listing] };
  const prepared = await f.service.prepare(input);
  f.rows.AUTOMATIC.push({ ...copy(f.rows.AUTOMATIC[0]), id: "second-auto", data: { ...copy(f.rows.AUTOMATIC[0].data), title: "OY72 YSJ" } });
  await assert.rejects(() => f.service.reconcile({ ...input, confirmation: prepared.confirmation, confirmed: true }), /category targets changed/);
  assert.equal(f.writes().length, 0);
});

test("the HTTP two-step update logs actions, writes and verification without keys, confirmation tokens or image data", async () => {
  const f = fixture("finance");
  const handler = createWixAdvertImageHandler({ environment, request: f.request, logger: (entry) => f.logs.push(entry) });
  const send = async (body) => {
    const response = { code: 0, payload: null, setHeader() {}, status(code) { this.code = code; return this; }, json(value) { this.payload = value; return this; } };
    await handler({ method: "POST", headers: { "x-marketing-customer-database-key": environment.MARKETING_CUSTOMER_DATABASE_API_KEY }, body: { ...f.input, ...body } }, response);
    assert.equal(response.code, 200, response.payload?.message);
    return response.payload;
  };
  const snapshot = await send({ action: "load" });
  const preparedUpload = await send({ action: "prepareUpload", mimeType: "image/jpeg", sizeInBytes: 1000 });
  const fileId = preparedUpload.uploadUrl.split("/").pop();
  const media = await send({ action: "finishUpload", uploadTicket: preparedUpload.uploadTicket, fileId });
  const draft = createWixImageDraft(snapshot); appendWixImage(draft, media); moveWixImage(draft, "existing-1", "existing-0");
  const input = { ...wixImageProposal(draft), selectedDestinations: [f.lane.listing] };
  const prepared = await send({ action: "prepare", ...input });
  assert.equal(f.writes().length, 0);
  assert.equal(f.logs.filter((entry) => entry.event === "wix_write_succeeded").length, 0);
  await send({ action: "reconcile", ...input, confirmation: prepared.confirmation, confirmed: true });
  assert.deepEqual(f.logs.filter((entry) => entry.event === "action_started").map((entry) => entry.action),
    ["load", "prepareUpload", "finishUpload", "prepare", "reconcile"]);
  assert.deepEqual(f.logs.filter((entry) => entry.event === "action_completed").map((entry) => entry.action),
    ["load", "prepareUpload", "finishUpload", "prepare", "reconcile"]);
  const reconcileTrace = f.logs.find((entry) => entry.event === "action_started" && entry.action === "reconcile").traceId;
  assert.ok(f.logs.filter((entry) => entry.event === "wix_write_succeeded").every((entry) => entry.traceId === reconcileTrace));
  const verification = f.logs.find((entry) => entry.event === "reconciliation_verification" && entry.outcome === "success");
  assert.equal(verification.traceId, reconcileTrace);
  assert.equal(verification.imageCount, 4);
  assert.equal(verification.registration, registration);
  const output = JSON.stringify(f.logs);
  for (const sensitive of [environment.WIX_API_KEY, environment.MARKETING_CUSTOMER_DATABASE_API_KEY, preparedUpload.uploadTicket,
    media.token, prepared.confirmation, uploadedUrl, "Due in Soon.jpg"]) assert.ok(!output.includes(sensitive), "Never log credentials, tokens or image data");
});

test("failed reconciliation logs exact failure and rollback state without implying verification success", async () => {
  const f = fixture("rent2buy"); addCategories(f);
  const draft = createWixImageDraft(await f.service.load(f.input));
  moveWixImage(draft, "existing-1", "existing-0");
  const input = { ...f.input, ...wixImageProposal(draft) };
  const prepared = await f.service.prepare(input);
  f.state.failCollectionOnce = "CREWVANS";
  await assert.rejects(() => f.service.reconcile({ ...input, confirmation: prepared.confirmation, confirmed: true }), /Simulated failed image patch/);
  const verification = f.logs.find((entry) => entry.event === "reconciliation_verification");
  assert.equal(verification.outcome, "failed");
  assert.equal(verification.manualAttentionRequired, false);
  assert.ok(f.logs.some((entry) => entry.event === "wix_write_succeeded" && entry.phase === "rollback"));
  assert.ok(!f.logs.some((entry) => entry.event === "reconciliation_verification" && entry.outcome === "success"));
});

test("logging redacts credentials and signed-token text even when a downstream error includes them", async () => {
  const logs = [];
  const message = environment.WIX_API_KEY + " " + environment.MARKETING_CUSTOMER_DATABASE_API_KEY + " %7Btoken%7D.signature";
  const handler = createWixAdvertImageHandler({ environment, logger: (entry) => logs.push(entry), request: async () => { throw new Error(message); } });
  const response = { setHeader() {}, status() { return this; }, json() {} };
  await handler({ method: "POST", headers: { "x-marketing-customer-database-key": environment.MARKETING_CUSTOMER_DATABASE_API_KEY },
    body: { registration, pipeline: "finance", action: "load" } }, response);
  const output = JSON.stringify(logs);
  assert.ok(output.includes("action_failed"));
  assert.ok(!output.includes(environment.WIX_API_KEY) && !output.includes(environment.MARKETING_CUSTOMER_DATABASE_API_KEY) && !output.includes("%7Btoken"));
});

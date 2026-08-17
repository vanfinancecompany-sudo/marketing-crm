import test from "node:test";
import assert from "node:assert/strict";
import { WixCmsClient } from "../lib/wixPublishing.js";
import {
  createWixDraftFromPublished,
  resolveWixDraftItemsCollectionId,
  wixClientForCollection,
} from "../lib/wixDraftPublishPluginSupport.js";

function makeClient(responsePayload) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    return { ok: true, status: 200, async json() { return responsePayload; } };
  };
  const client = new WixCmsClient({ apiBaseUrl: "https://www.wixapis.com", apiKey: "test", siteId: "site", collectionId: "Import3" }, fetchImpl);
  return { client, calls };
}

test("resolves the paired Draft Items collection from Wix collection plugins", () => {
  const payload = { dataCollection: { plugins: [{ type: "DRAFT_ITEMS", draftItemsOptions: { draftsCollectionId: "Import3__drafts" } }] } };
  assert.equal(resolveWixDraftItemsCollectionId(payload, "Import3"), "Import3__drafts");
});

test("refuses live writes when the Draft Items workflow is absent", () => {
  assert.throws(
    () => resolveWixDraftItemsCollectionId({ dataCollection: { plugins: [] } }, "Import3"),
    (error) => error.type === "configuration" && /Save changes as draft first/.test(error.message)
  );
});

test("creates a draft copy of a published item using the published collection id", async () => {
  const { client, calls } = makeClient({ dataItem: { id: "published-1" } });
  const result = await createWixDraftFromPublished(client, "published-1");
  assert.equal(result.id, "published-1");
  assert.equal(calls[0].options.method, "POST");
  assert.match(calls[0].url, /items\/create-draft$/);
  assert.deepEqual(calls[0].body, { dataCollectionId: "Import3", dataItemId: "published-1" });
});

test("creates a client scoped to the paired drafts collection", () => {
  const { client } = makeClient({});
  const draftClient = wixClientForCollection(client, "Import3__drafts");
  assert.equal(draftClient.configuration.collectionId, "Import3__drafts");
  assert.equal(draftClient.fetchImpl, client.fetchImpl);
});

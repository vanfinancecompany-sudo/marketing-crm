import test from "node:test";
import assert from "node:assert/strict";
import { WixCmsClient } from "../lib/wixPublishing.js";
import "../lib/wixDraftPublishPluginSupport.js";

function makeClient(responsePayload) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    return { ok: true, status: 200, async json() { return responsePayload; } };
  };
  const client = new WixCmsClient({ apiBaseUrl: "https://www.wixapis.com", apiKey: "test", siteId: "site", collectionId: "Import3" }, fetchImpl);
  return { client, calls };
}

test("query includes draft Publish plugin option", async () => {
  const { client, calls } = makeClient({ dataItems: [{ id: "draft-1" }] });
  await client.find("crmArticleId", "article-1");
  assert.deepEqual(calls[0].body.publishPluginOptions, { includeDraftItems: true });
  assert.equal(calls[0].body.consistentRead, true);
});

test("update includes draft Publish plugin option", async () => {
  const { client, calls } = makeClient({ dataItem: { id: "draft-1" } });
  await client.update("draft-1", { title: "Updated" });
  assert.equal(calls[0].options.method, "PUT");
  assert.deepEqual(calls[0].body.publishPluginOptions, { includeDraftItems: true });
  assert.deepEqual(calls[0].body.dataItem, { id: "draft-1", data: { title: "Updated" } });
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildKnowledgeWixRichContent,
  createOrUpdateKnowledgeRichContentDraft,
} from "../lib/wixKnowledgeRichContentPublishing.js";

const configuration = {
  apiKey: "test-key",
  siteId: "site-id",
  collectionId: "Import3",
  apiBaseUrl: "https://www.wixapis.com",
  dashboardUrl: "https://manage.wix.com/dashboard/site-id/database/Import3",
};

const article = (extra = {}) => ({
  id: "article-1",
  status: "approved",
  title: "Test Knowledge Article",
  slug: "test-knowledge-article",
  excerpt: "A short test excerpt.",
  content_markdown: "## What should you check?\n\nCheck the exact vehicle before deciding.",
  seo_title: "Test Knowledge Article",
  meta_description: "A test Knowledge Hub article used to verify Wix draft publishing.",
  category: "Vehicle Guides",
  cta: "Browse current used vans.",
  wix_item_id: null,
  ...extra,
});

function jsonResponse(status, payload) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}

function schemaResponse() {
  return jsonResponse(200, {
    dataCollection: {
      id: "Import3",
      fields: [{ key: "content", type: "RICH_CONTENT" }],
      plugins: [{ type: "DRAFT_ITEMS", draftItemsOptions: { draftsCollectionId: "Import3__drafts" } }],
    },
  });
}

function callBody(options = {}) { return options.body ? JSON.parse(options.body) : null; }

test("new Knowledge Hub article is created only on the real Wix drafts surface", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const body = callBody(options);
    calls.push({ url, method: options.method || "GET", body });
    if (url.endsWith("/collections/Import3")) return schemaResponse();
    if (url.endsWith("/items/query")) return jsonResponse(200, { dataItems: [] });
    if (url.endsWith("/items") && options.method === "POST") return jsonResponse(200, { dataItem: { id: article().id } });
    throw new Error(`Unexpected request ${options.method} ${url}`);
  };

  const result = await createOrUpdateKnowledgeRichContentDraft({ article: article(), configuration, fetchImpl });

  const createCall = calls.find((call) => call.url.endsWith("/items") && call.method === "POST");
  assert.equal(createCall.body.dataCollectionId, "Import3__drafts");
  assert.equal(createCall.body.dataItem.id, article().id);
  assert.equal(result.draftCollectionId, "Import3__drafts");
  assert.equal(result.serverState, "DRAFT");
  assert.equal(calls.some((call) => call.method === "PUT" && call.body?.dataCollectionId === "Import3"), false);
});

test("existing published Knowledge Hub article is copied to draft then edited on the draft surface", async () => {
  const calls = [];
  let publishedQueryCount = 0;
  const fetchImpl = async (url, options = {}) => {
    const body = callBody(options);
    calls.push({ url, method: options.method || "GET", body });
    if (url.endsWith("/collections/Import3")) return schemaResponse();
    if (url.endsWith("/items/query")) {
      if (body.dataCollectionId === "Import3__drafts") return jsonResponse(200, { dataItems: [] });
      if (body.dataCollectionId === "Import3") {
        publishedQueryCount += 1;
        return jsonResponse(200, publishedQueryCount === 1
          ? { dataItems: [{ id: "published-1", data: { crmArticleId: article().id, slug: article().slug } }] }
          : { dataItems: [] });
      }
    }
    if (url.endsWith("/items/create-draft")) return jsonResponse(200, { dataItem: { id: "published-1" } });
    if (url.endsWith("/items/published-1") && options.method === "PUT") return jsonResponse(200, { dataItem: { id: "published-1" } });
    throw new Error(`Unexpected request ${options.method} ${url}`);
  };

  const result = await createOrUpdateKnowledgeRichContentDraft({ article: article(), configuration, fetchImpl });

  const seed = calls.find((call) => call.url.endsWith("/items/create-draft"));
  const update = calls.find((call) => call.url.endsWith("/items/published-1") && call.method === "PUT");
  assert.deepEqual(seed.body, { dataCollectionId: "Import3", dataItemId: "published-1" });
  assert.equal(update.body.dataCollectionId, "Import3__drafts");
  assert.equal(result.serverState, "CHANGED");
  assert.equal(result.operation, "updated");
  assert.equal(calls.some((call) => call.method === "PUT" && call.body?.dataCollectionId === "Import3"), false);
});

test("manual Wix featured image survives a CRM draft refresh", async () => {
  const calls = [];
  const manualImage = "wix:image://v1/manual-image/article.jpg";
  const draftRecord = {
    id: article().id,
    data: {
      crmArticleId: article().id,
      slug: article().slug,
      featuredImage: manualImage,
    },
  };
  const fetchImpl = async (url, options = {}) => {
    const body = callBody(options);
    calls.push({ url, method: options.method || "GET", body });
    if (url.endsWith("/collections/Import3")) return schemaResponse();
    if (url.endsWith("/items/query")) {
      if (body.dataCollectionId === "Import3__drafts" && body.query.filter.crmArticleId) return jsonResponse(200, { dataItems: [draftRecord] });
      if (body.dataCollectionId === "Import3") return jsonResponse(200, { dataItems: [{ id: article().id, data: { crmArticleId: article().id, slug: article().slug } }] });
      return jsonResponse(200, { dataItems: [] });
    }
    if (url.endsWith(`/items/${article().id}`) && options.method === "PUT") return jsonResponse(200, { dataItem: { id: article().id } });
    throw new Error(`Unexpected request ${options.method} ${url}`);
  };

  const result = await createOrUpdateKnowledgeRichContentDraft({ article: article({ featured_image: "" }), configuration, fetchImpl });
  const update = calls.find((call) => call.url.endsWith(`/items/${article().id}`) && call.method === "PUT");
  assert.equal(update.body.dataCollectionId, "Import3__drafts");
  assert.equal(update.body.dataItem.data.featuredImage, manualImage);
  assert.equal(result.diagnostics.preserved_manual_featured_image, true);
  assert.equal(result.serverState, "CHANGED");
});

test("draft sender refuses to write when Wix draft-first workflow is not enabled", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/collections/Import3")) {
      return jsonResponse(200, { dataCollection: { id: "Import3", fields: [{ key: "content", type: "RICH_CONTENT" }], plugins: [] } });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  await assert.rejects(
    createOrUpdateKnowledgeRichContentDraft({ article: article(), configuration, fetchImpl }),
    (error) => error.type === "configuration" && /Refusing to write/.test(error.message)
  );
});

test("existing Next step section prevents a second automatic CTA section", () => {
  const result = buildKnowledgeWixRichContent(
    "## Next step\n\nUse your measurements when you browse current used vans.",
    [],
    "Browse current used vans."
  );
  const nextStepHeadings = result.richContent.nodes.filter((node) =>
    node.type === "HEADING" && node.nodes?.some((child) => /^Next step$/i.test(child.textData?.text || ""))
  );
  assert.equal(nextStepHeadings.length, 1);
  assert.equal(result.diagnostics.duplicate_next_step_prevented, true);
});

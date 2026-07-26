import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  WixPublishingError,
  acceptedInternalLinks,
  buildWixArticleData,
  buildWixPlainTextContent,
  createOrUpdateWixDraft,
  resolveWixContentFieldType,
  validateWixArticle,
  wixPublishingConfiguration,
} from "../lib/wixPublishing.js";
import {
  publishKnowledgeArticleToWix,
} from "../api/marketing-wix-publishing.js";
import wixPublishingHandler from "../api/marketing-wix-publishing.js";

const approvedArticle = (extra = {}) => ({
  id: "c4333e79-ced5-47ff-b8f1-caa3c485c321",
  status: "approved",
  title: "Understanding Medium Wheelbase Vans",
  slug: "understanding-medium-wheelbase-vans",
  excerpt: "A practical guide to choosing a medium wheelbase van.",
  content_markdown: "# Medium wheelbase vans\n\nMedium Wheelbase Vans balance load space and manoeuvrability.",
  seo_title: "Medium Wheelbase Vans: Business Guide",
  meta_description: "Understand medium wheelbase vans, their capacity and how to choose the right vehicle for your business.",
  category: "Vehicle Guides",
  cta: "Browse suitable vans when you are ready.",
  featured_image: "wix:image://v1/abc123/medium-van.jpg",
  wix_item_id: null,
  ...extra,
});

const suggestions = [
  {
    id: "accepted",
    status: "accepted",
    anchor_text: "Medium Wheelbase Vans",
    destination_url: "/van-finance-mwb-vans",
  },
  {
    id: "rejected",
    status: "rejected",
    anchor_text: "Privacy Policy",
    destination_url: "/privacy-policy",
  },
  {
    id: "pending",
    status: "pending",
    anchor_text: "Apply Now",
    destination_url: "/apply",
  },
];

const configuration = {
  apiKey: "secret-wix-key",
  siteId: "site-id",
  collectionId: "Import3",
  apiBaseUrl: "https://www.wixapis.com",
  dashboardUrl: "https://manage.wix.com/dashboard/site-id/database/Import3",
};

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

function collectionResponse(type = "RICH_CONTENT") {
  return jsonResponse(200, {
    dataCollection: {
      id: "Import3",
      fields: [{ key: "content", type }],
    },
  });
}

test("only approved and complete articles can be exported", () => {
  assert.throws(
    () => validateWixArticle(approvedArticle({ status: "draft" })),
    (error) => error instanceof WixPublishingError && error.type === "validation"
  );
  assert.throws(
    () => validateWixArticle(approvedArticle({ meta_description: "" })),
    /Meta description/
  );
});

test("missing Wix configuration is explicit and credentials are server-only", () => {
  assert.throws(
    () => wixPublishingConfiguration({ WIX_SITE_ID: "site" }),
    (error) =>
      error.type === "configuration" &&
      error.message.includes("WIX_API_KEY") &&
      error.message.includes("WIX_KNOWLEDGE_COLLECTION_ID")
  );
  const configured = wixPublishingConfiguration({
    WIX_API_KEY: "server-secret",
    WIX_SITE_ID: "site",
    WIX_KNOWLEDGE_COLLECTION_ID: "Import3",
  });
  assert.equal(configured.collectionId, "Import3");
});

test("payload transfers rich content, image and SEO while including accepted links only", () => {
  const data = buildWixArticleData(approvedArticle(), suggestions);
  assert.equal(data.title, "Understanding Medium Wheelbase Vans");
  assert.equal(data.slug, "understanding-medium-wheelbase-vans");
  assert.equal(data.seoTitle, "Medium Wheelbase Vans: Business Guide");
  assert.match(data.metaDescription, /medium wheelbase vans/i);
  assert.equal(data.featuredImage, "wix:image://v1/abc123/medium-van.jpg");
  assert.equal(data.crmArticleId, approvedArticle().id);
  assert.equal(data.syncStatus, "Draft");
  assert.equal(data.content.metadata.version, 1);
  assert.equal(data.content.nodes.some((node) => node.type === "HEADING"), true);
  const serialized = JSON.stringify(data.content);
  assert.match(serialized, /van-finance-mwb-vans/);
  assert.doesNotMatch(serialized, /privacy-policy/);
  assert.doesNotMatch(serialized, /\"\/apply\"/);
  assert.deepEqual(acceptedInternalLinks(suggestions).map((item) => item.url), ["/van-finance-mwb-vans"]);
});

test("Wix collection schema resolves Text and Rich Content without guessing", () => {
  assert.equal(resolveWixContentFieldType({
    dataCollection: { fields: [{ key: "content", type: "TEXT" }] },
  }), "TEXT");
  assert.equal(resolveWixContentFieldType({
    dataCollection: { fields: [{ key: "content", type: "RICH_CONTENT" }] },
  }), "RICH_CONTENT");
  assert.throws(
    () => resolveWixContentFieldType({
      dataCollection: { fields: [{ key: "content", type: "IMAGE" }] },
    }),
    (error) => error.type === "configuration" && /Text or Rich Content/.test(error.message)
  );
});

test("Text content preserves readable headings, lists and accepted links as plain text", () => {
  const article = approvedArticle({
    content_markdown:
      "# Medium Wheelbase Vans\n\nChoose a **medium van**.\n\n- Easy to park\n- Useful load space\n\nSee Medium Wheelbase Vans.",
  });
  const content = buildWixArticleData(article, suggestions, "TEXT").content;
  assert.equal(typeof content, "string");
  assert.match(content, /^Medium Wheelbase Vans/m);
  assert.match(content, /• Easy to park/);
  assert.match(content, /Medium Wheelbase Vans \(\/van-finance-mwb-vans\)/);
  assert.match(content, /Next step\nBrowse suitable vans when you are ready\./);
  assert.doesNotMatch(content, /privacy-policy|RichContent|\"nodes\"/);
  assert.equal(
    content,
    buildWixPlainTextContent(article.content_markdown, suggestions, article.cta)
  );
});

test("Create Wix Draft queries duplicate safeguards then inserts into Import3", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    if (url.includes("/collections/Import3")) return collectionResponse();
    if (url.endsWith("/query")) return jsonResponse(200, { dataItems: [] });
    return jsonResponse(200, { dataItem: { id: "wix-created-item" } });
  };
  const result = await createOrUpdateWixDraft({
    article: approvedArticle(),
    suggestions,
    configuration,
    fetchImpl,
  });
  assert.equal(result.operation, "created");
  assert.equal(result.itemId, "wix-created-item");
  assert.equal(calls.length, 4);
  assert.match(calls[0].url, /collections\/Import3$/);
  assert.equal(calls[1].body.query.filter.crmArticleId.$eq, approvedArticle().id);
  assert.equal(calls[2].body.query.filter.slug.$eq, approvedArticle().slug);
  assert.equal(calls[3].body.dataCollectionId, "Import3");
  assert.equal(calls[3].body.dataItem.id, approvedArticle().id);
  assert.equal(calls[3].body.dataItem.data.content.nodes.length > 0, true);
  assert.equal(calls[3].options.headers.Authorization, "secret-wix-key");
  assert.equal(JSON.stringify(result).includes("secret-wix-key"), false);
});

test("Create Wix Draft sends a string when Wix reports a Text content field", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    if (url.includes("/collections/Import3")) return collectionResponse("TEXT");
    if (url.endsWith("/query")) return jsonResponse(200, { dataItems: [] });
    return jsonResponse(200, { dataItem: { id: "wix-text-item" } });
  };
  const result = await createOrUpdateWixDraft({
    article: approvedArticle(),
    suggestions,
    configuration,
    fetchImpl,
  });
  assert.equal(result.contentFieldType, "TEXT");
  assert.equal(typeof calls.at(-1).body.dataItem.data.content, "string");
  assert.match(calls.at(-1).body.dataItem.data.content, /Medium Wheelbase Vans \(\/van-finance-mwb-vans\)/i);
  assert.doesNotMatch(calls.at(-1).body.dataItem.data.content, /privacy-policy/);
});

test("Update Wix Draft uses the stored Wix item and never creates another", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    if (url.includes("/collections/Import3")) return collectionResponse();
    return jsonResponse(200, { dataItem: { id: "existing-wix-item" } });
  };
  const result = await createOrUpdateWixDraft({
    article: approvedArticle({ wix_item_id: "existing-wix-item" }),
    suggestions,
    configuration,
    fetchImpl,
  });
  assert.equal(result.operation, "updated");
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /items\/existing-wix-item$/);
  assert.equal(calls[1].options.method, "PUT");
});

test("crmArticleId duplicate protection recovers an existing item before creating", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, options, body });
    if (url.includes("/collections/Import3")) return collectionResponse();
    if (url.endsWith("/query")) {
      return jsonResponse(200, {
        dataItems: [{ id: "recovered-item", data: { crmArticleId: approvedArticle().id } }],
      });
    }
    return jsonResponse(200, { dataItem: { id: "recovered-item" } });
  };
  const result = await createOrUpdateWixDraft({
    article: approvedArticle(),
    configuration,
    fetchImpl,
  });
  assert.equal(result.operation, "updated");
  assert.equal(result.itemId, "recovered-item");
  assert.equal(calls.length, 3);
  assert.equal(calls[2].options.method, "PUT");
});

test("a concurrent deterministic insert conflict updates the same Wix item", async () => {
  const calls = [];
  let queryCount = 0;
  const fetchImpl = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, options, body });
    if (url.includes("/collections/Import3")) return collectionResponse();
    if (url.endsWith("/query")) {
      queryCount += 1;
      return jsonResponse(200, { dataItems: [] });
    }
    if (options.method === "POST") return jsonResponse(409, { message: "Already exists" });
    return jsonResponse(200, { dataItem: { id: approvedArticle().id } });
  };
  const result = await createOrUpdateWixDraft({
    article: approvedArticle(),
    configuration,
    fetchImpl,
  });
  assert.equal(result.operation, "updated");
  assert.equal(result.itemId, approvedArticle().id);
  assert.equal(queryCount, 3);
  assert.match(calls.at(-1).url, new RegExp(`${approvedArticle().id}$`));
  assert.equal(calls.at(-1).options.method, "PUT");
});

test("Wix authentication failures are classified without returning credentials", async () => {
  await assert.rejects(
    createOrUpdateWixDraft({
      article: approvedArticle({ wix_item_id: "existing" }),
      configuration,
      fetchImpl: async (url) =>
        url.includes("/collections/Import3")
          ? collectionResponse()
          : jsonResponse(403, { message: "Forbidden secret-wix-key" }),
    }),
    (error) =>
      error.type === "authentication" &&
      error.message === "Wix rejected the API credentials or site access." &&
      !error.message.includes("secret-wix-key")
  );
});

function mockSupabase(initialArticle) {
  const state = {
    article: { ...initialArticle },
    links: suggestions,
    events: [],
  };
  function builder(table) {
    const query = { table, operation: "select", values: null, filters: [] };
    const api = {
      select() { query.operation = query.operation === "update" ? "update_select" : "select"; return api; },
      update(values) { query.operation = "update"; query.values = values; return api; },
      insert(values) { query.operation = "insert"; query.values = values; return api; },
      eq(field, value) { query.filters.push([field, value]); return api; },
      single() { return Promise.resolve(execute()); },
      then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
    };
    function execute() {
      if (table === "knowledge_articles" && query.operation === "select") {
        return { data: { ...state.article }, error: null };
      }
      if (table === "knowledge_articles" && query.operation.startsWith("update")) {
        state.article = { ...state.article, ...query.values };
        return { data: query.operation === "update_select" ? { ...state.article } : null, error: null };
      }
      if (table === "knowledge_internal_link_suggestions") {
        return {
          data: state.links.filter((item) =>
            query.filters.every(([field, value]) => item[field] === value)
          ),
          error: null,
        };
      }
      if (table === "knowledge_editorial_events" && query.operation === "insert") {
        state.events.push(query.values);
        return { data: query.values, error: null };
      }
      return { data: null, error: new Error(`Unexpected mock query for ${table}`) };
    }
    return api;
  }
  return { client: { from: builder }, state };
}

test("successful result saves Wix item, sync state and audit event in the CRM", async () => {
  const { client, state } = mockSupabase(approvedArticle());
  const fetchImpl = async (url) => {
    if (url.includes("/collections/Import3")) return collectionResponse("TEXT");
    if (url.endsWith("/query")) return jsonResponse(200, { dataItems: [] });
    return jsonResponse(200, { dataItem: { id: "saved-wix-item" } });
  };
  const result = await publishKnowledgeArticleToWix({
    supabase: client,
    articleId: approvedArticle().id,
    environment: {
      WIX_API_KEY: "secret",
      WIX_SITE_ID: "site-id",
      WIX_KNOWLEDGE_COLLECTION_ID: "Import3",
    },
    fetchImpl,
  });
  assert.equal(result.article.wix_item_id, "saved-wix-item");
  assert.equal(result.article.wix_collection_id, "Import3");
  assert.equal(result.article.wix_sync_status, "synced");
  assert.equal(result.article.wix_last_error, "");
  assert.equal(result.wix.published, false);
  assert.equal(result.wix.content_field_type, "TEXT");
  assert.equal(typeof result.wix.content_field_type, "string");
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].details.content_field_type, "TEXT");
  assert.equal(state.events[0].details.automatic_publication, false);
});

test("publishing API rejects unauthenticated browser requests", async () => {
  const request = { method: "POST", headers: {}, body: { action: "createOrUpdateDraft" } };
  const response = {
    statusCode: 0,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await wixPublishingHandler(request, response);
  assert.equal(response.statusCode, 401);
  assert.equal(response.payload.ok, false);
  assert.equal(JSON.stringify(response.payload).includes("WIX_API_KEY"), false);
});

test("migration, UI and API preserve draft-only publishing semantics", () => {
  const migration = readFileSync(new URL("../supabase/migrations/025_knowledge_hub_wix_cms_publishing.sql", import.meta.url), "utf8");
  const api = readFileSync(new URL("../api/marketing-wix-publishing.js", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../components/KnowledgeHubWixPublishing.jsx", import.meta.url), "utf8");
  const service = readFileSync(new URL("../services/wixPublishing.js", import.meta.url), "utf8");
  assert.match(migration, /featured_image/);
  assert.match(migration, /wix_payload_version/);
  assert.doesNotMatch(migration, /\bdrop\s+(table|column)\b/i);
  assert.match(api, /\.eq\("status", "accepted"\)/);
  assert.match(api, /wix_sync_status: result\.syncStatus/);
  assert.match(api, /automatic_publication: false/);
  assert.match(ui, /Create Wix Draft/);
  assert.match(ui, /Update Wix Draft/);
  assert.match(ui, /article\?\.status !== "approved"/);
  assert.match(service, /marketing-wix-publishing/);
  assert.doesNotMatch(service, /WIX_API_KEY|wix-site-id/);
});

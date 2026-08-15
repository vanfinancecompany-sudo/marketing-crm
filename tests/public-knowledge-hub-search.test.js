import test from "node:test";
import assert from "node:assert/strict";
import {
  handlePublicKnowledgeHubSearchRequest,
  knowledgeHubScopeForOrigin,
} from "../api/public-knowledge-hub-search.js";
import {
  isPublicKnowledgeHubArticle,
  normaliseKnowledgeHubSearchText,
  sanitiseKnowledgeHubSearchQuery,
  scorePublicKnowledgeHubArticle,
  searchPublicKnowledgeHubArticles,
} from "../lib/publicKnowledgeHubSearch.js";
import {
  loadRent2BuyKnowledgeHubArticles,
  normaliseRent2BuyKnowledgeHubItem,
  RENT2BUY_KNOWLEDGE_COLLECTION_ID,
  RENT2BUY_KNOWLEDGE_SITE_ID,
} from "../lib/rent2BuyKnowledgeHubCms.js";

function article(overrides = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "How to Check the MOT History of a Used Van Before Buying",
    slug: "check-mot-history-used-van",
    category: "Vehicle Guides",
    seo_title: "Used Van MOT History Check Guide",
    meta_description: "Check MOT passes, failures and advisories before buying a used van.",
    excerpt: "A practical guide to checking a used van's MOT history.",
    content_markdown: "Use the official MOT history service and read advisories in context.",
    faq_json: [{ question: "What does an MOT history show?", answer: "Passes, failures and recorded mileage." }],
    live_wix_url: "https://www.vanfinancecompany.co.uk/knowledge-hub-articles/check-mot-history-used-van",
    published_at: "2026-08-01T12:00:00.000Z",
    publication_verified_at: "2026-08-01T12:05:00.000Z",
    wix_sync_status: "live",
    wix_publication_status: "live",
    is_active: true,
    ...overrides,
  };
}

function rent2BuyArticle(overrides = {}) {
  return article({
    id: "00e89fb6-2672-402e-bde2-6b8c1361a726",
    title: "What Happens If Your Rent2Buy Van Is Stolen or Written Off?",
    slug: "rent2buy-van-stolen-total-loss-guide",
    category: "Rent2Buy",
    seo_title: "Rent2Buy Van Stolen or Written Off Guide",
    excerpt: "Learn what happens when a Rent2Buy van is stolen or written off.",
    content_markdown: "",
    faq_json: null,
    live_wix_url: "https://www.rent2buyvans.co.uk/knowledge-hub-articles/rent2buy-van-stolen-total-loss-guide",
    ...overrides,
  });
}

function responseRecorder() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    setHeader(name, value) { headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    end() { this.ended = true; return this; },
  };
}

function telemetrySupabase() {
  return {
    async rpc() { return { data: true, error: null }; },
    from(table) {
      assert.equal(table, "knowledge_hub_search_events");
      return { async insert() { return { error: null }; } };
    },
  };
}

test("public search eligibility requires a confirmed site-matching Knowledge Hub URL", () => {
  assert.equal(isPublicKnowledgeHubArticle(article()), true);
  assert.equal(isPublicKnowledgeHubArticle(article({ publication_verified_at: null })), false);
  assert.equal(isPublicKnowledgeHubArticle(article({ wix_publication_status: "draft" })), false);
  assert.equal(isPublicKnowledgeHubArticle(article({ is_active: false })), false);
  assert.equal(isPublicKnowledgeHubArticle(article({ live_wix_url: "https://example.com/knowledge-hub-articles/test" })), false);
  assert.equal(isPublicKnowledgeHubArticle(article({ live_wix_url: "https://www.vanfinancecompany.co.uk/vans-on-finance" })), false);
  assert.equal(isPublicKnowledgeHubArticle(rent2BuyArticle(), "rent2buy"), true);
  assert.equal(isPublicKnowledgeHubArticle(rent2BuyArticle(), "vfc"), false);
  assert.equal(isPublicKnowledgeHubArticle(article(), "rent2buy"), false);
});

test("title and exact-intent matches outrank incidental body mentions", () => {
  const strong = article({ id: "22222222-2222-4222-8222-222222222222", title: "What Should You Check in a Used Van's Load Area Before Buying?", slug: "used-van-load-area-checks" });
  const weak = article({ id: "33333333-3333-4333-8333-333333333333", title: "Buying a Used Van Online", slug: "buy-used-van-online", content_markdown: "Before buying, briefly inspect the load area as part of a wider checklist." });
  assert.ok(scorePublicKnowledgeHubArticle(strong, "used van load area") > scorePublicKnowledgeHubArticle(weak, "used van load area"));
  const results = searchPublicKnowledgeHubArticles([weak, strong], { query: "used van load area" });
  assert.equal(results[0].id, strong.id);
});

test("category filtering never leaks a different category into results", () => {
  const vehicle = article();
  const finance = article({
    id: "44444444-4444-4444-8444-444444444444",
    title: "What Factors Affect Your Van Finance Interest Rate?",
    slug: "van-finance-interest-rate-factors",
    category: "Van Finance",
    content_markdown: "Finance rate factors vary by lender and application.",
    live_wix_url: "https://www.vanfinancecompany.co.uk/knowledge-hub-articles/van-finance-interest-rate-factors",
  });
  const results = searchPublicKnowledgeHubArticles([vehicle, finance], { query: "van finance", category: "Van Finance" });
  assert.ok(results.length > 0);
  assert.ok(results.every((item) => item.category === "Van Finance"));
});

test("brand scope prevents VFC and Rent2Buy article leakage", () => {
  const vfc = article({ title: "Rent2Buy comparison on VFC", content_markdown: "stolen written off" });
  const rent2buy = rent2BuyArticle();
  const rentResults = searchPublicKnowledgeHubArticles([vfc, rent2buy], { query: "stolen written off", scope: "rent2buy" });
  assert.deepEqual(rentResults.map((item) => item.id), [rent2buy.id]);
  assert.ok(rentResults.every((item) => /rent2buyvans\.co\.uk/.test(item.url)));
  const vfcResults = searchPublicKnowledgeHubArticles([vfc, rent2buy], { query: "stolen written off", scope: "vfc" });
  assert.ok(vfcResults.every((item) => /vanfinancecompany\.co\.uk/.test(item.url)));
});

test("unverified and inactive articles are excluded even when they are the strongest text match", () => {
  const hidden = article({
    id: "55555555-5555-4555-8555-555555555555",
    title: "Bad Credit Van Finance",
    slug: "bad-credit-van-finance-hidden",
    publication_verified_at: null,
    live_wix_url: "https://www.vanfinancecompany.co.uk/knowledge-hub-articles/bad-credit-van-finance-hidden",
  });
  const visible = article({
    id: "66666666-6666-4666-8666-666666666666",
    title: "Understanding Van Finance Applications",
    slug: "understanding-van-finance-applications",
    content_markdown: "This guide includes questions about bad credit and finance applications.",
    live_wix_url: "https://www.vanfinancecompany.co.uk/knowledge-hub-articles/understanding-van-finance-applications",
  });
  const results = searchPublicKnowledgeHubArticles([hidden, visible], { query: "bad credit van finance" });
  assert.equal(results.some((item) => item.id === hidden.id), false);
  assert.equal(results.some((item) => item.id === visible.id), true);
});

test("stored search text redacts common customer contact and financial identifiers", () => {
  const stored = sanitiseKnowledgeHubSearchQuery("Can you help me? my email is stu@example.com and phone is 07123 456 789");
  assert.doesNotMatch(stored, /stu@example\.com/i);
  assert.doesNotMatch(stored, /07123/);
  assert.match(stored, /\[redacted\]/i);
});

test("query normalisation keeps intent words while removing punctuation noise", () => {
  assert.equal(normaliseKnowledgeHubSearchText("  MOT-history: failures & advisories?!  "), "mot history failures and advisories");
});

test("Rent2Buy Wix CMS items normalise only published Rent2Buy article routes", () => {
  const item = {
    id: "00e89fb6-2672-402e-bde2-6b8c1361a726",
    createdDate: "2026-08-10T10:00:00.000Z",
    updatedDate: "2026-08-14T10:00:00.000Z",
    data: {
      title: "What Happens If Your Rent2Buy Van Is Stolen or Written Off?",
      slug: "rent2buy-van-stolen-total-loss-guide",
      excerpt: "Stolen and written-off guidance.",
      seoTitle: "Rent2Buy Stolen Van Guide",
      metaDescription: "What happens after theft or total loss.",
      category: "Rent2Buy",
      publishDate: "2026-08-10T10:00:00.000Z",
      _publishStatus: "PUBLISHED",
      "link-knowledge-hub-articles-title": "/knowledge-hub-articles/rent2buy-van-stolen-total-loss-guide",
    },
  };
  const normalised = normaliseRent2BuyKnowledgeHubItem(item);
  assert.equal(normalised.id, item.id);
  assert.equal(normalised.category, "Rent2Buy");
  assert.equal(normalised.live_wix_url, "https://www.rent2buyvans.co.uk/knowledge-hub-articles/rent2buy-van-stolen-total-loss-guide");
  assert.equal(isPublicKnowledgeHubArticle(normalised, "rent2buy"), true);
  assert.equal(normaliseRent2BuyKnowledgeHubItem({ ...item, data: { ...item.data, _publishStatus: "DRAFT" } }), null);
});

test("Rent2Buy CMS reader uses the exact Rent2Buy site and Import3 collection", async () => {
  let request = null;
  const item = {
    id: "00e89fb6-2672-402e-bde2-6b8c1361a726",
    createdDate: "2026-08-10T10:00:00.000Z",
    updatedDate: "2026-08-14T10:00:00.000Z",
    data: {
      title: "Rent2Buy stolen van guide",
      slug: "rent2buy-van-stolen-total-loss-guide",
      excerpt: "What to do after theft.",
      _publishStatus: "PUBLISHED",
      "link-knowledge-hub-articles-title": "/knowledge-hub-articles/rent2buy-van-stolen-total-loss-guide",
    },
  };
  const articles = await loadRent2BuyKnowledgeHubArticles({
    environment: { WIX_API_KEY: "test-key" },
    useCache: false,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, async json() { return { dataItems: [item] }; } };
    },
  });
  assert.equal(request.options.headers["wix-site-id"], RENT2BUY_KNOWLEDGE_SITE_ID);
  assert.equal(request.options.headers.Authorization, "test-key");
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.dataCollectionId, RENT2BUY_KNOWLEDGE_COLLECTION_ID);
  assert.equal(payload.query.paging.limit, 100);
  assert.equal(articles.length, 1);
  assert.match(articles[0].live_wix_url, /rent2buyvans\.co\.uk/);
});

test("request origin determines Knowledge Hub scope and cannot be client-switched", () => {
  assert.equal(knowledgeHubScopeForOrigin("https://www.vanfinancecompany.co.uk"), "vfc");
  assert.equal(knowledgeHubScopeForOrigin("https://www.rent2buyvans.co.uk"), "rent2buy");
  assert.equal(knowledgeHubScopeForOrigin("https://rent2buyvans.co.uk"), "rent2buy");
  assert.equal(knowledgeHubScopeForOrigin("https://example.com"), null);
});

test("Rent2Buy origin searches the injected Rent2Buy CMS pool and returns only Rent2Buy URLs", async () => {
  const response = responseRecorder();
  await handlePublicKnowledgeHubSearchRequest({
    method: "POST",
    headers: { origin: "https://www.rent2buyvans.co.uk", "x-forwarded-for": "203.0.113.10" },
    body: { action: "search", query: "stolen written off", visitor_id: "visitor-1", scope: "vfc" },
  }, response, {
    environment: { AI_ASSISTANT_SESSION_SECRET: "test-secret" },
    supabase: telemetrySupabase(),
    loadRent2BuyArticles: async () => [rent2BuyArticle()],
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.scope, "rent2buy");
  assert.equal(response.payload.result_count, 1);
  assert.match(response.payload.results[0].url, /rent2buyvans\.co\.uk/);
  assert.doesNotMatch(response.payload.results[0].url, /vanfinancecompany\.co\.uk/);
});

test("production Knowledge Hub embed origin is allowed without broadening untrusted origins", async () => {
  const response = responseRecorder();
  await handlePublicKnowledgeHubSearchRequest({
    method: "OPTIONS",
    headers: { origin: "https://marketing-crm-github-work.vercel.app" },
  }, response, { environment: {} });
  assert.equal(response.statusCode, 204);
  assert.equal(response.headers["Access-Control-Allow-Origin"], "https://marketing-crm-github-work.vercel.app");
});

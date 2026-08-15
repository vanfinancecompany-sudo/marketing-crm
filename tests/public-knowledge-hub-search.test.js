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
  RENT2BUY_KNOWLEDGE_HUB_INDEX,
  RENT2BUY_KNOWLEDGE_HUB_INDEX_VERIFIED_AT,
} from "../lib/rent2BuyKnowledgeHubIndex.js";

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
  return {
    id: "00e89fb6-2672-402e-bde2-6b8c1361a726",
    title: "What Happens If Your Rent2Buy Van Is Stolen or Written Off?",
    slug: "rent2buy-van-stolen-total-loss-guide",
    category: "Rent2Buy",
    seo_title: "Rent2Buy Van Stolen or Written Off Guide",
    meta_description: "",
    excerpt: "Learn what happens when a Rent2Buy van is stolen or written off.",
    content_markdown: "",
    faq_json: null,
    live_wix_url: "https://www.rent2buyvans.co.uk/knowledge-hub-articles/rent2buy-van-stolen-total-loss-guide",
    is_active: true,
    source_verified: true,
    source_verified_at: RENT2BUY_KNOWLEDGE_HUB_INDEX_VERIFIED_AT,
    ...overrides,
  };
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

test("public search eligibility requires the correct site-specific publication evidence", () => {
  assert.equal(isPublicKnowledgeHubArticle(article()), true);
  assert.equal(isPublicKnowledgeHubArticle(article({ publication_verified_at: null })), false);
  assert.equal(isPublicKnowledgeHubArticle(article({ wix_publication_status: "draft" })), false);
  assert.equal(isPublicKnowledgeHubArticle(article({ is_active: false })), false);
  assert.equal(isPublicKnowledgeHubArticle(article({ live_wix_url: "https://example.com/knowledge-hub-articles/test" })), false);
  assert.equal(isPublicKnowledgeHubArticle(article({ live_wix_url: "https://www.vanfinancecompany.co.uk/vans-on-finance" })), false);

  assert.equal(isPublicKnowledgeHubArticle(rent2BuyArticle(), "rent2buy"), true);
  assert.equal(isPublicKnowledgeHubArticle(rent2BuyArticle({ source_verified: false }), "rent2buy"), false);
  assert.equal(isPublicKnowledgeHubArticle(rent2BuyArticle({ is_active: false }), "rent2buy"), false);
  assert.equal(isPublicKnowledgeHubArticle(rent2BuyArticle({ category: "Van Finance" }), "rent2buy"), false);
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

test("category filtering never leaks a different category into VFC results", () => {
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

test("unverified and inactive VFC articles are excluded even when they are the strongest text match", () => {
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

test("dedicated Rent2Buy index is exactly the 52-record published Wix source set", () => {
  assert.equal(RENT2BUY_KNOWLEDGE_HUB_INDEX.length, 52);
  assert.equal(new Set(RENT2BUY_KNOWLEDGE_HUB_INDEX.map((item) => item.id)).size, 52);
  assert.equal(new Set(RENT2BUY_KNOWLEDGE_HUB_INDEX.map((item) => item.slug)).size, 52);
  assert.ok(RENT2BUY_KNOWLEDGE_HUB_INDEX.every((item) => item.category === "Rent2Buy"));
  assert.ok(RENT2BUY_KNOWLEDGE_HUB_INDEX.every((item) => item.source_verified === true));
  assert.ok(RENT2BUY_KNOWLEDGE_HUB_INDEX.every((item) => item.source_verified_at === RENT2BUY_KNOWLEDGE_HUB_INDEX_VERIFIED_AT));
  assert.ok(RENT2BUY_KNOWLEDGE_HUB_INDEX.every((item) => /^https:\/\/www\.rent2buyvans\.co\.uk\/knowledge-hub-articles\//.test(item.live_wix_url)));
});

test("Rent2Buy index contains the current 100-mile location guidance and searches it naturally", () => {
  const locationArticle = RENT2BUY_KNOWLEDGE_HUB_INDEX.find((item) => item.id === "64ab8687-6a4b-401d-8cfb-b8e217ae0fd8");
  assert.ok(locationArticle);
  assert.match(locationArticle.excerpt, /100-mile radius/i);
  const results = searchPublicKnowledgeHubArticles(RENT2BUY_KNOWLEDGE_HUB_INDEX, {
    query: "do I qualify based on location 100 miles Southampton",
    scope: "rent2buy",
  });
  assert.ok(results.length > 0);
  assert.equal(results[0].id, locationArticle.id);
  assert.ok(results.every((item) => /rent2buyvans\.co\.uk/.test(item.url)));
});

test("request origin determines Knowledge Hub scope and cannot be client-switched", () => {
  assert.equal(knowledgeHubScopeForOrigin("https://www.vanfinancecompany.co.uk"), "vfc");
  assert.equal(knowledgeHubScopeForOrigin("https://www.rent2buyvans.co.uk"), "rent2buy");
  assert.equal(knowledgeHubScopeForOrigin("https://rent2buyvans.co.uk"), "rent2buy");
  assert.equal(knowledgeHubScopeForOrigin("https://example.com"), null);
});

test("Rent2Buy origin searches the permanent 52-record index and ignores a client VFC switch", async () => {
  const response = responseRecorder();
  await handlePublicKnowledgeHubSearchRequest({
    method: "POST",
    headers: { origin: "https://www.rent2buyvans.co.uk", "x-forwarded-for": "203.0.113.10" },
    body: { action: "search", query: "stolen written off", visitor_id: "visitor-1", scope: "vfc" },
  }, response, {
    environment: { AI_ASSISTANT_SESSION_SECRET: "test-secret" },
    supabase: telemetrySupabase(),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.scope, "rent2buy");
  assert.ok(response.payload.result_count > 0);
  assert.match(response.payload.results[0].url, /rent2buyvans\.co\.uk/);
  assert.doesNotMatch(response.payload.results[0].url, /vanfinancecompany\.co\.uk/);
});

test("Rent2Buy result selections are validated against the permanent index", async () => {
  const response = responseRecorder();
  await handlePublicKnowledgeHubSearchRequest({
    method: "POST",
    headers: { origin: "https://www.rent2buyvans.co.uk", "x-forwarded-for": "203.0.113.10" },
    body: {
      action: "select",
      search_request_id: "12345678-1234-4123-8123-123456789012",
      query: "stolen written off",
      article_id: "00e89fb6-2672-402e-bde2-6b8c1361a726",
      rank: 1,
      visitor_id: "visitor-1",
    },
  }, response, {
    environment: { AI_ASSISTANT_SESSION_SECRET: "test-secret" },
    supabase: telemetrySupabase(),
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.payload, { ok: true });
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

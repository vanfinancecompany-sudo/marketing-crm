import test from "node:test";
import assert from "node:assert/strict";
import {
  isPublicKnowledgeHubArticle,
  normaliseKnowledgeHubSearchText,
  sanitiseKnowledgeHubSearchQuery,
  scorePublicKnowledgeHubArticle,
  searchPublicKnowledgeHubArticles,
} from "../lib/publicKnowledgeHubSearch.js";

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

test("public search eligibility requires a confirmed VFC Knowledge Hub article URL", () => {
  assert.equal(isPublicKnowledgeHubArticle(article()), true);
  assert.equal(isPublicKnowledgeHubArticle(article({ publication_verified_at: null })), false);
  assert.equal(isPublicKnowledgeHubArticle(article({ wix_publication_status: "draft" })), false);
  assert.equal(isPublicKnowledgeHubArticle(article({ is_active: false })), false);
  assert.equal(isPublicKnowledgeHubArticle(article({ live_wix_url: "https://example.com/knowledge-hub-articles/test" })), false);
  assert.equal(isPublicKnowledgeHubArticle(article({ live_wix_url: "https://www.vanfinancecompany.co.uk/vans-on-finance" })), false);
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

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildArticleVisibility,
  buildVisibilitySummary,
  deriveVisibilityPrompts,
  filterVisibilityArticles,
  isConfirmedPublishedArticle,
  latestVisibilityResults,
} from "../lib/aiVisibility.js";
import { getVisibilityProviderAdapter } from "../lib/aiVisibilityProviders.js";
import visibilityHandler from "../api/marketing-ai-visibility.js";

const published = (id, extra = {}) => ({
  id,
  title: `Article ${id}`,
  status: "approved",
  live_wix_url: `https://www.vanfinancecompany.co.uk/guides/${id}`,
  published_at: "2026-06-01T10:00:00Z",
  publication_verified_at: "2026-06-01T10:05:00Z",
  wix_sync_status: "live",
  ...extra,
});
const result = (id, articleId, provider, status, checkedAt, extra = {}) => ({
  id,
  article_id: articleId,
  prompt_id: provider === "google_search_console" ? null : `prompt-${articleId}`,
  provider,
  result_status: status,
  checked_at: checkedAt,
  manually_verified: true,
  ...extra,
});

test("published pages require a confirmed live Wix record", () => {
  assert.equal(isConfirmedPublishedArticle(published("one")), true);
  assert.equal(isConfirmedPublishedArticle({ ...published("one"), publication_verified_at: null }), false);
  assert.equal(isConfirmedPublishedArticle({ ...published("one"), wix_sync_status: "pending" }), false);
  assert.equal(isConfirmedPublishedArticle({ ...published("one"), live_wix_url: "" }), false);
});

test("dashboard counts use stored completed evidence and exclude errors from visibility rate", () => {
  const articles = [
    published("visible"),
    published("negative"),
    published("error"),
    published("unchecked"),
  ];
  const results = [
    result("g-visible", "visible", "google_search_console", "indexed", "2026-07-01T10:00:00Z"),
    result("c-visible", "visible", "chatgpt", "mentioned", "2026-07-02T10:00:00Z", {
      evidence_excerpt: "Van Finance Company was mentioned.",
    }),
    result("p-visible", "visible", "perplexity", "cited", "2026-07-03T10:00:00Z", {
      evidence_excerpt: "The guide was cited.",
      source_url: "https://www.perplexity.ai/search/example",
    }),
    result("c-negative", "negative", "chatgpt", "not_detected", "2026-07-02T10:00:00Z"),
    result("g-negative", "negative", "google_search_console", "not_indexed", "2026-07-02T10:00:00Z"),
    result("c-error", "error", "chatgpt", "error", "2026-07-02T10:00:00Z", {
      manually_verified: false,
      error_details: "Configuration required",
    }),
  ];
  const summary = buildVisibilitySummary({
    articles,
    results,
    now: new Date("2026-07-26T10:00:00Z"),
    attentionDays: 30,
  });
  assert.equal(summary.published_pages, 4);
  assert.equal(summary.google_indexed, 1);
  assert.equal(summary.ai_visible, 1);
  assert.equal(summary.chatgpt_detections, 1);
  assert.equal(summary.perplexity_detections, 1);
  assert.equal(summary.total_verified_detections, 2);
  assert.equal(summary.awaiting_first_check, 2);
  assert.equal(summary.needs_attention, 1);
  assert.equal(summary.visibility_rate_numerator, 1);
  assert.equal(summary.visibility_rate_denominator, 2);
  assert.equal(summary.visibility_rate, 50);
  assert.equal(summary.last_checked_at, "2026-07-03T10:00:00Z");
});

test("latest provider evidence controls current visibility without deleting history", () => {
  const results = [
    result("old", "article", "chatgpt", "mentioned", "2026-07-01T00:00:00Z", {
      evidence_excerpt: "Earlier mention",
    }),
    result("new", "article", "chatgpt", "not_detected", "2026-07-20T00:00:00Z"),
  ];
  const item = buildArticleVisibility({
    article: published("article"),
    results,
    now: new Date("2026-07-26T00:00:00Z"),
  });
  assert.equal(item.visible, false);
  assert.equal(item.total_detections, 1);
  assert.equal(item.first_detected_at, "2026-07-01T00:00:00Z");
  assert.equal(item.last_detected_at, "2026-07-01T00:00:00Z");
  assert.equal(item.results.length, 2);
});

test("provider errors do not erase the latest completed verified result", () => {
  const results = [
    result("indexed", "article", "google_search_console", "indexed", "2026-07-01T00:00:00Z"),
    result("mentioned", "article", "chatgpt", "mentioned", "2026-07-02T00:00:00Z", {
      evidence_excerpt: "Verified mention",
    }),
    result("error", "article", "chatgpt", "error", "2026-07-03T00:00:00Z", {
      manually_verified: false,
      error_details: "Temporary provider error",
    }),
  ];
  const item = buildArticleVisibility({ article: published("article"), results });
  assert.equal(item.google_indexing_status, "indexed");
  assert.equal(item.visible, true);
  assert.equal(item.visibility_status, "visible");
  assert.equal(item.platforms_checked.includes("chatgpt"), true);
});

test("superseded evidence remains historical but no longer contributes to counts", () => {
  const results = [
    result("incorrect", "article", "gemini", "detected", "2026-07-01T00:00:00Z", {
      evidence_excerpt: "Incorrect evidence",
    }),
    result("correction", "article", "gemini", "not_detected", "2026-07-02T00:00:00Z", {
      supersedes_result_id: "incorrect",
    }),
  ];
  assert.deepEqual(latestVisibilityResults(results).map((entry) => entry.id), ["correction"]);
  const summary = buildVisibilitySummary({ articles: [published("article")], results });
  assert.equal(summary.gemini_detections, 0);
  assert.equal(summary.total_verified_detections, 0);
});

test("prompt derivation uses article, intent, FAQs and Business Brain without duplicates or excess", () => {
  const prompts = deriveVisibilityPrompts({
    article: {
      title: "Van finance application guide",
      faq_json: [
        { question: "What documents do I need?" },
        { question: "What documents do I need?" },
      ],
    },
    topic: { primary_keyword: "van finance applications" },
    businessSections: [{
      section_key: "business_vocabulary",
      entries: [{ label: "Rent2Buy" }, { label: "Affordability" }],
    }],
    maximum: 4,
  });
  assert.equal(prompts.length, 4);
  assert.equal(new Set(prompts.map((prompt) => prompt.prompt_fingerprint)).size, 4);
  assert.equal(prompts.some((prompt) => prompt.prompt_source === "article_title"), true);
  assert.equal(prompts.some((prompt) => prompt.prompt_source === "faq"), true);
  assert.equal(prompts.some((prompt) => prompt.prompt_source === "business_brain"), true);
});

test("results table filtering and quick sorting use evidence rollups", () => {
  const summary = buildVisibilitySummary({
    articles: [
      published("visible", { title: "Van Finance Guide", published_at: "2026-07-01T00:00:00Z" }),
      published("unchecked", { title: "Rent2Buy Guide", published_at: "2026-07-20T00:00:00Z" }),
    ],
    results: [
      result("visible", "visible", "chatgpt", "detected", "2026-07-10T00:00:00Z", {
        evidence_excerpt: "Detected",
      }),
    ],
  });
  assert.equal(filterVisibilityArticles(summary.articles, { status: "visible" }).length, 1);
  assert.equal(filterVisibilityArticles(summary.articles, { status: "not_checked" })[0].article.id, "unchecked");
  assert.equal(filterVisibilityArticles(summary.articles, { search: "rent2buy" }).length, 1);
  assert.equal(filterVisibilityArticles(summary.articles, { sort: "most_visible" })[0].article.id, "visible");
});

test("provider adapters explicitly report unsupported automation without visibility", async () => {
  const adapter = getVisibilityProviderAdapter("chatgpt");
  const outcome = await adapter.check();
  assert.equal(adapter.automated_checks_supported, false);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.result_status, "error");
  assert.equal(outcome.response_metadata.public_visibility_claimed, false);
});

test("AI Visibility API rejects unauthenticated requests", async () => {
  const request = { method: "POST", headers: {}, body: { action: "load" } };
  const response = {
    statusCode: 0,
    payload: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await visibilityHandler(request, response);
  assert.equal(response.statusCode, 401);
  assert.equal(response.payload.ok, false);
});

test("migration, routes and interface remain additive and evidence-only", () => {
  const migration = readFileSync(new URL("../supabase/migrations/023_knowledge_hub_ai_visibility.sql", import.meta.url), "utf8");
  const api = readFileSync(new URL("../api/marketing-ai-visibility.js", import.meta.url), "utf8");
  const providers = readFileSync(new URL("../lib/aiVisibilityProviders.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../pages/AIVisibilityPage.jsx", import.meta.url), "utf8");
  const widget = readFileSync(new URL("../components/AIVisibilityWidget.jsx", import.meta.url), "utf8");
  const app = readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
  assert.match(migration, /knowledge_visibility_results/);
  assert.match(migration, /wix_item_id/);
  assert.match(migration, /live_wix_url/);
  assert.match(migration, /manually_verified/);
  assert.match(migration, /knowledge_visibility_audit_events/);
  assert.doesNotMatch(migration, /\bdrop\s+(table|column|constraint)\b/i);
  assert.doesNotMatch(migration, /\branking_position\b/i);
  assert.match(api, /recordManualResult/);
  assert.match(api, /provider_check_failed/);
  assert.match(providers, /public_visibility_claimed: false/);
  assert.match(page, /Manually verified/);
  assert.match(page, /No visibility was claimed/);
  for (const label of [
    "Published pages",
    "Google indexed",
    "ChatGPT detections",
    "Gemini detections",
    "Perplexity detections",
    "Google AI Overview detections",
    "Awaiting first check",
    "Needs attention",
    "Total verified detections",
    "Visibility rate",
    "Last checked",
  ]) assert.match(widget, new RegExp(label));
  assert.match(app, /"AI Visibility": "\/ai-visibility"/);
});

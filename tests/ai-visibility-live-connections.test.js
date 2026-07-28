import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  aggregateSearchAnalytics,
  buildWixSyncPlan,
  googleEvidenceStatus,
  matchCrmArticleToWixItem,
} from "../lib/aiVisibilityLiveConnections.js";
import { buildVisibilitySummary, isConfirmedPublishedArticle } from "../lib/aiVisibility.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const liveArticle = {
  id: "article-1",
  title: "Live article",
  slug: "live-article",
  wix_item_id: "wix-1",
  live_wix_url: "https://www.vanfinancecompany.co.uk/knowledge-hub/live-article",
  published_at: "2026-07-01T10:00:00Z",
  publication_verified_at: "2026-07-01T10:05:00Z",
  wix_sync_status: "live",
  wix_publication_status: "live",
};

test("Wix draft is not counted as published", () => {
  assert.equal(isConfirmedPublishedArticle({ ...liveArticle, wix_publication_status: "draft" }), false);
  assert.equal(buildVisibilitySummary({ articles: [{ ...liveArticle, wix_publication_status: "draft" }] }).published_pages, 0);
});

test("live Wix article is counted as published and awaits its first check", () => {
  const summary = buildVisibilitySummary({ articles: [liveArticle] });
  assert.equal(summary.published_pages, 1);
  assert.equal(summary.awaiting_first_check, 1);
});

test("stored Wix item ID is preferred for matching", () => {
  const result = matchCrmArticleToWixItem(liveArticle, [
    { id: "wix-2", data: { crmArticleId: "article-1", slug: "live-article" } },
    { id: "wix-1", data: { crmArticleId: "other", slug: "other" } },
  ]);
  assert.equal(result.item.id, "wix-1");
  assert.equal(result.matched_by, "wix_item_id");
});

test("ambiguous fallback match is skipped", () => {
  const article = { id: "article-2", slug: "same-slug" };
  const result = matchCrmArticleToWixItem(article, [
    { id: "one", data: { slug: "same-slug" } },
    { id: "two", data: { slug: "same-slug" } },
  ]);
  assert.equal(result.item, null);
  assert.equal(result.ambiguous, true);
});

test("repeated Wix sync plan contains one deterministic match and no duplicate", () => {
  const input = {
    articles: [liveArticle],
    liveItems: [{ id: "wix-1", data: { crmArticleId: "article-1", liveUrl: liveArticle.live_wix_url } }],
  };
  assert.deepEqual(buildWixSyncPlan(input), buildWixSyncPlan(input));
  assert.equal(buildWixSyncPlan(input).matches.length, 1);
});

test("existing live Wix articles can be safely backfilled by CRM article ID", () => {
  const plan = buildWixSyncPlan({
    articles: [{ id: "article-backfill", slug: "backfill" }],
    liveItems: [{ id: "wix-backfill", data: { crmArticleId: "article-backfill", liveUrl: "https://example.com/backfill" } }],
  });
  assert.equal(plan.matches[0].matched_by, "crm_article_id");
});

test("Search Analytics values are stored accurately", () => {
  const metrics = aggregateSearchAnalytics([
    { keys: ["van finance"], clicks: 2, impressions: 10, ctr: 0.2, position: 3 },
    { keys: ["business van"], clicks: 1, impressions: 5, ctr: 0.2, position: 5 },
  ]);
  assert.equal(metrics.clicks, 3);
  assert.equal(metrics.impressions, 15);
  assert.equal(metrics.ctr, 0.2);
  assert.equal(metrics.average_position, 11 / 3);
  assert.equal(metrics.top_queries.length, 2);
});

test("reliable URL Inspection evidence updates indexed status", () => {
  assert.equal(googleEvidenceStatus({ inspection: { inspectionResult: { indexStatusResult: { verdict: "PASS" } } } }), "indexed");
});

test("performance-only evidence does not falsely claim indexed", () => {
  assert.equal(googleEvidenceStatus({ performance: { impressions: 12, clicks: 1 } }), "performance_found");
});

test("Google OAuth tokens remain server-side and property selection is explicit", async () => {
  const api = await read("../api/marketing-ai-visibility-connections.js");
  assert.match(api, /GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN/);
  assert.match(api, /GOOGLE_SEARCH_CONSOLE_SITE_URL/);
  assert.match(api, /token_storage:\s*"server_environment"/);
  assert.doesNotMatch(api, /localStorage|sessionStorage/);
});

test("bulk Google checks use verified live pages, controlled batches and partial failures", async () => {
  const api = await read("../api/marketing-ai-visibility-connections.js");
  assert.match(api, /filter\(isConfirmedPublishedArticle\)/);
  assert.match(api, /index \+= 5/);
  assert.match(api, /Promise\.allSettled/);
});

test("evidence history is inserted, not overwritten", async () => {
  const api = await read("../api/marketing-ai-visibility-connections.js");
  assert.match(api, /knowledge_visibility_results"\)\.insert/);
  assert.doesNotMatch(api, /knowledge_visibility_results"\)\.update/);
});

test("AI providers remain manual and no rankings or live publication are fabricated", async () => {
  const providers = await read("../lib/aiVisibilityProviders.js");
  const wix = await read("../api/marketing-wix-publishing.js");
  const connections = await read("../api/marketing-ai-visibility-connections.js");
  assert.match(providers, /Manual evidence only/);
  assert.doesNotMatch(`${connections}\n${wix}`, /publishLive|livePublish|status:\s*["']published["']/);
  assert.match(connections, /ranking_position_supplied:\s*false/);
});

test("migration is additive and preserves manual evidence", async () => {
  const migration = await read("../supabase/migrations/024_ai_visibility_wix_gsc_connections.sql");
  assert.match(migration, /add column if not exists wix_publication_status/);
  assert.match(migration, /performance_found/);
  assert.doesNotMatch(migration, /drop table|truncate|delete from/);
});

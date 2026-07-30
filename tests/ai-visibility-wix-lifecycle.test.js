import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  articleIsPresentInLiveSet,
  identitiesOverlap,
  isKnowledgeHubUrl,
  isWixKnowledgeManagedArticle,
  stableWixIdentityForArticle,
  wasInactiveWixArticle,
} from "../lib/aiVisibilityWixLifecycle.js";
import { buildVisibilitySummary, isConfirmedPublishedArticle } from "../lib/aiVisibility.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const activeArticle = {
  id: "article-1",
  title: "Example article",
  slug: "example-article",
  wix_item_id: "wix-1",
  wix_collection_id: "knowledge-hub",
  live_wix_url: "https://www.vanfinancecompany.co.uk/knowledge-hub-article/example-article",
  published_at: "2026-07-01T10:00:00Z",
  publication_verified_at: "2026-07-01T10:05:00Z",
  wix_sync_status: "live",
  wix_publication_status: "live",
  is_active: true,
};

test("stable Wix item ID, canonical URL or slug can retain an active record", () => {
  assert.equal(identitiesOverlap(
    stableWixIdentityForArticle(activeArticle),
    { wix_item_id: "wix-1", canonical_url: "", slug: "" },
  ), true);
  assert.equal(articleIsPresentInLiveSet(activeArticle, [
    { wix_item_id: "", canonical_url: activeArticle.live_wix_url.toLowerCase(), slug: "" },
  ]), true);
  assert.equal(articleIsPresentInLiveSet(activeArticle, [
    { wix_item_id: "", canonical_url: "", slug: "example-article" },
  ]), true);
});

test("title alone never matches a Wix lifecycle record", () => {
  assert.equal(articleIsPresentInLiveSet(activeArticle, [
    { title: activeArticle.title, wix_item_id: "", canonical_url: "", slug: "" },
  ]), false);
});

test("older Wix rows missing wix_collection_id are recognised by item ID and Knowledge Hub URL", () => {
  const legacy = {
    ...activeArticle,
    wix_collection_id: null,
    publication_verification_notes: "",
    last_wix_sync_at: null,
  };
  assert.equal(isWixKnowledgeManagedArticle(legacy, "knowledge-hub"), true);
});

test("older Wix rows using legacy status values are recognised with verification evidence", () => {
  const legacy = {
    ...activeArticle,
    wix_collection_id: null,
    live_wix_url: "",
    wix_sync_status: "published",
    wix_publication_status: "verified",
    publication_verification_notes: "Legacy Wix publication verification",
  };
  assert.equal(isWixKnowledgeManagedArticle(legacy, "knowledge-hub"), true);
});

test("Wix rows are identified by stable Wix URL and item ID", () => {
  assert.equal(isKnowledgeHubUrl(activeArticle.live_wix_url), true);
  assert.equal(isWixKnowledgeManagedArticle({
    wix_item_id: "legacy-wix-id",
    live_wix_url: activeArticle.live_wix_url,
  }, "knowledge-hub"), true);
});

test("deactivation scope is limited to Wix Knowledge Hub managed records", () => {
  assert.equal(isWixKnowledgeManagedArticle(activeArticle, "knowledge-hub"), true);
  assert.equal(isWixKnowledgeManagedArticle({
    id: "manual-url",
    live_wix_url: "https://example.com/page",
    title: "Manually added URL",
  }, "knowledge-hub"), false);
});

test("unrelated manual URLs remain untouched even if they have publication dates", () => {
  assert.equal(isWixKnowledgeManagedArticle({
    id: "manual-url",
    live_wix_url: "https://example.com/page",
    published_at: "2026-07-01T10:00:00Z",
    publication_verified_at: "2026-07-01T10:05:00Z",
    wix_sync_status: "live",
    wix_publication_status: "live",
  }, "knowledge-hub"), false);
});

test("title-only records remain untouched", () => {
  assert.equal(isWixKnowledgeManagedArticle({
    id: "title-only",
    title: activeArticle.title,
    slug: activeArticle.slug,
  }, "knowledge-hub"), false);
});

test("previously unpublished records are recognised for reactivation", () => {
  assert.equal(wasInactiveWixArticle({ ...activeArticle, is_active: false }), true);
  assert.equal(wasInactiveWixArticle({ ...activeArticle, wix_publication_status: "unpublished" }), true);
  assert.equal(wasInactiveWixArticle(activeArticle), false);
});

test("inactive Wix records are excluded from current dashboard totals", () => {
  const inactive = {
    ...activeArticle,
    id: "article-2",
    is_active: false,
    wix_sync_status: "unpublished",
    wix_publication_status: "unpublished",
    publication_verified_at: null,
    unpublished_at: "2026-07-29T10:00:00Z",
  };
  assert.equal(isConfirmedPublishedArticle(inactive), false);
  const summary = buildVisibilitySummary({
    articles: [activeArticle, inactive],
    results: [
      { id: "historic-1", article_id: inactive.id, provider: "chatgpt", result_status: "detected", checked_at: "2026-07-20T10:00:00Z" },
    ],
  });
  assert.equal(summary.published_pages, 1);
  assert.equal(summary.ai_visible, 0);
  assert.equal(summary.awaiting_first_check, 1);
});

test("migration adds lifecycle fields without deleting historical evidence", async () => {
  const migration = await read("../supabase/migrations/026_ai_visibility_wix_article_lifecycle.sql");
  assert.match(migration, /is_active boolean not null default true/);
  assert.match(migration, /unpublished_at timestamptz/);
  assert.match(migration, /knowledge_articles_wix_sync_status_check/);
  assert.match(migration, /knowledge_articles_wix_publication_status_check/);
  assert.match(migration, /unpublished/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.knowledge_visibility_results/i);
  assert.doesNotMatch(migration, /truncate/i);
});

test("full Wix sync validates upstream data before deactivation", async () => {
  const api = await read("../api/marketing-ai-visibility-wix-sync.js");
  const validationIndex = api.indexOf("Array.isArray(payload.dataItems)");
  const deactivationIndex = api.indexOf("deactivateMissingArticles");
  assert.ok(validationIndex >= 0);
  assert.ok(deactivationIndex > validationIndex);
  assert.match(api, /Existing records were not deactivated/);
  assert.doesNotMatch(api, /knowledge_visibility_results"\)\.delete/);
});

test("provider batches and manual checks remain gated by verified live state", async () => {
  const googleApi = await read("../api/marketing-ai-visibility-connections.js");
  const manualApi = await read("../api/marketing-ai-visibility-manual.js");
  assert.match(googleApi, /filter\(isConfirmedPublishedArticle\)/);
  assert.match(manualApi, /if \(!isConfirmedPublishedArticle\(article\)\)/);
});

test("sync result reports lifecycle diagnostics and final counts", async () => {
  const api = await read("../api/marketing-ai-visibility-wix-sync.js");
  for (const field of [
    "total_article_records_loaded",
    "wix_managed_records_identified",
    "active_wix_managed_records_before_sync",
    "live_records_matched",
    "legacy_wix_managed_candidates",
    "missing_live_candidates",
    "records_skipped_as_not_wix_managed",
    "records_deactivated",
    "active_records_updated",
    "previously_live_records_deactivated",
    "reactivated_records",
  ]) {
    assert.match(api, new RegExp(field));
  }
});

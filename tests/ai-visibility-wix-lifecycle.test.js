import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  articleIsPresentInLiveSet,
  identitiesOverlap,
  isWixKnowledgeManagedArticle,
  stableWixIdentityForArticle,
  wasInactiveWixArticle,
  WIX_INACTIVE_STATUS,
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

test("deactivation scope is limited to Wix Knowledge Hub managed records", () => {
  assert.equal(isWixKnowledgeManagedArticle(activeArticle, "knowledge-hub"), true);
  assert.equal(isWixKnowledgeManagedArticle({
    id: "manual-url",
    live_wix_url: "https://example.com/page",
    title: "Manually added URL",
  }, "knowledge-hub"), false);
});

test("unpublished is the single inactive lifecycle value used for reactivation", () => {
  assert.equal(WIX_INACTIVE_STATUS, "unpublished");
  assert.equal(wasInactiveWixArticle({ ...activeArticle, is_active: false }), true);
  assert.equal(wasInactiveWixArticle({ ...activeArticle, wix_publication_status: "unpublished" }), true);
  assert.equal(wasInactiveWixArticle({ ...activeArticle, wix_sync_status: "unpublished" }), true);
  assert.equal(wasInactiveWixArticle(activeArticle), false);
});

test("inactive Wix records are excluded from current dashboard totals", () => {
  const inactive = {
    ...activeArticle,
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

test("migration safely preserves existing constraint values and adds unpublished", async () => {
  const migration = await read("../supabase/migrations/026_ai_visibility_wix_article_lifecycle.sql");
  assert.match(migration, /is_active boolean not null default true/);
  assert.match(migration, /unpublished_at timestamptz/);
  assert.match(migration, /pg_get_expr\(c\.conbin, c\.conrelid\)/);
  assert.match(migration, /drop constraint if exists knowledge_articles_wix_sync_status_check/);
  assert.match(migration, /drop constraint if exists knowledge_articles_wix_publication_status_check/);
  assert.match(migration, /wix_sync_status = %L/);
  assert.match(migration, /wix_publication_status = %L/);
  assert.match(migration, /'unpublished'/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.knowledge_visibility_results/i);
  assert.doesNotMatch(migration, /truncate/i);
});

test("application and migration use the same unpublished inactive status", async () => {
  const api = await read("../api/marketing-ai-visibility-wix-sync.js");
  const migration = await read("../supabase/migrations/026_ai_visibility_wix_article_lifecycle.sql");
  assert.match(api, /wix_sync_status:\s*"unpublished"/);
  assert.match(api, /wix_publication_status:\s*"unpublished"/);
  assert.doesNotMatch(api, /wix_sync_status:\s*"not_live"/);
  assert.doesNotMatch(api, /wix_publication_status:\s*"not_live"/);
  assert.match(migration, /wix_sync_status = 'unpublished'/);
  assert.match(migration, /wix_publication_status = 'unpublished'/);
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

test("sync result clearly reports active, deactivated and reactivated counts", async () => {
  const api = await read("../api/marketing-ai-visibility-wix-sync.js");
  const component = await read("../components/AIVisibilityLiveConnections.jsx");
  assert.match(api, /active_records_updated/);
  assert.match(api, /previously_live_records_deactivated/);
  assert.match(api, /reactivated_records/);
  assert.match(component, /Active records updated/);
  assert.match(component, /Previously live records deactivated/);
  assert.match(component, /Reactivated/);
});

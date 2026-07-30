import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  articleIsPresentInLiveSet,
  articleLiveSetMatch,
  articleSpecificKnowledgeHubUrl,
  deactivationSelectionReason,
  identitiesOverlap,
  isGenericKnowledgeHubUrl,
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

test("stable Wix item ID, article URL or slug can retain an active record", () => {
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

test("generic Knowledge Hub landing URL is never an article identity", () => {
  const generic = "https://www.vanfinancecompany.co.uk/knowledge-hub/";
  assert.equal(isKnowledgeHubUrl(generic), true);
  assert.equal(isGenericKnowledgeHubUrl(generic), true);
  assert.equal(articleSpecificKnowledgeHubUrl(generic), "");
  const identity = stableWixIdentityForArticle({
    ...activeArticle,
    wix_item_id: "",
    slug: "",
    live_wix_url: generic,
  });
  assert.equal(identity.canonical_url, "");
  assert.equal(identity.generic_url_rejected, true);
});

test("different Wix item IDs do not match through a shared generic landing URL", () => {
  const generic = "https://www.vanfinancecompany.co.uk/knowledge-hub/";
  const article = {
    ...activeArticle,
    wix_item_id: "legacy-1",
    slug: "",
    live_wix_url: generic,
  };
  const match = articleLiveSetMatch(article, [
    {
      wix_item_id: "current-1",
      canonical_url: "",
      generic_url_rejected: true,
      slug: "",
    },
  ]);
  assert.equal(match.matched, false);
  assert.equal(match.method, "rejected_generic_url");
});

test("identity precedence reports Wix ID, article URL and slug methods", () => {
  assert.equal(articleLiveSetMatch(activeArticle, [
    { wix_item_id: "wix-1", canonical_url: "", slug: "" },
  ]).method, "wix_item_id");
  assert.equal(articleLiveSetMatch({ ...activeArticle, wix_item_id: "" }, [
    { wix_item_id: "", canonical_url: activeArticle.live_wix_url.toLowerCase(), slug: "" },
  ]).method, "article_specific_canonical_url");
  assert.equal(articleLiveSetMatch({ ...activeArticle, wix_item_id: "", live_wix_url: "" }, [
    { wix_item_id: "", canonical_url: "", slug: "example-article" },
  ]).method, "slug");
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

test("deactivation scope is limited to Wix Knowledge Hub managed records", () => {
  assert.equal(isWixKnowledgeManagedArticle(activeArticle, "knowledge-hub"), true);
  assert.equal(isWixKnowledgeManagedArticle({
    id: "manual-url",
    live_wix_url: "https://example.com/page",
    title: "Manually added URL",
  }, "knowledge-hub"), false);
});

test("unrelated manual URLs remain untouched even if they have publication dates", () => {
  const manual = {
    id: "manual-url",
    live_wix_url: "https://example.com/page",
    published_at: "2026-07-01T10:00:00Z",
    publication_verified_at: "2026-07-01T10:05:00Z",
    wix_sync_status: "live",
    wix_publication_status: "live",
  };
  assert.equal(isWixKnowledgeManagedArticle(manual, "knowledge-hub"), false);
  assert.equal(deactivationSelectionReason(manual, [], "knowledge-hub").selected, false);
});

test("title-only records remain untouched", () => {
  assert.equal(isWixKnowledgeManagedArticle({
    id: "title-only",
    title: activeArticle.title,
    slug: activeArticle.slug,
  }, "knowledge-hub"), false);
});

test("47 active historical rows with shared root URL reconcile to 19 live and 28 missing", () => {
  const genericUrl = "https://www.vanfinancecompany.co.uk/knowledge-hub/";
  const liveIdentities = Array.from({ length: 19 }, (_, index) => ({
    wix_item_id: `wix-${index + 1}`,
    canonical_url: `https://www.vanfinancecompany.co.uk/knowledge-hub-article/live-${index + 1}`,
    generic_url_rejected: false,
    slug: `live-${index + 1}`,
  }));
  const current = liveIdentities.map((identity, index) => ({
    ...activeArticle,
    id: `current-${index + 1}`,
    title: `Current ${index + 1}`,
    slug: identity.slug,
    wix_item_id: identity.wix_item_id,
    live_wix_url: identity.canonical_url,
  }));
  const historical = Array.from({ length: 28 }, (_, index) => ({
    ...activeArticle,
    id: `historical-${index + 1}`,
    title: `Historical ${index + 1}`,
    slug: "",
    wix_item_id: `old-${index + 1}`,
    wix_collection_id: null,
    live_wix_url: genericUrl,
    publication_verification_notes: "Previously verified from Wix Knowledge Hub",
  }));
  const manual = {
    id: "manual-1",
    title: "Manual",
    live_wix_url: "https://example.com/manual",
    published_at: activeArticle.published_at,
    publication_verified_at: activeArticle.publication_verified_at,
    wix_sync_status: "live",
    wix_publication_status: "live",
    is_active: true,
  };
  const rows = [...current, ...historical, manual];
  const managed = rows.filter((row) => isWixKnowledgeManagedArticle(row, "knowledge-hub"));
  const matched = managed.filter((row) => articleIsPresentInLiveSet(row, liveIdentities));
  const missing = managed.filter(
    (row) => deactivationSelectionReason(row, liveIdentities, "knowledge-hub").selected,
  );
  assert.equal(managed.length, 47);
  assert.equal(matched.length, 19);
  assert.equal(missing.length, 28);
  assert.equal(isWixKnowledgeManagedArticle(manual, "knowledge-hub"), false);

  const deactivated = missing.map((row) => ({
    ...row,
    is_active: false,
    wix_sync_status: "unpublished",
    wix_publication_status: "unpublished",
    publication_verified_at: null,
    unpublished_at: "2026-07-30T08:00:00Z",
  }));
  const after = [...current, ...deactivated, manual];
  assert.equal(buildVisibilitySummary({ articles: after }).published_pages, 19);
  assert.equal(
    deactivated.filter(
      (row) => deactivationSelectionReason(row, liveIdentities, "knowledge-hub").selected,
    ).length,
    0,
  );
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
  const summary = buildVisibilitySummary({ articles: [activeArticle, inactive] });
  assert.equal(summary.published_pages, 1);
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

test("diagnostics expose identity match counts", async () => {
  const diagnostics = await read("../api/marketing-ai-visibility-wix-diagnostics.js");
  assert.match(diagnostics, /matched_by_wix_item_id/);
  assert.match(diagnostics, /matched_by_article_specific_canonical_url/);
  assert.match(diagnostics, /matched_by_slug/);
  assert.match(diagnostics, /rejected_generic_urls/);
});

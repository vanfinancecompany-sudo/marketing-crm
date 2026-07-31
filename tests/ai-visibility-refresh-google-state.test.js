import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  VISIBILITY_RESULT_STATUSES,
  buildArticleVisibility,
  buildVisibilitySummary,
  filterVisibilityArticles,
  googleCustomerStatus,
} from "../lib/aiVisibility.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

function publishedArticle(overrides = {}) {
  return {
    id: "article-1",
    title: "Published article",
    is_active: true,
    live_wix_url: "https://www.vanfinancecompany.co.uk/knowledge-hub/example",
    published_at: "2026-07-01T10:00:00.000Z",
    publication_verified_at: "2026-07-01T10:01:00.000Z",
    last_wix_sync_at: "2026-07-31T10:00:00.000Z",
    wix_sync_status: "live",
    wix_publication_status: "live",
    ...overrides,
  };
}

test("published-page summary is recalculated from current persisted article rows", () => {
  const first = publishedArticle();
  const second = publishedArticle({
    id: "article-2",
    title: "Second article",
    live_wix_url: "https://www.vanfinancecompany.co.uk/knowledge-hub/second",
  });
  const summary = buildVisibilitySummary({ articles: [first, second], results: [], prompts: [] });
  assert.equal(summary.published_pages, 2);
  assert.equal(summary.awaiting_first_check, 2);

  const deactivated = buildVisibilitySummary({
    articles: [first, { ...second, is_active: false }],
    results: [],
    prompts: [],
  });
  assert.equal(deactivated.published_pages, 1);
});

test("Google failure attempts have their own timestamp and visible error status", () => {
  const article = publishedArticle();
  const visibility = buildArticleVisibility({
    article,
    results: [
      {
        id: "google-error-1",
        article_id: article.id,
        provider: "google_search_console",
        checked_at: "2026-07-31T11:00:00.000Z",
        result_status: "error",
      },
      {
        id: "manual-ai-1",
        article_id: article.id,
        provider: "chatgpt",
        checked_at: "2026-07-31T10:30:00.000Z",
        result_status: "not_detected",
      },
    ],
    prompts: [],
  });

  assert.equal(visibility.google_indexing_status, "error");
  assert.equal(visibility.last_google_checked_at, "2026-07-31T11:00:00.000Z");
  assert.equal(visibility.last_ai_provider_checked_at, "2026-07-31T10:30:00.000Z");
  assert.equal(visibility.last_wix_synced_at, article.last_wix_sync_at);
});

test("completed Google checks with no verdict are customer-facing Pending", () => {
  const pendingArticle = publishedArticle();
  const indexedArticle = publishedArticle({
    id: "article-2",
    title: "Indexed article",
    live_wix_url: "https://www.vanfinancecompany.co.uk/knowledge-hub/indexed",
  });
  const results = [
    {
      id: "pending-1",
      article_id: pendingArticle.id,
      provider: "google_search_console",
      checked_at: "2026-07-31T12:00:00.000Z",
      result_status: "inconclusive",
      error_details: "",
      structured_evidence: { impressions: 0, clicks: 0, inspection_error: "" },
    },
    {
      id: "indexed-1",
      article_id: indexedArticle.id,
      provider: "google_search_console",
      checked_at: "2026-07-31T12:00:00.000Z",
      result_status: "indexed",
    },
  ];
  const summary = buildVisibilitySummary({
    articles: [pendingArticle, indexedArticle],
    results,
    prompts: [],
  });
  const pending = summary.articles.find((item) => item.article.id === pendingArticle.id);

  assert.equal(googleCustomerStatus(results[0]), "pending");
  assert.equal(pending.google_indexing_status, "pending");
  assert.equal(pending.awaiting_first_check, false);
  assert.equal(pending.needs_attention, false);
  assert.match(pending.recommended_action, /has not returned an indexing verdict yet/i);
  assert.equal(summary.google_indexed, 1);
  assert.equal(summary.google_pending, 1);
  assert.equal(summary.awaiting_first_check, 0);
  assert.deepEqual(
    filterVisibilityArticles(summary.articles, { status: "pending" }).map((item) => item.article.id),
    [pendingArticle.id],
  );
});

test("provider connection refresh preserves successful timestamps and stores failures", async () => {
  const api = await read("../api/marketing-ai-visibility-connections.js");
  assert.match(api, /existing\.last_successful_check_at \|\| null/);
  assert.match(api, /recordGoogleFailure/);
  assert.match(api, /result_status: "error"/);
  assert.match(api, /last_bulk_summary/);
  assert.match(api, /last_check_attempt_at/);
  assert.match(api, /last_check_completed_at/);
  assert.doesNotMatch(api, /last_successful_check_at: updates\.last_successful_check_at \|\| null/);
});

test("Google reconciliation distinguishes Pending from genuine failures", async () => {
  const googleApi = await read("../api/marketing-ai-visibility-google.js");
  const manualApi = await read("../api/marketing-ai-visibility-manual.js");
  assert.match(googleApi, /result_status: "inconclusive"/);
  assert.match(googleApi, /customer_status: "pending"/);
  assert.match(googleApi, /customer_label: "Pending"/);
  assert.match(googleApi, /inspectionError/);
  assert.match(googleApi, /result_status: "error"/);
  assert.match(googleApi, /error_details: ""/);
  assert.match(googleApi, /evidence_excerpt: clean\(next\.evidence_excerpt\)/);
  assert.doesNotMatch(googleApi, /error_details: null/);
  assert.match(manualApi, /error_details: ""/);
  assert.match(googleApi, /const normalization = await normalizeCompletedGoogleRows\(supabase\);[\s\S]*await connectionsHandler/);
});

test("result-status migration permits the complete authoritative application set", async () => {
  const migration = await read("../supabase/migrations/029_ai_visibility_result_status_compatibility.sql");
  const expected = new Set(VISIBILITY_RESULT_STATUSES);

  for (const status of expected) {
    assert.match(migration, new RegExp(`'${status}'`), `migration must permit ${status}`);
  }

  assert.deepEqual(
    [...expected].sort(),
    [
      "checking",
      "cited",
      "detected",
      "error",
      "inconclusive",
      "indexed",
      "mentioned",
      "not_checked",
      "not_detected",
      "not_indexed",
      "performance_found",
    ].sort(),
  );
  assert.match(migration, /drop constraint if exists knowledge_visibility_results_result_status_check/);
  assert.match(migration, /add constraint knowledge_visibility_results_result_status_check/);
  assert.match(migration, /not valid/);
  assert.match(migration, /validate constraint knowledge_visibility_results_result_status_check/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.knowledge_visibility_results/i);
  assert.doesNotMatch(migration, /update\s+public\.knowledge_visibility_results/i);
});

test("Google service uses one effective connection endpoint for both panels", async () => {
  const service = await read("../services/aiVisibility.js");
  assert.match(service, /CONNECTIONS_API_ROUTE = "\/api\/marketing-ai-visibility-google"/);
  assert.match(service, /loadGoogleSearchConsoleConnection/);
  assert.match(service, /await loadGoogleSearchConsoleConnection\(\)/);
  assert.match(service, /AIVisibilityPendingState/);
});

test("pending UI enhancer covers cards, filters, table and evidence detail", async () => {
  const component = await read("../components/AIVisibilityPendingState.jsx");
  assert.match(component, /Google pending/);
  assert.match(component, /Google completed the check but has not returned an indexing verdict yet/);
  assert.match(component, /option\.value = "pending"/);
  assert.match(component, /patchArticleTable/);
  assert.match(component, /patchArticleDetail/);
  assert.match(component, /patchCurrentProviderCards/);
  assert.match(component, /data-ai-visibility-pending-state/);
});

test("AI Visibility page refetches every data source after live actions", async () => {
  const page = await read("../pages/AIVisibilityPage.jsx");
  assert.match(page, /ai-visibility-live-data-updated/);
  assert.match(page, /refreshFromLiveAction/);
  assert.match(page, /Last Wix synced/);
  assert.match(page, /Last Google checked/);
  assert.match(page, /Last AI-provider checked/);
  assert.match(page, /ProviderConnections providers=\{data\.provider_connections\}/);
});

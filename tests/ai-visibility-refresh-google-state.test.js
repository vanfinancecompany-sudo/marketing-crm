import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildArticleVisibility,
  buildVisibilitySummary,
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

test("AI Visibility page refetches every data source after live actions", async () => {
  const page = await read("../pages/AIVisibilityPage.jsx");
  assert.match(page, /ai-visibility-live-data-updated/);
  assert.match(page, /refreshFromLiveAction/);
  assert.match(page, /Last Wix synced/);
  assert.match(page, /Last Google checked/);
  assert.match(page, /Last AI-provider checked/);
  assert.match(page, /ProviderConnections providers=\{data\.provider_connections\}/);
});

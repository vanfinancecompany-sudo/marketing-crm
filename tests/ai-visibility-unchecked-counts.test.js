import test from "node:test";
import assert from "node:assert/strict";
import {
  buildVisibilitySummary,
  publishedCheckCoverage,
} from "../lib/aiVisibility.js";

const articles = Array.from({ length: 25 }, (_, index) => ({
  id: `article-${index + 1}`,
  title: `Article ${index + 1}`,
  live_wix_url: `https://www.vanfinancecompany.co.uk/knowledge-hub-article/article-${index + 1}`,
  published_at: "2026-07-01T10:00:00Z",
  publication_verified_at: "2026-07-01T10:05:00Z",
  wix_sync_status: "live",
  wix_publication_status: "live",
}));

const result = (articleId, status, provider = "google_search_console") => ({
  id: `${articleId}-${status}-${provider}`,
  article_id: articleId,
  provider,
  result_status: status,
  checked_at: "2026-07-20T10:00:00Z",
});

test("25 published articles without evidence are all awaiting first check", () => {
  const summary = buildVisibilitySummary({ articles, results: [] });
  assert.equal(summary.published_pages, 25);
  assert.equal(summary.checked_pages, 0);
  assert.equal(summary.awaiting_first_check, 25);
  assert.equal(summary.unchecked_pages, 25);
  assert.equal(summary.unchecked_article_ids.length, 25);
});

test("one completed Google result checks one unique article", () => {
  const summary = buildVisibilitySummary({
    articles,
    results: [result("article-1", "indexed")],
  });
  assert.equal(summary.checked_pages, 1);
  assert.equal(summary.awaiting_first_check, 24);
});

test("multiple completed results for one article still count once", () => {
  const summary = buildVisibilitySummary({
    articles,
    results: [
      result("article-1", "indexed"),
      result("article-1", "performance_found"),
      result("article-1", "not_detected", "chatgpt"),
    ],
  });
  assert.equal(summary.checked_pages, 1);
  assert.equal(summary.awaiting_first_check, 24);
});

test("failed, configuration and pending states do not count as completed", () => {
  for (const status of [
    "error",
    "configuration_required",
    "provider_request_failed",
    "checking",
    "not_checked",
  ]) {
    const summary = buildVisibilitySummary({
      articles,
      results: [result("article-1", status)],
    });
    assert.equal(summary.checked_pages, 0, status);
    assert.equal(summary.awaiting_first_check, 25, status);
  }
});

test("manual detected, not detected and inconclusive count as completed", () => {
  for (const status of ["detected", "not_detected", "inconclusive"]) {
    const summary = buildVisibilitySummary({
      articles,
      results: [result("article-1", status, "chatgpt")],
    });
    assert.equal(summary.checked_pages, 1, status);
    assert.equal(summary.awaiting_first_check, 24, status);
  }
});

test("shared coverage helper deduplicates article IDs", () => {
  const coverage = publishedCheckCoverage([
    { article: articles[0], checked_successfully: true },
    { article: articles[0], checked_successfully: true },
    { article: articles[1], checked_successfully: false },
  ]);
  assert.equal(coverage.published_count, 2);
  assert.equal(coverage.checked_count, 1);
  assert.equal(coverage.unchecked_count, 1);
});

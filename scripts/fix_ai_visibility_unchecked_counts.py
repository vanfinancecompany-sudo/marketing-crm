from pathlib import Path


def replace(path, old, new):
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"marker not found in {path}: {old[:120]!r}")
    file.write_text(text.replace(old, new), encoding="utf-8")


replace(
    "lib/aiVisibility.js",
    "export function buildArticleVisibility({\n",
    '''export function publishedCheckCoverage(articleResults = []) {
  const checkedArticleIds = new Set(
    articleResults
      .filter((item) => item.checked_successfully)
      .map((item) => item.article.id),
  );
  const publishedArticleIds = new Set(articleResults.map((item) => item.article.id));
  const uncheckedArticleIds = new Set(
    [...publishedArticleIds].filter((articleId) => !checkedArticleIds.has(articleId)),
  );
  return {
    published_article_ids: publishedArticleIds,
    checked_article_ids: checkedArticleIds,
    unchecked_article_ids: uncheckedArticleIds,
    published_count: publishedArticleIds.size,
    checked_count: checkedArticleIds.size,
    unchecked_count: uncheckedArticleIds.size,
  };
}

export function buildArticleVisibility({
''',
)
replace(
    "lib/aiVisibility.js",
    "    awaiting_first_check: articleResults.length === 0,\n",
    "    awaiting_first_check: !checkedSuccessfully,\n",
)
replace(
    "lib/aiVisibility.js",
    "  const aiEligible = articleResults.filter((item) => item.ai_eligible);\n",
    "  const coverage = publishedCheckCoverage(articleResults);\n  const aiEligible = articleResults.filter((item) => item.ai_eligible);\n",
)
replace(
    "lib/aiVisibility.js",
    "    published_pages: published.length,\n",
    '''    published_pages: coverage.published_count,
    checked_pages: coverage.checked_count,
    unchecked_pages: coverage.unchecked_count,
    checked_article_ids: [...coverage.checked_article_ids],
    unchecked_article_ids: [...coverage.unchecked_article_ids],
''',
)
replace(
    "lib/aiVisibility.js",
    "    awaiting_first_check: articleResults.filter((item) => item.awaiting_first_check).length,\n",
    "    awaiting_first_check: coverage.unchecked_count,\n",
)

replace(
    "pages/AIVisibilityPage.jsx",
    '''              {summary.published_pages} published pages ·{" "}
              {
                summary.articles.filter((item) => item.checked_successfully)
                  .length
              }{" "}
              checked
''',
    '''              {summary.published_pages} published pages · {summary.checked_pages} checked
''',
)
replace(
    "pages/AIVisibilityPage.jsx",
    '''            <div className="panel">
              <h3>Not yet checked</h3>
              {summary.articles
                .filter((item) => item.awaiting_first_check)
                .slice(0, 5)
                .map((item) => (
                  <button
                    className="visibility-quick-row"
                    type="button"
                    key={item.article.id}
                    onClick={() => setSelectedId(item.article.id)}
                  >
                    {item.article.title}
                  </button>
                ))}
              {!summary.awaiting_first_check ? (
                <div className="notice">
                  Every published page has a completed check.
                </div>
              ) : null}
            </div>
''',
    '''            <div className="panel">
              <h3>Not yet checked</h3>
              {summary.awaiting_first_check ? (
                <div className="notice">
                  {summary.awaiting_first_check} published pages have not yet been checked.
                </div>
              ) : null}
              {summary.articles
                .filter((item) => summary.unchecked_article_ids.includes(item.article.id))
                .slice(0, 5)
                .map((item) => (
                  <button
                    className="visibility-quick-row"
                    type="button"
                    key={item.article.id}
                    onClick={() => {
                      setFilters((current) => ({ ...current, status: "not_checked" }));
                      setArticlePage(1);
                      setArticlesOpen(true);
                    }}
                  >
                    {item.article.title}
                  </button>
                ))}
              {!summary.awaiting_first_check ? (
                <div className="notice">
                  Every published page has a completed check.
                </div>
              ) : null}
            </div>
''',
)

Path("tests/ai-visibility-unchecked-counts.test.js").write_text(r'''import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildVisibilitySummary, publishedCheckCoverage } from "../lib/aiVisibility.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
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
  const summary = buildVisibilitySummary({ articles, results: [result("article-1", "indexed")] });
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
  for (const status of ["error", "configuration_required", "provider_request_failed", "checking", "not_checked"]) {
    const summary = buildVisibilitySummary({ articles, results: [result("article-1", status)] });
    assert.equal(summary.checked_pages, 0, status);
    assert.equal(summary.awaiting_first_check, 25, status);
  }
});

test("manual detected, not detected and inconclusive count as completed", () => {
  for (const status of ["detected", "not_detected", "inconclusive"]) {
    const summary = buildVisibilitySummary({ articles, results: [result("article-1", status, "chatgpt")] });
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

test("page summary and not-yet-checked panel consume shared summary fields", async () => {
  const page = await read("../pages/AIVisibilityPage.jsx");
  assert.match(page, /summary\.checked_pages/);
  assert.match(page, /summary\.unchecked_article_ids/);
  assert.match(page, /published pages have not yet been checked/);
  assert.match(page, /Every published page has a completed check/);
});

test("pagination and filters do not feed global coverage", async () => {
  const page = await read("../pages/AIVisibilityPage.jsx");
  assert.match(page, /buildVisibilitySummary/);
  assert.match(page, /pageRows = rows\.slice/);
  assert.doesNotMatch(page, /buildVisibilitySummary\([^]*pageRows/);
});

test("Google remains explicit and no live Wix publication is introduced", async () => {
  const component = await read("../components/AIVisibilityLiveConnections.jsx");
  const wix = await read("../api/marketing-wix-publishing.js");
  assert.match(component, /Check Google for Published Pages/);
  assert.doesNotMatch(component, /useEffect\(\(\) => checkGoogleForPublishedPages/);
  assert.doesNotMatch(wix, /publishLive|livePublish/);
});
''', encoding="utf-8")

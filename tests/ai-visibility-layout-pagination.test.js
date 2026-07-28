import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("statistics render before the live controls and manual providers", async () => {
  const page = await read("../pages/AIVisibilityPage.jsx");
  assert.ok(
    page.indexOf("<SummaryCards") <
      page.indexOf("data-ai-visibility-live-anchor"),
  );
});

test("manual AI checks are collapsed by default and workflow closes after save", async () => {
  const component = await read("../components/AIVisibilityLiveConnections.jsx");
  assert.match(component, /<details[^>]*data-manual-ai-checks/);
  assert.match(component, /Manual AI checks/);
  assert.match(component, /4 manual providers available/);
  assert.match(component, /setManualProvider\(""\)/);
  assert.match(component, /How to run a manual check/);
});

test("published article results use client-side pagination with required page sizes", async () => {
  const page = await read("../pages/AIVisibilityPage.jsx");
  assert.match(page, /ARTICLE_PAGE_SIZES = \[10, 25, 50, 100\]/);
  assert.match(page, /useState\(25\)/);
  assert.match(page, /pageRows = rows\.slice/);
  assert.match(
    page,
    /Showing \{rows\.length \? pageStart \+ 1 : 0\}–\{pageEnd\} of \{rows\.length\}/,
  );
  assert.match(page, /Previous article results page/);
  assert.match(page, /Next article results page/);
  assert.match(page, /aria-current=\{page === safeArticlePage \? "page"/);
  assert.match(page, /View Evidence/);
});

test("filter and sort changes reset pagination", async () => {
  const page = await read("../pages/AIVisibilityPage.jsx");
  assert.match(
    page,
    /useEffect\(\(\) => setArticlePage\(1\), \[filters\.search, filters\.provider, filters\.status, filters\.from, filters\.to, filters\.sort, articlePageSize\]\)/,
  );
});

test("Google and Wix behaviour remain explicit and unchanged", async () => {
  const component = await read("../components/AIVisibilityLiveConnections.jsx");
  assert.match(component, /Check Google for Published Pages/);
  assert.match(component, /Sync Live Wix Articles/);
  assert.doesNotMatch(component, /useEffect\([^]*checkGoogleForPublishedPages/);
  assert.doesNotMatch(
    component,
    /publishLive|livePublish|puppeteer|playwright/,
  );
});

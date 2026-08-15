import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "public/knowledge-hub-search/site-loader.js"), "utf8");
const apiSource = fs.readFileSync(path.join(root, "api/public-knowledge-hub-search.js"), "utf8");

test("Knowledge Hub search loader is exact-path gated on both websites and cannot appear on article or stock pages", () => {
  assert.match(source, /new Set\(\["\/knowledge-hub-category\/rent2buy"\]\)/);
  assert.match(source, /new Set\(\["\/knowledge-hub"\]\)/);
  assert.match(source, /return SITE\.paths\.has\(normalisedPath\.toLowerCase\(\)\)/);
  assert.doesNotMatch(source, /startsWith\("\/knowledge-hub"\)/);
});

test("Knowledge Hub search survives Wix client-side navigation without remaining on other pages", () => {
  assert.match(source, /function syncRoute\(\)/);
  assert.match(source, /if \(isKnowledgeHubPath\(\)\) mount\(\)/);
  assert.match(source, /else if \(host \|\| targetObserver\) teardown\(\)/);
  assert.match(source, /setInterval\(syncRoute, 700\)/);
});

test("Knowledge Hub search loader uses isolated site-aware UI", () => {
  assert.match(source, /attachShadow\(\{ mode: "open" \}\)/);
  assert.match(source, /rent2buyvans\.co\.uk/);
  assert.match(source, /Rent2Buy Knowledge Hub/);
  assert.match(source, /across our Rent2Buy guides/);
  assert.match(source, /Van Finance/);
  assert.match(source, /Vehicle Guides/);
  assert.match(source, /Business Advice/);
  assert.match(source, /if \(SITE\.categories\.length <= 1\) return ""/);
  assert.match(source, /Ask a question or search by keyword/);
});

test("Knowledge Hub site loader uses the compact bounded VFC search design instead of expanding result cards", () => {
  assert.match(source, /width:min\(680px, calc\(100% - 32px\)\)/);
  assert.match(source, /border:2px solid #111/);
  assert.match(source, /class="search-row"/);
  assert.match(source, /class="search-button"/);
  assert.match(source, /id="resultsView" class="hidden"/);
  assert.match(source, /class="match-list"/);
  assert.match(source, /\.slice\(0, 3\)/);
  assert.match(source, /searchView\?\.classList\.add\("hidden"\)/);
  assert.match(source, /resultsView\?\.classList\.remove\("hidden"\)/);
  assert.doesNotMatch(source, /result-excerpt/);
  assert.doesNotMatch(source, /display:grid; gap:10px/);
});

test("Knowledge Hub search reuses the session-only anonymous analytics id and persists only the internal-test marker", () => {
  assert.match(source, /vfc_ai_assistant_analytics_session_v1/);
  assert.match(source, /sessionStorage/);
  assert.match(source, /vfc_internal_analytics_v1/);
  assert.match(source, /vfc_internal_test/);
  assert.match(source, /localStorage\.setItem\(INTERNAL_ANALYTICS_STORAGE_KEY, "1"\)/);
  assert.match(source, /localStorage\.removeItem\(INTERNAL_ANALYTICS_STORAGE_KEY\)/);
  assert.match(source, /visitor_id: analyticsVisitorForRequest\(\)/);
  assert.doesNotMatch(source, /localStorage\.setItem\([^,]+,\s*query/);
  assert.doesNotMatch(source, /localStorage\.setItem\([^,]+,\s*activeSearch/);
});

test("result selection analytics never block article navigation", () => {
  const selectionHandler = source.slice(source.indexOf("function recordSelection"), source.indexOf("function resetRefs"));
  assert.match(selectionHandler, /keepalive: true/);
  assert.match(selectionHandler, /Search analytics must never block navigation to an article/);
  assert.doesNotMatch(selectionHandler, /event\.preventDefault\(\)/);
});

test("public search API strips ranking scores and has explicit VFC and Rent2Buy origin scopes", () => {
  assert.match(apiSource, /results\.map\(\(\{ score: _score, \.\.\.result \}\) => result\)/);
  assert.match(apiSource, /vanfinancecompany\.co\.uk/);
  assert.match(apiSource, /rent2buyvans\.co\.uk/);
  assert.match(apiSource, /if \(VFC_HOSTS\.has\(hostname\)\) return "vfc"/);
  assert.match(apiSource, /if \(RENT2BUY_HOSTS\.has\(hostname\)\) return "rent2buy"/);
  assert.match(apiSource, /RENT2BUY_KNOWLEDGE_HUB_INDEX/);
  assert.doesNotMatch(apiSource, /WIX_API_KEY/);
  assert.doesNotMatch(apiSource, /loadRent2BuyKnowledgeHubArticles/);
});

test("public search API rate limits with a search-specific hashed key", () => {
  assert.match(apiSource, /knowledge-search:/);
  assert.match(apiSource, /SEARCH_LIMIT_PER_MINUTE = 30/);
  assert.match(apiSource, /SEARCH_LIMIT_PER_DAY = 500/);
});
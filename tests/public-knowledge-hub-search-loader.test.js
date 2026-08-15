import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "public/knowledge-hub-search/site-loader.js"), "utf8");
const rent2BuyEmbed = fs.readFileSync(path.join(root, "public/rent2buy-knowledge-hub-search/index.html"), "utf8");
const rent2BuyApi = fs.readFileSync(path.join(root, "api/public-rent2buy-knowledge-hub-search.js"), "utf8");
const apiSource = fs.readFileSync(path.join(root, "api/public-knowledge-hub-search.js"), "utf8");

test("site loader only auto-mounts the VFC Knowledge Hub and leaves Rent2Buy movable", () => {
  assert.match(source, /vanfinancecompany\.co\.uk/);
  assert.match(source, /const PATH = "\/knowledge-hub"/);
  assert.match(source, /VFC_HOSTS\.has\(hostname\)/);
  assert.doesNotMatch(source, /knowledge-hub-category\/rent2buy/);
  assert.doesNotMatch(source, /rent2buyvans\.co\.uk/);
});

test("VFC Knowledge Hub search survives Wix client-side navigation without remaining on other pages", () => {
  assert.match(source, /function syncRoute\(\)/);
  assert.match(source, /if \(isVfcKnowledgeHub\(\)\) mount\(\)/);
  assert.match(source, /else if \(host \|\| observer\) teardown\(\)/);
  assert.match(source, /setInterval\(syncRoute, 700\)/);
});

test("VFC site loader keeps the compact bounded search design", () => {
  assert.match(source, /attachShadow\(\{ mode: "open" \}\)/);
  assert.match(source, /width:min\(680px,calc\(100% - 32px\)\)/);
  assert.match(source, /border:2px solid #111/);
  assert.match(source, /class=\"search-row\"/);
  assert.match(source, /class=\"search-button\"/);
  assert.match(source, /id=\"resultsView\" class=\"hidden\"/);
  assert.match(source, /class=\"match-list\"/);
  assert.match(source, /\.slice\(0, 3\)/);
  assert.doesNotMatch(source, /result-excerpt/);
});

test("Rent2Buy has a standalone compact Wix embed using the Rent2Buy-only endpoint", () => {
  assert.match(rent2BuyEmbed, /Rent2Buy Knowledge Hub/);
  assert.match(rent2BuyEmbed, /public-rent2buy-knowledge-hub-search/);
  assert.match(rent2BuyEmbed, /target=\"_top\"/);
  assert.match(rent2BuyEmbed, /\.slice\(0,3\)/);
  assert.match(rent2BuyEmbed, /Search again/);
  assert.match(rent2BuyEmbed, /Cancel/);
  assert.doesNotMatch(rent2BuyEmbed, /Van Finance Company/);
  assert.match(rent2BuyApi, /https:\/\/www\.rent2buyvans\.co\.uk/);
  assert.match(rent2BuyApi, /public-knowledge-hub-search\.js/);
});

test("Knowledge Hub search keeps anonymous internal-test telemetry support", () => {
  for (const text of [source, rent2BuyEmbed]) {
    assert.match(text, /vfc_ai_assistant_analytics_session_v1/);
    assert.match(text, /vfc_internal_analytics_v1/);
    assert.match(text, /vfc_internal_test/);
    assert.match(text, /internal:/);
  }
});

test("result selection analytics never block article navigation", () => {
  const selectionHandler = source.slice(source.indexOf("function recordSelection"), source.indexOf("function reset"));
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

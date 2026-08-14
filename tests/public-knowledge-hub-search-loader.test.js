import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "public/knowledge-hub-search/site-loader.js"), "utf8");
const apiSource = fs.readFileSync(path.join(root, "api/public-knowledge-hub-search.js"), "utf8");

test("Knowledge Hub search loader is exact-path gated and cannot appear on article or stock pages", () => {
  assert.match(source, /normalisedPath !== "\/knowledge-hub"/);
  assert.doesNotMatch(source, /startsWith\("\/knowledge-hub"\)/);
});

test("Knowledge Hub search loader uses isolated UI and customer-facing category filters", () => {
  assert.match(source, /attachShadow\(\{ mode: "open" \}\)/);
  assert.match(source, /Van Finance/);
  assert.match(source, /Rent2Buy/);
  assert.match(source, /Vehicle Guides/);
  assert.match(source, /Business Advice/);
  assert.match(source, /Ask a question or search by keyword/);
});

test("Knowledge Hub search reuses the session-only anonymous analytics id and does not store search data locally", () => {
  assert.match(source, /vfc_ai_assistant_analytics_session_v1/);
  assert.match(source, /sessionStorage/);
  assert.doesNotMatch(source, /localStorage/);
});

test("result selection analytics never block article navigation", () => {
  assert.match(source, /keepalive: true/);
  assert.match(source, /Search analytics must never block navigation to an article/);
  assert.doesNotMatch(source, /event\.preventDefault\(\)/);
});

test("public search API strips internal ranking scores and only allows the VFC site origin", () => {
  assert.match(apiSource, /results\.map\(\(\{ score: _score, \.\.\.result \}\) => result\)/);
  assert.match(apiSource, /vanfinancecompany\.co\.uk/);
  assert.match(apiSource, /www\.vanfinancecompany\.co\.uk/);
  assert.doesNotMatch(apiSource, /rent2buyvans\.co\.uk/);
});

test("public search API rate limits with a search-specific hashed key", () => {
  assert.match(apiSource, /knowledge-search:/);
  assert.match(apiSource, /SEARCH_LIMIT_PER_MINUTE = 30/);
  assert.match(apiSource, /SEARCH_LIMIT_PER_DAY = 500/);
});

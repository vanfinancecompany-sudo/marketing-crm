import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const EMBED_PATH = new URL("../public/knowledge-hub-search/embed.html", import.meta.url);

async function embedSource() {
  return readFile(EMBED_PATH, "utf8");
}

test("results actions live in the results heading instead of below the matches", async () => {
  const source = await embedSource();
  const headingStart = source.indexOf('<div class="results-heading">');
  const matchList = source.indexOf('<div id="matchList"');
  const actions = source.indexOf('<div class="results-actions">');
  assert.ok(headingStart >= 0);
  assert.ok(actions > headingStart);
  assert.ok(actions < matchList);
  assert.equal(source.indexOf('<div class="results-actions">', actions + 1), -1);
});

test("result rows use a fixed one-line footprint", async () => {
  const source = await embedSource();
  assert.match(source, /\.match \{[^}]*height: 41px;/s);
  assert.match(source, /\.match-title \{[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;/s);
});

test("mobile input stays at 16px and mobile actions do not programmatically refocus it", async () => {
  const source = await embedSource();
  assert.match(source, /@media \(max-width: 640px\)[\s\S]*\.search-input \{ min-height: 44px; font-size: 16px; \}/);
  assert.match(source, /function canFocusWithoutMobileJump\(\)[\s\S]*window\.innerWidth > 640/);
  assert.match(source, /input\.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /input\.blur\(\);/);
});

test("embedded document is hard-locked against its own mobile scroll range", async () => {
  const source = await embedSource();
  assert.match(source, /html, body \{[^}]*height: 100%;[^}]*min-height: 0;[^}]*overflow: hidden;[^}]*overscroll-behavior: none;/s);
  assert.match(source, /body \{[^}]*position: fixed;[^}]*inset: 0;[^}]*overflow: hidden;/s);
});

test("embed shell fills and clips the iframe viewport like the stable Rent2Buy embed", async () => {
  const source = await embedSource();
  assert.match(source, /\.shell \{[^}]*height: 100%;[^}]*min-height: 0;[^}]*overflow: hidden;[^}]*overscroll-behavior: none;/s);
});

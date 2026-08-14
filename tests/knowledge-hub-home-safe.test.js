import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "public/knowledge-hub-ui/home-safe.js"), "utf8");

test("safe helper never hides the whole Wix page", () => {
  assert.doesNotMatch(source, /visibility:\s*hidden/);
  assert.doesNotMatch(source, /vfc-kh-preparing/);
  assert.doesNotMatch(source, /SITE_PAGES/);
  assert.doesNotMatch(source, /PAGES_CONTAINER/);
});

test("intro is inserted immediately before the search without relocating the search host", () => {
  assert.match(source, /search\.parentNode\.insertBefore\(intro, search\)/);
  assert.doesNotMatch(source, /insertAdjacentElement/);
  assert.doesNotMatch(source, /appendChild\(search\)/);
});

test("empty search status and results consume no height", () => {
  assert.match(source, /\.status:empty,\.results:empty/);
  assert.match(source, /height:0 !important/);
});

test("bottom category links use a real wrapping flex layout with spacing and no underlines", () => {
  assert.match(source, /vfc-kh-home-category-links/);
  assert.match(source, /flex-wrap:wrap/);
  assert.match(source, /gap:10px 12px/);
  assert.match(source, /text-decoration:none !important/);
});

test("DOM updates are coalesced in a microtask, not delayed with an animation timeout", () => {
  assert.match(source, /queueMicrotask/);
  assert.match(source, /new MutationObserver\(queueApply\)/);
  assert.doesNotMatch(source, /setTimeout\(apply/);
});

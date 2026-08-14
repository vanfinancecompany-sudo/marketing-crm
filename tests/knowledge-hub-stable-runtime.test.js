import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "public/knowledge-hub-ui/stable-runtime.js"), "utf8");

test("stable runtime owns Hub, category and article routes", () => {
  assert.match(source, /if \(path === "\/knowledge-hub"\) return "hub"/);
  assert.match(source, /knowledge-hub-category/);
  assert.match(source, /knowledge-hub-articles/);
});

test("home intro is rendered beside the fixed search host instead of moving the search through Wix layout", () => {
  assert.match(source, /searchHost\.parentNode\.insertBefore\(intro, searchHost\)/);
  assert.doesNotMatch(source, /insertAdjacentElement\("afterend", host\)/);
  assert.match(source, /data-vfc-kh-original-intro/);
});

test("search shell removes empty status and result height", () => {
  assert.match(source, /\.status:empty,/);
  assert.match(source, /\.results:empty/);
  assert.match(source, /height: 0 !important/);
});

test("card re-skin runs from a microtask rather than an 80ms delayed repaint", () => {
  assert.match(source, /queueMicrotask/);
  assert.doesNotMatch(source, /setTimeout\(applyPolish,\s*80\)/);
  assert.match(source, /new MutationObserver\(queueApply\)/);
});

test("footer category navigation is rebuilt as a wrapping flex layout", () => {
  assert.match(source, /vfc-kh-category-nav__links/);
  assert.match(source, /flex-wrap: wrap/);
  assert.match(source, /gap: 10px 12px/);
  assert.match(source, /text-decoration: none !important/);
});

test("article counts are only read from exact leaf labels", () => {
  assert.match(source, /element\.children\.length === 0/);
  assert.match(source, /\^number of articles/);
  assert.match(source, /\^\(\\d\+\)\\s\+articles/);
});

test("preparing guard has a bounded reveal fallback", () => {
  assert.match(source, /vfc-kh-preparing/);
  assert.match(source, /setTimeout\(\(\) => document\.documentElement\.classList\.remove\("vfc-kh-preparing"\), 900\)/);
});

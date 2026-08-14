import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "public/knowledge-hub-ui/home-polish.js"), "utf8");

test("Knowledge Hub home polish is exact-path gated and removable on route change", () => {
  assert.match(source, /return path === "\/knowledge-hub"/);
  assert.match(source, /function teardown\(\)/);
  assert.match(source, /removeStyle\(\)/);
});

test("welcome block is found independently of search and search is inserted immediately after it", () => {
  assert.match(source, /welcome to the van finance company knowledge hub/i);
  assert.match(source, /filter\(\(element\) => !element\.closest\("#vfc-knowledge-hub-search"\)\)/);
  assert.match(source, /categoryLinks === 0 && articleLinks === 0 && !containsSearch/);
  assert.match(source, /intro\.insertAdjacentElement\("afterend", host\)/);
});

test("Back control does not prevent search sitting under the welcome copy", () => {
  assert.match(source, /function findBackControl\(root\)/);
  assert.match(source, /backWrap\.insertAdjacentElement\("beforebegin", host\)/);
});

test("empty search footer collapses and shell height is explicitly auto", () => {
  assert.match(source, /padding: 24px 28px 18px !important/);
  assert.match(source, /height: auto !important/);
  assert.match(source, /\.status:empty/);
  assert.match(source, /\.results:empty/);
  assert.match(source, /height: 0 !important/);
});

test("landing-page cards use border-box geometry, stronger shadow and no hover translation", () => {
  assert.match(source, /box-sizing: border-box !important/);
  assert.match(source, /box-shadow: 0 6px 18px rgba\(0,0,0,\.10\)/);
  assert.match(source, /border-color: #b30d14 !important/);
  assert.doesNotMatch(source, /translateY\(/);
});

test("desktop card text remains prominent", () => {
  assert.match(source, /vfc-kh-modern-card__title[\s\S]*font-size: 20px !important/);
  assert.match(source, /vfc-kh-modern-card__excerpt[\s\S]*font-size: 18px !important/);
  assert.match(source, /vfc-kh-modern-card__count[\s\S]*font-size: 16px !important/);
});

test("footer category pills have spacing, no underlines and no ellipsis clipping", () => {
  assert.match(source, /data-vfc-kh-category-link/);
  assert.match(source, /margin: 6px 8px !important/);
  assert.match(source, /text-decoration: none !important/);
  assert.match(source, /text-overflow: clip !important/);
  assert.match(source, /white-space: nowrap !important/);
});

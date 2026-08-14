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

test("intro block is moved above the search by placing search immediately after the welcome section", () => {
  assert.match(source, /welcome to the van finance company knowledge hub/i);
  assert.match(source, /intro\.insertAdjacentElement\("afterend", host\)/);
  assert.match(source, /categoryLinks === 0/);
});

test("empty search status and results do not create a large blank footer", () => {
  assert.match(source, /\.status:empty/);
  assert.match(source, /min-height: 0 !important/);
  assert.match(source, /\.results:empty/);
  assert.match(source, /margin: 28px auto !important/);
});

test("landing-page cards use border-box geometry, stronger shadow and no hover translation", () => {
  assert.match(source, /box-sizing: border-box !important/);
  assert.match(source, /box-shadow: 0 6px 18px rgba\(0,0,0,\.10\)/);
  assert.match(source, /border-color: #b30d14 !important/);
  assert.doesNotMatch(source, /translateY\(/);
});

test("desktop card text is upsized to match the prominent welcome copy", () => {
  assert.match(source, /vfc-kh-modern-card__title[\s\S]*font-size: 20px !important/);
  assert.match(source, /vfc-kh-modern-card__excerpt[\s\S]*font-size: 18px !important/);
  assert.match(source, /vfc-kh-modern-card__count[\s\S]*font-size: 16px !important/);
});

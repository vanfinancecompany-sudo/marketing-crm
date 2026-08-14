import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "public/knowledge-hub-search/desktop-polish.js"), "utf8");

test("Knowledge Hub desktop polish is exact-path and desktop gated", () => {
  assert.match(source, /return normalisedPath === "\/knowledge-hub"/);
  assert.match(source, /\(min-width: 769px\)/);
  assert.match(source, /if \(!isKnowledgeHubPath\(\) \|\| !isDesktop\(\)\) return/);
});

test("desktop search width is aligned to the category-card width target", () => {
  assert.match(source, /min\(820px, calc\(100% - 32px\)\)/);
  assert.match(source, /shadowRoot/);
  assert.match(source, /querySelector\?\.\("\.shell"\)/);
});

test("Back control is compact and moves back exactly one browser-history step", () => {
  assert.match(source, /control\.textContent = "← Back"/);
  assert.match(source, /window\.history\.back\(\)/);
  assert.doesNotMatch(source, /history\.go\(/);
  assert.match(source, /Go back to the previous page/);
});

test("Knowledge Hub footer category links become larger pill links and arrows are removed", () => {
  assert.match(source, /Knowledge Hub Categories/);
  assert.match(source, /data-vfc-kh-category-link/);
  assert.match(source, /font: 700 15px\/1\.15/);
  assert.match(source, /border-radius: 999px/);
  assert.match(source, /querySelectorAll\("svg,img"\)/);
});

test("desktop polish survives Wix client-side rendering and route changes", () => {
  assert.match(source, /MutationObserver/);
  assert.match(source, /setInterval\(syncRoute, 700\)/);
  assert.match(source, /popstate/);
  assert.match(source, /hashchange/);
});

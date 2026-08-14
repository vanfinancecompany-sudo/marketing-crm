import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "public/knowledge-hub-ui/site-loader.js"), "utf8");

test("Knowledge Hub UI polish is scoped to Hub, category and article routes only", () => {
  assert.match(source, /if \(path === "\/knowledge-hub"\) return "hub"/);
  assert.match(source, /startsWith\("\/knowledge-hub-category\/"\)/);
  assert.match(source, /startsWith\("\/knowledge-hub-articles\/"\)/);
  assert.doesNotMatch(source, /startsWith\("\/"\) return/);
});

test("Hub category, category article and related article boxes use the search-result card language", () => {
  assert.match(source, /vfc-kh-modern-card/);
  assert.match(source, /border: 1px solid #e1e1e1/);
  assert.match(source, /border-radius: 13px/);
  assert.match(source, /box-shadow: 0 7px 20px rgba\(0,0,0,\.06\)/);
  assert.match(source, /color: #b30d14/);
  assert.match(source, /font: 800 17px\/1\.28/);
  assert.match(source, /font: 400 14px\/1\.5/);
});

test("card replacement removes the image-heavy Wix presentation while preserving the existing destination", () => {
  assert.match(source, /data-vfc-kh-card-root/);
  assert.match(source, /> :not\(\.vfc-kh-modern-card\)/);
  assert.match(source, /card\.href = href/);
  assert.match(source, /href: link\.href \|\| targetPath/);
  assert.doesNotMatch(source, /fetch\(/);
});

test("inline article links cannot be mistaken for CMS cards", () => {
  assert.match(source, /const hasMedia = Boolean\(node\.querySelector\("img,picture,wix-image"\)\)/);
  assert.match(source, /const hasReadMore = \/read\\s\*more\/i\.test\(text\)/);
  assert.match(source, /if \(!hasMedia && !hasReadMore\) return -50/);
});

test("desktop search, Back control and footer category polish remain included", () => {
  assert.match(source, /min\(820px, calc\(100% - 32px\)\)/);
  assert.match(source, /control\.textContent = "← Back"/);
  assert.match(source, /window\.history\.back\(\)/);
  assert.doesNotMatch(source, /history\.go\(/);
  assert.match(source, /Knowledge Hub Categories/);
  assert.match(source, /font: 700 15px\/1\.15/);
});

test("mobile cards are polished but desktop-only navigation tweaks remain desktop gated", () => {
  assert.match(source, /padding: 16px 17px/);
  assert.match(source, /@media \(min-width: 769px\)/);
  assert.match(source, /if \(!isDesktop\(\)\) return false/);
});

test("polish survives Wix client-side navigation and repeater rerenders", () => {
  assert.match(source, /MutationObserver/);
  assert.match(source, /setInterval\(syncRoute, 700\)/);
  assert.match(source, /popstate/);
  assert.match(source, /hashchange/);
});

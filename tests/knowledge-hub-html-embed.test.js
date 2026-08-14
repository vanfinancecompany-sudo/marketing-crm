import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "public/knowledge-hub-search/embed.html"), "utf8");

test("Knowledge Hub HTML embed is self-contained and uses the existing public search API", () => {
  assert.match(source, /public-knowledge-hub-search/);
  assert.match(source, /Knowledge Hub/);
  assert.match(source, /What do you need help with\?/);
  assert.match(source, /target="_top"/);
  assert.doesNotMatch(source, /SITE_PAGES|PAGES_CONTAINER|MutationObserver|insertBefore/);
});

test("Knowledge Hub HTML embed keeps balanced initial card spacing and hides empty result space", () => {
  assert.match(source, /padding:\s*22px 24px/);
  assert.match(source, /\.status:empty, \.results:empty\s*\{\s*display:\s*none/);
});

test("Knowledge Hub HTML embed preserves search and selection telemetry", () => {
  assert.match(source, /action:\s*"search"/);
  assert.match(source, /action:\s*"select"/);
  assert.match(source, /search_request_id/);
  assert.match(source, /visitor_id:\s*visitor/);
});

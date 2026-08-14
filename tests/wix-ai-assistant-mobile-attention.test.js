import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("mobile composer keeps Talk and Send permanently visible", async () => {
  const visual = await source("../public/wix-ai-assistant/visual-polish.mjs");

  assert.match(visual, /\.input-row textarea \{ flex:1 0 100% !important/);
  assert.match(visual, /\.mic \{ flex:1 1 38% !important/);
  assert.match(visual, /\.send \{ flex:1 1 56% !important/);
  assert.doesNotMatch(visual, /mobile-compact/);
  assert.doesNotMatch(visual, /Tap here to continue chatting/);
  assert.doesNotMatch(visual, /sendMessageWithMobileCollapse/);
});

test("mobile header has a prominent safe-area-aware Close control", async () => {
  const visual = await source("../public/wix-ai-assistant/visual-polish.mjs");

  assert.match(visual, /\.header \.close \{/);
  assert.match(visual, /background:#fff !important/);
  assert.match(visual, /font-weight:800 !important/);
  assert.match(visual, /close\.textContent = "✕ Close"/);
  assert.match(visual, /env\(safe-area-inset-top\)/);
  assert.match(visual, /env\(safe-area-inset-bottom\)/);
});

test("panel-only mobile assistant removes floating-card borders", async () => {
  const visual = await source("../public/wix-ai-assistant/visual-polish.mjs");

  assert.match(visual, /:host\(\[panel-only\]\) \.panel \{ border:0 !important; border-radius:0 !important; \}/);
});

test("obsolete continue-chat attention layer is no longer loaded", async () => {
  const embed = await source("../public/wix-ai-assistant/embed.html");

  assert.match(embed, /await import\("\.\/visual-polish\.mjs"\)/);
  assert.doesNotMatch(embed, /mobile-attention-cue\.mjs/);
  assert.match(embed, /overscroll-behavior:none/);
  assert.match(embed, /body\{position:fixed;inset:0\}/);
});

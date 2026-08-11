import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("collapsed mobile composer uses a clear red continue-chat pulse", async () => {
  const cue = await source("../public/wix-ai-assistant/mobile-attention-cue.mjs");

  assert.match(cue, /\.composer\.mobile-compact \.input-row textarea/);
  assert.match(cue, /border:2px solid #d71920 !important/);
  assert.match(cue, /@keyframes vfcContinueChatPulse/);
  assert.match(cue, /box-shadow:0 0 0 6px rgba\(215,25,32,\.16\), 0 0 12px rgba\(215,25,32,\.12\)/);
  assert.match(cue, /animation:vfcContinueChatPulse 2\.2s ease-in-out infinite/);
  assert.match(cue, /textarea::placeholder/);
  assert.match(cue, /font-weight:700/);
  assert.match(cue, /@keyframes vfcContinueChatText/);
});

test("continue-chat animation stops naturally when the composer expands", async () => {
  const [cue, visual] = await Promise.all([
    source("../public/wix-ai-assistant/mobile-attention-cue.mjs"),
    source("../public/wix-ai-assistant/visual-polish.mjs"),
  ]);

  assert.match(cue, /\.composer\.mobile-compact/);
  assert.match(visual, /composer\.classList\.remove\("mobile-compact"\)/);
  assert.match(visual, /input\.addEventListener\("focus", expand\)/);
  assert.match(visual, /input\.addEventListener\("click", expand\)/);
});

test("open embedded assistant has a thin dark separating border", async () => {
  const cue = await source("../public/wix-ai-assistant/mobile-attention-cue.mjs");

  assert.match(cue, /:host\(\[panel-only\]\) \.panel/);
  assert.match(cue, /border:1px solid #202428 !important/);
});

test("attention cue respects reduced-motion preferences", async () => {
  const cue = await source("../public/wix-ai-assistant/mobile-attention-cue.mjs");

  assert.match(cue, /prefers-reduced-motion:reduce/);
  assert.match(cue, /animation:none/);
  assert.match(cue, /border:2px solid #d71920 !important/);
});

test("attention layer loads after the existing visual polish", async () => {
  const embed = await source("../public/wix-ai-assistant/embed.html");
  const polishIndex = embed.indexOf('await import("./visual-polish.mjs")');
  const cueIndex = embed.indexOf('await import("./mobile-attention-cue.mjs")');

  assert.ok(polishIndex >= 0);
  assert.ok(cueIndex > polishIndex);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const service = fs.readFileSync(new URL("../services/aiVisibility.js", import.meta.url), "utf8");
const vercel = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

test("passive AI Visibility loads fail fast and deduplicate overlapping requests", () => {
  assert.match(service, /const PASSIVE_REQUEST_TIMEOUT_MS = 12000;/);
  assert.match(service, /const inFlightRequests = new Map\(\);/);
  assert.match(service, /if \(inFlightRequests\.has\(key\)\) return inFlightRequests\.get\(key\);/);
  assert.match(service, /signal: controller\.signal/);
  assert.match(service, /AI Visibility request timed out/);
});

test("AI Visibility loads are cached and do not automatically refresh Google state", () => {
  assert.match(service, /requestAiVisibility\("load", \{\}, \{ cache: true \}\)/);
  assert.doesNotMatch(service, /await loadGoogleSearchConsoleConnection\(\)/);
  assert.match(service, /FAILURE_COOLDOWN_MS = 60000/);
});

test("deliberate Google checks retain long timeouts and bypass passive cooldown", () => {
  assert.match(service, /const SINGLE_GOOGLE_CHECK_TIMEOUT_MS = 90000;/);
  assert.match(service, /const BULK_GOOGLE_CHECK_TIMEOUT_MS = 240000;/);
  assert.match(service, /timeoutMs: BULK_GOOGLE_CHECK_TIMEOUT_MS/);
  assert.match(service, /cooldown: false/);
  assert.equal(vercel.functions["api/marketing-ai-visibility-google.js"].maxDuration, 300);
});

test("only the passive AI Visibility summary endpoint is capped at 15 seconds", () => {
  assert.equal(vercel.functions["api/marketing-ai-visibility.js"].maxDuration, 15);
});

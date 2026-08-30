import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BUFFER_RATE_LIMIT_COOLDOWN_MS,
  BufferRateLimitCooldownError,
  bufferCooldownRemainingMs,
  bufferDeferredPayload,
  bufferRetryAfterMs,
  isBufferRateLimitCooldownError,
  isBufferRateLimitMessage,
} from "../lib/bufferRuntimeGuard.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

test("recognises Buffer rate-limit responses and calculates a safe cooldown", () => {
  assert.equal(isBufferRateLimitMessage("Too many requests from this client. Please try again later."), true);
  assert.equal(isBufferRateLimitMessage("Buffer HTTP 429"), true);
  assert.equal(isBufferRateLimitMessage("Invalid post"), false);

  const now = Date.parse("2026-08-30T12:00:00Z");
  assert.equal(
    bufferCooldownRemainingMs({ blockedUntil: "2026-08-30T12:15:00Z" }, now),
    BUFFER_RATE_LIMIT_COOLDOWN_MS,
  );
  assert.equal(bufferCooldownRemainingMs({ blockedUntil: "2026-08-30T11:59:00Z" }, now), 0);
});

test("honours Buffer Retry-After seconds and exposes a non-failing deferred payload", () => {
  const response = {
    headers: {
      get(name) {
        return String(name).toLowerCase() === "retry-after" ? "120" : "";
      },
    },
  };
  assert.equal(bufferRetryAfterMs(response), 120_000);

  const error = new BufferRateLimitCooldownError("cooling down", 120_000);
  assert.equal(isBufferRateLimitCooldownError(error), true);
  assert.deepEqual(
    {
      ok: bufferDeferredPayload(error).ok,
      deferred: bufferDeferredPayload(error).deferred,
      degraded: bufferDeferredPayload(error).degraded,
      reason: bufferDeferredPayload(error).reason,
      retry_after_ms: bufferDeferredPayload(error).retry_after_ms,
    },
    {
      ok: true,
      deferred: true,
      degraded: true,
      reason: "buffer_rate_limit_cooldown",
      retry_after_ms: 120_000,
    },
  );
});

test("all live Buffer readers share the runtime guard", () => {
  const guardedEndpoints = [
    "api/buffer-publish-status.js",
    "api/system-health.js",
    "api/buffer-facebook-automation-worker.js",
    "api/buffer-facebook-story-automation.js",
    "api/buffer-instagram-mirror.js",
    "api/buffer-publishing.js",
    "api/buffer-reel-health.js",
  ];

  for (const file of guardedEndpoints) {
    const code = source(file);
    assert.match(code, /bufferRuntimeGuard/);
    assert.doesNotMatch(code, /fetch\(BUFFER_API_URL/);
  }
});

test("status monitoring uses cached success and no longer retries on browser focus", () => {
  const status = source("api/buffer-publish-status.js");
  assert.match(status, /saveBufferStatusSnapshot/);
  assert.match(status, /loadBufferStatusSnapshot/);
  assert.match(status, /serving cached status during cooldown/);

  const client = source("public/buffer-live-status.js");
  assert.match(client, /REFRESH_MS = 5 \* 60 \* 1000/);
  assert.match(client, /MIN_REQUEST_GAP_MS = 5 \* 60 \* 1000/);
  assert.doesNotMatch(client, /addEventListener\("focus"/);
  assert.match(client, /setInterval\(\(\) => refresh\(false\), REFRESH_MS\)/);
});

test("health and automation routes degrade cleanly instead of returning Buffer 500s", () => {
  const health = source("api/system-health.js");
  assert.match(health, /reason: "buffer_rate_limit_cooldown"/);
  assert.match(health, /degraded/);

  for (const file of [
    "api/buffer-facebook-automation-worker.js",
    "api/buffer-facebook-story-automation.js",
    "api/buffer-instagram-mirror.js",
  ]) {
    const code = source(file);
    assert.match(code, /status\(202\)/);
    assert.match(code, /bufferDeferredPayload/);
  }
});

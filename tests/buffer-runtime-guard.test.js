import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildBufferOAuthAuthorizeUrl,
  decryptBufferOAuthPayload,
  encryptBufferOAuthPayload,
} from "../lib/bufferOAuth.js";
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

test("App Client cooldowns are isolated from the exhausted personal-access bucket", () => {
  const appClientError = new BufferRateLimitCooldownError(
    "app client cooling down",
    60_000,
    "app_client_oauth",
  );
  assert.equal(bufferDeferredPayload(appClientError).credential_source, "app_client_oauth");

  const runtime = source("lib/bufferRuntimeGuard.js");
  assert.match(runtime, /buffer-runtime-v1\/rate-limit-state\.json/);
  assert.match(runtime, /buffer-runtime-v2\/rate-limit-app-client\.json/);
  assert.match(runtime, /resolveBufferCredential/);
  assert.match(runtime, /source: credential\.source/);
});

test("Buffer OAuth uses PKCE, offline access and encrypted token storage", () => {
  const authorizeUrl = new URL(buildBufferOAuthAuthorizeUrl({
    clientId: "client-id",
    redirectUri: "https://marketing-crm-six.vercel.app/api/buffer-oauth/callback",
    state: "state-value",
    codeChallenge: "challenge-value",
  }));
  assert.equal(authorizeUrl.origin, "https://auth.buffer.com");
  assert.equal(authorizeUrl.pathname, "/auth");
  assert.equal(authorizeUrl.searchParams.get("response_type"), "code");
  assert.equal(authorizeUrl.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorizeUrl.searchParams.get("state"), "state-value");
  assert.match(authorizeUrl.searchParams.get("scope"), /offline_access/);
  assert.match(authorizeUrl.searchParams.get("scope"), /account:read/);
  assert.match(authorizeUrl.searchParams.get("scope"), /posts:read/);
  assert.match(authorizeUrl.searchParams.get("scope"), /posts:write/);

  const secret = "test-client-secret";
  const payload = {
    access_token: "access",
    refresh_token: "refresh",
    expires_at: "2026-09-05T20:00:00.000Z",
  };
  const encrypted = encryptBufferOAuthPayload(payload, secret);
  assert.notEqual(encrypted.ciphertext, JSON.stringify(payload));
  assert.deepEqual(decryptBufferOAuthPayload(encrypted, secret), payload);
  assert.throws(() => decryptBufferOAuthPayload(encrypted, "wrong-secret"));

  const oauth = source("lib/bufferOAuth.js");
  assert.match(oauth, /grant_type: "authorization_code"/);
  assert.match(oauth, /grant_type: "refresh_token"/);
  assert.match(oauth, /BUFFER_ORGANIZATION_ID/);
  assert.match(oauth, /aes-256-gcm/);

  const callback = source("api/buffer-oauth/callback.js");
  assert.match(callback, /exchangeBufferOAuthCode/);
  const start = source("api/buffer-oauth/start.js");
  assert.match(start, /x-marketing-customer-database-key/);
  assert.match(start, /createBufferOAuthAuthorization/);
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

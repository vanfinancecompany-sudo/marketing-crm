import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import handler from "../api/marketing-ai-assistant-health-live.js";

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

async function withEnvironment(values, operation) {
  const keys = Object.keys(values);
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value == null) delete process.env[key];
    else process.env[key] = String(value);
  }
  try { return await operation(); }
  finally {
    for (const key of keys) {
      if (previous[key] == null) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

const runtime = {
  VERCEL_ENV: "production",
  MARKETING_CUSTOMER_DATABASE_API_KEY: "health-test-key",
  OPENAI_API_KEY: "server-only-openai-key",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "server-only-service-role",
  VERCEL_GIT_COMMIT_SHA: "abc123",
};

test("production live-health route remains locked behind Marketing access", async () => {
  await withEnvironment(runtime, async () => {
    const response = responseRecorder();
    await handler({ method: "POST", headers: {}, body: { action: "configuration" } }, response);
    assert.equal(response.statusCode, 401);
    assert.equal(response.payload.ok, false);
  });
});

test("protected production configuration enables bounded live validation without exposing secrets", async () => {
  await withEnvironment(runtime, async () => {
    const response = responseRecorder();
    await handler({
      method: "POST",
      headers: { "x-marketing-customer-database-key": "health-test-key" },
      body: { action: "configuration" },
    }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.configuration.live_validation_available, true);
    assert.equal(response.payload.configuration.preview_live_validation_available, true);
    assert.equal(response.payload.configuration.live_batch_limit, 2);
    assert.equal(response.payload.configuration.live_min_conversations, 50);
    assert.equal(response.payload.configuration.live_max_conversations, 100);
    assert.equal(response.payload.configuration.guarantees.database_writes, 0);
    assert.equal(response.payload.configuration.guarantees.customer_records_created, 0);
    const serialized = JSON.stringify(response.payload);
    assert.doesNotMatch(serialized, /server-only-openai-key|server-only-service-role|health-test-key/);
  });
});

test("live validation is unavailable outside the protected production runtime", async () => {
  await withEnvironment({ ...runtime, VERCEL_ENV: "preview" }, async () => {
    const response = responseRecorder();
    await handler({
      method: "POST",
      headers: { "x-marketing-customer-database-key": "health-test-key" },
      body: { action: "configuration" },
    }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.configuration.live_validation_available, false);
  });
});

test("production wrapper preserves confirmation, batch limits and write-free validation safeguards", async () => {
  const source = await readFile(new URL("../api/marketing-ai-assistant-health-live.js", import.meta.url), "utf8");
  assert.match(source, /competenceAuthorize\(request\)/);
  assert.match(source, /runLiveHealthBatch\(supabase, body, permissionEnvironment\)/);
  assert.match(source, /VERCEL_ENV:\s*"preview"/);
  assert.doesNotMatch(source, /\.insert\(|\.upsert\(|customer_records.*insert/i);
  assert.match(source, /explicit_confirmation_required:\s*true/);
});

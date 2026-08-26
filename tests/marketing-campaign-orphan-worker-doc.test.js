import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../api/marketing-template-campaign-send-orphan-worker.js", import.meta.url), "utf8");

test("orphan repair worker never submits email to a provider", () => {
  assert.doesNotMatch(source, /callEmailProvider/);
  assert.doesNotMatch(source, /sendSendGridEmail/);
  assert.match(source, /retry_safe/);
  assert.match(source, /provider_attempt_started_at/);
});

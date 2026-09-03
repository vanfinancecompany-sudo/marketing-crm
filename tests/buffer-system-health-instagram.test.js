import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

test("system health checks the configured Instagram channel with Facebook in one Buffer query", () => {
  const health = source("api/system-health.js");
  assert.match(health, /vanFinanceInstagramChannelId/);
  assert.match(health, /bufferHealthPostsQuery\(channelIds\)/);
  assert.match(health, /Van Finance Instagram/);
  assert.match(health, /instagram_ok/);
  assert.match(health, /instagram_mirror: checks\[1\]\?\.instagram_ok !== false/);
});

test("Automation Health Centre shows live Buffer attempt, duration and Instagram failures", () => {
  const health = source("api/system-health.js");
  assert.match(health, /key: "instagram_mirror"/);
  assert.match(health, /status: checkMap\.instagram \? "healthy" : "failed"/);
  assert.match(health, /lastAttemptAt: checkMap\.bufferCheckedAt/);
  assert.match(health, /duration: checkMap\.bufferDuration/);
  assert.match(health, /lastError: checkMap\.instagramIssue/);
  assert.match(health, /key: "buffer_status"/);
  assert.match(health, /label: "Buffer channel health"/);
});

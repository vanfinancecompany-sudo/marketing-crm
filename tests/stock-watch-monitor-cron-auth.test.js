import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isCronRequest } from "../api/stock-watch-monitor-agent.js";

function request(headers = {}) {
  return { headers };
}

test("Stock Watch Monitor recognises the deployed 15-minute Vercel cron request", () => {
  assert.equal(isCronRequest(request({
    "x-vercel-cron-schedule": "*/15 * * * *",
    "user-agent": "vercel-cron/1.0",
  }), {}), true);
});

test("Stock Watch Monitor rejects spoofed schedule without Vercel cron user-agent", () => {
  assert.equal(isCronRequest(request({
    "x-vercel-cron-schedule": "*/15 * * * *",
    "user-agent": "Mozilla/5.0",
  }), {}), false);
});

test("Stock Watch Monitor rejects a different cron schedule", () => {
  assert.equal(isCronRequest(request({
    "x-vercel-cron-schedule": "*/5 * * * *",
    "user-agent": "vercel-cron/1.0",
  }), {}), false);
});

test("Stock Watch Monitor requires CRON_SECRET bearer auth when configured", () => {
  const headers = {
    "x-vercel-cron-schedule": "*/15 * * * *",
    "user-agent": "vercel-cron/1.0",
  };
  assert.equal(isCronRequest(request(headers), { CRON_SECRET: "secret-value" }), false);
  assert.equal(isCronRequest(request({ ...headers, authorization: "Bearer wrong" }), { CRON_SECRET: "secret-value" }), false);
  assert.equal(isCronRequest(request({ ...headers, authorization: "Bearer secret-value" }), { CRON_SECRET: "secret-value" }), true);
});

test("build applies cron auth patch after the monitor agent transform", () => {
  const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const build = packageJson.scripts.build;
  const monitorIndex = build.indexOf("apply-stock-watch-monitor-agent.mjs");
  const cronIndex = build.indexOf("apply-stock-watch-monitor-cron-auth.mjs");
  assert.ok(monitorIndex >= 0);
  assert.ok(cronIndex > monitorIndex);
  assert.match(build, /stock-watch-monitor-cron-auth\.test\.js/);
});

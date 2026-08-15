import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "public/wix-ai-assistant/site-loader.js"), "utf8");

test("sitewide assistant records exposure/open/close and carries a session-only analytics id", () => {
  assert.match(source, /ANALYTICS_SESSION_KEY/);
  assert.match(source, /sessionStorage/);
  assert.match(source, /sendTelemetry\("launcher_impression"\)/);
  assert.match(source, /sendTelemetry\("launcher_open"\)/);
  assert.match(source, /sendTelemetry\("launcher_close"\)/);
  assert.match(source, /analytics_visitor_id: analyticsVisitorForRequest\(\)/);
  assert.match(source, /visitor_id: analyticsVisitorForRequest\(\)/);
});

test("sitewide telemetry has a dedicated endpoint and records CTA clicks without exposing assistant diagnostics", () => {
  assert.match(source, /\/api\/ai-assistant-telemetry/);
  assert.match(source, /sendTelemetry\("cta_click"/);
  const telemetryBody = source.match(/function sendTelemetry[\s\S]*?\n  }\n\n  function createUi/)?.[0] || "";
  assert.doesNotMatch(telemetryBody, /message:/);
  assert.doesNotMatch(telemetryBody, /knowledge_sources/);
});

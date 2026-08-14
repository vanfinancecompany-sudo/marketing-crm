import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const page = fs.readFileSync(path.join(root, "public/ai-control-centre/index.html"), "utf8");
const nav = fs.readFileSync(path.join(root, "public/shared/sidebar-navigation.js"), "utf8");
const api = fs.readFileSync(path.join(root, "api/marketing-ai-control-centre.js"), "utf8");

test("AI Control Centre uses the shared Marketing CRM access key and header", () => {
  assert.match(page, /marketingCustomerDatabaseApiKey/);
  assert.match(page, /x-marketing-customer-database-key/);
  assert.match(page, /\/api\/marketing-campaigns/);
  assert.match(page, /action:\s*"validateAccess"/);
});

test("AI Control Centre is exposed through the shared sidebar as a document page", () => {
  assert.match(nav, /id:\s*"ai-control-centre"/);
  assert.match(nav, /label:\s*"AI Control Centre"/);
  assert.match(nav, /path:\s*"\/ai-control-centre\/"/);
  assert.match(nav, /navigation:\s*"document"/);
  assert.match(page, /data-marketing-sidebar/);
});

test("AI Control Centre reads the aggregate evidence endpoint and links back to specialist tools", () => {
  assert.match(page, /\/api\/marketing-ai-control-centre\?days=/);
  assert.match(page, /href="\/ai-visibility"/);
  assert.match(page, /href="\/ai-assistant-health"/);
  assert.match(page, /href="\/ai-knowledge-opportunities"/);
  assert.match(page, /href="\/knowledge-hub"/);
});

test("AI Control Centre escapes dynamic source titles and search-gap queries before innerHTML rendering", () => {
  assert.match(page, /const escapeHtml =/);
  assert.match(page, /escapeHtml\(item\.title \|\| item\.query \|\| item\.source_id/);
  assert.match(page, /escapeHtml\(item\.detail/);
  assert.match(page, /escapeHtml\(emptyText/);
});

test("Control Centre API stays protected and restricts writes to explicit Assistant Health baseline snapshots", () => {
  assert.match(api, /MARKETING_CUSTOMER_DATABASE_API_KEY/);
  assert.match(api, /\["GET", "POST"\]\.includes\(request\.method\)/);
  assert.match(api, /body\.action === "loadHealthBaselines"/);
  assert.match(api, /body\.action === "saveHealthBaseline"/);
  assert.match(api, /ai_assistant_health_baselines/);
  assert.match(api, /buildAssistantMeasurementSummary/);
  assert.match(api, /buildVisibilitySummary/);
  assert.doesNotMatch(api, /\.update\(/);
  assert.doesNotMatch(api, /\.delete\(/);
  const saveFunction = api.match(/async function saveHealthBaseline[\s\S]*?\n}\n/)?.[0] || "";
  assert.match(saveFunction, /\.insert\(/);
  assert.equal((api.match(/\.insert\(/g) || []).length, 1);
});

test("aggregate Control Centre API keeps staged measurement and baseline tables optional for reads", () => {
  assert.match(api, /ai_assistant_events/);
  assert.match(api, /knowledge_hub_search_events/);
  assert.match(api, /ai_assistant_health_baselines/);
  assert.match(api, /optional:\s*true/);
  assert.match(api, /missingTable/);
});

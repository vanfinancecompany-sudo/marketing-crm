import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const endpoint = fs.readFileSync(path.join(root, "api/marketing-ai-knowledge-opportunity-evidence.js"), "utf8");
const refresh = fs.readFileSync(path.join(root, "api/_knowledgeOpportunityEvidenceRefresh.js"), "utf8");
const page = fs.readFileSync(path.join(root, "public/ai-control-centre/index.html"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/041_knowledge_opportunity_live_evidence.sql"), "utf8");

test("live evidence refresh is an explicit protected POST action", () => {
  assert.match(endpoint, /request\.method !== "POST"/);
  assert.match(endpoint, /competenceAuthorize\(request\)/);
  assert.match(endpoint, /refreshEvidence/);
  assert.match(endpoint, /automatic_content_creation:\s*false/);
  assert.match(endpoint, /automatic_publication:\s*false/);
  assert.match(endpoint, /manual_statuses_preserved:\s*true/);
});

test("existing opportunity evidence updates do not change manual workflow status", () => {
  const existingUpdate = refresh.match(/if \(existing\) \{[\s\S]*?continue;\n    \}/)?.[0] || "";
  assert.match(existingUpdate, /priority_score/);
  assert.match(existingUpdate, /evidence_last_refreshed_at|evidenceColumns/);
  assert.doesNotMatch(existingUpdate, /status\s*:/);
  assert.match(refresh, /allowAutomaticReopen:\s*false/);
});

test("AI Control Centre uses a fixed 90-day decision window for evidence refresh", () => {
  assert.match(page, /body:\s*JSON\.stringify\(\{ action: "refreshEvidence", days: 90 \}\)/);
  assert.match(page, /stable 90-day evidence window/);
  assert.match(page, /Nothing was created or published automatically/);
});

test("live assistant evidence migration stores intent labels but not raw question text", () => {
  assert.match(migration, /secondary_intents text\[\]/);
  assert.match(migration, /Raw public assistant question text is not stored/);
  assert.doesNotMatch(migration, /raw_question\s+text/i);
  assert.doesNotMatch(migration, /customer_message\s+text/i);
});

test("evidence worker reads assistant, Hub search and GSC channels with pagination", () => {
  assert.match(refresh, /ai_assistant_events/);
  assert.match(refresh, /knowledge_hub_search_events/);
  assert.match(refresh, /knowledge_visibility_results/);
  assert.match(refresh, /PAGE_SIZE = 1000/);
  assert.match(refresh, /MAX_ROWS = 25000/);
  assert.match(refresh, /loadPagedRows/);
});

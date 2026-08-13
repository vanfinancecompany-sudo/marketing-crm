import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = readFileSync(new URL("../api/jasmin-knowledge-revision.js", import.meta.url), "utf8");
const schema = readFileSync(new URL("../docs/jasmin-knowledge-action.openapi.yaml", import.meta.url), "utf8");

test("revision drafts are hidden from the normal article lifecycle", () => {
  assert.match(api, /status: "archived"/);
  assert.match(api, /revision_state: "draft"/);
  assert.match(api, /Only approved or exported articles can be opened as revision drafts/);
});

test("only one open revision is allowed for a source article", () => {
  assert.match(api, /A revision draft already exists for this article/);
  assert.match(api, /revisionSourceId\(article\) === sourceId/);
});

test("revision edits keep the temporary slug and source linkage", () => {
  assert.match(api, /slug: current\.slug/);
  assert.match(api, /revision_of: revisionSourceId\(current\)/);
  assert.match(api, /revision_state: "draft"/);
});

test("stale revisions are blocked before replacing the approved source article", () => {
  assert.match(api, /revision_source_updated_at/);
  assert.match(api, /source article changed after this revision draft was created/i);
  assert.match(api, /Discard this stale revision draft, then create a fresh revision draft/i);
});

test("an open stale revision can be discarded without touching its source", () => {
  assert.match(api, /async function discardRevisionDraft/);
  assert.match(api, /Only open revision drafts can be discarded through this action/);
  assert.match(api, /revision_state: "discarded"/);
  assert.match(api, /revision_discarded_at: now/);
  assert.doesNotMatch(api, /discardRevisionDraft[\s\S]*?\.update\([\s\S]*?\.eq\("id", source/i);
});

test("approving a revision updates the original article and leaves Wix as a separate explicit step", () => {
  assert.match(api, /slug: source\.slug/);
  assert.match(api, /last_revision_id: revision\.id/);
  assert.match(api, /revision_state: "applied"/);
  assert.match(api, /Use sendToWixDraft on the source article ID only after explicit user approval/);
  assert.doesNotMatch(api, /publishKnowledgeArticleToWix|sendToWixDraft\(/);
});

test("OpenAPI exposes revision recovery actions without a live Wix publish action", () => {
  assert.match(schema, /version: 1\.2\.1/);
  assert.match(schema, /operationId: manageKnowledgeRevision/);
  assert.match(schema, /createRevisionDraft/);
  assert.match(schema, /updateRevisionDraft/);
  assert.match(schema, /discardRevisionDraft/);
  assert.match(schema, /approveRevision/);
  assert.doesNotMatch(schema, /publishLive|sendToWixLive/);
});

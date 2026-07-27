import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { evaluatePublishingSafety } from "../lib/publishingSafety.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const base = {
  id: "article-1",
  title: "Van Finance Guide",
  content_markdown: "## Introduction\n\nA detailed guide for customers reviewing a commercial vehicle agreement. ".repeat(8),
  faq_json: [],
  cta: "Apply now",
  cta_destination: "/apply",
  generation_metadata: {},
};
const assessment = { article_id: "article-1", created_at: "2026-07-27T15:00:00Z", content_hash: "same" };

for (const [label, article] of [
  ["duplicate title", { ...base, content_markdown: `# Van Finance Guide\n\n${base.content_markdown}` }],
  ["repeated sections", { ...base, content_markdown: `${base.content_markdown}\n\n## FAQs\n\nAnswer.\n\n## FAQs\n\nAnswer.` }],
  ["claim", { ...base, content_markdown: `${base.content_markdown}\n\nEvery applicant is guaranteed approval within 60 minutes.` }],
  ["stale analysis", { ...base, updated_at: "2026-07-27T16:00:00Z", content_hash: "changed" }],
]) {
  test(`${label} warning does not technically block Wix`, () => {
    const safety = evaluatePublishingSafety(article, { assessment, businessKnowledge: [] });
    assert.equal(safety.hard_blocked, false);
    assert.ok(safety.warning_count > 0);
  });
}

test("single warning confirmation controls the primary Wix action", async () => {
  const source = await read("../components/KnowledgeHubWixPublishing.jsx");
  assert.match(source, /I have reviewed the warnings and want to continue\./);
  assert.match(source, /hasWarnings && !warningsConfirmed/);
  assert.match(source, /Approve & Create Wix Draft/);
  assert.match(source, /Approve & Update Wix Draft/);
  assert.doesNotMatch(source, /confirmContentLoss|confirmClaims/);
});

test("current saved article is the Wix source of truth", async () => {
  const ui = await read("../components/KnowledgeHubWixPublishing.jsx");
  const api = await read("../api/marketing-knowledge-safety-approval.js");
  assert.match(ui, /Content being sent: current saved article/);
  assert.match(api, /content_source:"current_saved_article"/);
  assert.doesNotMatch(api, /Corrections are not saved\. Accept corrections before continuing\./);
});

test("optional AI fix does not gate Wix export", async () => {
  const source = await read("../components/PublishingSafetyCorrections.jsx");
  assert.match(source, /Fix with AI — optional/);
  assert.match(source, /not required for Wix export/);
  assert.doesNotMatch(source, /Blocked — material corrections required|Hold — corrections required|Correction incomplete|genuine material issue remains/);
});

test("server requires one acknowledgement only when warnings exist", async () => {
  const api = await read("../api/marketing-knowledge-safety-approval.js");
  assert.match(api, /requireWarningAcknowledgement/);
  assert.match(api, /confirm_warnings/);
  assert.match(api, /publishing_warnings_acknowledged_at/);
  assert.doesNotMatch(api, /confirm_large_reduction|correction_complete/);
});

test("Wix payload failure remains technical and live publication is never requested", async () => {
  const api = await read("../api/marketing-knowledge-safety-approval.js");
  const ui = await read("../components/KnowledgeHubWixPublishing.jsx");
  assert.match(api, /Article approved, but Wix draft creation failed\./);
  assert.match(api, /retry_wix:true/);
  assert.match(api, /live_published:false/);
  assert.match(ui, /It never publishes live/);
  assert.doesNotMatch(`${api}\n${ui}`, /status:\s*["']published["']|publishLive|livePublish/);
});

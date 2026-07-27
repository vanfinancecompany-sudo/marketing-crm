import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Approval Queue uses Ready for approval wording", async () => {
  const source = await read("../components/KnowledgeHubApprovalDomFixes.js");
  assert.match(source, /★★★★★ Ready for approval/);
  assert.match(source, /★★★★★ Ready/);
});

test("combined approve and create or update Wix draft flow is available", async () => {
  const ui = await read("../components/KnowledgeHubWixPublishing.jsx");
  const api = await read("../api/marketing-knowledge-safety-approval.js");
  assert.match(ui, /Approve & Create Wix Draft/);
  assert.match(ui, /Approve & Update Wix Draft/);
  assert.match(api, /approveAndCreateWixDraft/);
  assert.match(api, /publishKnowledgeArticleToWix/);
});

test("safety, stale analysis and unsaved corrections stop the combined action", async () => {
  const ui = await read("../components/KnowledgeHubWixPublishing.jsx");
  const api = await read("../api/marketing-knowledge-safety-approval.js");
  assert.match(ui, /Corrections are not saved\. Accept corrections before continuing\./);
  assert.match(api, /ensureSafe\(latest/);
  assert.match(api, /Saved content differs from the reviewed article/);
  assert.match(api, /currentContentHash/);
});

test("approval refresh returns saved article and Wix state", async () => {
  const api = await read("../api/marketing-knowledge-safety-approval.js");
  assert.match(api, /const refreshed = await loadLatestArticle/);
  assert.match(api, /article: refreshed/);
  assert.match(api, /wix: wixResult\.wix/);
});

test("already approved articles use Wix-only labels without forced reapproval", async () => {
  const ui = await read("../components/KnowledgeHubWixPublishing.jsx");
  const api = await read("../api/marketing-knowledge-safety-approval.js");
  assert.match(ui, /isApproved[\s\S]*Update Wix Draft[\s\S]*Create Wix Draft/);
  assert.match(api, /if \(latest\.status !== "approved"\)/);
});

test("partial Wix failure provides Retry Wix Draft", async () => {
  const ui = await read("../components/KnowledgeHubWixPublishing.jsx");
  const api = await read("../api/marketing-knowledge-safety-approval.js");
  assert.match(api, /Article approved, but Wix draft creation failed\./);
  assert.match(api, /retry_wix: true/);
  assert.match(ui, /Retry Wix Draft/);
});

test("duplicate clicks are prevented and Wix remains draft-only", async () => {
  const ui = await read("../components/KnowledgeHubWixPublishing.jsx");
  const api = await read("../api/marketing-knowledge-safety-approval.js");
  assert.match(ui, /running\.current \|\| busy/);
  assert.match(api, /live_published: false/);
  assert.doesNotMatch(api, /publishLive|livePublish|status:\s*"published"/);
});

test("accepted correction has accepting state, verification and clear success feedback", async () => {
  const source = await read("../components/PublishingSafetyCorrections.jsx");
  assert.match(source, /Accepting…/);
  assert.match(source, /sameReviewedArticle/);
  assert.match(source, /Corrections could not be verified after saving\./);
  assert.match(source, /Corrections accepted and saved as draft\./);
  assert.match(source, /setProposal\(null\)/);
  assert.match(source, /knowledgeCorrectionFeedback/);
});

test("acceptance API failure preserves proposal controls", async () => {
  const source = await read("../components/PublishingSafetyCorrections.jsx");
  assert.match(source, /catch \(error\)[\s\S]*setStatus\("ready"\)/);
  assert.doesNotMatch(source, /catch \(error\)[\s\S]{0,120}setProposal\(null\)/);
});

test("legacy top-level Approve is hidden while advanced Approve only remains", async () => {
  const fixes = await read("../components/KnowledgeHubApprovalDomFixes.js");
  const ui = await read("../components/KnowledgeHubWixPublishing.jsx");
  assert.match(fixes, /textContent\?\.trim\(\) === "Approve"/);
  assert.match(fixes, /style\.display = "none"/);
  assert.match(ui, /Approve only/);
});

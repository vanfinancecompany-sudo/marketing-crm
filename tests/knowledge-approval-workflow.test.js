import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { verifyAcceptedCorrection } from "../lib/knowledgeCorrectionState.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const reviewedArticle = {
  id: "article-1",
  title: "Reviewed title",
  seo_title: "Reviewed SEO title",
  meta_description: "Reviewed description",
  excerpt: "Reviewed excerpt",
  content_markdown: "## Introduction\n\nReviewed body.",
  faq_json: [{ question: "Question?", answer: "Answer." }],
  cta: "Apply now",
  internal_link_suggestions: [
    { status: "accepted", anchor_text: "View vans", destination_url: "/vans" },
  ],
};

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

test("Accepting state renders before the API is awaited", async () => {
  const source = await read("../components/PublishingSafetyCorrections.jsx");
  const statusIndex = source.indexOf('setStatus("accepting")');
  const progressIndex = source.indexOf('setMessage("Saving and verifying corrections…")');
  const paintIndex = source.indexOf("await nextPaint()");
  const apiIndex = source.indexOf("await acceptPublishingCorrection");
  assert.ok(statusIndex >= 0);
  assert.ok(progressIndex > statusIndex);
  assert.ok(paintIndex > progressIndex);
  assert.ok(apiIndex > paintIndex);
  assert.match(source, /status === "accepting" \? "Accepting…" : "Accept Corrections"/);
});

test("all correction controls are disabled while accepting", async () => {
  const source = await read("../components/PublishingSafetyCorrections.jsx");
  assert.match(source, /acceptDisabled = status === "working" \|\| status === "accepting"/);
  assert.match(source, /disabled=\{status === "working" \|\| status === "accepting"\}[\s\S]{0,180}>Regenerate Correction/);
  assert.match(source, /disabled=\{status === "working" \|\| status === "accepting"\}[\s\S]{0,260}>Discard Corrections/);
});

test("success banner is prominent, persistent, focusable and scrolled into view", async () => {
  const source = await read("../components/KnowledgeHubApprovalDomFixes.js");
  assert.match(source, /Corrections accepted and saved successfully\./);
  assert.match(source, /Article status/);
  assert.match(source, /Saved content verified/);
  assert.match(source, /aria-live/);
  assert.match(source, /scrollIntoView/);
  assert.match(source, /banner\.focus/);
  assert.match(source, /style\.position = "sticky"/);
  assert.match(source, /insertAdjacentElement\("afterend"/);
});

test("successful acceptance clears proposal UI and persists banner state", async () => {
  const source = await read("../components/PublishingSafetyCorrections.jsx");
  assert.match(source, /correction_save_verified: true/);
  assert.match(source, /writeKnowledgeCorrectionState\(successState\)/);
  assert.match(source, /dispatchKnowledgeCorrectionState\(successState\)/);
  assert.match(source, /setProposal\(null\)/);
  assert.match(source, /setStatus\("accepted"\)/);
  assert.match(source, /status === "accepted"/);
});

test("saved fields and accepted internal-link anchors are verified against proposal", () => {
  const saved = structuredClone(reviewedArticle);
  const result = verifyAcceptedCorrection(saved, reviewedArticle, saved.internal_link_suggestions);
  assert.equal(result.correction_save_verified, true);
  assert.deepEqual(result.correction_save_verification_errors, []);

  saved.content_markdown = "Different body";
  const mismatch = verifyAcceptedCorrection(saved, reviewedArticle, saved.internal_link_suggestions);
  assert.equal(mismatch.correction_save_verified, false);
  assert.equal(mismatch.correction_save_verification_errors[0].field, "content_markdown");

  const linkMismatch = verifyAcceptedCorrection(reviewedArticle, reviewedArticle, [
    { status: "accepted", anchor_text: "Different anchor", destination_url: "/vans" },
  ]);
  assert.equal(linkMismatch.correction_save_verified, false);
  assert.equal(linkMismatch.correction_save_verification_errors[0].field, "accepted_internal_link_anchors");
});

test("article, revision, analysis and Wix state are refreshed from server after acceptance", async () => {
  const source = await read("../components/PublishingSafetyCorrections.jsx");
  assert.match(source, /Promise\.all\(\[loadKnowledgeHub\(\), loadEditorialEngine\(\)\]\)/);
  assert.match(source, /editorial\.link_suggestions/);
  assert.match(source, /editorial\.assessments/);
  assert.match(source, /article: \{ \.\.\.saved, internal_link_suggestions: acceptedLinks \}/);
  assert.match(source, /window\.location\.reload\(\)/);
});

test("Wix actions remain disabled until correction save verification succeeds", async () => {
  const source = await read("../components/KnowledgeHubWixPublishing.jsx");
  assert.match(source, /correctionSaveVerified = !correctionApplies \|\| correctionState\?\.correction_save_verified === true/);
  assert.match(source, /actionDisabled = busy \|\| hasUnsavedChanges \|\| !correctionSaveVerified/);
  assert.match(source, /Corrections could not be verified after saving\./);
  assert.match(source, /Approval and Wix actions remain disabled\./);
});

test("API failure restores correction controls and keeps the proposal", async () => {
  const source = await read("../components/PublishingSafetyCorrections.jsx");
  assert.match(source, /catch \(error\)[\s\S]*setStatus\("ready"\)/);
  assert.match(source, /setAcceptError\(error\.message/);
  assert.doesNotMatch(source, /catch \(error\)[\s\S]{0,220}setProposal\(null\)/);
});

test("legacy top-level Approve is hidden while advanced Approve only remains", async () => {
  const fixes = await read("../components/KnowledgeHubApprovalDomFixes.js");
  const ui = await read("../components/KnowledgeHubWixPublishing.jsx");
  assert.match(fixes, /textContent\?\.trim\(\) === "Approve"/);
  assert.match(fixes, /style\.display = "none"/);
  assert.match(ui, /Approve only/);
});

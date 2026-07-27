import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  correctionSaveEligibility,
  proposalStateForArticle,
  verifyAcceptedCorrection,
} from "../lib/knowledgeCorrectionState.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const article = {
  id: "article-1",
  updated_at: "2026-07-27T10:00:00.000Z",
  title: "Corrected title",
  slug: "corrected-title",
  seo_title: "Corrected SEO title",
  meta_description: "Corrected description",
  excerpt: "Corrected excerpt",
  content_markdown: "## Introduction\n\nCorrected body.",
  faq_json: [{ question: "Question?", answer: "Answer." }],
  cta: "Apply now",
  category: "Rent2Buy",
  article_type: "guide",
  featured_image: "",
  generation_metadata: { product_scope_override: "rent2buy" },
  internal_link_suggestions: [
    { status: "accepted", anchor_text: "View vans", destination_url: "/vans" },
  ],
};

const proposal = {
  article_id: article.id,
  source_updated_at: article.updated_at,
  after: structuredClone(article),
  correction_complete: true,
  remaining_hard_blocks: [],
  claim_confirmation_required: false,
  content_loss_confirmation_required: false,
};

test("injected Accept Corrections action is removed from the user-facing flow", async () => {
  const correction = await read("../components/PublishingSafetyCorrections.jsx");
  assert.doesNotMatch(correction, />Accept Corrections</);
  assert.doesNotMatch(correction, /data-knowledge-accept-corrections/);
  assert.match(correction, /Save from the main article editor/);
  assert.match(correction, /Save Corrected Draft/);
});

test("main-editor Save Corrected Draft is React-owned with no DOM or native listener dependency", async () => {
  const wix = await read("../components/KnowledgeHubWixPublishing.jsx");
  assert.match(wix, /className="panel main-editor-correction-save"/);
  assert.match(wix, /type="button"[\s\S]{0,180}onClick=\{saveCorrectedDraft\}/);
  assert.doesNotMatch(wix, /createRoot|createPortal|querySelector|addEventListener\(["']click/);
});

test("shared proposal state exposes proposal version, confirmations and completion data", () => {
  const state = proposalStateForArticle(proposal, { claims: true, contentLoss: true });
  assert.equal(state.proposal_id, `article-1:${article.updated_at}`);
  assert.equal(state.proposal.source_updated_at, article.updated_at);
  assert.equal(state.proposal.correction_complete, true);
  assert.equal(state.claims_confirmed, true);
  assert.equal(state.content_loss_confirmed, true);
});

test("source-version mismatch and required confirmations block save", () => {
  const state = proposalStateForArticle({ ...proposal, claim_confirmation_required: true }, { claims: false });
  assert.equal(correctionSaveEligibility(state, article).eligible, false);
  assert.match(correctionSaveEligibility(state, article).reason, /Confirm the flagged/);
  const changed = { ...article, updated_at: "2026-07-27T11:00:00.000Z" };
  const versionResult = correctionSaveEligibility(proposalStateForArticle(proposal), changed);
  assert.equal(versionResult.eligible, false);
  assert.match(versionResult.reason, /changed after the correction was prepared/);
});

test("complete proposal fields are submitted through the existing acceptance service", async () => {
  const wix = await read("../components/KnowledgeHubWixPublishing.jsx");
  const service = await read("../services/publishingCorrections.js");
  assert.match(wix, /acceptPublishingCorrection\(activeProposal/);
  assert.match(service, /corrected_article: correctedArticle/);
  assert.match(service, /faq_json: normalizeFaqCollection\(proposal\.after\?\.faq_json\)/);
  for (const field of ["title", "seo_title", "meta_description", "excerpt", "content_markdown", "faq_json", "cta", "internal_link_suggestions"]) assert.ok(Object.hasOwn(article, field));
});

test("save flow creates revision, reloads server data and verifies all fields together", async () => {
  const wix = await read("../components/KnowledgeHubWixPublishing.jsx");
  assert.match(wix, /recordArticleRevision\([\s\S]*ai_safety_correction/);
  assert.match(wix, /Promise\.all\(\[loadKnowledgeHub\(\), loadEditorialEngine\(\)\]\)/);
  assert.match(wix, /verifyAcceptedCorrection\(saved, activeProposal\.after, acceptedLinks\)/);
  assert.match(wix, /Corrected article saved successfully\./);
  assert.match(wix, /Revision: AI safety correction/);
  assert.match(wix, /Saved content verified: Yes/);
});

test("normalised exact verification includes structured fields, FAQs, CTA and accepted anchors", () => {
  const saved = structuredClone(article);
  const valid = verifyAcceptedCorrection(saved, article, saved.internal_link_suggestions);
  assert.equal(valid.correction_save_verified, true);

  saved.faq_json[0].answer = "Changed";
  const faqMismatch = verifyAcceptedCorrection(saved, article, saved.internal_link_suggestions);
  assert.equal(faqMismatch.correction_save_verified, false);
  assert.equal(faqMismatch.correction_save_verification_errors[0].exact_field, "faq_json");
  assert.equal(faqMismatch.correction_save_verification_errors[0].mismatch_type, "answer_changed");

  const linkMismatch = verifyAcceptedCorrection(article, article, [
    { status: "accepted", anchor_text: "Changed anchor", destination_url: "/vans" },
  ]);
  assert.equal(linkMismatch.correction_save_verified, false);
  assert.equal(linkMismatch.correction_save_verification_errors[0].field, "accepted_internal_link_anchors");
});

test("proposal clears only after verified success and mismatches identify exact fields", async () => {
  const wix = await read("../components/KnowledgeHubWixPublishing.jsx");
  const verificationIndex = wix.indexOf("verification.correction_save_verified");
  const clearIndex = wix.indexOf("proposal: null");
  assert.ok(verificationIndex >= 0 && clearIndex > verificationIndex);
  assert.match(wix, /Mismatched fields:/);
  assert.match(wix, /verification_errors: verification\.correction_save_verification_errors/);
});

test("approval and Wix stay disabled until visible verified save and reanalysis", async () => {
  const wix = await read("../components/KnowledgeHubWixPublishing.jsx");
  assert.match(wix, /correction_save_verified === true && correctionState\?\.visible_success_displayed === true/);
  assert.match(wix, /!correctionSaveVerified \|\| analysisStaleAfterCorrection/);
  assert.match(wix, /Save and verify the corrected draft before approval and Wix export/);
  assert.match(wix, /Reanalyse the corrected draft before approval and Wix export/);
});

test("bulk proposals require opening each article to save", async () => {
  const correction = await read("../components/PublishingSafetyCorrections.jsx");
  assert.match(correction, /Proposal ready — open article to save/);
  assert.doesNotMatch(correction, /acceptPublishingCorrection/);
});

test("no automatic approval or live Wix publication is introduced", async () => {
  const correction = await read("../components/PublishingSafetyCorrections.jsx");
  const wix = await read("../components/KnowledgeHubWixPublishing.jsx");
  assert.doesNotMatch(correction, /approveAndCreateWixDraft|publishLive|livePublish/);
  assert.match(wix, /It never publishes live/);
  assert.doesNotMatch(wix, /status:\s*["']published["']/);
});

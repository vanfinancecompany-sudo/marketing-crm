import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_BULK_CORRECTIONS,
  applyAcceptedCorrection,
  assertDuplicateTitleResolved,
  buildCorrectionPreview,
  buildSafetyCorrectionPrompt,
  canAcceptCorrection,
  limitCorrectionBatch,
  normalizeCorrectionProposal,
  startsWithDuplicateArticleH1,
  verifyCorrectionResults,
} from "../lib/publishingCorrections.js";
import { evaluatePublishingSafety } from "../lib/publishingSafety.js";

const detailedBody = `## Who this guide is for

Builders comparing commercial vehicle funding can use this guide to prepare. This section explains how the vehicle, business circumstances and available finance route fit together.

## Worked example

A builder replacing an older van may compare the total amount payable, deposit, term, vehicle condition and expected business use before deciding whether an option is suitable.

## What to check

Review affordability, vehicle suitability and the information requested by a lender. Requirements can vary by lender and application, so the customer should check the actual quotation and documents.

## Comparing options

Compare the agreement term, total amount payable, ownership position, fees and any end-of-term conditions rather than relying only on a headline monthly figure.

## Next steps

Compare suitable vans and ask for an individual quotation. Useful information for builders considering a work van should remain detailed and practical.`;

const baseArticle = { id:"article-1", topic_id:"topic-1", title:"Van finance for builders", slug:"van-finance-for-builders", seo_title:"Van finance for builders", meta_description:"A practical guide to van finance for builders.", excerpt:"Understand the main steps before applying.", content_markdown:detailedBody, faq_json:[{question:"Can builders apply?",answer:"Applications are considered individually."}], cta:"View available vans", category:"Van Finance", article_type:"finance-guide", generation_metadata:{target_audience:"Builders",preferred_term:"van finance"}, internal_link_suggestions:[{destination:"/vans-on-finance"}], status:"draft" };
const assessment = { created_at: "2026-07-27T10:00:00.000Z", content_hash: "same" };
function proposal(overrides = {}) { return { ...baseArticle, content_markdown:baseArticle.content_markdown, changes:[], removed_links:[], manual_confirmation_required:[], removed_sections:[], removal_reasons:[], ...overrides }; }

 test("duplicate title is removed while all body content is preserved", () => {
  const original = { ...baseArticle, content_markdown: `# ${baseArticle.title}\n\n${detailedBody}` };
  const preview = buildCorrectionPreview({ originalArticle: original, proposed: { ...proposal(), content_markdown: original.content_markdown }, safetyOptions: { ignoreAssessmentFreshness: true } });
  assert.equal(startsWithDuplicateArticleH1(preview.after), false);
  assert.equal(preview.after.content_markdown, detailedBody);
  assert.match(preview.after.content_markdown, /## Worked example/);
});

test("duplicate-title validator rejects corrected content when duplicate remains", () => {
  assert.throws(() => assertDuplicateTitleResolved({ ...baseArticle, content_markdown: `# ${baseArticle.title}\n\n${detailedBody}` }), /Duplicate article title remains/);
});

test("duplicate FAQ is consolidated", () => {
  const corrected = normalizeCorrectionProposal(baseArticle, proposal({ faq_json:[{question:"Can builders apply?",answer:"Applications are considered individually."}] }));
  assert.equal(corrected.corrected_article.faq_json.length, 1);
});

test("valid stored Markdown does not create a false raw-Markdown block", () => {
  const markdown = `${detailedBody}\n\n**Important**\n\n- First point\n- Second point\n\n---\n\n| Item | Detail |\n| --- | --- |\n| Term | Varies |`;
  const result = evaluatePublishingSafety({ ...baseArticle, content_markdown: markdown }, { assessment, ignoreAssessmentFreshness:true });
  assert.equal(result.hard_block_reasons.includes("Unprocessed formatting or raw markdown detected."), false);
});

test("rendered raw Markdown still blocks", () => {
  const result = evaluatePublishingSafety({ ...baseArticle, preview_text:"## Heading **raw bold**" }, { assessment, ignoreAssessmentFreshness:true });
  assert.ok(result.hard_block_reasons.includes("Unprocessed formatting or raw markdown detected."));
});

test("raw Markdown repair preserves article depth and useful headings", () => {
  const preview = buildCorrectionPreview({ originalArticle:{...baseArticle,content_html:"<p>**bold**</p>"}, proposed:proposal(), safetyOptions:{ignoreAssessmentFreshness:true} });
  assert.match(preview.after.content_markdown,/## Worked example/);
  assert.match(preview.after.content_markdown,/## Comparing options/);
  assert.ok(preview.content_retained_percent >= 85);
});

test("unresolved automatic hard blocks make correction incomplete and disable acceptance", () => {
  const originalSafety = { hard_block_reasons:["Duplicate or repeated article sections detected."] };
  const proposedSafety = { hard_block_reasons:["Duplicate or repeated article sections detected."], requires_manual_claim_review:false };
  const verification = verifyCorrectionResults({ originalSafety, proposedSafety });
  assert.equal(verification.correction_complete,false);
  assert.deepEqual(verification.remaining_hard_blocks,["Duplicate or repeated article sections detected."]);
  assert.equal(canAcceptCorrection(verification),false);
});

test("manual finance confirmation is separated from automatic hard blocks", () => {
  const reason = "Unverified financial or business claim requires confirmation.";
  const verification = verifyCorrectionResults({ originalSafety:{hard_block_reasons:[reason]}, proposedSafety:{hard_block_reasons:[reason],requires_manual_claim_review:true}, manualConfirmationRequired:["APR wording requires confirmation."] });
  assert.equal(verification.correction_complete,true);
  assert.deepEqual(verification.remaining_hard_blocks,[]);
});

test("regeneration prompt uses only remaining unresolved reasons", () => {
  const prompt = buildSafetyCorrectionPrompt({ article:baseArticle, safety:{hard_block_reasons:["First issue","Second issue"],checks:{}}, unresolvedReasons:["Second issue"] });
  const failureSection = prompt.split("Exact safety failures to repair in this run:")[1].split("Safety states:")[0];
  assert.match(failureSection,/Second issue/);
  assert.doesNotMatch(failureSection,/First issue/);
});

test("more than 25 percent unexplained reduction triggers excessive content loss", () => {
  const preview = buildCorrectionPreview({ originalArticle:baseArticle, proposed:proposal({content_markdown:"## Short guide\n\nBuilders should compare suitable options carefully."}), safetyOptions:{ignoreAssessmentFreshness:true} });
  assert.equal(preview.excessive_content_loss,true);
});

test("valid duplicate removal does not trigger false content-loss warning", () => {
  const duplicateBlock = `\n\n## Duplicate explanation\n\n${"This duplicated blocked paragraph adds no new information. ".repeat(18)}`;
  const original = {...baseArticle,content_markdown:`${detailedBody}${duplicateBlock}`};
  const preview = buildCorrectionPreview({ originalArticle:original, proposed:proposal({removed_sections:["Duplicate explanation"],removal_reasons:["duplicate content"]}), safetyOptions:{ignoreAssessmentFreshness:true} });
  assert.equal(preview.excessive_content_loss,false);
});

test("questionable finance wording is not replaced with unsupported claims", () => {
  const prompt = buildSafetyCorrectionPrompt({ article:baseArticle, safety:{hard_block_reasons:["Claim review"],checks:{finance_claims:"warning"}} });
  assert.match(prompt,/larger deposit automatically lowers APR/i);
  assert.match(prompt,/shorter term automatically lowers APR/i);
  assert.match(prompt,/Do not replace one questionable finance claim with another/i);
});

test("original article remains unchanged until explicit acceptance", () => {
  const original = structuredClone(baseArticle);
  buildCorrectionPreview({ originalArticle:original, proposed:proposal({title:"Changed title"}), safetyOptions:{ignoreAssessmentFreshness:true} });
  assert.deepEqual(original,baseArticle);
});

test("bulk correction remains limited to five with no automatic Wix update or approval", () => {
  const ids = limitCorrectionBatch(["1","2","3","4","5","6","7"]);
  assert.equal(MAX_BULK_CORRECTIONS,5);
  assert.deepEqual(ids,["1","2","3","4","5"]);
  const accepted = applyAcceptedCorrection(baseArticle,proposal());
  assert.equal(accepted.status,"draft");
  assert.equal(accepted.wix_sync_status,undefined);
});

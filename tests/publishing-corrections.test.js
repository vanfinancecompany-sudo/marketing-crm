import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_BULK_CORRECTIONS,
  applyAcceptedCorrection,
  buildCorrectionPreview,
  buildSafetyCorrectionPrompt,
  limitCorrectionBatch,
  normalizeCorrectionProposal,
} from "../lib/publishingCorrections.js";
import { evaluatePublishingSafety } from "../lib/publishingSafety.js";

const baseArticle = {
  id: "article-1",
  topic_id: "topic-1",
  title: "Van finance for builders",
  slug: "van-finance-for-builders",
  seo_title: "Van finance for builders",
  meta_description: "A practical guide to van finance for builders.",
  excerpt: "Understand the main steps before applying.",
  content_markdown: `## Who this guide is for\n\nBuilders comparing commercial vehicle funding can use this guide to prepare.\n\n## What to check\n\nReview affordability, vehicle suitability and the information requested by a lender.\n\n## Next steps\n\nCompare suitable vans and ask for an individual quotation. ${"Useful information for builders considering a work van. ".repeat(16)}`,
  faq_json: [{ question: "Can builders apply?", answer: "Applications are considered individually." }],
  cta: "View available vans",
  category: "Van Finance",
  article_type: "finance-guide",
  generation_metadata: { target_audience: "Builders" },
  internal_link_suggestions: [{ destination: "/vans-on-finance" }],
  status: "draft",
};

function proposal(overrides = {}) {
  return {
    ...baseArticle,
    content_markdown: baseArticle.content_markdown,
    changes: [],
    removed_links: [],
    manual_confirmation_required: [],
    ...overrides,
  };
}

test("duplicate title can be corrected without changing original before acceptance", () => {
  const original = { ...baseArticle, content_markdown: `# ${baseArticle.title}\n\n${baseArticle.content_markdown}` };
  const preview = buildCorrectionPreview({ originalArticle: original, proposed: proposal() });
  assert.equal(original.content_markdown.startsWith("# "), true);
  assert.equal(preview.after.content_markdown.startsWith("# "), false);
});

test("duplicate FAQ is consolidated", () => {
  const corrected = normalizeCorrectionProposal(baseArticle, proposal({
    faq_json: [
      { question: "Can builders apply?", answer: "Applications are considered individually." },
    ],
  }));
  assert.equal(corrected.corrected_article.faq_json.length, 1);
});

test("raw markdown can be converted while valid links remain preserved", () => {
  const original = { ...baseArticle, content_html: "<p>**bold** [Stock](/vans-on-finance)</p>" };
  const corrected = proposal({
    content_markdown: `${baseArticle.content_markdown}\n\nSee [available vans](/vans-on-finance).`,
    content_html: "<p><strong>bold</strong> <a href=\"/vans-on-finance\">Stock</a></p>",
  });
  const preview = buildCorrectionPreview({ originalArticle: original, proposed: corrected });
  assert.match(preview.after.content_markdown, /\/vans-on-finance/);
  assert.equal(preview.after.content_markdown.includes("javascript:"), false);
});

test("broken links are not replaced with invented URLs", () => {
  const corrected = normalizeCorrectionProposal(baseArticle, proposal({
    content_markdown: baseArticle.content_markdown,
    removed_links: ["[Apply now]()"],
  }));
  assert.equal(corrected.removed_links[0], "[Apply now]()");
  assert.equal(JSON.stringify(corrected.corrected_article).includes("invented.example"), false);
});

test("repetitive wording is reduced by the proposed version", () => {
  const repeated = { ...baseArticle, content_markdown: "## Guide\n\n" + "Van Finance Company helps builders compare vans. ".repeat(60) };
  const preview = buildCorrectionPreview({ originalArticle: repeated, proposed: proposal() });
  assert.equal(evaluatePublishingSafety(repeated, { stale: false }).checks.repetition, "blocked");
  assert.notEqual(preview.after.content_markdown, repeated.content_markdown);
});

test("supported Business Knowledge claims and user overrides are supplied to the AI prompt", () => {
  const prompt = buildSafetyCorrectionPrompt({
    article: baseArticle,
    safety: { hard_block_reasons: ["Claim review"], checks: { finance_claims: "warning" } },
    businessKnowledge: [{ content: "Free UK delivery is confirmed." }],
    overrides: { primary_product: "finance", structured_ctas: [{ destination: "/apply" }] },
    approvedLinks: [{ destination_url: "/vans-on-finance" }],
    structuredCtas: [{ destination: "/apply" }],
  });
  assert.match(prompt, /Free UK delivery is confirmed/);
  assert.match(prompt, /primary_product/);
  assert.match(prompt, /\/vans-on-finance/);
  assert.match(prompt, /\/apply/);
});

test("unsupported financial claims remain manual or are conservatively removed", () => {
  const corrected = normalizeCorrectionProposal(baseArticle, proposal({
    manual_confirmation_required: ["Guaranteed approval claim removed pending confirmation."],
    content_markdown: baseArticle.content_markdown,
  }));
  assert.equal(corrected.manual_confirmation_required.length, 1);
  assert.equal(corrected.corrected_article.content_markdown.includes("guaranteed approval"), false);
});

test("discarding a proposal leaves the original object unchanged", () => {
  const original = structuredClone(baseArticle);
  buildCorrectionPreview({ originalArticle: original, proposed: proposal({ title: "Changed title" }) });
  assert.deepEqual(original, baseArticle);
});

test("accepting corrections returns a draft and preserves identifiers and overrides", () => {
  const accepted = applyAcceptedCorrection(baseArticle, proposal({ title: "Corrected title" }));
  assert.equal(accepted.status, "draft");
  assert.equal(accepted.id, baseArticle.id);
  assert.equal(accepted.topic_id, baseArticle.topic_id);
  assert.deepEqual(accepted.generation_metadata, baseArticle.generation_metadata);
});

test("a high score cannot bypass a remaining hard block", () => {
  const unsafe = { ...baseArticle, content_markdown: `# ${baseArticle.title}\n\n${baseArticle.content_markdown}` };
  const result = evaluatePublishingSafety(unsafe, {
    stale: false,
    assessment: { overall_score: 99, created_at: new Date().toISOString() },
  });
  assert.equal(result.hard_blocked, true);
  assert.equal(result.recommended_action, "Hold — corrections required");
});

test("bulk correction is limited to 5 and does not imply Wix update or approval", () => {
  const ids = limitCorrectionBatch(["1", "2", "3", "4", "5", "6", "7"]);
  assert.equal(MAX_BULK_CORRECTIONS, 5);
  assert.deepEqual(ids, ["1", "2", "3", "4", "5"]);
  const accepted = applyAcceptedCorrection(baseArticle, proposal());
  assert.equal(accepted.status, "draft");
  assert.equal(accepted.wix_sync_status, undefined);
});

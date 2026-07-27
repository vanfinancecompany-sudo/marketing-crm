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

const baseArticle = {
  id: "article-1",
  topic_id: "topic-1",
  title: "Van finance for builders",
  slug: "van-finance-for-builders",
  seo_title: "Van finance for builders",
  meta_description: "A practical guide to van finance for builders.",
  excerpt: "Understand the main steps before applying.",
  content_markdown: detailedBody,
  faq_json: [{ question: "Can builders apply?", answer: "Applications are considered individually." }],
  cta: "View available vans",
  category: "Van Finance",
  article_type: "finance-guide",
  generation_metadata: { target_audience: "Builders", preferred_term: "van finance" },
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
    removed_sections: [],
    removal_reasons: [],
    ...overrides,
  };
}

test("duplicate title is removed without rewriting unrelated sections", () => {
  const original = { ...baseArticle, content_markdown: `# ${baseArticle.title}\n\n${detailedBody}` };
  const preview = buildCorrectionPreview({ originalArticle: original, proposed: proposal() });
  assert.equal(original.content_markdown.startsWith("# "), true);
  assert.equal(preview.after.content_markdown.startsWith("# "), false);
  assert.match(preview.after.content_markdown, /## Worked example/);
  assert.match(preview.after.content_markdown, /## Comparing options/);
});

test("duplicate FAQ is consolidated", () => {
  const corrected = normalizeCorrectionProposal(baseArticle, proposal({
    faq_json: [{ question: "Can builders apply?", answer: "Applications are considered individually." }],
  }));
  assert.equal(corrected.corrected_article.faq_json.length, 1);
});

test("raw Markdown is cleaned while article depth and valid links are preserved", () => {
  const original = { ...baseArticle, content_html: "<p>**bold** [Stock](/vans-on-finance)</p>" };
  const corrected = proposal({
    content_markdown: `${detailedBody}\n\nSee [available vans](/vans-on-finance).`,
    content_html: "<p><strong>bold</strong> <a href=\"/vans-on-finance\">Stock</a></p>",
  });
  const preview = buildCorrectionPreview({ originalArticle: original, proposed: corrected });
  assert.match(preview.after.content_markdown, /\/vans-on-finance/);
  assert.match(preview.after.content_markdown, /## Worked example/);
  assert.ok(preview.content_retained_percent >= 85);
});

test("useful headings, examples and comparisons remain in targeted repair", () => {
  const preview = buildCorrectionPreview({ originalArticle: baseArticle, proposed: proposal() });
  for (const heading of ["Who this guide is for", "Worked example", "What to check", "Comparing options", "Next steps"]) {
    assert.match(preview.after.content_markdown, new RegExp(heading));
  }
});

test("more than 25 percent unexplained reduction triggers excessive content loss", () => {
  const shortened = proposal({
    content_markdown: "## Short guide\n\nBuilders should compare suitable van finance options carefully.",
  });
  const preview = buildCorrectionPreview({ originalArticle: baseArticle, proposed: shortened });
  assert.equal(preview.excessive_content_loss, true);
  assert.ok(preview.word_count_change_percent < -25);
  assert.ok(preview.original_word_count > preview.proposed_word_count);
});

test("valid duplicate removal does not trigger false content-loss warning", () => {
  const duplicateBlock = `\n\n## Duplicate explanation\n\n${"This duplicated blocked paragraph adds no new information. ".repeat(18)}`;
  const original = { ...baseArticle, content_markdown: `${detailedBody}${duplicateBlock}` };
  const preview = buildCorrectionPreview({
    originalArticle: original,
    proposed: proposal({
      removed_sections: ["Duplicate explanation"],
      removal_reasons: ["duplicate content"],
    }),
  });
  assert.ok(preview.word_count_change_percent < -25);
  assert.equal(preview.excessive_content_loss, false);
});

test("broken links are not replaced with invented URLs", () => {
  const corrected = normalizeCorrectionProposal(baseArticle, proposal({ removed_links: ["[Apply now]()"] }));
  assert.equal(corrected.removed_links[0], "[Apply now]()");
  assert.equal(JSON.stringify(corrected.corrected_article).includes("invented.example"), false);
});

test("prompt preserves Business Knowledge, overrides and prohibits unsupported APR substitutions", () => {
  const prompt = buildSafetyCorrectionPrompt({
    article: baseArticle,
    safety: { hard_block_reasons: ["Claim review"], checks: { finance_claims: "warning" } },
    businessKnowledge: [{ content: "Applications are assessed individually." }],
    overrides: { primary_product: "finance", structured_ctas: [{ destination: "/apply" }] },
    approvedLinks: [{ destination_url: "/vans-on-finance" }],
    structuredCtas: [{ destination: "/apply" }],
  });
  assert.match(prompt, /targeted editorial repairs only/i);
  assert.match(prompt, /not a rewriting or summarisation task/i);
  assert.match(prompt, /larger deposit automatically lowers APR/i);
  assert.match(prompt, /shorter term automatically lowers APR/i);
  assert.match(prompt, /Applications are assessed individually/);
  assert.match(prompt, /\/vans-on-finance/);
});

test("unsupported financial claims remain manual or are conservatively removed", () => {
  const corrected = normalizeCorrectionProposal(baseArticle, proposal({
    manual_confirmation_required: ["APR claim requires confirmation."],
    content_markdown: detailedBody,
  }));
  assert.equal(corrected.manual_confirmation_required.length, 1);
  assert.equal(corrected.corrected_article.content_markdown.includes("automatically lowers APR"), false);
});

test("original content remains unchanged until explicit acceptance", () => {
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
  const unsafe = { ...baseArticle, content_markdown: `# ${baseArticle.title}\n\n${detailedBody}` };
  const result = evaluatePublishingSafety(unsafe, {
    stale: false,
    assessment: { overall_score: 99, created_at: new Date().toISOString() },
  });
  assert.equal(result.hard_blocked, true);
  assert.equal(result.recommended_action, "Hold — corrections required");
});

test("bulk correction remains limited to five and does not imply Wix update or approval", () => {
  const ids = limitCorrectionBatch(["1", "2", "3", "4", "5", "6", "7"]);
  assert.equal(MAX_BULK_CORRECTIONS, 5);
  assert.deepEqual(ids, ["1", "2", "3", "4", "5"]);
  const accepted = applyAcceptedCorrection(baseArticle, proposal());
  assert.equal(accepted.status, "draft");
  assert.equal(accepted.wix_sync_status, undefined);
});

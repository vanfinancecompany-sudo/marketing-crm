import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildCorrectionPreview, normalizeMarkdownSpacing } from "../lib/publishingCorrections.js";
import { correctionSaveEligibility, proposalStateForArticle } from "../lib/knowledgeCorrectionState.js";
import { evaluatePublishingSafety } from "../lib/publishingSafety.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const filler = Array.from({ length: 220 }, (_, index) => `guidance${index + 1}`).join(" ");

function financeArticle(overrides = {}) {
  return {
    id: "finance-1",
    updated_at: "2026-07-27T12:00:00.000Z",
    title: "Van Finance Guide",
    slug: "van-finance-guide",
    seo_title: "Van Finance Guide",
    meta_description: "Practical guidance about van finance agreements.",
    excerpt: "Review the agreement and vehicle details before applying.",
    category: "Van Finance",
    article_type: "guide",
    primary_product: "finance",
    generation_metadata: { product_scope_override: "finance" },
    content_markdown: `## Introduction\n\n${filler}\n\n## Agreement details\n\nReview the term, total amount payable and ownership position.\n\n## Next steps\n\nCompare the vehicle and agreement carefully.`,
    faq_json: [],
    cta: "Apply for Van Finance",
    internal_link_suggestions: [],
    ...overrides,
  };
}

function proposalFor(article) {
  return {
    ...article,
    changes: [],
    removed_links: [],
    manual_confirmation_required: [],
    removed_sections: [],
    removal_reasons: [],
    removed_section_word_counts: [],
  };
}

test("formatting-only issue becomes ready after deterministic repair", () => {
  const original = financeArticle({
    content_markdown: `# Van Finance Guide\n## Introduction\n${filler}\n---\n## Next steps\n1. Review the van\n2. Review the agreement\nApply for Van Finance`,
  });
  const preview = buildCorrectionPreview({
    originalArticle: original,
    proposed: proposalFor(original),
    safetyOptions: { ignoreAssessmentFreshness: true },
    scopeOverride: "finance",
  });
  assert.equal(preview.after.content_markdown.startsWith("# Van Finance Guide"), false);
  assert.match(preview.after.content_markdown, /## Introduction\n\n/);
  assert.match(preview.after.content_markdown, /\n\n---\n\n/);
  assert.equal(preview.markdown_structure_valid, true);
  assert.equal(preview.remaining_hard_blocks.includes("Article formatting requires editorial correction."), false);
});

test("Markdown normalisation preserves bullet and numbered lists while separating CTA", () => {
  const output = normalizeMarkdownSpacing(`## Checks\n- First\n- Second\n1. One\n2. Two\nApply now`, "Apply now");
  assert.match(output, /## Checks\n\n- First\n- Second\n1\. One\n2\. Two\n\nApply now/);
});

test("claim-only proposal becomes saveable immediately after explicit confirmation", () => {
  const article = financeArticle();
  const proposal = {
    article_id: article.id,
    source_updated_at: article.updated_at,
    after: article,
    correction_complete: true,
    remaining_hard_blocks: [],
    claim_confirmation_required: true,
    content_loss_confirmation_required: false,
  };
  const pending = proposalStateForArticle(proposal, { claims: false });
  assert.equal(correctionSaveEligibility(pending, article).eligible, false);
  const confirmed = proposalStateForArticle(proposal, { claims: true });
  assert.equal(correctionSaveEligibility(confirmed, article).eligible, true);
});

test("review warnings do not block corrected-draft saving", () => {
  const article = financeArticle();
  const proposal = {
    article_id: article.id,
    source_updated_at: article.updated_at,
    after: article,
    correction_complete: true,
    remaining_hard_blocks: [],
    review_warnings: ["Minor repetition or templated tone should be reviewed."],
    claim_confirmation_required: false,
    content_loss_confirmation_required: false,
  };
  assert.equal(correctionSaveEligibility(proposalStateForArticle(proposal), article).eligible, true);
});

test("material links and product-separation failures still block", () => {
  const brokenLink = evaluatePublishingSafety(financeArticle({
    content_markdown: `${financeArticle().content_markdown}\n\n[Apply](javascript:alert(1))`,
  }), { ignoreAssessmentFreshness: true });
  assert.ok(brokenLink.hard_block_reasons.includes("Broken or malformed link detected."));

  const rent2buy = evaluatePublishingSafety({
    ...financeArticle(),
    id: "r2b",
    title: "Rent2Buy Guide",
    category: "Rent2Buy",
    primary_product: "rent2buy",
    generation_metadata: { product_scope_override: "rent2buy" },
    content_markdown: `## Introduction\n\n${filler}\n\n## Next steps\n\nReview the terms.`,
  }, { ignoreAssessmentFreshness: true, scopeOverride: "rent2buy" });
  assert.ok(rent2buy.hard_block_reasons.some((reason) => /Rent2Buy content/.test(reason)));
});

test("UI shows compact status and regeneration only for genuine material blocks", async () => {
  const source = await read("../components/PublishingSafetyCorrections.jsx");
  assert.match(source, /Ready to save/);
  assert.match(source, /Review and confirm/);
  assert.match(source, /Blocked — genuine material issue remains/);
  assert.match(source, /1 business claim needs your confirmation/);
  assert.match(source, /Formatting repaired automatically\. No material blocks remain\./);
  assert.match(source, /effectiveStatus === "blocked"[\s\S]*Regenerate Correction/);
});

test("no automatic approval or live Wix publishing is introduced", async () => {
  const correction = await read("../components/PublishingSafetyCorrections.jsx");
  const wix = await read("../components/KnowledgeHubWixPublishing.jsx");
  assert.doesNotMatch(correction, /approveAndCreateWixDraft|publishLive|livePublish/);
  assert.match(wix, /It never publishes live/);
  assert.doesNotMatch(wix, /status:\s*["']published["']/);
});

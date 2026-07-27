import { evaluatePublishingSafety } from "./publishingSafety.js";

const clean = (value) => String(value || "").trim();
const SAFE_FIELDS = [
  "title",
  "slug",
  "seo_title",
  "meta_description",
  "excerpt",
  "content_markdown",
  "faq_json",
  "cta",
  "category",
  "article_type",
  "featured_image",
];
const VALID_REMOVAL_REASONS = new Set([
  "duplicate content",
  "raw formatting",
  "placeholder text",
  "unsupported claim",
  "broken link",
  "unsafe content",
  "blocked content",
]);

export const MAX_BULK_CORRECTIONS = 5;

export function limitCorrectionBatch(articleIds = []) {
  return [...new Set((Array.isArray(articleIds) ? articleIds : []).filter(Boolean))].slice(
    0,
    MAX_BULK_CORRECTIONS
  );
}

export function countArticleWords(value) {
  return clean(value).split(/\s+/).filter(Boolean).length;
}

function justifiedRemoval(reasons = []) {
  return reasons.length > 0 && reasons.every((reason) =>
    [...VALID_REMOVAL_REASONS].some((allowed) => clean(reason).toLowerCase().includes(allowed))
  );
}

export function buildSafetyCorrectionPrompt({
  article,
  safety,
  businessKnowledge = [],
  overrides = {},
  approvedLinks = [],
  structuredCtas = [],
}) {
  return `Make targeted editorial repairs only to the identified publishing-safety problems in this Knowledge Hub article.

This is not a rewriting or summarisation task.

Hard preservation rules:
- Preserve every valid section, useful heading, example, explanation, comparison, FAQ and practical detail that is unrelated to a detected safety failure.
- Edit only the exact sections connected to the supplied failures.
- Remove only duplicated, broken, unsafe, placeholder, raw-formatting or unsupported material.
- Preserve the original topic, intended meaning, search intent, article depth and natural human usefulness.
- Preserve confirmed Business Knowledge, saved user overrides, valid SEO title, approved internal-link destinations, structured CTA destinations, preferred company terminology, and the distinction between Van Finance and Rent2Buy.
- Preserve at least 85% of valid non-duplicated content as a general target.
- Do not shorten the article merely to make it neater. Do not convert it into a summary.
- Do not add keyword repetition or SEO filler.
- Convert valid Markdown links into clean valid article formatting while retaining the confirmed destination.
- Never invent a URL. Remove a broken link only when no confirmed destination exists and report it.

Finance claim rules:
- Retain or cautiously clarify only claims supported by confirmed Business Knowledge.
- Do not replace one questionable finance claim with another.
- Do not state or imply that a larger deposit automatically lowers APR.
- Do not state or imply that a shorter term automatically lowers APR.
- Do not introduce guaranteed approval, guaranteed acceptance, guaranteed rates or guaranteed delivery.
- Do not present lender requirements as universal.
- Unsupported sensitive claims must be removed conservatively or listed for manual confirmation, never strengthened or broadened.

Return the full corrected article, not only changed sections. Also return:
- changes: precise issues repaired
- removed_links: broken links removed because no confirmed destination existed
- manual_confirmation_required: unresolved sensitive claims
- removed_sections: titles or concise descriptions of removed material
- removal_reasons: one reason per removed section, using clear terms such as duplicate content, raw formatting, placeholder text, unsupported claim, broken link, unsafe content or blocked content

Exact safety failures:
${(safety?.hard_block_reasons || []).map((reason) => `- ${reason}`).join("\n") || "- Safety warning present"}

Safety states:
${JSON.stringify(safety?.checks || {}, null, 2)}

Confirmed Business Knowledge:
${JSON.stringify(businessKnowledge, null, 2)}

Saved user overrides (preserve):
${JSON.stringify(overrides || {}, null, 2)}

Approved internal links (preserve destinations; never invent new ones):
${JSON.stringify(approvedLinks || [], null, 2)}

Structured CTA destinations (preserve):
${JSON.stringify(structuredCtas || [], null, 2)}

Current article:
${JSON.stringify(article, null, 2)}`;
}

export function normalizeCorrectionProposal(originalArticle = {}, proposed = {}) {
  const corrected = {};
  SAFE_FIELDS.forEach((field) => {
    if (field === "faq_json") {
      corrected[field] = Array.isArray(proposed[field])
        ? proposed[field]
            .map((item) => ({
              question: clean(item?.question),
              answer: clean(item?.answer),
            }))
            .filter((item) => item.question && item.answer)
        : Array.isArray(originalArticle[field])
          ? originalArticle[field]
          : [];
      return;
    }
    corrected[field] = proposed[field] === undefined
      ? originalArticle[field]
      : clean(proposed[field]);
  });

  corrected.id = originalArticle.id;
  corrected.topic_id = originalArticle.topic_id;
  corrected.template_id = originalArticle.template_id;
  corrected.status = "draft";
  corrected.internal_link_suggestions = originalArticle.internal_link_suggestions || [];
  corrected.generation_metadata = originalArticle.generation_metadata || {};
  corrected.approved_at = null;

  return {
    corrected_article: corrected,
    changes: Array.isArray(proposed.changes) ? proposed.changes.map(clean).filter(Boolean) : [],
    removed_links: Array.isArray(proposed.removed_links)
      ? proposed.removed_links.map(clean).filter(Boolean)
      : [],
    manual_confirmation_required: Array.isArray(proposed.manual_confirmation_required)
      ? proposed.manual_confirmation_required.map(clean).filter(Boolean)
      : [],
    removed_sections: Array.isArray(proposed.removed_sections)
      ? proposed.removed_sections.map(clean).filter(Boolean)
      : [],
    removal_reasons: Array.isArray(proposed.removal_reasons)
      ? proposed.removal_reasons.map(clean).filter(Boolean)
      : [],
  };
}

export function buildCorrectionPreview({ originalArticle, proposed, safetyOptions = {} }) {
  const normalized = normalizeCorrectionProposal(originalArticle, proposed);
  const originalWordCount = countArticleWords(originalArticle.content_markdown);
  const proposedWordCount = countArticleWords(normalized.corrected_article.content_markdown);
  const wordCountChangePercent = originalWordCount
    ? Math.round(((proposedWordCount - originalWordCount) / originalWordCount) * 1000) / 10
    : 0;
  const reductionPercent = Math.max(0, -wordCountChangePercent);
  const removalsExplained = normalized.removed_sections.length > 0 &&
    normalized.removed_sections.length === normalized.removal_reasons.length &&
    justifiedRemoval(normalized.removal_reasons);
  const excessiveContentLoss = reductionPercent > 25 && !removalsExplained;

  return {
    before: originalArticle,
    after: normalized.corrected_article,
    changes: normalized.changes,
    removed_links: normalized.removed_links,
    manual_confirmation_required: normalized.manual_confirmation_required,
    original_word_count: originalWordCount,
    proposed_word_count: proposedWordCount,
    word_count_change_percent: wordCountChangePercent,
    content_retained_percent: originalWordCount
      ? Math.max(0, Math.round((proposedWordCount / originalWordCount) * 1000) / 10)
      : 100,
    removed_sections: normalized.removed_sections,
    removal_reasons: normalized.removal_reasons,
    excessive_content_loss: excessiveContentLoss,
    safety_before: evaluatePublishingSafety(originalArticle, safetyOptions),
    safety_after: evaluatePublishingSafety(normalized.corrected_article, {
      ...safetyOptions,
      stale: true,
    }),
  };
}

export function correctionNeedsManualReview(preview = {}) {
  return Boolean(
    preview.manual_confirmation_required?.length ||
      preview.safety_after?.requires_manual_claim_review ||
      preview.excessive_content_loss
  );
}

export function applyAcceptedCorrection(originalArticle = {}, correctedArticle = {}) {
  return {
    ...originalArticle,
    ...normalizeCorrectionProposal(originalArticle, correctedArticle).corrected_article,
    status: "draft",
    approved_at: null,
  };
}

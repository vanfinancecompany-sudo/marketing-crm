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

export const MAX_BULK_CORRECTIONS = 5;

export function limitCorrectionBatch(articleIds = []) {
  return [...new Set((Array.isArray(articleIds) ? articleIds : []).filter(Boolean))].slice(
    0,
    MAX_BULK_CORRECTIONS
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
  return `Correct only the identified publishing-safety problems in this Knowledge Hub article.

Hard rules:
- Preserve the original topic, intended meaning, confirmed business information, saved user overrides, valid SEO title/search intent, approved internal links, structured CTA destinations, preferred company terminology, and the distinction between Van Finance and Rent2Buy.
- Do not invent URLs, finance claims, lender requirements, rates, repayments, deposits, warranties, approval promises or delivery promises.
- Unsupported sensitive claims must be removed conservatively or listed for manual confirmation; never strengthen them.
- Do not add keyword repetition.
- Return natural UK English written for a human reader.
- Return JSON matching the supplied schema only.

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
  };
}

export function buildCorrectionPreview({ originalArticle, proposed, safetyOptions = {} }) {
  const normalized = normalizeCorrectionProposal(originalArticle, proposed);
  return {
    before: originalArticle,
    after: normalized.corrected_article,
    changes: normalized.changes,
    removed_links: normalized.removed_links,
    manual_confirmation_required: normalized.manual_confirmation_required,
    safety_before: evaluatePublishingSafety(originalArticle, safetyOptions),
    safety_after: evaluatePublishingSafety(normalized.corrected_article, {
      ...safetyOptions,
      assessment: null,
      stale: false,
    }),
  };
}

export function correctionNeedsManualReview(preview = {}) {
  return Boolean(
    preview.manual_confirmation_required?.length ||
      preview.safety_after?.requires_manual_claim_review
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

import {
  BUSINESS_KNOWLEDGE_SECTION_DEFINITIONS,
  normalizeBusinessKnowledgeSections,
} from "./businessIntelligence.js";
import { KNOWLEDGE_CATEGORIES, findKnowledgeArticleDuplicates } from "./knowledgeHub.js";

export const AI_CONTENT_CHANNELS = Object.freeze([
  { key: "email", label: "Email", guidance: "A subject-led marketing email draft with preview text." },
  { key: "facebook", label: "Facebook", guidance: "A useful Facebook post with a clear manual next step." },
  { key: "linkedin", label: "LinkedIn", guidance: "A professional LinkedIn post with business context." },
  { key: "google_business_profile", label: "Google Business Profile", guidance: "A concise local business update." },
  { key: "x", label: "X", guidance: "A concise post suitable for X." },
  { key: "sms", label: "SMS", guidance: "A concise SMS draft; do not imply it will be sent." },
  { key: "meta_ad", label: "Meta Ad", guidance: "Manual-review ad copy with primary text, headline and CTA." },
]);

export const AI_REVIEW_CATEGORY_KEYS = Object.freeze([
  "brand_voice",
  "vocabulary",
  "compliance",
  "seo",
  "readability",
  "repetition",
  "cta_quality",
  "generic_wording",
  "hallucination_risk",
]);

function clean(value) {
  return String(value || "").trim();
}

function clampScore(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : fallback;
}

export function calculateBusinessBrainCompleteness(sections = [], settings = {}) {
  const normalized = normalizeBusinessKnowledgeSections(sections, settings);
  const sectionScores = normalized.map((section) => {
    const contentWords = clean(section.content).split(/\s+/).filter(Boolean).length;
    const completeEntries = (section.entries || []).filter(
      (entry) => clean(entry.label) && clean(entry.value)
    ).length;
    const partialEntries = (section.entries || []).filter(
      (entry) => clean(entry.label) || clean(entry.value)
    ).length;
    const contentScore = Math.min(70, contentWords * 2);
    const entryScore = Math.min(30, completeEntries * 10 + (partialEntries - completeEntries) * 4);
    return {
      key: section.section_key,
      title: section.title,
      score: section.active === false ? 0 : clampScore(contentScore + entryScore),
    };
  });
  const overall = sectionScores.length
    ? Math.round(sectionScores.reduce((sum, section) => sum + section.score, 0) / sectionScores.length)
    : 0;
  return { overall, sections: sectionScores };
}

function wordCount(value) {
  return clean(value).split(/\s+/).filter(Boolean).length;
}

function sentenceWords(value) {
  const sentences = clean(value).split(/[.!?]+/).map((item) => wordCount(item)).filter(Boolean);
  return sentences.length
    ? sentences.reduce((sum, count) => sum + count, 0) / sentences.length
    : 0;
}

export function calculateArticleSeoIntelligence(article = {}, allArticles = []) {
  const markdown = clean(article.content_markdown);
  const title = clean(article.title);
  const words = wordCount(markdown);
  const headings = markdown.match(/^#{2,3}\s+.+$/gm) || [];
  const links = markdown.match(/\[[^\]]+\]\([^)]+\)/g) || [];
  const faqCount = Array.isArray(article.faq_json) ? article.faq_json.length : 0;
  const titleDuplicate = allArticles.some(
    (candidate) =>
      candidate.id !== article.id &&
      candidate.status !== "archived" &&
      clean(candidate.title).toLowerCase() === title.toLowerCase()
  );
  const readability = clampScore(100 - Math.max(0, sentenceWords(markdown) - 18) * 3);
  const seo = clampScore(
    (clean(article.seo_title) ? 20 : 0) +
      (clean(article.meta_description).length >= 80 ? 20 : 0) +
      (headings.length >= 3 ? 20 : headings.length * 6) +
      (words >= 600 ? 20 : Math.round(words / 30)) +
      (links.length ? 20 : 0)
  );
  const relevance = clampScore(
    (clean(article.category) ? 25 : 0) +
      (clean(article.excerpt) ? 20 : 0) +
      (clean(article.generation_metadata?.target_audience) ? 20 : 0) +
      Math.min(35, words / 20)
  );
  const ctaQuality = clampScore(clean(article.cta).length >= 20 ? 100 : clean(article.cta).length * 5);
  const internalLinking = clampScore(Math.min(100, links.length * 35 + (article.internal_link_suggestions?.length || 0) * 15));
  const flags = {
    missing_headings: headings.length < 3,
    missing_faq: faqCount === 0,
    duplicate_title: titleDuplicate,
    thin_content: words < 600,
  };
  const penalties = Object.values(flags).filter(Boolean).length * 8;
  const overall = clampScore(
    (seo + readability + relevance + ctaQuality + internalLinking) / 5 - penalties
  );
  return {
    overall_score: overall,
    seo_score: seo,
    readability,
    business_relevance: relevance,
    cta_quality: ctaQuality,
    internal_linking: internalLinking,
    flags,
    word_count: words,
    heading_count: headings.length,
    faq_count: faqCount,
  };
}

export function recommendInternalLinks(article = {}, allArticles = []) {
  const sourceWords = new Set(
    `${article.title || ""} ${article.category || ""}`.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3)
  );
  return allArticles
    .filter((candidate) => candidate.id !== article.id && candidate.status === "approved")
    .map((candidate) => {
      const candidateWords = `${candidate.title || ""} ${candidate.category || ""}`.toLowerCase().split(/[^a-z0-9]+/);
      const overlap = candidateWords.filter((word) => sourceWords.has(word)).length;
      const type = /rent2buy/i.test(`${candidate.category} ${candidate.title}`)
        ? "Rent2Buy page"
        : /faq/i.test(candidate.article_type)
          ? "FAQ page"
          : /vehicle/i.test(`${candidate.article_type} ${candidate.category}`)
            ? "Vehicle guide"
            : /buying/i.test(candidate.article_type)
              ? "Buying guide"
              : /finance/i.test(`${candidate.category} ${candidate.title}`)
                ? "Finance page"
                : "Related article";
      return { article_id: candidate.id, title: candidate.title, type, score: overlap };
    })
    .sort((first, second) => second.score - first.score || first.title.localeCompare(second.title))
    .slice(0, 8);
}

export function buildTopicPlannerSections({ topics = [], articles = [], freshnessDays = 180, now = new Date() } = {}) {
  const activeArticles = articles.filter((article) => article.status !== "archived");
  const coveredTopicIds = new Set(activeArticles.map((article) => article.topic_id).filter(Boolean));
  const staleThreshold = now.getTime() - Number(freshnessDays || 180) * 86400000;
  const duplicates = findKnowledgeArticleDuplicates(activeArticles);
  const duplicateArticleIds = new Set(
    duplicates.flatMap((duplicate) => [duplicate.article?.id, duplicate.other?.id]).filter(Boolean)
  );
  const missingCategories = new Set(
    KNOWLEDGE_CATEGORIES.filter(
      (category) => !activeArticles.some((article) => article.category === category && article.status === "approved")
    )
  );
  return {
    high_priority: topics.filter((topic) => Number(topic.priority || 3) >= 4 && !coveredTopicIds.has(topic.id)),
    seasonal: topics.filter((topic) => topic.seasonal),
    missing_coverage: topics.filter((topic) => missingCategories.has(topic.category) && !coveredTopicIds.has(topic.id)),
    refresh_needed: activeArticles.filter(
      (article) => new Date(article.updated_at || article.created_at).getTime() < staleThreshold
    ),
    recently_published: activeArticles
      .filter((article) => article.status === "approved")
      .sort((a, b) => new Date(b.approved_at || b.updated_at) - new Date(a.approved_at || a.updated_at))
      .slice(0, 12),
    duplicate_risks: activeArticles.filter((article) => duplicateArticleIds.has(article.id)),
    opportunities: topics.filter(
      (topic) => !coveredTopicIds.has(topic.id) && (Number(topic.estimated_value || 3) >= 4 || clean(topic.opportunity_reason))
    ),
  };
}

export function parseAiContentAsset(value) {
  let parsed = value;
  if (typeof parsed === "string") parsed = JSON.parse(parsed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The AI response was not a structured content asset.");
  }
  const result = {
    title: clean(parsed.title),
    body: clean(parsed.body),
    preview_text: clean(parsed.preview_text),
    cta: clean(parsed.cta),
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(clean).filter(Boolean) : [],
  };
  if (!result.title || !result.body) throw new Error("The AI content asset is incomplete.");
  return result;
}

export function parseWebsiteIntelligence(value) {
  let parsed = value;
  if (typeof parsed === "string") parsed = JSON.parse(parsed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The AI response was not structured website intelligence.");
  }
  const keys = ["company", "products", "faqs", "services", "tone", "vocabulary", "personas", "ctas"];
  const sections = Object.fromEntries(
    keys.map((key) => [
      key,
      Array.isArray(parsed[key]) ? parsed[key].map(clean).filter(Boolean).slice(0, 100) : [],
    ])
  );
  if (!Object.values(sections).some((entries) => entries.length)) {
    throw new Error("No reviewable business knowledge was extracted.");
  }
  return sections;
}

export function normalizeAiReview(value) {
  let parsed = value;
  if (typeof parsed === "string") parsed = JSON.parse(parsed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The AI response was not a structured review.");
  }
  const categories = Object.fromEntries(
    AI_REVIEW_CATEGORY_KEYS.map((key) => [
      key,
      {
        score: clampScore(parsed.categories?.[key]?.score),
        reason: clean(parsed.categories?.[key]?.reason),
      },
    ])
  );
  return {
    overall_score: clampScore(parsed.overall_score),
    summary: clean(parsed.summary),
    categories,
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.map(clean).filter(Boolean)
      : [],
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.slice(0, 100) : [],
  };
}

export const BUSINESS_BRAIN_SECTION_LABELS = Object.freeze(
  Object.fromEntries(BUSINESS_KNOWLEDGE_SECTION_DEFINITIONS.map((section) => [section.key, section.title]))
);

export const EDITORIAL_CATEGORY_WEIGHTS = Object.freeze({
  business_accuracy: 0.12,
  business_brain_compliance: 0.1,
  seo_quality: 0.1,
  conversion_potential: 0.1,
  customer_intent_match: 0.09,
  readability: 0.07,
  originality: 0.08,
  internal_linking: 0.07,
  faq_coverage: 0.06,
  cta_quality: 0.08,
  metadata_quality: 0.05,
  freshness: 0.04,
  consistency: 0.04,
});

export const EDITORIAL_CATEGORY_LABELS = Object.freeze({
  business_accuracy: "Business Accuracy",
  business_brain_compliance: "Business Brain Compliance",
  seo_quality: "SEO Quality",
  conversion_potential: "Conversion Potential",
  customer_intent_match: "Customer Intent Match",
  readability: "Readability",
  originality: "Originality",
  internal_linking: "Internal Linking",
  faq_coverage: "FAQ Coverage",
  cta_quality: "CTA Quality",
  metadata_quality: "Metadata Quality",
  freshness: "Freshness",
  consistency: "Consistency",
});

export const PRIMARY_PRODUCTS = Object.freeze(["finance", "rent2buy", "both"]);
export const CUSTOMER_JOURNEYS = Object.freeze([
  "awareness",
  "research",
  "comparison",
  "decision",
  "ready_to_apply",
]);
export const SEARCH_INTENTS = Object.freeze(["informational", "commercial", "transactional"]);
export const PUBLICATION_STATUSES = Object.freeze(["ready", "review", "needs_improvement", "blocked"]);

const clean = (value) => String(value || "").trim();
const clamp = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : fallback;
};
const unique = (items) => [...new Set(items)];

export function articleContentHash(article = {}) {
  const content = [
    article.title,
    article.seo_title,
    article.meta_description,
    article.excerpt,
    article.content_markdown,
    JSON.stringify(article.faq_json || []),
    article.cta,
  ].map(clean).join("\n");
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeScoreCategory(value = {}) {
  return {
    score: clamp(value.score),
    reason: clean(value.reason),
    lost_points: Math.max(0, Math.min(100, Number(value.lost_points) || 0)),
  };
}

export function calculateEditorialScore(categoryScores = {}, options = {}) {
  const categories = Object.fromEntries(
    Object.keys(EDITORIAL_CATEGORY_WEIGHTS).map((key) => [
      key,
      normalizeScoreCategory(categoryScores[key]),
    ])
  );
  const overall = clamp(
    Object.entries(EDITORIAL_CATEGORY_WEIGHTS).reduce(
      (total, [key, weight]) => total + categories[key].score * weight,
      0
    )
  );
  const criticalWarning = Boolean(options.criticalWarning);
  const blocked =
    criticalWarning ||
    categories.business_accuracy.score < 50 ||
    categories.business_brain_compliance.score < 50 ||
    overall < 45;
  const grade = overall >= 90 ? 5 : overall >= 80 ? 4 : overall >= 70 ? 3 : overall >= 55 ? 2 : 1;
  const confidenceScore = clamp(options.confidenceScore, 0);
  const confidence = confidenceScore >= 80 ? "high" : confidenceScore >= 55 ? "medium" : "low";
  const publicationStatus = blocked
    ? "blocked"
    : overall >= 85 && confidenceScore >= 70
      ? "ready"
      : overall >= 70
        ? "review"
        : "needs_improvement";
  const lostPoints = Object.entries(categories)
    .map(([key, category]) => ({
      category: key,
      label: EDITORIAL_CATEGORY_LABELS[key],
      points: Number(((100 - category.score) * EDITORIAL_CATEGORY_WEIGHTS[key]).toFixed(1)),
      reason: category.reason,
    }))
    .filter((item) => item.points > 0)
    .sort((a, b) => b.points - a.points);
  return {
    overall_score: overall,
    grade,
    confidence,
    publication_status: publicationStatus,
    category_scores: categories,
    lost_points: lostPoints,
  };
}

function normalizeIntent(value = {}) {
  return {
    primary_product: PRIMARY_PRODUCTS.includes(value.primary_product) ? value.primary_product : "both",
    secondary_product: clean(value.secondary_product),
    customer_journey: CUSTOMER_JOURNEYS.includes(value.customer_journey)
      ? value.customer_journey
      : "research",
    search_intent: SEARCH_INTENTS.includes(value.search_intent)
      ? value.search_intent
      : "informational",
    conversion_goal: clean(value.conversion_goal),
    confidence_score: clamp(value.confidence_score),
  };
}

export function applyIntentOverrides(intent = {}, overrides = {}) {
  const allowed = new Set([
    "primary_product",
    "secondary_product",
    "customer_journey",
    "search_intent",
    "conversion_goal",
  ]);
  const safeOverrides = Object.fromEntries(
    Object.entries(overrides || {}).filter(([key, value]) => allowed.has(key) && clean(value))
  );
  return normalizeIntent({ ...intent, ...safeOverrides });
}

function normalizeCtas(items = [], allowedDestinations = []) {
  const destinations = new Set();
  const allowed = new Set(allowedDestinations.map(clean).filter(Boolean));
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      role: item?.role === "secondary" ? "secondary" : "primary",
      button_text: clean(item?.button_text),
      destination: clean(item?.destination),
      order: Math.max(1, Math.min(3, Number(item?.order) || index + 1)),
      reason: clean(item?.reason),
      confidence_score: clamp(item?.confidence_score),
    }))
    .filter((item) => {
      if (
        !item.button_text ||
        !item.destination ||
        destinations.has(item.destination) ||
        (allowed.size && !allowed.has(item.destination))
      ) return false;
      destinations.add(item.destination);
      return true;
    })
    .sort((a, b) => a.order - b.order)
    .slice(0, 3);
}

function normalizeInternalLinks(items = [], allowedArticleIds = [], allowedPageKeys = []) {
  const articleIds = new Set(allowedArticleIds);
  const pageKeys = new Set(allowedPageKeys);
  const anchors = new Set();
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      target_type: item?.target_type === "business_page" ? "business_page" : "article",
      target_id: clean(item?.target_id),
      anchor_text: clean(item?.anchor_text),
      context: clean(item?.context),
      relevance_score: clamp(item?.relevance_score),
    }))
    .filter((item) => {
      const anchor = item.anchor_text.toLowerCase();
      const validTarget = item.target_type === "article"
        ? articleIds.has(item.target_id)
        : pageKeys.has(item.target_id);
      if (!validTarget || !anchor || anchors.has(anchor) || item.relevance_score < 40) return false;
      anchors.add(anchor);
      return true;
    })
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .slice(0, 6);
}

function normalizeBusinessRecommendations(items = [], brainSections = []) {
  const contentByKey = new Map(
    brainSections.map((section) => [
      section.section_key,
      clean(`${section.content || ""} ${(section.entries || []).map((entry) => `${entry.label} ${entry.value}`).join(" ")}`)
        .toLowerCase(),
    ])
  );
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      key: clean(item?.key) || `recommendation_${index + 1}`,
      title: clean(item?.title),
      suggestion: clean(item?.suggestion),
      brain_section_key: clean(item?.brain_section_key),
      source_excerpt: clean(item?.source_excerpt),
      target_field: clean(item?.target_field) || "content_markdown",
      confidence_score: clamp(item?.confidence_score),
    }))
    .filter((item) => {
      const source = contentByKey.get(item.brain_section_key);
      const excerpt = item.source_excerpt.toLowerCase();
      return item.title && item.suggestion && source && excerpt.length >= 5 && source.includes(excerpt);
    })
    .slice(0, 20);
}

function normalizeImprovements(items = []) {
  const seen = new Set();
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      key: clean(item?.key) || `improvement_${index + 1}`,
      title: clean(item?.title),
      description: clean(item?.description),
      target_field: clean(item?.target_field) || "content_markdown",
      expected_gain: Math.max(0, Math.min(30, Number(item?.expected_gain) || 0)),
    }))
    .filter((item) => item.title && item.description && !seen.has(item.key) && seen.add(item.key))
    .slice(0, 20);
}

export function normalizeEditorialAnalysis(value, context = {}) {
  let parsed = value;
  if (typeof parsed === "string") parsed = JSON.parse(parsed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The AI response was not a structured editorial assessment.");
  }
  const intent = normalizeIntent(parsed.intent);
  const warnings = (Array.isArray(parsed.warnings) ? parsed.warnings : [])
    .map((warning) => ({
      severity: ["low", "medium", "high", "critical"].includes(warning?.severity)
        ? warning.severity
        : "medium",
      message: clean(warning?.message),
    }))
    .filter((warning) => warning.message)
    .slice(0, 50);
  const score = calculateEditorialScore(parsed.category_scores, {
    confidenceScore: intent.confidence_score,
    criticalWarning: warnings.some((warning) => warning.severity === "critical"),
  });
  const conceptKeys = new Set((context.concepts || []).map((concept) => concept.concept_key));
  const coverageConcepts = (Array.isArray(parsed.coverage_concepts) ? parsed.coverage_concepts : [])
    .map((item) => ({
      concept_key: clean(item?.concept_key),
      relevance_score: clamp(item?.relevance_score),
      evidence: clean(item?.evidence),
    }))
    .filter((item) => conceptKeys.has(item.concept_key) && item.relevance_score >= 20)
    .slice(0, 50);
  return {
    intent,
    structured_ctas: normalizeCtas(parsed.structured_ctas, context.allowedCtaDestinations),
    internal_links: normalizeInternalLinks(
      parsed.internal_links,
      (context.articles || []).map((article) => article.id),
      (context.businessPages || []).map((page) => page.page_key)
    ),
    business_recommendations: normalizeBusinessRecommendations(
      parsed.business_recommendations,
      context.brainSections || []
    ),
    ...score,
    strengths: unique((Array.isArray(parsed.strengths) ? parsed.strengths : []).map(clean).filter(Boolean)).slice(0, 20),
    weaknesses: unique((Array.isArray(parsed.weaknesses) ? parsed.weaknesses : []).map(clean).filter(Boolean)).slice(0, 20),
    suggested_improvements: normalizeImprovements(parsed.suggested_improvements),
    coverage_concepts: coverageConcepts,
    warnings,
  };
}

export function estimateReadingTime(article = {}) {
  const words = clean(article.content_markdown).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 225));
}

export function buildArticleReviewSummary(article = {}, assessment = {}) {
  const categories = assessment.category_scores || {};
  const score = Number(assessment.overall_score) || 0;
  const action = assessment.publication_status === "ready"
    ? "publish"
    : assessment.publication_status === "review"
      ? "minor_review"
      : assessment.publication_status === "blocked"
        ? "rewrite"
        : "improve";
  return {
    reading_time_minutes: estimateReadingTime(article),
    review_time_minutes: Math.max(1, Math.ceil((assessment.weaknesses?.length || 0) / 2) + 1),
    overall_score: score,
    confidence: assessment.confidence || "low",
    business_risk: clamp(100 - (categories.business_accuracy?.score || 0)),
    seo_risk: clamp(100 - (categories.seo_quality?.score || 0)),
    conversion_rating: clamp(categories.conversion_potential?.score),
    recommended_action: action,
  };
}

export function buildArticleHealth(assessment = {}, intent = {}, stale = false) {
  const categories = assessment.category_scores || {};
  const health = {
    business_accuracy: clamp(categories.business_accuracy?.score),
    seo: clamp(categories.seo_quality?.score),
    conversion: clamp(categories.conversion_potential?.score),
    freshness: stale ? 0 : clamp(categories.freshness?.score),
    links: clamp(categories.internal_linking?.score),
    metadata: clamp(categories.metadata_quality?.score),
    business_brain_compliance: clamp(categories.business_brain_compliance?.score),
    overall_health: stale ? Math.max(0, clamp(assessment.overall_score) - 10) : clamp(assessment.overall_score),
  };
  const warnings = [];
  if (!intent.conversion_goal) warnings.push("Conversion goal needs review.");
  if (stale) warnings.push("Editorial analysis is out of date.");
  if (assessment.publication_status === "blocked") warnings.push("Critical editorial checks block approval.");
  Object.entries(health).forEach(([key, score]) => {
    if (key !== "overall_health" && score < 60) warnings.push(`${EDITORIAL_CATEGORY_LABELS[key] || key} needs attention.`);
  });
  return { ...health, warnings: unique(warnings) };
}

export function buildApprovalQueue({ articles = [], assessments = [], topics = [], proposals = [] } = {}) {
  const latest = new Map();
  [...assessments]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .forEach((assessment) => {
      if (!latest.has(assessment.article_id)) latest.set(assessment.article_id, assessment);
    });
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const improving = new Set(
    proposals.filter((proposal) => proposal.status === "review").map((proposal) => proposal.article_id)
  );
  return articles
    .filter((article) => article.status === "draft")
    .map((article) => {
      const assessment = latest.get(article.id);
      const topic = topicById.get(article.topic_id);
      const score = Number(assessment?.overall_score) || 0;
      const grade = Number(assessment?.grade) || 1;
      const queueState = improving.has(article.id)
        ? "ai_improving"
        : grade >= 5
          ? "ready"
          : grade === 4
            ? "review"
            : grade === 3
              ? "ai_improving"
              : grade === 2
                ? "rewrite"
                : "reject";
      const freshnessAge = Math.max(
        0,
        Math.floor((Date.now() - new Date(article.updated_at || article.created_at).getTime()) / 86400000)
      );
      const priority =
        (Number(topic?.estimated_value) || 3) * 12 +
        (Number(topic?.priority) || 3) * 8 +
        (clean(topic?.opportunity_reason) ? 10 : 0) +
        (assessment?.category_scores?.conversion_potential?.score || 0) * 0.2 +
        Math.min(20, freshnessAge / 10) +
        (grade >= 4 ? 30 : Math.max(0, 20 - score / 5));
      return { article, assessment, queue_state: queueState, priority_score: Math.round(priority) };
    })
    .sort((a, b) => {
      const rank = { ready: 0, review: 1, ai_improving: 2, rewrite: 3, reject: 4 };
      return rank[a.queue_state] - rank[b.queue_state] || b.priority_score - a.priority_score;
    });
}

export function buildKnowledgeCoverageMap({
  concepts = [],
  articleConcepts = [],
  articles = [],
  topics = [],
} = {}) {
  const articleById = new Map(articles.map((article) => [article.id, article]));
  const existingTitles = [...articles, ...topics].map((item) => clean(item.title).toLowerCase());
  return concepts
    .filter((concept) => concept.active !== false)
    .map((concept) => {
      const mappings = articleConcepts.filter((mapping) => mapping.concept_id === concept.id);
      const approved = mappings.filter(
        (mapping) => articleById.get(mapping.article_id)?.status === "approved"
      );
      const best = Math.max(0, ...approved.map((mapping) => Number(mapping.relevance_score) || 0));
      const breadth = Math.min(20, approved.length * 5);
      const coverage = clamp(best * 0.8 + breadth);
      const duplicateIntent = existingTitles.some((title) =>
        [concept.label, ...(concept.aliases || [])].some((term) => title.includes(clean(term).toLowerCase()))
      );
      return {
        ...concept,
        coverage_score: coverage,
        article_count: approved.length,
        weak: coverage < 60,
        recommended_topic: coverage < 60 && !duplicateIntent
          ? `A practical guide to ${concept.label}`
          : "",
      };
    })
    .sort((a, b) => a.coverage_score - b.coverage_score || a.label.localeCompare(b.label));
}

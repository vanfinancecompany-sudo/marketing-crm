export const AUTOMATION_JOB_TYPES = Object.freeze([
  "opportunity_scan",
  "topic_discovery",
  "draft_factory",
  "improvement",
  "editorial_refresh",
  "daily_briefing",
]);

export const PROHIBITED_AUTOMATION_ACTIONS = Object.freeze([
  "publish",
  "approve",
  "schedule_publication",
  "modify_website",
  "send_email",
  "send_sms",
  "post_social",
]);

export const OPPORTUNITY_TYPES = Object.freeze([
  "missing_topic",
  "outdated_content",
  "weak_article",
  "duplicate_intent",
  "missing_faq",
  "weak_cta",
  "weak_linking",
]);

const clean = (value) => String(value || "").trim();
const clamp = (value, minimum = 0, maximum = 100) =>
  Math.max(minimum, Math.min(maximum, Math.round(Number(value) || 0)));

export function automationFingerprint(...parts) {
  const input = parts.map(clean).join("|").toLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function assertSafeAutomationAction(action) {
  const normalized = clean(action).toLowerCase();
  if (PROHIBITED_AUTOMATION_ACTIONS.includes(normalized)) {
    throw new Error(`Automation safety rule prohibits "${normalized}".`);
  }
  return normalized;
}

export function calculateOpportunityPriority(opportunity = {}) {
  const businessValue = clamp(opportunity.business_value || 3, 1, 5);
  const conversion = clamp(opportunity.conversion_potential || 3, 1, 5);
  const effort = clamp(opportunity.editorial_effort || 3, 1, 5);
  const freshness = clamp(opportunity.freshness_priority || 0);
  const qualityGap = clamp(opportunity.quality_gap || 0);
  return clamp(
    businessValue * 10 +
      conversion * 10 +
      Math.max(0, 6 - effort) * 4 +
      freshness * 0.12 +
      qualityGap * 0.18
  );
}

function productFromText(value) {
  const text = clean(value).toLowerCase();
  const finance = /\bfinance|hire purchase|lease purchase|credit\b/.test(text);
  const rent2buy = /rent\s?2\s?buy|rent-to-buy|no credit check/.test(text);
  return finance && rent2buy ? "both" : rent2buy ? "rent2buy" : finance ? "finance" : "both";
}

function journeyFromAssessment(assessment = {}) {
  return assessment.effective_intent?.customer_journey || "research";
}

function intentWords(value) {
  return new Set(
    clean(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((word) => word.length > 3)
      .map((word) => word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word)
  );
}

function duplicateIntentScore(first, second) {
  const firstWords = intentWords(first);
  const secondWords = intentWords(second);
  if (!firstWords.size || !secondWords.size) return 0;
  const overlap = [...firstWords].filter((word) => secondWords.has(word)).length;
  return overlap / Math.max(firstWords.size, secondWords.size);
}

export function buildScannerOpportunities({
  articles = [],
  assessments = [],
  concepts = [],
  articleConcepts = [],
  topics = [],
  freshnessDays = 180,
  now = new Date(),
} = {}) {
  const latest = new Map();
  [...assessments]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .forEach((assessment) => {
      if (!latest.has(assessment.article_id)) latest.set(assessment.article_id, assessment);
    });
  const opportunities = [];
  const add = (values) => {
    const fingerprint = automationFingerprint(
      values.opportunity_type,
      values.source_article_id || values.source_concept_id || values.title,
      values.source_version || ""
    );
    if (opportunities.some((item) => item.fingerprint === fingerprint)) return;
    opportunities.push({
      business_value: 3,
      conversion_potential: 3,
      editorial_effort: 3,
      customer_journey: "research",
      primary_product: productFromText(values.title),
      ...values,
      fingerprint,
      priority_score: calculateOpportunityPriority(values),
      status: "draft",
    });
  };

  const threshold = now.getTime() - Number(freshnessDays || 180) * 86400000;
  articles.filter((article) => article.status !== "archived").forEach((article) => {
    const assessment = latest.get(article.id);
    const base = {
      source_article_id: article.id,
      title: article.title,
      primary_product:
        assessment?.effective_intent?.primary_product || productFromText(`${article.title} ${article.category}`),
      customer_journey: journeyFromAssessment(assessment),
      evidence: { article_title: article.title, assessment_id: assessment?.id || null },
      source_version: assessment?.id || article.updated_at || article.created_at,
    };
    const updated = new Date(article.updated_at || article.created_at).getTime();
    if (updated < threshold) {
      add({
        ...base,
        opportunity_type: "outdated_content",
        title: `Refresh: ${article.title}`,
        reason: "The article is older than the configured freshness threshold.",
        freshness_priority: 100,
        quality_gap: 100 - Number(assessment?.overall_score || 0),
        business_value: 4,
        conversion_potential: 3,
        editorial_effort: 2,
      });
    }
    if (!assessment || Number(assessment.overall_score) < 75) {
      add({
        ...base,
        opportunity_type: "weak_article",
        title: `Improve: ${article.title}`,
        reason: assessment
          ? `Editorial score is ${assessment.overall_score}/100.`
          : "The article has no current editorial assessment.",
        quality_gap: 100 - Number(assessment?.overall_score || 0),
        business_value: 4,
        conversion_potential: 4,
        editorial_effort: 2,
      });
    }
    if (!Array.isArray(article.faq_json) || article.faq_json.length < 2) {
      add({
        ...base,
        opportunity_type: "missing_faq",
        title: `Expand FAQs: ${article.title}`,
        reason: "The article has fewer than two useful FAQ entries.",
        quality_gap: 70,
        editorial_effort: 1,
      });
    }
    if (Number(assessment?.category_scores?.cta_quality?.score || 0) < 70) {
      add({
        ...base,
        opportunity_type: "weak_cta",
        title: `Strengthen CTA: ${article.title}`,
        reason: "CTA quality is below the editorial preparation threshold.",
        conversion_potential: 5,
        quality_gap: 100 - Number(assessment?.category_scores?.cta_quality?.score || 0),
        editorial_effort: 1,
      });
    }
    if (Number(assessment?.category_scores?.internal_linking?.score || 0) < 70) {
      add({
        ...base,
        opportunity_type: "weak_linking",
        title: `Improve links: ${article.title}`,
        reason: "Internal linking is below the editorial preparation threshold.",
        quality_gap: 100 - Number(assessment?.category_scores?.internal_linking?.score || 0),
        editorial_effort: 1,
      });
    }
  });

  const activeArticles = articles.filter((article) => article.status !== "archived");
  activeArticles.forEach((article, index) => {
    activeArticles.slice(index + 1).forEach((candidate) => {
      const relevance = duplicateIntentScore(article.title, candidate.title);
      if (relevance < 0.7) return;
      const assessment = latest.get(candidate.id);
      add({
        opportunity_type: "duplicate_intent",
        source_article_id: candidate.id,
        title: `Review duplicate intent: ${article.title} / ${candidate.title}`,
        reason: "These articles appear to target substantially the same search intent.",
        evidence: {
          article_ids: [article.id, candidate.id],
          article_titles: [article.title, candidate.title],
          relevance_score: clamp(relevance * 100),
        },
        source_version: [
          article.id,
          article.updated_at || article.created_at,
          candidate.id,
          candidate.updated_at || candidate.created_at,
        ].join(":"),
        primary_product:
          assessment?.effective_intent?.primary_product ||
          productFromText(`${article.title} ${candidate.title}`),
        customer_journey: journeyFromAssessment(assessment),
        business_value: 3,
        conversion_potential: 3,
        editorial_effort: 2,
        quality_gap: clamp(relevance * 100),
      });
    });
  });

  const approvedArticleIds = new Set(
    articles.filter((article) => article.status === "approved").map((article) => article.id)
  );
  const existingIntentText = [...articles, ...topics]
    .filter((item) => item.status !== "archived")
    .map((item) => clean(item.title).toLowerCase());
  concepts.filter((concept) => concept.active !== false).forEach((concept) => {
    const coverage = articleConcepts
      .filter(
        (mapping) =>
          mapping.concept_id === concept.id && approvedArticleIds.has(mapping.article_id)
      )
      .reduce((maximum, mapping) => Math.max(maximum, Number(mapping.relevance_score) || 0), 0);
    const terms = [concept.label, ...(concept.aliases || [])]
      .map((term) => clean(term).toLowerCase())
      .filter(Boolean);
    const duplicateIntent = existingIntentText.some((title) =>
      terms.some((term) => title.includes(term))
    );
    if (coverage < 60 && !duplicateIntent) {
      add({
        opportunity_type: "missing_topic",
        source_concept_id: concept.id,
        title: `Cover: ${concept.label}`,
        reason: `Approved knowledge coverage is ${coverage}/100.`,
        evidence: { concept_key: concept.concept_key, coverage_score: coverage },
        source_version: coverage,
        primary_product: concept.primary_product || "both",
        customer_journey: "research",
        business_value: 4,
        conversion_potential: 4,
        editorial_effort: 3,
        quality_gap: 100 - coverage,
      });
    }
  });
  return opportunities.sort((a, b) => b.priority_score - a.priority_score);
}

export function mergeDiscoveredTopics(ideas = [], existing = []) {
  const signatureFor = (value) =>
    clean(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(" ")
      .map((word) => word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word)
      .join(" ");
  const signatures = new Set(
    existing.map((item) => signatureFor(item.title))
  );
  const accepted = [];
  const duplicates = [];
  ideas.forEach((idea) => {
    const signature = signatureFor(idea.title);
    const words = new Set(signature.split(" ").filter((word) => word.length > 3));
    const nearDuplicate = [...signatures].some((candidate) => {
      const candidateWords = candidate.split(" ").filter((word) => word.length > 3);
      const overlap = candidateWords.filter((word) => words.has(word)).length;
      return signature === candidate || (overlap >= 3 && overlap / Math.max(words.size, candidateWords.length) >= 0.7);
    });
    if (!signature || nearDuplicate) duplicates.push(idea);
    else {
      signatures.add(signature);
      accepted.push(idea);
    }
  });
  return { accepted, duplicates };
}

export function canQueueDraftFactory(opportunity = {}) {
  return opportunity.status === "approved" && opportunity.opportunity_type === "missing_topic";
}

export function evaluateDraftThreshold(assessment = {}, minimumScore = 75) {
  const score = Number(assessment.overall_score) || 0;
  const critical = (assessment.warnings || []).some((warning) => warning.severity === "critical");
  const passes =
    !critical &&
    score >= Number(minimumScore || 75) &&
    assessment.publication_status !== "blocked";
  return {
    passes,
    score,
    reason: passes
      ? `Draft meets the ${minimumScore}/100 preparation threshold.`
      : critical
        ? "Draft has a critical editorial warning."
        : `Draft score ${score}/100 is below the ${minimumScore}/100 threshold.`,
  };
}

export function buildDailyBriefing({
  logs = [],
  opportunities = [],
  jobs = [],
  assessments = [],
  now = new Date(),
} = {}) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const yesterday = new Date(start.getTime() - 86400000);
  const completed = logs.filter((log) => {
    const created = new Date(log.created_at);
    return created >= yesterday && created < start && log.result === "succeeded";
  });
  const latestAssessment = new Map();
  assessments.forEach((assessment) => {
    if (!latestAssessment.has(assessment.article_id)) latestAssessment.set(assessment.article_id, assessment);
  });
  const priorities = opportunities
    .filter((item) => item.status === "draft" || item.status === "approved")
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, 8)
    .map((item) => ({
      opportunity_id: item.id,
      title: item.title,
      reason: item.reason,
      priority_score: item.priority_score,
      recommended_action: item.status === "draft" ? "review_opportunity" : "review_preparation",
    }));
  const readyJobs = jobs.filter((job) => job.status === "succeeded" && job.article_id);
  const reviewMinutes = priorities.length * 2 + readyJobs.reduce((total, job) => {
    const assessment = latestAssessment.get(job.article_id);
    return total + Number(assessment?.review_summary?.review_time_minutes || 3);
  }, 0);
  const count = (action) => completed.filter((log) => log.action === action).length;
  return {
    briefing_date: start.toISOString().slice(0, 10),
    completed_summary: {
      topics_discovered: count("topic_discovery"),
      drafts_generated: count("draft_factory"),
      articles_improved: count("improvement"),
      faqs_expanded: completed.filter((log) => log.details?.improvement_type === "missing_faq").length,
      content_gaps_identified: count("opportunity_scan"),
    },
    priorities,
    estimated_review_minutes: reviewMinutes,
    explanation:
      "Priorities favour business value, conversion potential, editorial readiness and freshness. Every item requires manual review.",
  };
}

export function nextRetry(job = {}, now = new Date()) {
  const attempts = Number(job.attempts) || 0;
  const maxAttempts = Number(job.max_attempts) || 3;
  if (attempts >= maxAttempts) return { retry: false, available_at: null };
  const delayMinutes = Math.min(60, 5 * 2 ** Math.max(0, attempts - 1));
  return {
    retry: true,
    available_at: new Date(now.getTime() + delayMinutes * 60000).toISOString(),
  };
}

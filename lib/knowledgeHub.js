export const KNOWLEDGE_CATEGORIES = [
  "Van Finance",
  "Rent2Buy",
  "Credit",
  "Self Employed",
  "Limited Company",
  "Vehicle Guides",
  "Comparisons",
  "Trades",
  "FAQs",
  "Business Advice",
];

export const KNOWLEDGE_TOPIC_STATUSES = ["idea", "ready", "generated", "archived"];
export const KNOWLEDGE_TOPIC_PRIORITIES = [1, 2, 3, 4, 5];
export const KNOWLEDGE_ARTICLE_STATUSES = ["draft", "approved", "exported", "archived"];
export const KNOWLEDGE_ARTICLE_TYPES = [
  "faq",
  "finance-guide",
  "rent2buy-guide",
  "buying-guide",
  "vehicle-guide",
  "vehicle-review",
  "comparison",
  "checklist",
];

export function normalizeKnowledgeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keywordSet(value) {
  return new Set(normalizeKnowledgeText(value).split(" ").filter((word) => word.length > 2));
}

export function slugifyKnowledgeArticle(value) {
  return normalizeKnowledgeText(value).replace(/\s+/g, "-");
}

function topicKeywordText(topic = {}) {
  const secondary = Array.isArray(topic.secondary_keywords) ? topic.secondary_keywords.join(" ") : "";
  return `${topic.title || ""} ${topic.primary_keyword || ""} ${secondary}`;
}

export function findKnowledgeTopicDuplicates(candidate, topics = []) {
  const title = normalizeKnowledgeText(candidate?.title);
  const candidateWords = keywordSet(topicKeywordText(candidate));

  return topics
    .filter((topic) => !candidate?.id || topic.id !== candidate.id)
    .map((topic) => {
      const topicWords = keywordSet(topicKeywordText(topic));
      const shared = [...candidateWords].filter((word) => topicWords.has(word)).length;
      const overlap = shared / Math.max(1, Math.min(candidateWords.size, topicWords.size));
      return {
        topic,
        exact: Boolean(title && title === normalizeKnowledgeText(topic.title)),
        overlap,
      };
    })
    .filter((match) => match.exact || match.overlap >= 0.6)
    .sort((first, second) => Number(second.exact) - Number(first.exact) || second.overlap - first.overlap);
}

export function findKnowledgeArticleDuplicates(articles = []) {
  const active = articles.filter((article) => article.status !== "archived");
  const matches = [];
  active.forEach((article, index) => {
    const candidateWords = keywordSet(
      `${article.title || ""} ${article.seo_title || ""} ${article.excerpt || ""}`
    );
    active.slice(index + 1).forEach((other) => {
      const otherWords = keywordSet(
        `${other.title || ""} ${other.seo_title || ""} ${other.excerpt || ""}`
      );
      const shared = [...candidateWords].filter((word) => otherWords.has(word)).length;
      const overlap = shared / Math.max(1, Math.min(candidateWords.size, otherWords.size));
      const exact =
        normalizeKnowledgeText(article.title) === normalizeKnowledgeText(other.title);
      if (exact || overlap >= 0.72) matches.push({ article, other, exact, overlap });
    });
  });
  return matches.sort(
    (first, second) =>
      Number(second.exact) - Number(first.exact) || second.overlap - first.overlap
  );
}

export function parseKnowledgeTopicIdeasResponse(value) {
  let parsed = value?.topics ?? value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    } catch {
      throw new Error("The AI returned invalid topic JSON. No suggestions were saved.");
    }
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.ideas)) {
    throw new Error("The AI response did not contain structured topic ideas.");
  }
  return parsed.ideas.map((idea) => {
    const category = KNOWLEDGE_CATEGORIES.includes(idea.category)
      ? idea.category
      : KNOWLEDGE_CATEGORIES[0];
    return {
      title: String(idea.title || "").trim(),
      category,
      primary_keyword: String(idea.primary_keyword || "").trim(),
      secondary_keywords: Array.isArray(idea.secondary_keywords)
        ? idea.secondary_keywords.map((item) => String(item || "").trim()).filter(Boolean)
        : [],
      intent: String(idea.intent || "").trim(),
      rationale: String(idea.rationale || "").trim(),
      priority: Math.min(5, Math.max(1, Number(idea.priority) || 3)),
      status: "idea",
      notes: String(idea.rationale || "").trim(),
      source: "ai_topic_finder",
    };
  }).filter((idea) => idea.title);
}

function countBy(items, field) {
  return items.reduce((counts, item) => {
    const key = item[field] || "Uncategorised";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

export function buildKnowledgeAnalytics({
  topics = [],
  articles = [],
  categories = KNOWLEDGE_CATEGORIES,
  freshnessDays = 180,
  now = new Date(),
} = {}) {
  const activeTopics = topics.filter((topic) => topic.status !== "archived");
  const activeArticles = articles.filter((article) => article.status !== "archived");
  const approvedArticles = activeArticles.filter((article) => article.status === "approved");
  const allChecks = activeArticles.flatMap((article) =>
    Array.isArray(article.quality_checks) && article.quality_checks.length
      ? article.quality_checks
      : calculateKnowledgeQualityChecks(
          article,
          article.generation_metadata?.approximate_length
        )
  );
  const passedChecks = allChecks.filter((check) => check.pass).length;
  const attentionArticles = activeArticles.filter((article) => {
    const checks =
      Array.isArray(article.quality_checks) && article.quality_checks.length
        ? article.quality_checks
        : calculateKnowledgeQualityChecks(
            article,
            article.generation_metadata?.approximate_length
          );
    return checks.some((check) => !check.pass);
  });
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - Math.max(1, Number(freshnessDays) || 180));
  const staleArticles = approvedArticles.filter(
    (article) => new Date(article.updated_at || article.created_at || 0) < cutoff
  );
  const topicDuplicatePairs = [];
  activeTopics.forEach((topic, index) => {
    findKnowledgeTopicDuplicates(topic, activeTopics.slice(index + 1)).forEach((match) => {
      topicDuplicatePairs.push({
        topic,
        other: match.topic,
        exact: match.exact,
        overlap: match.overlap,
      });
    });
  });
  const articleTopicIds = new Set(activeArticles.map((article) => article.topic_id).filter(Boolean));
  const highPriorityOpen = activeTopics.filter(
    (topic) => Number(topic.priority || 3) >= 4 && !articleTopicIds.has(topic.id)
  );
  const coverage = categories.map((category) => {
    const categoryTopics = activeTopics.filter((topic) => topic.category === category);
    const categoryApproved = approvedArticles.filter((article) => article.category === category);
    return {
      category,
      topics: categoryTopics.length,
      approved_articles: categoryApproved.length,
      missing: categoryTopics.length === 0 || categoryApproved.length === 0,
    };
  });

  return {
    totals: {
      topics: topics.length,
      articles: articles.length,
      active_articles: activeArticles.length,
      approved_articles: approvedArticles.length,
    },
    by_status: countBy(articles, "status"),
    by_category: countBy(activeArticles, "category"),
    by_template: countBy(activeArticles, "article_type"),
    quality: {
      pass_rate: allChecks.length ? Math.round((passedChecks / allChecks.length) * 100) : 0,
      needing_attention: attentionArticles,
    },
    freshness: {
      threshold_days: Math.max(1, Number(freshnessDays) || 180),
      stale_articles: staleArticles,
    },
    duplicates: {
      topics: topicDuplicatePairs,
      articles: findKnowledgeArticleDuplicates(activeArticles),
    },
    coverage,
    missing_coverage: coverage.filter((item) => item.missing),
    planner: {
      high_priority_open: highPriorityOpen,
      ready: activeTopics.filter((topic) => topic.status === "ready").length,
      generated: activeTopics.filter((topic) => topic.status === "generated").length,
    },
  };
}

export function markdownToKnowledgeHtml(markdown) {
  const safe = String(markdown || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return safe
    .split(/\n{2,}/)
    .map((block) => {
      if (/^### /.test(block)) return `<h3>${block.slice(4)}</h3>`;
      if (/^## /.test(block)) return `<h2>${block.slice(3)}</h2>`;
      if (/^# /.test(block)) return `<h1>${block.slice(2)}</h1>`;
      const lines = block.split("\n");
      if (lines.every((line) => /^[-*] /.test(line))) {
        return `<ul>${lines.map((line) => `<li>${line.slice(2)}</li>`).join("")}</ul>`;
      }
      return `<p>${block.replace(/\n/g, "<br />")}</p>`;
    })
    .join("\n");
}

export function parseKnowledgeArticleResponse(value) {
  let parsed = value?.article ?? value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    } catch {
      throw new Error("The AI returned invalid JSON. Your inputs have been kept.");
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The AI response was not a structured article.");
  }

  const required = ["title", "seo_title", "meta_description", "excerpt", "content_markdown", "cta"];
  const missing = required.filter((field) => !String(parsed[field] || "").trim());
  if (missing.length) throw new Error(`The AI response is missing: ${missing.join(", ")}.`);
  if (parsed.faq_json != null && !Array.isArray(parsed.faq_json)) {
    throw new Error("The AI response contains invalid FAQ data.");
  }

  return {
    title: String(parsed.title).trim(),
    slug: slugifyKnowledgeArticle(parsed.slug || parsed.title),
    seo_title: String(parsed.seo_title).trim(),
    meta_description: String(parsed.meta_description).trim(),
    excerpt: String(parsed.excerpt).trim(),
    content_markdown: String(parsed.content_markdown).trim(),
    content_html: String(parsed.content_html || markdownToKnowledgeHtml(parsed.content_markdown)),
    faq_json: parsed.faq_json || [],
    cta: String(parsed.cta).trim(),
    internal_link_suggestions: Array.isArray(parsed.internal_link_suggestions)
      ? parsed.internal_link_suggestions
      : [],
    generation_metadata:
      parsed.generation_metadata && typeof parsed.generation_metadata === "object"
        ? parsed.generation_metadata
        : {},
  };
}

export function calculateKnowledgeQualityChecks(article, targetLength = 1000) {
  const content = String(article?.content_markdown || "");
  const paragraphs = content
    .split(/\n{2,}/)
    .map(normalizeKnowledgeText)
    .filter((paragraph) => paragraph.length > 40);
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const unsupportedClaim =
    /\b(guaranteed|always approved|lowest rate|best rate|no rejection|currently in stock|£\d+|\d+(?:\.\d+)?%\s*(?:apr|interest)?)\b/i;

  return [
    ["clear_intent", "Answers a clear question or intent", Boolean(article?.title && article?.excerpt)],
    [
      "adequate_length",
      `Adequate length (${wordCount} words)`,
      wordCount >= Math.max(300, Number(targetLength || 1000) * 0.65),
    ],
    ["headings", "Sensible heading structure", /^## /m.test(content)],
    ["empty_sections", "No empty sections", !/^#{1,3} .+\n\s*(?=^#{1,3} |\s*$)/m.test(content)],
    ["repetition", "No repeated paragraphs", new Set(paragraphs).size === paragraphs.length],
    [
      "seo_title",
      "SEO title is 30–60 characters",
      String(article?.seo_title || "").length >= 30 && String(article?.seo_title || "").length <= 60,
    ],
    [
      "meta_description",
      "Meta description is 120–160 characters",
      String(article?.meta_description || "").length >= 120 &&
        String(article?.meta_description || "").length <= 160,
    ],
    [
      "faq",
      "FAQ structure is valid",
      (article?.faq_json || []).every((entry) => entry?.question && entry?.answer),
    ],
    ["cta", "CTA is present", Boolean(String(article?.cta || "").trim())],
    [
      "unsupported_claim",
      "No obvious unsupported claim",
      !unsupportedClaim.test(`${content} ${article?.cta || ""}`),
    ],
  ].map(([key, label, pass]) => ({ key, label, pass }));
}

export function validateKnowledgeArticle(article) {
  const errors = {};
  if (!String(article?.title || "").trim()) errors.title = "Title is required.";
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(article?.slug || ""))) {
    errors.slug = "Use lowercase words separated by hyphens.";
  }
  if (String(article?.content_markdown || "").trim().length < 200) {
    errors.content_markdown = "Content must be at least 200 characters.";
  }
  if (String(article?.seo_title || "").length < 20 || String(article?.seo_title || "").length > 70) {
    errors.seo_title = "SEO title should be 20–70 characters.";
  }
  if (
    String(article?.meta_description || "").length < 80 ||
    String(article?.meta_description || "").length > 180
  ) {
    errors.meta_description = "Meta description should be 80–180 characters.";
  }
  return errors;
}

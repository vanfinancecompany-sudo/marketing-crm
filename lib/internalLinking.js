export const WEBSITE_INDEX_CATEGORIES = Object.freeze([
  "Stock",
  "Applications",
  "Products",
  "Finance",
  "Support",
  "Knowledge Hub",
  "Guides",
]);

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "article", "because", "before", "being", "between",
  "could", "from", "have", "into", "more", "only", "other", "should", "their", "there",
  "these", "they", "this", "through", "using", "vehicle", "vehicles", "very", "what", "when",
  "where", "which", "while", "with", "would", "your",
]);

const INTENT_RULES = Object.freeze([
  {
    key: "medium_wheelbase_vans",
    label: "Medium Wheelbase Vans",
    signals: ["transit custom", "mwb", "medium wheelbase", "medium van"],
    destinations: ["medium wheelbase", "mwb", "medium van"],
  },
  {
    key: "long_wheelbase_vans",
    label: "Long Wheelbase Vans",
    signals: ["transit lwb", "lwb", "long wheelbase", "large van"],
    destinations: ["long wheelbase", "lwb", "large van"],
  },
  {
    key: "pickups",
    label: "Pickups",
    signals: ["ford ranger", "ranger", "pickup", "pick-up"],
    destinations: ["pickup", "pick-up"],
  },
  {
    key: "small_vans",
    label: "Small Vans",
    signals: ["citroen berlingo", "berlingo", "small van", "compact van"],
    destinations: ["small van", "compact van"],
  },
  {
    key: "van_finance",
    label: "Van Finance",
    signals: ["vehicle finance", "van finance", "hire purchase", "lease purchase", "monthly payment"],
    destinations: ["van finance", "vehicle finance", "finance"],
  },
  {
    key: "rent2buy",
    label: "Rent2Buy",
    signals: ["no credit check", "rent2buy", "rent 2 buy", "rent-to-buy", "affordability"],
    destinations: ["rent2buy", "rent 2 buy", "rent-to-buy", "no credit check"],
  },
  {
    key: "application",
    label: "Apply Now",
    signals: ["apply now", "applying", "application", "ready to apply", "submit an application"],
    destinations: ["apply now", "application", "apply"],
  },
  {
    key: "documents",
    label: "Upload Documents",
    signals: ["upload documents", "proof of income", "documentation", "documents", "paperwork"],
    destinations: ["upload documents", "documents", "documentation"],
  },
]);

const clean = (value) => String(value || "").trim();
const clamp = (value, minimum = 0, maximum = 100) =>
  Math.max(minimum, Math.min(maximum, Math.round(Number(value) || 0)));
const list = (value) => (Array.isArray(value) ? value : []).map(clean).filter(Boolean);

function normalizedText(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value) {
  return new Set(
    normalizedText(value)
      .split(" ")
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
  );
}

function includesPhrase(text, phrase) {
  return normalizedText(text).includes(normalizedText(phrase));
}

function headings(markdown) {
  return clean(markdown)
    .split("\n")
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/, "").trim())
    .filter(Boolean);
}

function inferredIntents(text, destination = false) {
  return INTENT_RULES.filter((rule) =>
    (destination ? rule.destinations : rule.signals).some((signal) => includesPhrase(text, signal))
  ).map((rule) => rule.key);
}

export function isApprovedInternalUrl(value, websiteUrl = "") {
  const url = clean(value);
  if (/^\/(?!\/)/.test(url)) return true;
  if (!/^https?:\/\//i.test(url)) return false;
  if (!clean(websiteUrl)) return false;
  try {
    return new URL(url).origin === new URL(websiteUrl).origin;
  } catch {
    return false;
  }
}

export function buildInternalLinkArticleProfile({ article = {}, topic = {}, intent = {} } = {}) {
  const articleHeadings = headings(article.content_markdown);
  const text = [
    article.title,
    article.seo_title,
    article.meta_description,
    article.excerpt,
    article.content_markdown,
    article.cta,
    article.category,
    article.article_type,
    topic.title,
    topic.primary_keyword,
    ...list(topic.secondary_keywords),
    topic.intent,
    intent.primary_product,
    intent.secondary_product,
    intent.customer_journey,
    intent.search_intent,
    intent.conversion_goal,
  ].join(" ");
  const signalMatches = Object.fromEntries(
    INTENT_RULES.map((rule) => [
      rule.key,
      rule.signals.filter((signal) => includesPhrase(text, signal)),
    ])
  );
  return {
    text,
    headings: articleHeadings,
    tokens: tokens(text),
    intents: new Set(inferredIntents(text)),
    signal_matches: signalMatches,
  };
}

function candidateText(page, linkedArticle) {
  return [
    page.title,
    page.category,
    page.description,
    page.product,
    ...list(page.keywords),
    ...list(page.vehicle_types),
    ...list(page.customer_intent),
    linkedArticle?.title,
    linkedArticle?.category,
    linkedArticle?.excerpt,
    linkedArticle?.seo_title,
    linkedArticle?.meta_description,
  ].join(" ");
}

function chooseReason(profile, page, candidateIntents, directPhrases) {
  const intentKey = [...profile.intents].find((key) => candidateIntents.has(key));
  if (intentKey) {
    const rule = INTENT_RULES.find((item) => item.key === intentKey);
    const source = profile.signal_matches[intentKey]?.[0] || rule.label;
    return `The article references ${source}, which maps to the ${rule.label} buying intent.`;
  }
  if (directPhrases.length) {
    return `The article and approved destination both cover ${directPhrases.slice(0, 3).join(", ")}.`;
  }
  return `The approved ${page.category} destination supports the article's customer journey.`;
}

function chooseContext(profile, candidateTokens, fallback) {
  const matchingHeading = profile.headings.find((heading) =>
    [...tokens(heading)].some((word) => candidateTokens.has(word))
  );
  return matchingHeading
    ? `Review placement in or near the “${matchingHeading}” section.`
    : `Review placement near the article discussion of ${fallback}.`;
}

function naturalAnchor(page, linkedArticle, intentKey) {
  const title = clean(linkedArticle?.title || page.title);
  if (title) return title.slice(0, 100);
  const rule = INTENT_RULES.find((item) => item.key === intentKey);
  return clean(rule?.label || page.category).slice(0, 100);
}

export function suggestInternalLinks({
  article = {},
  topic = {},
  intent = {},
  websitePages = [],
  knowledgeArticles = [],
  websiteUrl = "",
  minimumConfidence = 40,
  maximumSuggestions = 8,
} = {}) {
  const profile = buildInternalLinkArticleProfile({ article, topic, intent });
  const articleById = new Map(knowledgeArticles.map((item) => [item.id, item]));
  const seenUrls = new Set();
  return websitePages
    .filter(
      (page) =>
        page.active !== false &&
        page.status !== "Hidden" &&
        page.approval_status === "approved" &&
        page.verified === true
    )
    .filter((page) => isApprovedInternalUrl(page.url, websiteUrl))
    .map((page) => {
      const linkedArticle = page.knowledge_article_id
        ? articleById.get(page.knowledge_article_id)
        : null;
      if (
        page.knowledge_article_id &&
        (!linkedArticle || linkedArticle.status !== "approved" || linkedArticle.id === article.id)
      ) return null;
      const text = candidateText(page, linkedArticle);
      const candidateTokens = tokens(text);
      const candidateIntents = new Set(inferredIntents(text, true));
      const sharedIntents = [...profile.intents].filter((key) => candidateIntents.has(key));
      const pagePhrases = [...list(page.keywords), ...list(page.vehicle_types), ...list(page.customer_intent)]
        .filter((phrase) => includesPhrase(profile.text, phrase));
      const sharedTokens = [...candidateTokens].filter((word) => profile.tokens.has(word));
      let score =
        Math.min(68, sharedIntents.length * 58) +
        Math.min(24, pagePhrases.length * 8) +
        Math.min(18, sharedTokens.length * 3) +
        Math.max(0, Math.min(8, (Number(page.priority) || 3) * 2 - 2));
      const intentValues = list(page.customer_intent).map(normalizedText);
      if (
        intentValues.some((value) =>
          [intent.customer_journey, intent.search_intent, intent.conversion_goal]
            .map(normalizedText)
            .some((articleIntent) => articleIntent && value.includes(articleIntent))
        )
      ) score += 12;
      score = clamp(score, 0, 99);
      if (score < minimumConfidence) return null;
      const strongestIntent = sharedIntents[0];
      return {
        website_page_id: page.id,
        target_type: linkedArticle ? "knowledge_article" : "website_page",
        target_article_id: linkedArticle?.id || null,
        destination_title: clean(linkedArticle?.title || page.title),
        destination_url: clean(page.url),
        anchor_text: naturalAnchor(page, linkedArticle, strongestIntent),
        confidence_score: score,
        reason: chooseReason(profile, page, candidateIntents, pagePhrases.length ? pagePhrases : sharedTokens),
        context: chooseContext(
          profile,
          candidateTokens,
          clean(INTENT_RULES.find((item) => item.key === strongestIntent)?.label || page.title)
        ),
      };
    })
    .filter(Boolean)
    .sort(
      (first, second) =>
        second.confidence_score - first.confidence_score ||
        first.destination_title.localeCompare(second.destination_title)
    )
    .filter((item) => {
      const key = normalizedText(item.destination_url);
      if (seenUrls.has(key)) return false;
      seenUrls.add(key);
      return true;
    })
    .slice(0, Math.max(3, Math.min(8, Number(maximumSuggestions) || 8)));
}

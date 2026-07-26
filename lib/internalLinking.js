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
const GENERIC_MATCH_WORDS = new Set([
  "business", "businesses", "company", "finance", "guide", "help", "information",
  "uk", "van", "vans", "vehicle", "vehicles",
]);
const LEGAL_DESTINATIONS = Object.freeze([
  ["privacy", ["privacy policy", "privacy"]],
  ["cookies", ["cookie policy", "cookies", "cookie"]],
  ["data protection", ["data protection policy", "data protection"]],
  ["complaints", ["customer complaints policy", "complaints policy", "complaints"]],
  ["terms", ["terms and conditions", "terms conditions"]],
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
  const source = normalizedText(text);
  const target = normalizedText(phrase);
  return Boolean(target && ` ${source} `.includes(` ${target} `));
}

function headings(markdown, maximumLevel = 3) {
  return clean(markdown)
    .split("\n")
    .filter((line) => new RegExp(`^#{1,${maximumLevel}}\\s+`).test(line))
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
  const title = clean(article.title);
  const seoTitle = clean(article.seo_title);
  const slug = clean(article.slug).replaceAll("-", " ");
  const primaryKeyword = clean(topic.primary_keyword || article.primary_keyword);
  const body = clean(article.content_markdown);
  const cta = clean(article.cta);
  const text = [
    title,
    seoTitle,
    slug,
    article.meta_description,
    article.excerpt,
    body,
    cta,
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
    title,
    seo_title: seoTitle,
    slug,
    primary_keyword: primaryKeyword,
    body,
    cta,
    headings: articleHeadings,
    tokens: tokens(text),
    intents: new Set(inferredIntents(text)),
    signal_matches: signalMatches,
    high_signal_text: [
      title,
      seoTitle,
      slug,
      primaryKeyword,
      ...articleHeadings,
    ].join(" "),
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

function isSpecificPhrase(value) {
  const phraseTokens = normalizedText(value).split(" ").filter(Boolean);
  return Boolean(
    phraseTokens.length &&
    (phraseTokens.length > 1
      ? phraseTokens.some((word) => !GENERIC_MATCH_WORDS.has(word))
      : !GENERIC_MATCH_WORDS.has(phraseTokens[0]))
  );
}

function isAcronym(value) {
  const phrase = normalizedText(value);
  return /^[a-z0-9]{2,5}$/.test(phrase) && isSpecificPhrase(phrase);
}

function legalTopic(value) {
  const text = normalizedText(value);
  return LEGAL_DESTINATIONS.find(([, phrases]) =>
    phrases.some((phrase) => includesPhrase(text, phrase))
  )?.[0] || "";
}

function articleMode(profile, article, topic) {
  const high = normalizedText([
    profile.high_signal_text,
    article.category,
    article.article_type,
    topic.category,
    topic.intent,
  ].join(" "));
  if (legalTopic(high)) return "legal";
  if (
    profile.intents.has("medium_wheelbase_vans") ||
    profile.intents.has("long_wheelbase_vans") ||
    profile.intents.has("small_vans") ||
    profile.intents.has("pickups") ||
    /\b(vehicle review|buying guide|van guide|wheelbase|pickup|stock)\b/.test(high)
  ) return "vehicle";
  if (
    profile.intents.has("application") ||
    profile.intents.has("documents") ||
    /\b(application|applying|eligibility|documentation|documents)\b/.test(high)
  ) return "application";
  if (
    profile.intents.has("van_finance") ||
    /\b(finance|hire purchase|lease purchase)\b/.test(high)
  ) return "finance";
  return "general";
}

function categoryScore(mode, category) {
  const scores = {
    vehicle: { Stock: 16, Products: 12, Finance: 9, Guides: 7, "Knowledge Hub": 6, Applications: 4, Support: 1 },
    finance: { Finance: 16, Products: 12, Applications: 9, Stock: 7, Guides: 5, "Knowledge Hub": 5, Support: 3 },
    application: { Applications: 16, Support: 11, Finance: 8, Products: 6, Guides: 4, "Knowledge Hub": 4, Stock: 2 },
    legal: { Support: 12, Guides: 3, "Knowledge Hub": 3 },
    general: { Products: 7, Guides: 6, "Knowledge Hub": 6, Stock: 5, Finance: 5, Applications: 4, Support: 3 },
  };
  return scores[mode]?.[category] || 0;
}

function phraseEvidence(profile, phrase, source, weights) {
  const fields = [
    ["article title", profile.title, weights.title],
    ["H1–H3 heading", profile.headings.join(" "), weights.heading],
    ["article slug", profile.slug, weights.slug],
    ["primary keyword", profile.primary_keyword, weights.primaryKeyword],
    ["SEO title", profile.seo_title, weights.seoTitle],
    ["article body", profile.body, weights.body],
  ];
  const matched = fields.find(([, text]) => includesPhrase(text, phrase));
  if (!matched) return null;
  const [field, , baseWeight] = matched;
  const specific = isSpecificPhrase(phrase);
  const score = specific ? baseWeight : Math.max(2, Math.round(baseWeight * 0.3));
  const kind =
    field === "article title"
      ? isAcronym(phrase) ? "Exact acronym" : "Exact match"
      : source === "matching_term" ? "Matching term" : "Keyword match";
  return {
    phrase: clean(phrase),
    field,
    score,
    reason: `${kind}: “${clean(phrase)}” in ${field}`,
    specific,
  };
}

function rankingReason(evidence, category, categoryPoints, sharedIntent) {
  const reasons = evidence
    .sort((first, second) => second.score - first.score)
    .slice(0, 2)
    .map((item) => item.reason);
  if (categoryPoints >= 7) reasons.push(`Category match: ${category}`);
  if (sharedIntent && reasons.length < 3) reasons.push(`Intent match: ${sharedIntent}`);
  return reasons.slice(0, 3).join(" · ");
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
  minimumConfidence = 35,
  maximumSuggestions = 8,
} = {}) {
  const profile = buildInternalLinkArticleProfile({ article, topic, intent });
  const mode = articleMode(profile, article, topic);
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
      if (/\/manufacturers?(?:\/|$)/i.test(clean(page.url))) return null;
      const linkedArticle = page.knowledge_article_id
        ? articleById.get(page.knowledge_article_id)
        : null;
      if (
        page.knowledge_article_id &&
        (!linkedArticle || linkedArticle.status !== "approved" || linkedArticle.id === article.id)
      ) return null;
      const text = candidateText(page, linkedArticle);
      const destinationLegalTopic = legalTopic(`${page.title} ${page.url} ${page.description}`);
      if (
        destinationLegalTopic &&
        !includesPhrase(profile.high_signal_text, destinationLegalTopic)
      ) return null;
      const candidateTokens = tokens(text);
      const candidateIntents = new Set(inferredIntents(text, true));
      const sharedIntents = [...profile.intents].filter((key) => candidateIntents.has(key));
      const matchingTerms = list(page.vehicle_types);
      const keywordTerms = list(page.keywords).filter(
        (keyword) =>
          !matchingTerms.some(
            (term) => normalizedText(term) === normalizedText(keyword)
          )
      );
      const termEvidence = matchingTerms
        .map((phrase) =>
          phraseEvidence(profile, phrase, "matching_term", {
            title: 40,
            heading: 28,
            slug: 25,
            primaryKeyword: 25,
            seoTitle: 23,
            body: 10,
          })
        )
        .filter(Boolean);
      const keywordEvidence = keywordTerms
        .map((phrase) =>
          phraseEvidence(profile, phrase, "keyword", {
            title: 30,
            heading: 22,
            slug: 20,
            primaryKeyword: 20,
            seoTitle: 18,
            body: 7,
          })
        )
        .filter(Boolean);
      const evidence = [...termEvidence, ...keywordEvidence];
      const specificPhraseScore = Math.min(
        72,
        evidence.filter((item) => item.specific).reduce((total, item) => total + item.score, 0)
      );
      const broadPhraseScore = Math.min(
        18,
        evidence.filter((item) => !item.specific).reduce((total, item) => total + item.score, 0)
      );
      const titleTokens = tokens(
        `${profile.title} ${profile.primary_keyword} ${profile.seo_title}`
      );
      const specificTitleOverlap = [...tokens(page.title)].filter(
        (word) =>
          titleTokens.has(word) &&
          !GENERIC_MATCH_WORDS.has(word) &&
          !STOP_WORDS.has(word)
      );
      const semanticTitleScore = Math.min(24, specificTitleOverlap.length * 8);
      const sharedIntentScore = Math.min(24, sharedIntents.length * 18);
      const categoryPoints = categoryScore(mode, page.category);
      const sharedTokens = [...candidateTokens].filter(
        (word) =>
          profile.tokens.has(word) &&
          !GENERIC_MATCH_WORDS.has(word)
      );
      const genericSimilarity = Math.min(6, sharedTokens.length);
      const priorityScore = Math.max(
        0,
        Math.min(4, (Number(page.priority) || 3) - 1)
      );
      let score =
        specificPhraseScore +
        broadPhraseScore +
        semanticTitleScore +
        sharedIntentScore +
        categoryPoints +
        genericSimilarity +
        priorityScore +
        (categoryPoints ? 2 : 0);
      const directCustomerIntentMatch = list(page.customer_intent).some(
        (value) => includesPhrase(profile.text, value)
      );
      if (directCustomerIntentMatch) score += 10;
      const intentValues = list(page.customer_intent).map(normalizedText);
      if (
        intentValues.some((value) =>
          [intent.customer_journey, intent.search_intent, intent.conversion_goal]
            .map(normalizedText)
            .some((articleIntent) => articleIntent && value.includes(articleIntent))
        )
      ) score += 8;
      if (
        list(page.customer_intent).some(
          (value) => includesPhrase(profile.cta, value)
        )
      ) score += 6;
      if (destinationLegalTopic && mode === "legal") score += 10;
      score = clamp(score, 0, 98);
      if (score < minimumConfidence) return null;
      const strongestIntent = sharedIntents[0];
      const strongestIntentLabel = clean(
        INTENT_RULES.find((item) => item.key === strongestIntent)?.label
      );
      return {
        website_page_id: page.id,
        target_type: linkedArticle ? "knowledge_article" : "website_page",
        target_article_id: linkedArticle?.id || null,
        destination_title: clean(linkedArticle?.title || page.title),
        destination_url: clean(page.url),
        anchor_text: naturalAnchor(page, linkedArticle, strongestIntent),
        confidence_score: score,
        reason: rankingReason(
          evidence,
          page.category,
          categoryPoints,
          strongestIntentLabel
        ) || `Relevant approved ${page.category} destination.`,
        context: chooseContext(
          profile,
          candidateTokens,
          clean(strongestIntentLabel || page.title)
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

export function mergeInternalLinkReviewState({
  created = [],
  existing = [],
  proposedPageIds = new Set(),
  sourceHash = "",
} = {}) {
  const retained = existing.filter(
    (item) =>
      ["accepted", "rejected"].includes(item.status) ||
      (
        item.status === "pending" &&
        item.source_content_hash === sourceHash &&
        proposedPageIds.has(item.website_page_id)
      )
  );
  const byId = new Map(
    [...created, ...retained].map((item) => [item.id, item])
  );
  return [...byId.values()].sort(
    (first, second) =>
      second.confidence_score - first.confidence_score ||
      first.destination_title.localeCompare(second.destination_title)
  );
}

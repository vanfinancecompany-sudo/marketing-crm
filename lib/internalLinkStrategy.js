const clean = (value) => String(value || "").trim();

const TOPIC_GENERIC_WORDS = new Set([
  "about", "article", "business", "businesses", "buy", "buyer", "buyers", "buying",
  "can", "company", "complete", "consider", "considering", "finance", "financial", "for",
  "from", "guide", "guides", "how", "information", "into", "more", "most", "should",
  "the", "their", "this", "used", "uk", "van", "vans", "vehicle", "vehicles", "what",
  "when", "which", "with", "work", "your",
]);

function normalized(value) {
  return clean(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stemTopicWord(word) {
  const value = normalized(word);
  if (value.length > 5 && value.endsWith("ies")) return `${value.slice(0, -3)}y`;
  if (value.length > 5 && value.endsWith("ing")) return value.slice(0, -3);
  if (value.length > 4 && value.endsWith("ed")) return value.slice(0, -2);
  if (value.length > 4 && value.endsWith("s") && !value.endsWith("ss")) return value.slice(0, -1);
  return value;
}

function topicTokens(value) {
  return new Set(
    normalized(value)
      .split(" ")
      .map(stemTopicWord)
      .filter((word) => word.length > 2 && !TOPIC_GENERIC_WORDS.has(word))
  );
}

function markdownHeadings(value) {
  return clean(value)
    .split("\n")
    .filter((line) => /^#{1,3}\s+/.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/, "").trim())
    .join(" ");
}

function articleHighSignalText(article = {}, topic = {}) {
  return [
    article.title,
    article.seo_title,
    clean(article.slug).replaceAll("-", " "),
    article.category,
    article.article_type,
    topic.title,
    topic.primary_keyword,
    ...(Array.isArray(topic.secondary_keywords) ? topic.secondary_keywords : []),
    topic.intent,
    markdownHeadings(article.content_markdown),
  ].join(" ");
}

function linkedArticleTopicText(article = {}) {
  return [
    article.title,
    article.seo_title,
    clean(article.slug).replaceAll("-", " "),
    article.category,
    article.article_type,
    article.meta_description,
    article.excerpt,
  ].join(" ");
}

export function hasStrongKnowledgeTopicOverlap({ sourceArticle = {}, sourceTopic = {}, linkedArticle = {} } = {}) {
  const sourceTitle = topicTokens([
    sourceArticle.title,
    sourceArticle.seo_title,
    clean(sourceArticle.slug).replaceAll("-", " "),
    sourceTopic.title,
    sourceTopic.primary_keyword,
  ].join(" "));
  const destinationTitle = topicTokens([
    linkedArticle.title,
    linkedArticle.seo_title,
    clean(linkedArticle.slug).replaceAll("-", " "),
  ].join(" "));
  if ([...destinationTitle].some((word) => sourceTitle.has(word))) return true;

  const sourceHigh = topicTokens(articleHighSignalText(sourceArticle, sourceTopic));
  const destination = topicTokens(linkedArticleTopicText(linkedArticle));
  return [...destination].filter((word) => sourceHigh.has(word)).length >= 2;
}

function pathFor(value) {
  const raw = clean(value);
  if (!raw) return "";
  try {
    if (/^https?:\/\//i.test(raw)) return new URL(raw).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return "";
  }
  const path = raw.split(/[?#]/)[0].replace(/\/+$/, "");
  return path || "/";
}

export function classifyKnowledgeLinkProduct({ article = {}, topic = {}, intent = {} } = {}) {
  const highSignal = normalized([
    article.title,
    article.seo_title,
    article.slug,
    article.category,
    article.article_type,
    topic.title,
    topic.category,
    topic.intent,
    intent.primary_product,
  ].join(" "));

  if (/\b(?:rent2buy|rent 2 buy|rent to buy)\b/.test(highSignal)) return "rent2buy";
  return "finance";
}

export function commercialDestinationRole(page = {}, product = "finance") {
  const path = pathFor(page.url).toLowerCase();
  const title = normalized(page.title);

  if (product === "rent2buy") {
    if (path === "/guaranteed-van-lease" || /^what is rent2buy(?: van finance)?$/.test(title)) return "home";
    if (path === "/rent2buy-application" || /\brent2buy application\b/.test(title)) return "application";
    if (path === "/rent2buy-all-vans" || path === "/rent2buyvans" || /\brent2buy vans no credit check\b/.test(title)) return "stock";
    return "";
  }

  if (path === "/") return "home";
  if (path === "/apply-by-reg-finance/application-form" || /\bvan finance application form\b/.test(title)) return "application";
  if (path === "/vans-on-finance" || /\bview vans van finance\b/.test(title)) return "stock";
  return "";
}

export function isApplicationDestinationRelevant({ article = {}, topic = {}, intent = {}, product = "finance" } = {}) {
  const highSignal = normalized([
    article.title,
    article.seo_title,
    article.slug,
    article.category,
    article.article_type,
    topic.title,
    topic.primary_keyword,
    topic.intent,
    intent.customer_journey,
    intent.search_intent,
    intent.conversion_goal,
  ].join(" "));

  if (product === "rent2buy") {
    return /\b(?:apply|application|eligib|proof|afford|rent2buy|rent 2 buy|rent to buy)\w*\b/.test(highSignal);
  }
  return /\b(?:apply|application|approval|eligib|finance|apr|interest|lender)\w*\b/.test(highSignal);
}

export function filterInternalLinkCandidates({
  article = {},
  topic = {},
  intent = {},
  websitePages = [],
  knowledgeArticles = [],
} = {}) {
  const sourceProduct = classifyKnowledgeLinkProduct({ article, topic, intent });
  const articleById = new Map(
    (Array.isArray(knowledgeArticles) ? knowledgeArticles : []).map((item) => [item.id, item])
  );

  return (Array.isArray(websitePages) ? websitePages : []).filter((page) => {
    if (page.knowledge_article_id) {
      const linkedArticle = articleById.get(page.knowledge_article_id);
      if (!linkedArticle || linkedArticle.id === article.id || linkedArticle.status !== "approved") return false;
      if (classifyKnowledgeLinkProduct({ article: linkedArticle }) !== sourceProduct) return false;
      return hasStrongKnowledgeTopicOverlap({ sourceArticle: article, sourceTopic: topic, linkedArticle });
    }

    const role = commercialDestinationRole(page, sourceProduct);
    if (!role) return false;
    if (role === "application") {
      return isApplicationDestinationRelevant({ article, topic, intent, product: sourceProduct });
    }
    return true;
  });
}

export function selectFocusedInternalLinkSuggestions(
  suggestions = [],
  { maximumKnowledgeLinks = 2, maximumCommercialLinks = 2, minimumKnowledgeConfidence = 45 } = {}
) {
  const ordered = Array.isArray(suggestions) ? suggestions : [];
  const knowledge = ordered
    .filter((item) => item.target_type === "knowledge_article")
    .filter((item) => Number(item.confidence_score || 0) >= minimumKnowledgeConfidence)
    .slice(0, Math.max(0, Number(maximumKnowledgeLinks) || 0));

  const commercial = [];
  const seenRoles = new Set();
  for (const item of ordered) {
    if (item.target_type === "knowledge_article") continue;
    const product = /rent2buy|rent 2 buy|rent-to-buy/i.test(`${item.destination_title || ""} ${item.destination_url || ""}`) ? "rent2buy" : "finance";
    const role = commercialDestinationRole({ title: item.destination_title, url: item.destination_url }, product);
    if (!role || seenRoles.has(role)) continue;
    seenRoles.add(role);
    commercial.push(item);
    if (commercial.length >= Math.max(0, Number(maximumCommercialLinks) || 0)) break;
  }

  return [...knowledge, ...commercial].sort(
    (first, second) =>
      Number(second.confidence_score || 0) - Number(first.confidence_score || 0) ||
      clean(first.destination_title).localeCompare(clean(second.destination_title))
  );
}

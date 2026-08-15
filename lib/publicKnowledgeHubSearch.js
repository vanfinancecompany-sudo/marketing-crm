import { isConfirmedPublishedArticle } from "./aiVisibility.js";
import { redactSensitiveCustomerData } from "./publicAssistantFoundation.js";

const MAX_QUERY_LENGTH = 200;
const MAX_RESULTS = 12;
export const PUBLIC_KNOWLEDGE_HUB_SCOPES = Object.freeze(["vfc", "rent2buy"]);
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "can", "do", "for", "from", "how", "i",
  "in", "is", "it", "my", "of", "on", "or", "the", "to", "van", "vans", "what", "when",
  "where", "which", "with", "you", "your",
]);
const SCOPE_HOSTS = Object.freeze({
  vfc: new Set(["vanfinancecompany.co.uk", "www.vanfinancecompany.co.uk"]),
  rent2buy: new Set(["rent2buyvans.co.uk", "www.rent2buyvans.co.uk"]),
});

function clean(value, limit = 5000) {
  return String(value || "").trim().slice(0, limit);
}

function normaliseScope(value) {
  const scope = clean(value, 40).toLowerCase();
  return PUBLIC_KNOWLEDGE_HUB_SCOPES.includes(scope) ? scope : "vfc";
}

export function normaliseKnowledgeHubSearchText(value) {
  return clean(value, MAX_QUERY_LENGTH)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitiseKnowledgeHubSearchQuery(value) {
  const redacted = redactSensitiveCustomerData(clean(value, MAX_QUERY_LENGTH));
  return clean(redacted, MAX_QUERY_LENGTH);
}

function meaningfulTerms(normalisedQuery) {
  const all = normalisedQuery.split(" ").filter(Boolean);
  const specific = [...new Set(all.filter((term) => term.length > 1 && !STOP_WORDS.has(term)))];
  return specific.length ? specific : [...new Set(all.filter((term) => term.length > 1))];
}

function text(value) {
  return normaliseKnowledgeHubSearchText(value);
}

function faqText(value) {
  if (!value) return "";
  try {
    return text(typeof value === "string" ? value : JSON.stringify(value));
  } catch {
    return "";
  }
}

export function isKnowledgeHubArticleUrl(value, scope = "vfc") {
  try {
    const url = new URL(clean(value, 1000));
    return SCOPE_HOSTS[normaliseScope(scope)].has(url.hostname.toLowerCase())
      && url.pathname.toLowerCase().startsWith("/knowledge-hub-articles/");
  } catch {
    return false;
  }
}

export function isPublicKnowledgeHubArticle(article = {}, scope = "vfc") {
  const knowledgeScope = normaliseScope(scope);
  if (!isKnowledgeHubArticleUrl(article.live_wix_url, knowledgeScope)) return false;
  if (knowledgeScope === "rent2buy") {
    return article?.source_verified === true
      && article?.is_active === true
      && clean(article?.category, 100).toLowerCase() === "rent2buy";
  }
  return isConfirmedPublishedArticle(article);
}

function articleSearchFields(article = {}) {
  return {
    title: text(article.title),
    seo: text(article.seo_title),
    excerpt: text(article.excerpt || article.meta_description),
    category: text(article.category),
    slug: text(article.slug),
    faq: faqText(article.faq_json),
    body: text(article.content_markdown),
  };
}

function phraseScore(fields, phrase) {
  if (!phrase) return 0;
  let score = 0;
  if (fields.title === phrase) score += 120;
  else if (fields.title.includes(phrase)) score += 52;
  if (fields.seo.includes(phrase)) score += 38;
  if (fields.excerpt.includes(phrase)) score += 24;
  if (fields.faq.includes(phrase)) score += 18;
  if (fields.slug.includes(phrase)) score += 14;
  if (fields.body.includes(phrase)) score += 10;
  return score;
}

export function scorePublicKnowledgeHubArticle(article = {}, query = "") {
  const phrase = normaliseKnowledgeHubSearchText(query);
  if (phrase.length < 2) return 0;
  const terms = meaningfulTerms(phrase);
  if (!terms.length) return 0;
  const fields = articleSearchFields(article);
  let score = phraseScore(fields, phrase);
  let matchedTerms = 0;

  terms.forEach((term) => {
    let matched = false;
    if (fields.title.includes(term)) { score += 14; matched = true; }
    if (fields.seo.includes(term)) { score += 10; matched = true; }
    if (fields.excerpt.includes(term)) { score += 7; matched = true; }
    if (fields.faq.includes(term)) { score += 6; matched = true; }
    if (fields.category.includes(term)) { score += 4; matched = true; }
    if (fields.slug.includes(term)) { score += 3; matched = true; }
    if (fields.body.includes(term)) { score += 2; matched = true; }
    if (matched) matchedTerms += 1;
  });

  if (matchedTerms === terms.length) score += 24;
  else score -= (terms.length - matchedTerms) * 5;
  return Math.max(0, score);
}

export function publicKnowledgeHubResult(article = {}, score = 0) {
  return {
    id: clean(article.id, 100),
    title: clean(article.title, 240),
    category: clean(article.category, 100) || "Knowledge Hub",
    excerpt: clean(article.excerpt || article.meta_description, 360),
    url: clean(article.live_wix_url, 1000),
    score,
  };
}

export function searchPublicKnowledgeHubArticles(articles = [], { query = "", category = "all", limit = 8, scope = "vfc" } = {}) {
  const normalisedQuery = normaliseKnowledgeHubSearchText(query);
  const categoryFilter = text(category);
  const requestedLimit = Math.min(MAX_RESULTS, Math.max(1, Number.parseInt(limit, 10) || 8));
  const knowledgeScope = normaliseScope(scope);
  if (normalisedQuery.length < 2) return [];

  return (Array.isArray(articles) ? articles : [])
    .filter((article) => isPublicKnowledgeHubArticle(article, knowledgeScope))
    .filter((article) => categoryFilter === "" || categoryFilter === "all" || text(article.category) === categoryFilter)
    .map((article) => ({ article, score: scorePublicKnowledgeHubArticle(article, normalisedQuery) }))
    .filter((item) => item.score > 0)
    .sort((first, second) => {
      if (second.score !== first.score) return second.score - first.score;
      const published = new Date(second.article.published_at || 0).getTime() - new Date(first.article.published_at || 0).getTime();
      if (published) return published;
      return String(first.article.title || "").localeCompare(String(second.article.title || ""));
    })
    .slice(0, requestedLimit)
    .map(({ article, score }) => publicKnowledgeHubResult(article, score));
}

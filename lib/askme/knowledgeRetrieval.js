// On-demand knowledge retrieval for the Ask Me lean engine.
//
// Reuses the CRM's existing approved knowledge: Business Brain sections, approved
// Knowledge Hub articles (via the cached, product-filtered corpus in
// assistantKnowledgeRuntime) and active business pages. Ranking is the existing
// lexical ranker (rankKnowledge: synonyms, coverage, authority bonus) plus a
// relevance floor and diversity limits, so only a few genuinely relevant passages
// reach the prompt. Everything is in memory after the first load (5-minute cache);
// there is no extra model call and no per-question database round trip.

import { getCachedAssistantKnowledge, preparedKnowledgeFor } from "../assistantKnowledgeRuntime.js";

const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);
const now = () => performance.now();
const ms = (start) => Math.round(now() - start);

export const RETRIEVAL_LIMITS = Object.freeze({
  maxPassages: 4,        // keeps the prompt compact (~600-900 extra input tokens at most)
  maxPerSource: 2,       // diversity: at most two passages from one article/section
  passageChars: 650,
  minCoverage: 0.3,      // matched words must carry at least 30% of the question's specificity (IDF mass)
  minRelative: 0.35,     // and score at least 35% of the best passage for that part
  maxPages: 2,
});

// Follow-ups ("what about the warranty on it?") need the previous customer turn.
// Everyday phrasings for "documents" ("what do I need to bring to apply?").
export function expandQuery(text) {
  return /\b(?:bring|provide|show|send|upload|need)\b[^?.]*\b(?:apply|application|applying|collect\w*|sign\w*)\b/i.test(text) && !/\bdocuments?\b/i.test(text)
    ? `${text} documents`
    : text;
}

function previousCustomerQuestion(history) {
  return history.findLast((item) => item.role === "user")?.content || "";
}

export function referencedKnowledgeQuestion(message, history = []) {
  const reference = /^(?:(?:and|but|so)\s+)?(?:does|do|did|is|are|will|would|can|could)\s+(?:that|it|this|they|those|these)\s+(?:(?:also|still)\s+)?(?:include|cover|apply|extend|mean|count|protect|have to cover)\b/i;
  return reference.test(message.trim()) ? previousCustomerQuestion(history) : "";
}

export function retrievalQuery(message, history = []) {
  return clean(`${message} ${previousCustomerQuestion(history)}`, 1200);
}

// ---- BM25 index over the approved corpus ---------------------------------------------
// The legacy ranker keeps only whitelisted "focus terms" when any are present, so a
// question like "do I need insurance before delivery" was searched as just "delivery".
// This index weighs every meaningful word by how rare it is in the corpus, so specific
// words (insurance, gearbox, CCJ) dominate generic ones (van, finance). Built once per
// cached corpus (WeakMap), then each query is a few milliseconds.

const STOPWORDS = new Set("a an and are as at be but by can could do does for from get got had has have how i if in into is it its me my no not of on or our so than that the their them then there these they this to up us was we what when where which who why will with would you your yours i'm im i've ive i'd id it's whats what's please thanks thank just also any some about need want like know tell let one".split(" "));
const SYNONYMS = new Map([["insure", "insurance"], ["insured", "insurance"], ["docs", "documents"], ["document", "documents"], ["paperwork", "documents"], ["guarantee", "warranty"], ["guarantees", "warranty"], ["cancel", "termination"], ["cancelling", "termination"], ["terminate", "termination"], ["early", "early"], ["selfemployed", "self-employed"], ["sole", "self-employed"], ["deliver", "delivery"], ["delivered", "delivery"], ["collect", "collection"], ["collected", "collection"], ["complain", "complaint"], ["complaints", "complaint"], ["broken", "fault"], ["faulty", "fault"], ["faults", "fault"], ["mot", "mot"], ["ccjs", "ccj"]]);

export function tokens(text) {
  const raw = clean(text, 20000).toLowerCase().replace(/self[\s-]+employed/g, "self-employed").match(/[a-z0-9£][a-z0-9£'-]*/g) || [];
  return raw
    .map((word) => word.replace(/'s$/, "").replace(/^-+|-+$/g, ""))
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
    .map((word) => SYNONYMS.get(word) || (word.length > 4 && /[^s]s$/.test(word) && !/ss$/.test(word) ? word.slice(0, -1) : word))
    .map((word) => SYNONYMS.get(word) || word);
}

const indexCache = new WeakMap();

export function buildIndex(corpus = []) {
  if (indexCache.has(corpus)) return indexCache.get(corpus);
  const docs = corpus.map((source) => {
    const terms = [...tokens(`${source.title} ${source.heading}`), ...tokens(`${source.title} ${source.heading}`), ...tokens(source.passage)];
    const tf = new Map();
    for (const term of terms) tf.set(term, (tf.get(term) || 0) + 1);
    return { source, tf, length: terms.length || 1 };
  });
  const df = new Map();
  for (const doc of docs) for (const term of doc.tf.keys()) df.set(term, (df.get(term) || 0) + 1);
  const avgLength = docs.reduce((sum, doc) => sum + doc.length, 0) / Math.max(1, docs.length);
  const index = { docs, df, avgLength, size: docs.length };
  indexCache.set(corpus, index);
  return index;
}

export function searchIndex(query, index, { limit = 8 } = {}) {
  const queryTerms = [...new Set(tokens(query))];
  if (!queryTerms.length || !index.size) return [];
  const idf = (term) => Math.log(1 + (index.size - (index.df.get(term) || 0) + 0.5) / ((index.df.get(term) || 0) + 0.5));
  // Words absent from the whole corpus can't be matched by anything, so they don't count
  // against coverage ("does the warranty cover the gearbox" still finds warranty passages).
  const totalIdf = queryTerms.filter((term) => index.df.has(term)).reduce((sum, term) => sum + idf(term), 0) || 1;
  const k1 = 1.2;
  const b = 0.75;
  return index.docs.map((doc) => {
    let score = 0;
    const matched = [];
    for (const term of queryTerms) {
      const tf = doc.tf.get(term);
      if (!tf) continue;
      matched.push(term);
      score += idf(term) * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc.length / index.avgLength));
    }
    const coverage = matched.reduce((sum, term) => sum + idf(term), 0) / totalIdf;
    const authority = doc.source.type === "business_brain" || doc.source.type === "business_faq" ? 1.15 : 1;
    return { ...doc.source, score: Number((score * authority).toFixed(3)), coverage: Number(coverage.toFixed(3)), matched_terms: matched };
  })
    .filter((item) => item.matched_terms.length)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// Multi-part questions ("documents if I'm self-employed, and do I need insurance?")
// are ranked part by part so each subject gets its own evidence.
export function questionParts(query) {
  const parts = clean(query, 1200)
    .split(/\?|;|\.\s|\s+(?:and also|also|and what about|what about|plus)\s+|,\s*(?:and\s+)?(?=(?:do|does|can|what|how|is|are|will|would)\b)/i)
    .map((part) => part.trim())
    .filter((part) => part.split(/\s+/).length >= 2);
  return parts.length > 1 ? parts.slice(0, 3) : [clean(query, 1200)];
}

// Interleave the ranked lists (best of each part first), then apply the floor and limits.
export function mergeRankedParts(rankedParts = []) {
  const merged = [];
  const seen = new Set();
  const longest = Math.max(0, ...rankedParts.map((list) => list.length));
  for (let index = 0; index < longest; index += 1) {
    for (const list of rankedParts) {
      const source = list[index];
      if (!source) continue;
      const key = `${source.source_id}|${source.heading}|${clean(source.passage, 80)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(source);
    }
  }
  return merged;
}

export function selectPassages(ranked = [], limits = RETRIEVAL_LIMITS) {
  const perSource = new Map();
  const chosen = [];
  for (const source of ranked) {
    if (chosen.length >= limits.maxPassages) break;
    if (Number(source.coverage) < limits.minCoverage || Number(source.relative ?? 1) < limits.minRelative) continue;
    const key = source.source_id || source.title;
    if ((perSource.get(key) || 0) >= limits.maxPerSource) continue;
    perSource.set(key, (perSource.get(key) || 0) + 1);
    chosen.push({
      type: source.type,
      source_id: source.source_id,
      title: clean(source.title, 160),
      heading: clean(source.heading, 160),
      passage: clean(source.passage, limits.passageChars),
      url: clean(source.public_url, 500) || null,
      score: source.score,
    });
  }
  return chosen;
}

// ---- Business pages (wider approved site pages: title, description, keywords, URL) ----

let pageCache = { value: null, expiresAt: 0, inFlight: null };
const PAGE_TTL_MS = 5 * 60 * 1000;

export function resetBusinessPageCache() { pageCache = { value: null, expiresAt: 0, inFlight: null }; }

async function cachedBusinessPages(loadPages) {
  if (pageCache.value && pageCache.expiresAt > Date.now()) return { pages: pageCache.value, cache_hit: true };
  if (!pageCache.inFlight) {
    pageCache.inFlight = Promise.resolve(loadPages()).then((pages) => {
      pageCache = { value: Array.isArray(pages) ? pages : [], expiresAt: Date.now() + PAGE_TTL_MS, inFlight: null };
      return pageCache.value;
    }).catch((error) => { pageCache.inFlight = null; throw error; });
  }
  return { pages: await pageCache.inFlight, cache_hit: false };
}

const words = (text) => clean(text, 4000).toLowerCase().match(/[a-z0-9£]+/g) || [];
const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "for", "is", "are", "can", "i", "do", "you", "my", "me", "on", "in", "it", "this", "that", "with", "what", "how", "if", "be", "have", "get", "van", "vans"]);

export function rankBusinessPages(query, pages = [], product = "finance", limits = RETRIEVAL_LIMITS) {
  const queryWords = new Set(words(query).filter((word) => word.length > 2 && !STOP.has(word)));
  if (!queryWords.size) return [];
  return pages
    .filter((page) => page.active !== false && [product, "both", "general"].includes(clean(page.product, 20).toLowerCase() || "general"))
    .map((page) => {
      const haystack = new Set(words(`${page.title} ${page.description} ${(page.keywords || []).join(" ")} ${(page.customer_intent || []).join(" ")}`));
      const matched = [...queryWords].filter((word) => haystack.has(word));
      return { page, matched, score: matched.length + (Number(page.priority) || 3) / 10 };
    })
    .filter((item) => item.matched.length >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limits.maxPages)
    .map(({ page }) => ({ title: clean(page.title, 160), description: clean(page.description, 300), url: clean(page.url, 500) }));
}

/**
 * @param {object} input { product, message, history }
 * @param {object} deps  { loadKnowledge: () => knowledge, loadBusinessPages: () => pages, environment }
 */
export async function retrieveKnowledge({ product, message, history = [] }, deps = {}) {
  const started = now();
  const timings = {};
  let stage = now();
  const runtime = await getCachedAssistantKnowledge(deps.loadKnowledge, { environment: deps.environment || process.env });
  timings.knowledge_load_ms = ms(stage);
  stage = now();
  const { corpus } = preparedKnowledgeFor(runtime, product, false); // strict Finance / Rent2Buy separation
  const index = buildIndex(corpus);
  const current = expandQuery(clean(message, 1200));
  // A follow-up that is too thin on its own ("does that include the gearbox?") also
  // searches with the previous customer turn; a self-contained question searches alone,
  // so an earlier price question does not pull pricing passages into a documents answer.
  const knownTerms = new Set(tokens(current).filter((term) => index.df.has(term)));
  const reference = referencedKnowledgeQuestion(message, history);
  const query = reference || knownTerms.size < 2 ? expandQuery(retrievalQuery(message, history)) : current;
  const parts = questionParts(current);
  const withRelative = (list) => list.map((item) => ({ ...item, relative: list[0]?.score ? item.score / list[0].score : 0 }));
  const search = (part) => withRelative(searchIndex(part, index, { limit: 10 }));
  const rankedParts = (parts.length > 1 ? parts : [query]).map(search);
  // Preserve evidence for the question being referred to even when the new detail
  // (e.g. "gearbox") is common in unrelated stock or specification articles.
  if (reference && parts.length === 1) rankedParts.push(search(expandQuery(reference)));
  // Multi-part questions get room for the best three passages of each part (max 6).
  const limits = parts.length > 1 ? { ...RETRIEVAL_LIMITS, maxPassages: Math.min(6, parts.length * 3) } : RETRIEVAL_LIMITS;
  const passages = selectPassages(mergeRankedParts(rankedParts), limits);
  timings.rank_ms = ms(stage);
  let pages = [];
  let pagesCacheHit = null;
  if (typeof deps.loadBusinessPages === "function") {
    stage = now();
    try {
      const loaded = await cachedBusinessPages(deps.loadBusinessPages);
      pagesCacheHit = loaded.cache_hit;
      pages = rankBusinessPages(query, loaded.pages, product);
    } catch {
      pages = [];
    }
    timings.pages_ms = ms(stage);
  }
  timings.total_ms = ms(started);
  return {
    passages,
    pages,
    corpus_size: corpus.length,
    query_parts: parts.length,
    cache_hit: runtime.cache_hit,
    pages_cache_hit: pagesCacheHit,
    timings_ms: timings,
  };
}

export function knowledgeText({ passages = [], pages = [] } = {}) {
  const blocks = passages.map((item, index) => `[K${index + 1}] ${item.type === "business_brain" || item.type === "business_faq" ? "Business Brain" : "Knowledge Hub"} — ${item.title}${item.heading && item.heading !== item.title ? ` — ${item.heading}` : ""}\n${item.passage}`);
  const pageLines = pages.map((page) => `- ${page.title}: ${page.description}${page.url ? ` (${page.url})` : ""}`);
  return [blocks.join("\n\n"), pageLines.length ? `Related website pages:\n${pageLines.join("\n")}` : ""].filter(Boolean).join("\n\n");
}

import { calculateOpportunityPriority, classifyLearningIntent } from "./knowledgeLearningEngine.js";
import { redactSensitiveCustomerData } from "./publicAssistantFoundation.js";

const ASSISTANT_INTENT_PHRASES = Object.freeze({
  coverage: "do you cover my area and where can I collect",
  delivery_collection: "delivery or collection area",
  deposit: "how much deposit or upfront payment do I need",
  poor_credit: "am I eligible with bad credit",
  self_employed: "am I eligible if I am self employed",
  documents: "what documents or proof do I need",
  monthly_cost: "what will the monthly payment cost",
  vat_pricing: "what will the monthly payment cost including VAT",
  vehicle: "which vehicles are eligible",
  application: "how do I apply and what happens next",
  ownership: "how does this product work and who owns the van",
  trading_history: "am I eligible with limited trading history",
  business_use: "am I eligible for business use",
  multiple_vehicles: "which vehicles are eligible for my business",
});

const UNCLASSIFIED_PREFIX = "uncategorised_";
const MAX_EVIDENCE_QUERIES = 8;

function clean(value, limit = 500) {
  return String(value || "").trim().slice(0, limit);
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function time(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalisedText(value) {
  return clean(value, 500).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function safeQuery(value) {
  return clean(redactSensitiveCustomerData(clean(value, 500)), 500);
}

function knownClassification(classified) {
  return classified?.key && !String(classified.key).startsWith(UNCLASSIFIED_PREFIX) ? classified : null;
}

export function inferEvidenceProduct({ product, category, query } = {}) {
  const explicit = clean(product, 40).toLowerCase();
  if (["finance", "rent2buy"].includes(explicit)) return explicit;
  const categoryText = clean(category, 100).toLowerCase();
  if (categoryText.includes("rent2buy") || categoryText.includes("rent 2 buy") || categoryText.includes("rent to buy")) return "rent2buy";
  const queryText = normalisedText(query);
  if (/\brent\s*(?:2|to)\s*buy\b/.test(queryText) || queryText.includes("rent2buy")) return "rent2buy";
  return "finance";
}

export function classifyAssistantEvidenceIntent(intent, product) {
  const phrase = ASSISTANT_INTENT_PHRASES[clean(intent, 80).toLowerCase()];
  if (!phrase) return null;
  return knownClassification(classifyLearningIntent(phrase, product));
}

export function classifyTextEvidenceIntent(query, product) {
  const text = safeQuery(query);
  if (!text) return null;
  return knownClassification(classifyLearningIntent(text, product));
}

function newEvidenceGroup(product, classified) {
  return {
    key: `${product}:${classified.key}`,
    product,
    title: classified.title,
    category: classified.category,
    normalised_intent: classified.key,
    live_assistant_question_count: 0,
    live_assistant_gap_count: 0,
    live_assistant_retrieval_miss_count: 0,
    hub_search_count: 0,
    hub_no_result_count: 0,
    gsc_impressions: 0,
    gsc_clicks: 0,
    gsc_query_count: 0,
    assistant_intents: new Map(),
    hub_queries: new Map(),
    gsc_queries: new Map(),
    first_seen_at: null,
    last_seen_at: null,
  };
}

function groupFor(groups, product, classified) {
  const key = `${product}:${classified.key}`;
  if (!groups.has(key)) groups.set(key, newEvidenceGroup(product, classified));
  return groups.get(key);
}

function touch(group, createdAt) {
  const value = clean(createdAt, 80);
  if (!value) return;
  if (!group.first_seen_at || time(value) < time(group.first_seen_at)) group.first_seen_at = value;
  if (!group.last_seen_at || time(value) > time(group.last_seen_at)) group.last_seen_at = value;
}

function incrementQuery(map, displayQuery, metrics = {}) {
  const query = safeQuery(displayQuery);
  const key = normalisedText(query);
  if (!key) return;
  const current = map.get(key) || { query, count: 0, impressions: 0, clicks: 0 };
  current.count += positiveNumber(metrics.count || 1);
  current.impressions += positiveNumber(metrics.impressions);
  current.clicks += positiveNumber(metrics.clicks);
  map.set(key, current);
}

function latestGoogleResults(rows = []) {
  const latest = new Map();
  (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.provider === "google_search_console")
    .sort((a, b) => time(b.checked_at) - time(a.checked_at))
    .forEach((row) => { if (row.article_id && !latest.has(row.article_id)) latest.set(row.article_id, row); });
  return [...latest.values()];
}

function topQueries(map) {
  return [...map.values()]
    .sort((a, b) => b.impressions - a.impressions || b.count - a.count || b.clicks - a.clicks || a.query.localeCompare(b.query))
    .slice(0, MAX_EVIDENCE_QUERIES);
}

export function aggregateKnowledgeOpportunityEvidence({ assistantEvents = [], searchEvents = [], visibilityResults = [], articles = [] } = {}) {
  const groups = new Map();
  const articleById = new Map((Array.isArray(articles) ? articles : []).map((article) => [article.id, article]));
  let unclassifiedAssistantEvents = 0;
  let unclassifiedSearches = 0;
  let unclassifiedGscQueries = 0;

  (Array.isArray(assistantEvents) ? assistantEvents : [])
    .filter((event) => event?.event_type === "assistant_response")
    .forEach((event) => {
      const product = inferEvidenceProduct({ product: event.product_context });
      const intents = [...new Set(Array.isArray(event.secondary_intents) ? event.secondary_intents : [])];
      let classifiedAny = false;
      intents.forEach((intent) => {
        const classified = classifyAssistantEvidenceIntent(intent, product);
        if (!classified) return;
        classifiedAny = true;
        const group = groupFor(groups, product, classified);
        group.live_assistant_question_count += 1;
        if (event.knowledge_gap === true) group.live_assistant_gap_count += 1;
        if (event.retrieval_required === true && event.retrieval_used !== true) group.live_assistant_retrieval_miss_count += 1;
        incrementQuery(group.assistant_intents, intent, { count: 1 });
        touch(group, event.created_at);
      });
      if (intents.length && !classifiedAny) unclassifiedAssistantEvents += 1;
    });

  (Array.isArray(searchEvents) ? searchEvents : [])
    .filter((event) => event?.event_type === "search_submitted")
    .forEach((event) => {
      const product = inferEvidenceProduct({ category: event.category, query: event.normalised_query || event.query_text });
      const classified = classifyTextEvidenceIntent(event.normalised_query || event.query_text, product);
      if (!classified) { unclassifiedSearches += 1; return; }
      const group = groupFor(groups, product, classified);
      group.hub_search_count += 1;
      if (Number(event.result_count || 0) === 0) group.hub_no_result_count += 1;
      incrementQuery(group.hub_queries, event.query_text || event.normalised_query, { count: 1 });
      touch(group, event.created_at);
    });

  latestGoogleResults(visibilityResults).forEach((result) => {
    const article = articleById.get(result.article_id) || {};
    const queries = Array.isArray(result?.structured_evidence?.top_queries) ? result.structured_evidence.top_queries : [];
    queries.forEach((queryRow) => {
      const product = inferEvidenceProduct({ category: article.category, query: queryRow.query });
      const classified = classifyTextEvidenceIntent(queryRow.query, product);
      if (!classified) { unclassifiedGscQueries += 1; return; }
      const group = groupFor(groups, product, classified);
      group.gsc_impressions += positiveNumber(queryRow.impressions);
      group.gsc_clicks += positiveNumber(queryRow.clicks);
      group.gsc_query_count += 1;
      incrementQuery(group.gsc_queries, queryRow.query, { impressions: queryRow.impressions, clicks: queryRow.clicks });
      touch(group, result.checked_at);
    });
  });

  return {
    groups: [...groups.values()].map((group) => ({
      ...group,
      assistant_intents: topQueries(group.assistant_intents),
      hub_queries: topQueries(group.hub_queries),
      gsc_queries: topQueries(group.gsc_queries),
      first_seen_at: group.first_seen_at || new Date().toISOString(),
      last_seen_at: group.last_seen_at || new Date().toISOString(),
    })),
    diagnostics: {
      unclassified_assistant_events: unclassifiedAssistantEvents,
      unclassified_hub_searches: unclassifiedSearches,
      unclassified_gsc_queries: unclassifiedGscQueries,
    },
  };
}

export function evidencePriorityComponents(evidence = {}) {
  const liveDemand = Math.min(12, positiveNumber(evidence.live_assistant_question_count) * 2);
  const liveGaps = Math.min(12, positiveNumber(evidence.live_assistant_gap_count) * 4 + positiveNumber(evidence.live_assistant_retrieval_miss_count) * 2);
  const hubDemand = Math.min(10, positiveNumber(evidence.hub_no_result_count) * 3 + Math.min(4, positiveNumber(evidence.hub_search_count)));
  const gscDemand = Math.min(8, Math.round(Math.log10(positiveNumber(evidence.gsc_impressions) + 1) * 3 + Math.min(2, positiveNumber(evidence.gsc_clicks) * 0.5)));
  return { live_demand: liveDemand, live_gaps: liveGaps, hub_demand: hubDemand, gsc_demand: gscDemand };
}

export function calculateEvidenceAdjustedPriority(opportunity = {}, evidence = {}, now = new Date()) {
  const base = calculateOpportunityPriority({
    ...opportunity,
    existing_article_count: opportunity.existing_article_count ?? opportunity.related_article_ids?.length ?? 0,
    last_seen_at: evidence.last_seen_at || opportunity.last_seen_at,
  }, now);
  const extra = evidencePriorityComponents(evidence);
  const components = { ...base.components, ...extra };
  const score = Math.max(0, Math.min(100, Object.values(components).reduce((sum, value) => sum + Number(value || 0), 0)));
  const level = score >= 75 ? "critical" : score >= 50 ? "high" : score >= 25 ? "medium" : "low";
  return { score, level, components };
}

export function shouldCreateEvidenceOpportunity(evidence = {}) {
  const assistantGap = positiveNumber(evidence.live_assistant_gap_count) + positiveNumber(evidence.live_assistant_retrieval_miss_count);
  if (positiveNumber(evidence.live_assistant_question_count) >= 2 && assistantGap >= 1) return true;
  if (positiveNumber(evidence.hub_no_result_count) >= 2) return true;
  return positiveNumber(evidence.hub_search_count) >= 3 && positiveNumber(evidence.gsc_impressions) >= 20;
}

export function evidenceChannelPayload(evidence = {}, windowDays = 90) {
  return {
    window_days: windowDays,
    live_assistant: {
      question_count: positiveNumber(evidence.live_assistant_question_count),
      gap_count: positiveNumber(evidence.live_assistant_gap_count),
      retrieval_miss_count: positiveNumber(evidence.live_assistant_retrieval_miss_count),
      intent_labels: (evidence.assistant_intents || []).map((item) => ({ label: item.query, count: item.count })),
    },
    knowledge_hub_search: {
      search_count: positiveNumber(evidence.hub_search_count),
      no_result_count: positiveNumber(evidence.hub_no_result_count),
      top_queries: evidence.hub_queries || [],
    },
    google_search_console: {
      impressions: positiveNumber(evidence.gsc_impressions),
      clicks: positiveNumber(evidence.gsc_clicks),
      query_count: positiveNumber(evidence.gsc_query_count),
      top_queries: evidence.gsc_queries || [],
    },
    first_seen_at: evidence.first_seen_at || null,
    last_seen_at: evidence.last_seen_at || null,
  };
}

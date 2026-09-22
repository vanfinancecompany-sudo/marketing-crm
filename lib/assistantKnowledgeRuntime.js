import {
  buildRetrievalCorpus,
  filterKnowledgeForProduct,
} from "./aiAssistantCompetence.js";

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MIN_TTL_MS = 30 * 1000;
const MAX_TTL_MS = 15 * 60 * 1000;

let cache = {
  value: null,
  expiresAt: 0,
  inFlight: null,
};

function nowMs(now) {
  return typeof now === "function" ? Number(now()) : Date.now();
}

function cacheTtlMs(environment = process.env) {
  const configured = Number(environment.AI_ASSISTANT_KNOWLEDGE_CACHE_TTL_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_TTL_MS;
  return Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, Math.round(configured)));
}

function prepareProduct(knowledge, productContext, comparison = false) {
  const bounded = filterKnowledgeForProduct(knowledge, productContext, { comparison });
  const corpus = buildRetrievalCorpus({
    ...bounded,
    productContext,
    comparison,
  });
  return { bounded, corpus };
}

export function prepareAssistantKnowledge(knowledge = {}) {
  return {
    knowledge,
    prepared: {
      finance: prepareProduct(knowledge, "finance", false),
      rent2buy: prepareProduct(knowledge, "rent2buy", false),
      comparison_finance: prepareProduct(knowledge, "finance", true),
      comparison_rent2buy: prepareProduct(knowledge, "rent2buy", true),
    },
  };
}

export function preparedKnowledgeFor(runtime, productContext, comparison = false) {
  const key = comparison ? `comparison_${productContext}` : productContext;
  const selected = runtime?.prepared?.[key];
  if (!selected) throw new Error(`Prepared assistant knowledge is unavailable for ${key}.`);
  return selected;
}

export async function getCachedAssistantKnowledge(loadFresh, {
  environment = process.env,
  now = Date.now,
} = {}) {
  const current = nowMs(now);
  if (cache.value && current < cache.expiresAt) {
    return {
      ...cache.value,
      cache_hit: true,
      cache_joined: false,
      cache_age_ms: Math.max(0, current - cache.value.loadedAt),
    };
  }

  if (cache.inFlight) {
    const joined = await cache.inFlight;
    return {
      ...joined,
      cache_hit: true,
      cache_joined: true,
      cache_age_ms: Math.max(0, nowMs(now) - joined.loadedAt),
    };
  }

  const startedAt = current;
  const inFlight = Promise.resolve()
    .then(loadFresh)
    .then((knowledge) => {
      const prepared = prepareAssistantKnowledge(knowledge);
      const loadedAt = nowMs(now);
      const value = {
        ...prepared,
        loadedAt,
        load_time_ms: Math.max(0, loadedAt - startedAt),
      };
      cache.value = value;
      cache.expiresAt = loadedAt + cacheTtlMs(environment);
      return value;
    })
    .finally(() => {
      if (cache.inFlight === inFlight) cache.inFlight = null;
    });

  cache.inFlight = inFlight;
  const loaded = await inFlight;
  return {
    ...loaded,
    cache_hit: false,
    cache_joined: false,
    cache_age_ms: 0,
  };
}

export function resetAssistantKnowledgeCache() {
  cache = {
    value: null,
    expiresAt: 0,
    inFlight: null,
  };
}

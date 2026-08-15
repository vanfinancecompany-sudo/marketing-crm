import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { assistantTelemetryVisitorHash } from "../lib/aiAssistantTelemetry.js";
import {
  isPublicKnowledgeHubArticle,
  normaliseKnowledgeHubSearchText,
  sanitiseKnowledgeHubSearchQuery,
  searchPublicKnowledgeHubArticles,
} from "../lib/publicKnowledgeHubSearch.js";
import { loadRent2BuyKnowledgeHubArticles } from "../lib/rent2BuyKnowledgeHubCms.js";
import { secureHash, validateWixOrigin } from "../lib/publicAssistantFoundation.js";

const SEARCH_LIMIT_PER_MINUTE = 30;
const SEARCH_LIMIT_PER_DAY = 500;
const KNOWLEDGE_HUB_EMBED_ORIGIN = "https://marketing-crm-github-work.vercel.app";
const VFC_HOSTS = new Set(["vanfinancecompany.co.uk", "www.vanfinancecompany.co.uk"]);
const RENT2BUY_HOSTS = new Set(["rent2buyvans.co.uk", "www.rent2buyvans.co.uk"]);
const ARTICLE_FIELDS = [
  "id", "title", "slug", "category", "article_type", "seo_title", "meta_description", "excerpt",
  "content_markdown", "faq_json", "status", "live_wix_url", "published_at", "publication_verified_at",
  "wix_sync_status", "wix_publication_status", "is_active",
].join(",");
const clean = (value, limit = 500) => String(value || "").trim().slice(0, limit);

function getSupabase(environment = process.env) {
  if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Knowledge Hub search is unavailable.");
  return createClient(environment.SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

function requestOrigin(request) {
  return clean(request.headers?.origin || request.headers?.Origin, 500);
}

export function knowledgeHubScopeForOrigin(origin, environment = process.env) {
  try {
    const parsed = new URL(clean(origin, 500));
    if (parsed.origin === KNOWLEDGE_HUB_EMBED_ORIGIN) return "vfc";
    if (!validateWixOrigin(parsed.origin, environment)) return null;
    const hostname = parsed.hostname.toLowerCase();
    if (VFC_HOSTS.has(hostname)) return "vfc";
    if (RENT2BUY_HOSTS.has(hostname)) return "rent2buy";
    return null;
  } catch {
    return null;
  }
}

function setCors(response, origin) {
  response.setHeader?.("Access-Control-Allow-Origin", origin);
  response.setHeader?.("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader?.("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader?.("Access-Control-Max-Age", "600");
  response.setHeader?.("Cache-Control", "no-store, max-age=0");
  response.setHeader?.("Vary", "Origin");
}

function bodyObject(request) {
  if (!request.body) return {};
  if (typeof request.body === "object") return request.body;
  try { return JSON.parse(request.body); } catch { return {}; }
}

function requestIp(request) {
  const forwarded = clean(request.headers?.["x-forwarded-for"], 500).split(",")[0].trim();
  return forwarded || clean(request.headers?.["x-real-ip"], 100) || "unknown";
}

function rateWindow(now, durationMs) {
  return new Date(Math.floor(now.getTime() / durationMs) * durationMs).toISOString();
}

async function consumeSearchRateLimit(supabase, request, environment = process.env) {
  const secret = clean(environment.AI_ASSISTANT_SESSION_SECRET, 1000);
  if (!secret) throw new Error("Knowledge Hub search security is unavailable.");
  const keyHash = secureHash(`knowledge-search:${requestIp(request)}`, secret);
  const now = new Date();
  const minute = await supabase.rpc("consume_ai_assistant_rate_limit", {
    p_key_hash: keyHash,
    p_scope: "minute",
    p_window_start: rateWindow(now, 60_000),
    p_limit: SEARCH_LIMIT_PER_MINUTE,
  });
  if (minute?.error) throw minute.error;
  if (minute?.data !== true) return false;
  const day = await supabase.rpc("consume_ai_assistant_rate_limit", {
    p_key_hash: keyHash,
    p_scope: "day",
    p_window_start: rateWindow(now, 86_400_000),
    p_limit: SEARCH_LIMIT_PER_DAY,
  });
  if (day?.error) throw day.error;
  return day?.data === true;
}

function missingSearchTelemetryTable(error) {
  const code = clean(error?.code, 40);
  const message = clean(error?.message, 1000).toLowerCase();
  return code === "42P01" || (message.includes("knowledge_hub_search_events") && message.includes("does not exist"));
}

async function recordSearchEvent(supabase, payload) {
  try {
    const result = await supabase.from("knowledge_hub_search_events").insert(payload);
    if (result?.error) throw result.error;
  } catch (error) {
    if (!missingSearchTelemetryTable(error)) {
      console.error("PUBLIC KNOWLEDGE HUB SEARCH TELEMETRY ERROR", {
        event_type: payload?.event_type || null,
        exception_type: error?.name || "Error",
        message: clean(error?.message, 500),
      });
    }
  }
}

async function loadVfcPublishedArticles(supabase) {
  const result = await supabase
    .from("knowledge_articles")
    .select(ARTICLE_FIELDS)
    .eq("is_active", true)
    .eq("wix_publication_status", "live")
    .in("wix_sync_status", ["live", "synced"])
    .not("live_wix_url", "is", null)
    .not("published_at", "is", null)
    .not("publication_verified_at", "is", null)
    .limit(1000);
  if (result?.error) throw result.error;
  return (Array.isArray(result?.data) ? result.data : []).filter((article) => isPublicKnowledgeHubArticle(article, "vfc"));
}

async function loadPublishedArticles({ scope, supabase, environment, dependencies }) {
  if (scope === "rent2buy") {
    const loader = dependencies.loadRent2BuyArticles || loadRent2BuyKnowledgeHubArticles;
    return loader({ environment, fetchImpl: dependencies.fetchImpl || fetch });
  }
  return loadVfcPublishedArticles(supabase);
}

function uuid(value) {
  const candidate = clean(value, 80).toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(candidate) ? candidate : "";
}

function telemetryCategory(scope, category) {
  if (scope === "rent2buy") return "Rent2Buy";
  return category === "all" ? null : category;
}

async function searchKnowledgeHub({ supabase, body, environment, scope, dependencies }) {
  const query = clean(body.query, 200);
  const normalisedQuery = normaliseKnowledgeHubSearchText(query);
  if (normalisedQuery.length < 2) return { status: 400, payload: { error: "Enter at least 2 characters to search." } };
  const category = scope === "rent2buy" ? "all" : (clean(body.category, 100) || "all");
  const articles = await loadPublishedArticles({ scope, supabase, environment, dependencies });
  const results = searchPublicKnowledgeHubArticles(articles, { query, category, limit: 8, scope });
  const searchRequestId = randomUUID();
  const storedQuery = sanitiseKnowledgeHubSearchQuery(query);
  const storedNormalised = normaliseKnowledgeHubSearchText(storedQuery) || "redacted";

  await recordSearchEvent(supabase, {
    event_type: "search_submitted",
    search_request_id: searchRequestId,
    visitor_hash: assistantTelemetryVisitorHash(body.visitor_id, environment),
    query_text: storedQuery || "[redacted]",
    normalised_query: storedNormalised,
    result_count: results.length,
    category: telemetryCategory(scope, category),
  });

  return {
    status: 200,
    payload: {
      search_request_id: searchRequestId,
      query,
      category,
      scope,
      result_count: results.length,
      results: results.map(({ score: _score, ...result }) => result),
    },
  };
}

async function selectKnowledgeHubResult({ supabase, body, environment, scope, dependencies }) {
  const searchRequestId = uuid(body.search_request_id);
  const articleId = uuid(body.article_id);
  const rank = Number.parseInt(body.rank, 10);
  const rawQuery = clean(body.query, 200);
  const storedQuery = sanitiseKnowledgeHubSearchQuery(rawQuery);
  const storedNormalised = normaliseKnowledgeHubSearchText(storedQuery);
  if (!searchRequestId || !articleId || !storedNormalised || !Number.isInteger(rank) || rank < 1 || rank > 1000) {
    return { status: 400, payload: { error: "Invalid search selection." } };
  }

  let available = false;
  if (scope === "rent2buy") {
    const articles = await loadPublishedArticles({ scope, supabase, environment, dependencies });
    available = articles.some((article) => article.id === articleId && isPublicKnowledgeHubArticle(article, "rent2buy"));
  } else {
    const result = await supabase.from("knowledge_articles").select(ARTICLE_FIELDS).eq("id", articleId).maybeSingle();
    if (result?.error) throw result.error;
    available = isPublicKnowledgeHubArticle(result?.data || {}, "vfc");
  }
  if (!available) return { status: 404, payload: { error: "Article is not available." } };

  await recordSearchEvent(supabase, {
    event_type: "result_selected",
    search_request_id: searchRequestId,
    visitor_hash: assistantTelemetryVisitorHash(body.visitor_id, environment),
    query_text: storedQuery || "[redacted]",
    normalised_query: storedNormalised,
    result_count: null,
    selected_article_id: articleId,
    selected_rank: rank,
    category: telemetryCategory(scope, clean(body.category, 100) || "all"),
  });
  return { status: 200, payload: { ok: true } };
}

export async function handlePublicKnowledgeHubSearchRequest(request, response, dependencies = {}) {
  const environment = dependencies.environment || process.env;
  const origin = requestOrigin(request);
  const scope = knowledgeHubScopeForOrigin(origin, environment);
  response.setHeader?.("Cache-Control", "no-store, max-age=0");
  if (!scope) return response.status(403).json({ error: "Unavailable from this website." });
  setCors(response, origin);
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "POST") return response.status(405).json({ error: "Method not allowed." });

  try {
    const supabase = dependencies.supabase || getSupabase(environment);
    const allowed = await consumeSearchRateLimit(supabase, request, environment);
    if (!allowed) return response.status(429).json({ error: "Too many searches. Please try again shortly." });
    const body = bodyObject(request);
    const action = clean(body.action, 20) || "search";
    const result = action === "search"
      ? await searchKnowledgeHub({ supabase, body, environment, scope, dependencies })
      : action === "select"
        ? await selectKnowledgeHubResult({ supabase, body, environment, scope, dependencies })
        : { status: 400, payload: { error: "Unsupported search action." } };
    return response.status(result.status).json(result.payload);
  } catch (error) {
    console.error("PUBLIC KNOWLEDGE HUB SEARCH ERROR", {
      scope,
      exception_type: error?.name || "Error",
      message: clean(error?.message, 500),
    });
    return response.status(503).json({ error: "Knowledge Hub search is temporarily unavailable." });
  }
}

export default async function handler(request, response) {
  return handlePublicKnowledgeHubSearchRequest(request, response);
}

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { refreshArticleInternalLinks } from "../lib/internalLinkingService.js";
import { findInternalLinkAnchorMatches } from "../lib/internalLinkAnchorValidation.js";
import {
  HISTORIC_LINK_RETROFIT_ACTION,
  HISTORIC_LINK_RETROFIT_SEED_EXCLUSIONS,
  compactHistoricSuggestion,
  validateHistoricBatchDecisions,
} from "../lib/historicLinkBulkWorkflow.js";
import { prepareJasminLinkDecision } from "./jasmin-knowledge-links.js";
import { publishKnowledgeArticleToWix } from "./marketing-wix-publishing.js";

const JASMIN_KEY_HEADER = "x-jasmin-marketing-key";
const clean = (value, limit = 20000) => String(value || "").trim().slice(0, limit);
class ApiError extends Error { constructor(status, message, details = null) { super(message); this.status = status; this.details = details; } }

function authorised(request, environment = process.env) {
  const expected = clean(environment.JASMIN_MARKETING_API_KEY, 10000);
  const header = clean(request?.headers?.[JASMIN_KEY_HEADER] || request?.headers?.[JASMIN_KEY_HEADER.toLowerCase()], 10000);
  const authorization = clean(request?.headers?.authorization, 10000);
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return Boolean(expected && (header === expected || bearer === expected));
}
function getSupabase() {
  const url = clean(process.env.SUPABASE_URL, 2000), key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY, 10000);
  if (!url || !key) throw new ApiError(500, "Marketing CRM data service is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") { try { return JSON.parse(request.body); } catch { throw new ApiError(400, "The request body is not valid JSON."); } }
  return request.body;
}
function data(result, fallback, status = 500) { if (result.error) throw new ApiError(status, result.error.message || fallback); return result.data; }
function batchToken(articleIds) { return crypto.createHash("sha256").update(articleIds.join("|")).digest("hex").slice(0, 24); }

async function completedArticleIds(supabase) {
  const rows = data(await supabase.from("knowledge_editorial_events").select("article_id,details").eq("event_type", "system"), "Historic retrofit history could not be loaded.") || [];
  return new Set(rows.filter((row) => row?.details?.action === HISTORIC_LINK_RETROFIT_ACTION).map((row) => row.article_id).filter(Boolean));
}

async function currentSuggestions(supabase, articleId) {
  return data(await supabase.from("knowledge_internal_link_suggestions").select("*").eq("article_id", articleId).neq("status", "superseded").order("confidence_score", { ascending: false }).order("created_at", { ascending: true }), "Internal-link suggestions could not be loaded.") || [];
}

async function mapWithConcurrency(items, concurrency, worker) {
  const output = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return output;
}

async function prepareHistoricBatch(supabase, body) {
  const limit = Math.max(1, Math.min(20, Number(body.limit) || 20));
  const completed = await completedArticleIds(supabase);
  const excluded = new Set([...HISTORIC_LINK_RETROFIT_SEED_EXCLUSIONS, ...completed]);
  const inventory = data(await supabase.from("knowledge_articles").select("id,title,category,status,created_at,content_markdown,wix_sync_status").eq("status", "approved").order("created_at", { ascending: true }).limit(250), "Approved Knowledge Hub inventory could not be loaded.") || [];
  const eligible = inventory.filter((article) => !excluded.has(article.id));
  const selected = eligible.slice(0, limit);
  if (!selected.length) return { batch_token: null, article_ids: [], articles: [], remaining_candidates: 0, complete: true };

  const articles = await mapWithConcurrency(selected, 4, async (article) => {
    await refreshArticleInternalLinks(supabase, article.id, { reason: "Historic bulk retrofit prepared for precision-first editorial review." });
    const suggestions = await currentSuggestions(supabase, article.id);
    const compact = suggestions.map((suggestion) => compactHistoricSuggestion(article.content_markdown, suggestion));
    return {
      id: article.id,
      title: article.title,
      category: article.category,
      created_at: article.created_at,
      suggestions: compact,
      pending_decision_ids: compact.filter((item) => item.status === "pending").map((item) => item.id),
      legacy_cleanup_ids: compact.filter((item) => item.status === "accepted" && !item.anchor_found).map((item) => item.id),
    };
  });
  const articleIds = articles.map((article) => article.id);
  return {
    batch_token: batchToken(articleIds),
    article_ids: articleIds,
    articles,
    remaining_candidates: Math.max(0, eligible.length - selected.length),
    complete: false,
    instructions: {
      new_pending: "Decide every pending suggestion: accept with an exact existing anchor, or reject.",
      legacy_missing_anchor: "Every accepted suggestion with anchor_found=false must be re-anchored with edit_anchor or retired with reject.",
      precision_first: true,
      article_copy_changes_allowed: false,
      wix_action_performed: false,
    },
  };
}

async function recordDecision(supabase, suggestion, article, decision) {
  if (decision.decision === "keep") return suggestion;
  const prepared = prepareJasminLinkDecision({ suggestion, articleMarkdown: article.content_markdown, decision: decision.decision, anchorText: decision.anchor_text });
  const updated = data(await supabase.from("knowledge_internal_link_suggestions").update(prepared.update).eq("id", suggestion.id).select().single(), "Historic internal-link decision could not be saved.");
  data(await supabase.from("knowledge_internal_link_events").insert({
    suggestion_id: suggestion.id,
    article_id: suggestion.article_id,
    website_page_id: suggestion.website_page_id,
    action: prepared.eventAction,
    reason: clean(decision.reason, 1000) || (prepared.retiredAcceptedLink ? "Retired legacy accepted link during historic precision-first retrofit." : "Historic precision-first bulk retrofit decision."),
    details: {
      previous_status: prepared.previousStatus,
      status: updated.status,
      retired_accepted_link: prepared.retiredAcceptedLink,
      previous_anchor_text: suggestion.anchor_text,
      anchor_text: updated.anchor_text,
      destination_url: suggestion.destination_url,
      anchor_validation: prepared.validation,
      decided_via: "jasmin_historic_bulk_action",
      automatic_insertion: false,
    },
  }), "Historic internal-link audit history could not be saved.");
  return updated;
}

async function markCompleted(supabase, article, wixResult, batchId) {
  data(await supabase.from("knowledge_editorial_events").insert({
    event_type: "system",
    article_id: article.id,
    summary: "Historic Knowledge Hub internal-link retrofit completed.",
    details: {
      action: HISTORIC_LINK_RETROFIT_ACTION,
      batch_id: batchId,
      wix_item_id: wixResult?.wix?.item_id || article.wix_item_id || null,
      wix_sync_status: wixResult?.wix?.sync_status || "synced",
      published: false,
      completed_via: "jasmin_historic_bulk_action",
    },
  }), "Historic retrofit completion marker could not be saved.");
}

async function processHistoricArticle(supabase, requestArticle, batchId) {
  try {
    const article = data(await supabase.from("knowledge_articles").select("*").eq("id", requestArticle.article_id).single(), "Historic batch article could not be loaded.", 404);
    if (article.status !== "approved") throw new ApiError(409, `Article ${article.id} is no longer approved.`);
    const suggestions = await currentSuggestions(supabase, article.id);
    const decisions = Array.isArray(requestArticle.decisions) ? requestArticle.decisions : [];
    validateHistoricBatchDecisions({ articleId: article.id, suggestions, decisions });
    const decisionIds = new Set(decisions.map((item) => item.suggestion_id));
    const required = suggestions.filter((item) => item.status === "pending" || (item.status === "accepted" && !findInternalLinkAnchorMatches(article.content_markdown, item.anchor_text).found));
    const missing = required.filter((item) => !decisionIds.has(item.id)).map((item) => item.id);
    if (missing.length) throw new ApiError(409, `Article ${article.id} still has unreviewed pending or broken legacy suggestions.`, { missing_suggestion_ids: missing });

    const byId = new Map(suggestions.map((item) => [item.id, item]));
    for (const decision of decisions) await recordDecision(supabase, byId.get(decision.suggestion_id), article, decision);

    const finalSuggestions = await currentSuggestions(supabase, article.id);
    const accepted = finalSuggestions.filter((item) => item.status === "accepted");
    const invalidAccepted = accepted.map((item) => ({ item, validation: findInternalLinkAnchorMatches(article.content_markdown, item.anchor_text) })).filter(({ validation }) => !validation.found);
    if (invalidAccepted.length) throw new ApiError(409, `Article ${article.id} still has accepted links without valid anchors.`, { suggestion_ids: invalidAccepted.map(({ item }) => item.id) });

    const wixResult = await publishKnowledgeArticleToWix({ supabase, articleId: article.id });
    const skipped = wixResult?.diagnostics?.suggestions_skipped || [];
    if (skipped.length) throw new ApiError(409, `Wix skipped surviving accepted links for article ${article.id}.`, { skipped });
    await markCompleted(supabase, article, wixResult, batchId);
    return {
      ok: true,
      article_id: article.id,
      title: article.title,
      category: article.category,
      final_accepted: accepted.map((item) => ({ id: item.id, destination_title: item.destination_title, destination_url: item.destination_url, anchor_text: item.anchor_text })),
      accepted_loaded: wixResult?.diagnostics?.accepted_suggestions_loaded?.length || 0,
      inserted: wixResult?.diagnostics?.suggestions_successfully_inserted?.length || 0,
      skipped: skipped.length,
      link_decorations: wixResult?.diagnostics?.final_link_decoration_count || 0,
      wix_item_id: wixResult?.wix?.item_id || null,
      wix_sync_status: wixResult?.wix?.sync_status || null,
      content_status: wixResult?.wix?.content_status || "Draft",
      published: false,
    };
  } catch (error) {
    return {
      ok: false,
      article_id: clean(requestArticle?.article_id, 100),
      message: clean(error.message, 1000) || "Historic article processing failed.",
      details: error.details || null,
      published: false,
    };
  }
}

async function applyHistoricBatch(supabase, body) {
  const requestedArticles = Array.isArray(body.articles) ? body.articles : [];
  if (!requestedArticles.length || requestedArticles.length > 20) throw new ApiError(400, "Provide between 1 and 20 prepared batch articles.");
  const articleIds = requestedArticles.map((item) => clean(item.article_id, 100));
  if (body.batch_token !== batchToken(articleIds)) throw new ApiError(409, "Historic batch token does not match the supplied article order. Prepare the batch again before applying decisions.");

  const results = await mapWithConcurrency(requestedArticles, 3, (requestArticle) => processHistoricArticle(supabase, requestArticle, body.batch_token));
  const successes = results.filter((item) => item.ok);
  const failures = results.filter((item) => !item.ok);
  return {
    batch_token: body.batch_token,
    requested: requestedArticles.length,
    completed: successes.length,
    failed: failures.length,
    results,
    retry_article_ids: failures.map((item) => item.article_id),
    published_live_count: 0,
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorised(request)) return response.status(401).json({ ok: false, message: "Jasmin access key not recognised." });
  let body = {};
  try {
    body = parseBody(request);
    const supabase = getSupabase();
    let result;
    if (body.action === "prepareHistoricLinkBatch") result = await prepareHistoricBatch(supabase, body);
    else if (body.action === "applyHistoricLinkBatch") result = await applyHistoricBatch(supabase, body);
    else throw new ApiError(400, "Unsupported historic bulk-link action.");
    return response.status(200).json({ ok: true, action: body.action, ...result });
  } catch (error) {
    console.error("JASMIN HISTORIC BULK LINKS ERROR", { action: clean(body.action, 100), status: error.status || 500, message: clean(error.message, 500), details: error.details || null });
    return response.status(error.status || 500).json({ ok: false, message: error.status ? error.message : "Historic bulk-link request failed.", details: error.details || null, published: false });
  }
}

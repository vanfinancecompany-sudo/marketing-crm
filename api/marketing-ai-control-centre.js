import { createClient } from "@supabase/supabase-js";
import { buildAssistantMeasurementSummary } from "../lib/aiAssistantTelemetry.js";
import { buildVisibilitySummary } from "../lib/aiVisibility.js";
import { isDefaultActiveKnowledgeOpportunity, recommendedKnowledgeWorkflowAction } from "../lib/knowledgeOpportunityWorkflow.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const MAX_ROWS = 25000;
const PAGE_SIZE = 1000;
const MAX_BASELINE_REPORT_BYTES = 250000;
const clean = (value, limit = 1000) => String(value || "").trim().slice(0, limit);

function authorize(request, environment = process.env) {
  const expected = environment.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const header = request.headers?.[API_KEY_HEADER] || "";
  const authorization = request.headers?.authorization || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return Boolean(expected && (header === expected || bearer === expected));
}

function getSupabase(environment = process.env) {
  if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY) throw new Error("AI Control Centre storage is unavailable.");
  return createClient(environment.SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "object") return request.body;
  try { return JSON.parse(request.body); } catch { throw new Error("Request body is not valid JSON."); }
}

function requestedDays(request) {
  const raw = Number.parseInt(request.query?.days, 10);
  if (!Number.isInteger(raw)) return 28;
  return Math.min(90, Math.max(1, raw));
}

function missingTable(error, table) {
  const code = clean(error?.code, 40);
  const message = clean(error?.message, 1000).toLowerCase();
  return code === "42P01" || (message.includes(table.toLowerCase()) && message.includes("does not exist"));
}

function resultData(result, fallback) {
  if (result?.error) throw new Error(result.error.message || fallback);
  return Array.isArray(result?.data) ? result.data : [];
}

async function loadPagedRows(supabase, table, fields, options = {}) {
  const rows = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    let query = supabase.from(table).select(fields);
    if (options.since) query = query.gte(options.dateField || "created_at", options.since);
    if (options.orderField) query = query.order(options.orderField, { ascending: options.ascending === true });
    const result = await query.range(from, from + PAGE_SIZE - 1);
    if (result?.error) {
      if (options.optional && missingTable(result.error, table)) return [];
      throw result.error;
    }
    const page = Array.isArray(result?.data) ? result.data : [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function total(rows, field) {
  return rows.reduce((sum, item) => sum + Math.max(0, Number(item?.[field] || 0)), 0);
}

function latestEvidenceRefresh(rows) {
  return rows.map((item) => item.evidence_last_refreshed_at).filter(Boolean).sort().at(-1) || null;
}

function buildOpportunitySummary(rows = []) {
  const hydrated = rows.map((item) => ({ ...item, recommended_workflow_action: recommendedKnowledgeWorkflowAction(item) }));
  const active = hydrated.filter(isDefaultActiveKnowledgeOpportunity);
  const evidenceBacked = active.filter((item) => Boolean(
    item.evidence_last_refreshed_at
      && (Number(item.live_assistant_question_count || 0) || Number(item.hub_search_count || 0) || Number(item.gsc_impressions || 0)),
  ));
  return {
    new: hydrated.filter((item) => item.status === "new").length,
    high_priority: active.filter((item) => ["critical", "high"].includes(item.priority_level)).length,
    rent2buy: active.filter((item) => item.product === "rent2buy").length,
    finance: active.filter((item) => item.product === "finance").length,
    unanswered: active.filter((item) => Number(item.unanswered_count || 0) > 0).length,
    weak: active.filter((item) => Number(item.weak_answer_count || 0) > 0).length,
    conflicts: active.filter((item) => Number(item.conflict_count || 0) > 0).length,
    create_article: active.filter((item) => item.recommended_workflow_action === "create_article").length,
    review_later: hydrated.filter((item) => item.status === "review_later").length,
    draft_created: hydrated.filter((item) => item.status === "draft_created").length,
    resolved: hydrated.filter((item) => item.status === "resolved").length,
    evidence_backed: evidenceBacked.length,
    live_assistant_questions: total(active, "live_assistant_question_count"),
    live_assistant_gaps: total(active, "live_assistant_gap_count"),
    live_assistant_retrieval_misses: total(active, "live_assistant_retrieval_miss_count"),
    hub_searches: total(active, "hub_search_count"),
    hub_no_results: total(active, "hub_no_result_count"),
    gsc_impressions: Math.round(total(active, "gsc_impressions")),
    gsc_clicks: Math.round(total(active, "gsc_clicks")),
    evidence_last_refreshed_at: latestEvidenceRefresh(hydrated),
  };
}

function validIsoDate(value) {
  const parsed = new Date(value || 0);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export function normaliseHealthBaselineInput(body = {}, environment = process.env) {
  const mode = clean(body.mode, 30).toLowerCase();
  if (!["deterministic", "live"].includes(mode)) throw new Error("Baseline mode must be deterministic or live.");
  if (!body.report || typeof body.report !== "object" || Array.isArray(body.report)) throw new Error("A completed Assistant Health report is required.");

  let serialised;
  try { serialised = JSON.stringify(body.report); } catch { throw new Error("Assistant Health report is not valid JSON."); }
  if (Buffer.byteLength(serialised, "utf8") > MAX_BASELINE_REPORT_BYTES) throw new Error("Assistant Health report is too large to save as a baseline.");
  const report = JSON.parse(serialised);
  const reportMode = clean(report.mode, 30).toLowerCase();
  if (reportMode && reportMode !== mode) throw new Error("Baseline mode does not match the completed report.");

  const conversations = Number.parseInt(report.conversations, 10);
  const minimum = mode === "live" ? 50 : 1;
  const maximum = mode === "live" ? 100 : 10000;
  if (!Number.isInteger(conversations) || conversations < minimum || conversations > maximum) throw new Error("Baseline conversation count is outside the supported range.");

  const turns = Math.max(0, Number.parseInt(report.turns, 10) || 0);
  const score = Number(report.overall_ai_health_score);
  const validation = report.validation && typeof report.validation === "object" && !Array.isArray(report.validation) ? report.validation : {};
  const defaultName = `Baseline ${mode === "live" ? "Live" : "Deterministic"} · ${conversations.toLocaleString("en-GB")}`;
  return {
    name: clean(body.name, 160) || defaultName,
    mode,
    commit_sha: clean(environment.VERCEL_GIT_COMMIT_SHA, 100) || clean(report.commit, 100) || null,
    conversations,
    turns,
    overall_ai_health_score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null,
    report,
    validation,
    generated_at: validIsoDate(report.generated_at),
    created_by: "Marketing CRM administrator",
  };
}

async function loadHealthBaselines(supabase, { optional = false } = {}) {
  const result = await supabase.from("ai_assistant_health_baselines").select("*").order("created_at", { ascending: false }).limit(30);
  if (result?.error) {
    if (optional && missingTable(result.error, "ai_assistant_health_baselines")) return [];
    throw result.error;
  }
  return Array.isArray(result?.data) ? result.data : [];
}

async function saveHealthBaseline(supabase, body, environment) {
  const payload = normaliseHealthBaselineInput(body, environment);
  const result = await supabase.from("ai_assistant_health_baselines").insert(payload).select("*").single();
  if (result?.error) throw result.error;
  return result.data;
}

function baselinePayload(rows = []) {
  return {
    baselines: rows,
    latest: rows[0] || null,
    latest_by_mode: {
      deterministic: rows.find((item) => item.mode === "deterministic") || null,
      live: rows.find((item) => item.mode === "live") || null,
    },
  };
}

async function handleBaselineAction(request, response, supabase, environment) {
  const body = parseBody(request);
  if (body.action === "loadHealthBaselines") {
    return response.status(200).json({ ok: true, ...baselinePayload(await loadHealthBaselines(supabase, { optional: true })) });
  }
  if (body.action === "saveHealthBaseline") {
    const baseline = await saveHealthBaseline(supabase, body, environment);
    return response.status(200).json({ ok: true, baseline });
  }
  return response.status(400).json({ ok: false, message: "Unsupported AI Control Centre action." });
}

export async function handleAiControlCentreRequest(request, response, dependencies = {}) {
  const environment = dependencies.environment || process.env;
  response.setHeader?.("Cache-Control", "no-store, max-age=0");
  if (!authorize(request, environment)) return response.status(401).json({ error: "Unauthorized" });
  if (!["GET", "POST"].includes(request.method)) return response.status(405).json({ error: "Method not allowed" });

  try {
    const supabase = dependencies.supabase || getSupabase(environment);
    if (request.method === "POST") return await handleBaselineAction(request, response, supabase, environment);

    const days = requestedDays(request);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const [
      articleResult,
      visibilityResult,
      promptResult,
      settingResult,
      opportunityResult,
      assistantEvents,
      searchEvents,
      healthBaselines,
    ] = await Promise.all([
      supabase.from("knowledge_articles").select("*").limit(2000),
      loadPagedRows(supabase, "knowledge_visibility_results", "*", { orderField: "checked_at", optional: true }),
      supabase.from("knowledge_visibility_prompts").select("*").limit(10000),
      supabase.from("knowledge_visibility_settings").select("attention_days").eq("settings_key", "default").maybeSingle(),
      supabase.from("knowledge_assistant_opportunities").select("*").limit(5000),
      loadPagedRows(supabase, "ai_assistant_events", "event_type,visitor_hash,customer_session_id,page_type,product_context,conversation_intent,secondary_intents,retrieval_required,retrieval_performed,retrieval_used,knowledge_gap,knowledge_sources,cta_action_key,cta_label,message_number,response_mode,created_at", { since, orderField: "created_at", optional: true }),
      loadPagedRows(supabase, "knowledge_hub_search_events", "event_type,search_request_id,query_text,normalised_query,result_count,selected_article_id,selected_rank,category,created_at", { since, orderField: "created_at", optional: true }),
      loadHealthBaselines(supabase, { optional: true }),
    ]);

    const articles = resultData(articleResult, "Knowledge articles could not be loaded.");
    const prompts = resultData(promptResult, "Visibility prompts could not be loaded.");
    const opportunities = resultData(opportunityResult, "Knowledge opportunities could not be loaded.");
    if (settingResult?.error && !missingTable(settingResult.error, "knowledge_visibility_settings")) throw settingResult.error;
    const attentionDays = Number(settingResult?.data?.attention_days || 30);

    return response.status(200).json({
      generated_at: new Date().toISOString(),
      days,
      since,
      assistant: buildAssistantMeasurementSummary(assistantEvents, searchEvents),
      visibility: buildVisibilitySummary({ articles, results: visibilityResult, prompts, attentionDays }),
      opportunities: buildOpportunitySummary(opportunities),
      assistant_health_baseline: healthBaselines[0] || null,
      assistant_health_baselines_by_mode: baselinePayload(healthBaselines).latest_by_mode,
      rows_loaded: {
        assistant_events: assistantEvents.length,
        knowledge_hub_search_events: searchEvents.length,
        knowledge_articles: articles.length,
        visibility_results: visibilityResult.length,
        visibility_prompts: prompts.length,
        opportunities: opportunities.length,
        health_baselines: healthBaselines.length,
        capped: assistantEvents.length >= MAX_ROWS || searchEvents.length >= MAX_ROWS || visibilityResult.length >= MAX_ROWS,
      },
    });
  } catch (error) {
    console.error("MARKETING AI CONTROL CENTRE ERROR", { exception_type: error?.name || "Error", message: clean(error?.message, 500) });
    return response.status(500).json({ error: "AI Control Centre request could not be completed." });
  }
}

export default async function handler(request, response) {
  return handleAiControlCentreRequest(request, response);
}

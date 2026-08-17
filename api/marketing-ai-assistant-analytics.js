import { createClient } from "@supabase/supabase-js";
import { CUSTOMER_ANALYTICS_TRUSTED_SINCE, buildAssistantMeasurementSummary } from "../lib/aiAssistantTelemetry.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const PAGE_SIZE = 1000;
const MAX_ROWS = 25000;

function clean(value, limit = 1000) {
  return String(value || "").trim().slice(0, limit);
}

function authorize(request, environment = process.env) {
  const expected = environment.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const header = request.headers?.[API_KEY_HEADER] || "";
  const authorization = request.headers?.authorization || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return Boolean(expected && (header === expected || bearer === expected));
}

function getSupabase(environment = process.env) {
  if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Analytics storage is unavailable.");
  return createClient(environment.SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

function requestedDays(request) {
  const raw = Number.parseInt(request.query?.days, 10);
  if (!Number.isInteger(raw)) return 28;
  return Math.min(90, Math.max(1, raw));
}

function laterIso(first, second) {
  const firstMs = new Date(first || 0).getTime();
  const secondMs = new Date(second || 0).getTime();
  return new Date(Math.max(Number.isFinite(firstMs) ? firstMs : 0, Number.isFinite(secondMs) ? secondMs : 0)).toISOString();
}

function missingTable(error, table) {
  const code = clean(error?.code, 40);
  const message = clean(error?.message, 1000).toLowerCase();
  return code === "42P01" || message.includes(table.toLowerCase()) && message.includes("does not exist");
}

async function loadRows(supabase, table, fields, since) {
  const rows = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const result = await supabase
      .from(table)
      .select(fields)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (result?.error) {
      if (missingTable(result.error, table)) return [];
      throw result.error;
    }
    const page = Array.isArray(result?.data) ? result.data : [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadConversationCostRows(supabase, since) {
  const rows = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const result = await supabase
      .from("knowledge_competence_results")
      .select("model,conversation_diagnostics,simulation_session_id,created_at")
      .eq("mode", "conversation")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (result?.error) {
      if (missingTable(result.error, "knowledge_competence_results")) return [];
      throw result.error;
    }
    const page = Array.isArray(result?.data) ? result.data : [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

export function buildAssistantCostSummary(rows = []) {
  const modelCounts = new Map();
  let aiResponses = 0;
  let deterministicResponses = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedCostUsd = 0;
  let pricedAiResponses = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const diagnostics = row?.conversation_diagnostics && typeof row.conversation_diagnostics === "object"
      ? row.conversation_diagnostics
      : {};
    const model = clean(diagnostics?.model_route?.model || row?.model, 120) || "unknown";
    const tier = clean(diagnostics?.model_route?.tier, 40) || (model.startsWith("deterministic") ? "deterministic" : "unknown");
    const usage = diagnostics?.token_usage && typeof diagnostics.token_usage === "object" ? diagnostics.token_usage : {};
    const cost = Number(diagnostics?.estimated_cost_usd);
    const isAi = !model.startsWith("deterministic");

    if (isAi) aiResponses += 1;
    else deterministicResponses += 1;
    inputTokens += Math.max(0, Number(usage.input_tokens) || 0);
    outputTokens += Math.max(0, Number(usage.output_tokens) || 0);
    if (Number.isFinite(cost)) {
      estimatedCostUsd += Math.max(0, cost);
      if (isAi) pricedAiResponses += 1;
    }

    const key = `${tier}:${model}`;
    const current = modelCounts.get(key) || { tier, model, responses: 0, input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0 };
    current.responses += 1;
    current.input_tokens += Math.max(0, Number(usage.input_tokens) || 0);
    current.output_tokens += Math.max(0, Number(usage.output_tokens) || 0);
    if (Number.isFinite(cost)) current.estimated_cost_usd += Math.max(0, cost);
    modelCounts.set(key, current);
  }

  const models = [...modelCounts.values()]
    .map((item) => ({ ...item, estimated_cost_usd: Number(item.estimated_cost_usd.toFixed(6)) }))
    .sort((a, b) => b.responses - a.responses || a.model.localeCompare(b.model));
  const totalResponses = aiResponses + deterministicResponses;

  return {
    measured_conversation_responses: totalResponses,
    ai_generated_responses: aiResponses,
    deterministic_responses: deterministicResponses,
    mini_responses: models.filter((item) => item.tier === "mini").reduce((sum, item) => sum + item.responses, 0),
    full_responses: models.filter((item) => item.tier === "full").reduce((sum, item) => sum + item.responses, 0),
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    estimated_cost_usd: Number(estimatedCostUsd.toFixed(6)),
    average_cost_per_ai_response_usd: aiResponses && pricedAiResponses
      ? Number((estimatedCostUsd / aiResponses).toFixed(6))
      : null,
    pricing_coverage_rate: aiResponses ? Math.round((pricedAiResponses / aiResponses) * 1000) / 10 : 0,
    models,
  };
}

export async function handleMarketingAssistantAnalyticsRequest(request, response, dependencies = {}) {
  const environment = dependencies.environment || process.env;
  response.setHeader?.("Cache-Control", "no-store, max-age=0");
  if (!authorize(request, environment)) return response.status(401).json({ error: "Unauthorized" });
  if (request.method !== "GET") return response.status(405).json({ error: "Method not allowed" });

  try {
    const days = requestedDays(request);
    const requestedSince = new Date(Date.now() - days * 86_400_000).toISOString();
    const since = laterIso(requestedSince, CUSTOMER_ANALYTICS_TRUSTED_SINCE);
    const supabase = dependencies.supabase || getSupabase(environment);
    const [events, searchEvents, conversationCostRows] = await Promise.all([
      loadRows(
        supabase,
        "ai_assistant_events",
        "event_type,visitor_hash,customer_session_id,page_type,product_context,conversation_intent,retrieval_required,retrieval_performed,retrieval_used,knowledge_gap,knowledge_sources,cta_action_key,cta_label,message_number,response_mode,created_at",
        since,
      ),
      loadRows(
        supabase,
        "knowledge_hub_search_events",
        "event_type,search_request_id,visitor_hash,query_text,normalised_query,result_count,selected_article_id,selected_rank,category,created_at",
        since,
      ),
      loadConversationCostRows(supabase, since),
    ]);

    return response.status(200).json({
      generated_at: new Date().toISOString(),
      since,
      requested_days: days,
      customer_measurement_reset_at: CUSTOMER_ANALYTICS_TRUSTED_SINCE,
      rows_loaded: {
        assistant_events: events.length,
        knowledge_hub_search_events: searchEvents.length,
        conversation_cost_rows: conversationCostRows.length,
        capped: events.length >= MAX_ROWS || searchEvents.length >= MAX_ROWS || conversationCostRows.length >= MAX_ROWS,
      },
      summary: {
        ...buildAssistantMeasurementSummary(events, searchEvents),
        cost: buildAssistantCostSummary(conversationCostRows),
      },
    });
  } catch (error) {
    console.error("MARKETING AI ASSISTANT ANALYTICS ERROR", {
      exception_type: error?.name || "Error",
      message: clean(error?.message, 500),
    });
    return response.status(500).json({ error: "Could not load assistant analytics." });
  }
}

export default async function handler(request, response) {
  return handleMarketingAssistantAnalyticsRequest(request, response);
}

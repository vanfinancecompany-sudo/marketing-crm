import { createClient } from "@supabase/supabase-js";
import { buildAssistantMeasurementSummary } from "../lib/aiAssistantTelemetry.js";

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

export async function handleMarketingAssistantAnalyticsRequest(request, response, dependencies = {}) {
  const environment = dependencies.environment || process.env;
  response.setHeader?.("Cache-Control", "no-store, max-age=0");
  if (!authorize(request, environment)) return response.status(401).json({ error: "Unauthorized" });
  if (request.method !== "GET") return response.status(405).json({ error: "Method not allowed" });

  try {
    const days = requestedDays(request);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const supabase = dependencies.supabase || getSupabase(environment);
    const [events, searchEvents] = await Promise.all([
      loadRows(
        supabase,
        "ai_assistant_events",
        "event_type,visitor_hash,customer_session_id,page_type,product_context,conversation_intent,retrieval_required,retrieval_performed,retrieval_used,knowledge_gap,knowledge_sources,cta_action_key,cta_label,message_number,response_mode,created_at",
        since,
      ),
      loadRows(
        supabase,
        "knowledge_hub_search_events",
        "event_type,search_request_id,query_text,normalised_query,result_count,selected_article_id,selected_rank,category,created_at",
        since,
      ),
    ]);

    return response.status(200).json({
      generated_at: new Date().toISOString(),
      since,
      days,
      rows_loaded: {
        assistant_events: events.length,
        knowledge_hub_search_events: searchEvents.length,
        capped: events.length >= MAX_ROWS || searchEvents.length >= MAX_ROWS,
      },
      summary: buildAssistantMeasurementSummary(events, searchEvents),
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

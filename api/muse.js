// Meta Muse custom connector: read-only, aggregated/redacted Marketing CRM data.
// GET /api/muse/<resource> with header x-muse-api-key (or Bearer) = MUSE_API_KEY.
// GET /api/muse/openapi is public (description only, no data).
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { loadJasminMarketingSnapshot } from "./jasmin-readonly.js";
import { handleMarketingAssistantAnalyticsRequest } from "./marketing-ai-assistant-analytics.js";
import websiteAnalyticsSummary from "./website-analytics-summary.js";
import financeApplicationFunnel from "./finance-application-funnel.js";
import {
  RESOURCES, MUSE_KEY_HEADER, museAuthorised, rateLimited, scrubForMuse, containsPii, clampInt,
  buildStock, buildConversationVolumes, buildOpportunities, buildCampaigns, searchGapThemes,
} from "../lib/museConnector.js";
import { classifyLearningIntent } from "../lib/knowledgeLearningEngine.js";

const readJson = (relative) => JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8"));

function db(environment) {
  if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Data service is not configured.");
  return createClient(environment.SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

const rows = (result) => {
  if (result?.error) throw result.error;
  return result?.data || [];
};

// Runs an existing CRM handler in-process and returns its JSON body.
export async function callHandler(handler, request) {
  let status = 200;
  let body = null;
  const response = {
    statusCode: 200,
    setHeader() { return response; },
    status(code) { status = code; response.statusCode = code; return response; },
    json(payload) { body = payload; return response; },
    end(text) { if (text && body === null) { try { body = JSON.parse(text); } catch { body = null; } } status = response.statusCode; return response; },
  };
  await handler({ method: "GET", headers: {}, query: {}, ...request }, response);
  return status < 400 && body ? body : { available: false, message: body?.message || body?.error || "Unavailable." };
}

const loaders = {
  async overview({ supabase }) {
    const sections = ["contacts", "stock", "campaigns", "email", "content", "knowledge", "visibility", "vansco"];
    const snapshot = await loadJasminMarketingSnapshot({ requested: ["summary"], sections, q: "", limit: 12, detail: false }, { supabase });
    return { sections: snapshot.sections };
  },

  async stock({ supabase, query }) {
    const limit = clampInt(query.limit, 50, 1, 200);
    const term = String(query.q || "").replace(/[^\w\s.-]/g, "").trim().slice(0, 60);
    let finance = supabase.from("facebook_adverts").select("id,title,price,vat,salePrice,vanDescription,vanSpec,weblink").eq("is_active", true).order("id", { ascending: false }).limit(500);
    let rent = supabase.from("rent_vehicles").select("registration,created_at,monthly,week,initialRental,vanDescription,vanSpec,webLink").eq("is_active", true).order("created_at", { ascending: false }).limit(500);
    if (term) {
      finance = finance.or(`title.ilike.%${term}%,vanDescription.ilike.%${term}%,vanSpec.ilike.%${term}%`);
      rent = rent.or(`registration.ilike.%${term}%,vanDescription.ilike.%${term}%,vanSpec.ilike.%${term}%`);
    }
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const [f, r, v] = await Promise.all([finance, rent, supabase.from("vehicle_views").select("registration").gte("viewed_at", since).limit(10000)]);
    return buildStock({ finance: rows(f), rent2buy: rows(r), views: v?.error ? [] : rows(v), limit });
  },

  async "website-analytics"() {
    const [traffic, funnel] = await Promise.all([callHandler(websiteAnalyticsSummary), callHandler(financeApplicationFunnel)]);
    return { traffic, finance_application_funnel_today: funnel };
  },

  async "ask-me"({ supabase, query, environment }) {
    // Reuses the CRM's Ask Me analytics with a one-off internal key, so Muse
    // never needs (or sees) the CRM's own key.
    const nonce = `muse-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    const result = await callHandler(
      (req, res) => handleMarketingAssistantAnalyticsRequest(req, res, { supabase, environment: { ...environment, MARKETING_CUSTOMER_DATABASE_API_KEY: nonce } }),
      { headers: { "x-marketing-customer-database-key": nonce }, query: { days: String(clampInt(query.days, 28, 1, 90)) } },
    );
    // Search text is typed by customers: replace it with fixed themes.
    const search = result?.summary?.knowledge_hub_search;
    if (search) {
      search.no_result_themes = searchGapThemes(search.top_no_result_queries, (text) => classifyLearningIntent(text, "finance").key);
      delete search.top_no_result_queries;
    }
    return result;
  },

  async conversations({ supabase, query }) {
    const days = clampInt(query.days, 30, 1, 90);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const [events, sessions] = await Promise.all([
      supabase.from("conversation_events").select("source_id,channel,kind,occurred_at,product").gte("occurred_at", since).limit(10000),
      supabase.from("ai_customer_sessions").select("product_lock,message_count,last_activity_at").gte("last_activity_at", since).limit(10000),
    ]);
    return buildConversationVolumes({ events: events?.error ? [] : rows(events), sessions: sessions?.error ? [] : rows(sessions), days });
  },

  async opportunities({ supabase, query }) {
    let q = supabase.from("knowledge_assistant_opportunities")
      .select("product,normalised_intent,status,priority_level,priority_score,question_count,unanswered_count,weak_answer_count,first_seen_at,last_seen_at,recommended_action")
      .neq("status", "dismissed")
      .order("priority_score", { ascending: false })
      .limit(clampInt(query.limit, 200, 1, 500));
    if (["finance", "rent2buy"].includes(query.product)) q = q.eq("product", query.product);
    return buildOpportunities(rows(await q));
  },

  async campaigns({ supabase, query }) {
    const limit = clampInt(query.limit, 50, 1, 200);
    const c = rows(await supabase.from("marketing_campaigns")
      .select("id,name,description,channel,objective,status,tags,campaign_type,subject_line,created_at,updated_at")
      .order("updated_at", { ascending: false }).limit(limit));
    const ids = c.map((x) => x.id);
    const s = ids.length ? rows(await supabase.from("marketing_email_sends")
      .select("campaign_id,send_type,requested_count,eligible_count,suppressed_count,sent_count,failed_count,created_at,started_at,completed_at")
      .in("campaign_id", ids).limit(5000)) : [];
    return buildCampaigns({ campaigns: c, sends: s });
  },

  async capabilities() {
    const map = readJson("../docs/JASMIN_MARKETING_CRM_CAPABILITY_MAP_V1.json");
    return {
      system: "Marketing CRM (Van Finance Company and Rent2Buy Vans)",
      principles: map.principles,
      areas: (map.areas || []).map((a) => ({ id: a.id, label: a.label, purpose: a.purpose, can_report: a.read_now })),
      note: "Muse access is read-only. Muse can recommend; people in the CRM decide and act.",
    };
  },
};

export function createMuseHandler({ environment = process.env, supabase: injected } = {}) {
  return async function handler(request, response) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Robots-Tag", "noindex");
    const query = request.query || {};
    const resource = String(query.resource || "").toLowerCase();
    if (request.method === "OPTIONS") {
      response.setHeader("Allow", "GET, OPTIONS");
      return response.status(204).end();
    }
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      return response.status(405).json({ error: "Read-only: GET only." });
    }
    if (resource === "openapi") return response.status(200).json(readJson("../docs/muse-connector.openapi.json"));
    if (!museAuthorised(request, environment)) return response.status(401).json({ error: `Unauthorised. Send the Muse key in the ${MUSE_KEY_HEADER} header.` });
    const client = String(request.headers?.["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
    if (rateLimited(client)) {
      response.setHeader("Retry-After", "60");
      return response.status(429).json({ error: "Rate limit: 60 requests per minute." });
    }
    if (resource === "index" || resource === "") return response.status(200).json({ readOnly: true, resources: RESOURCES });
    const loader = loaders[resource];
    if (!loader) return response.status(404).json({ error: "Unknown resource.", resources: Object.keys(RESOURCES) });
    try {
      const supabase = injected || (resource === "website-analytics" || resource === "capabilities" ? null : db(environment));
      const data = scrubForMuse(await loader({ supabase, query, environment }));
      if (containsPii(data)) return response.status(500).json({ error: "Response withheld by privacy check." });
      return response.status(200).json({ resource, generatedAt: new Date().toISOString(), readOnly: true, data });
    } catch (error) {
      console.error("MUSE CONNECTOR ERROR", resource, String(error?.message || error).slice(0, 200));
      return response.status(500).json({ error: "Data could not be loaded." });
    }
  };
}

export default createMuseHandler();

import { createClient } from "@supabase/supabase-js";

const JASMIN_KEY_HEADER = "x-jasmin-marketing-key";
const ALLOWED_SECTIONS = new Set([
  "summary",
  "contacts",
  "stock",
  "campaigns",
  "email",
  "content",
  "knowledge",
  "visibility",
  "vansco",
  "all",
]);
const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 50;

function clean(value, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function clampLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(parsed)));
}

function configuredKey(environment = process.env) {
  return clean(environment.JASMIN_MARKETING_API_KEY, 10000);
}

function suppliedKey(request) {
  const headerValue = request?.headers?.[JASMIN_KEY_HEADER] || request?.headers?.[JASMIN_KEY_HEADER.toLowerCase()] || "";
  const authorization = clean(request?.headers?.authorization, 10000);
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return clean(headerValue || bearer, 10000);
}

export function isJasminMarketingAuthorised(request, environment = process.env) {
  const expected = configuredKey(environment);
  return Boolean(expected && suppliedKey(request) === expected);
}

function getSupabase() {
  const url = clean(process.env.SUPABASE_URL, 2000);
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY, 10000);
  if (!url || !key) throw new Error("Marketing CRM data service is not configured.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function requestQuery(request) {
  if (request?.query && typeof request.query === "object") return request.query;
  try {
    const parsed = new URL(request?.url || "/", "https://marketing-crm.local");
    return Object.fromEntries(parsed.searchParams.entries());
  } catch {
    return {};
  }
}

export function parseJasminMarketingRequest(request) {
  const query = requestQuery(request);
  const requested = clean(query.sections || query.section || "summary", 250)
    .split(",")
    .map((value) => clean(value, 40).toLowerCase())
    .filter(Boolean);
  const invalid = requested.filter((value) => !ALLOWED_SECTIONS.has(value));
  if (invalid.length) {
    const error = new Error(`Unsupported Marketing CRM section: ${invalid.join(", ")}.`);
    error.statusCode = 400;
    throw error;
  }
  const expanded = requested.includes("all") || requested.includes("summary")
    ? ["contacts", "stock", "campaigns", "email", "content", "knowledge", "visibility", "vansco"]
    : [...new Set(requested)];
  return {
    requested: requested.length ? requested : ["summary"],
    sections: expanded,
    q: clean(query.q, 120),
    limit: clampLimit(query.limit),
    detail: !requested.includes("summary") || Boolean(clean(query.q, 120)),
  };
}

function safeMessage(error) {
  const raw = clean(error?.message || error, 240);
  if (!raw) return "Section is unavailable.";
  if (/service role|api[_ -]?key|secret|token|credential/i.test(raw)) return "Section is unavailable because its data source is not configured.";
  return raw;
}

async function safeSection(name, loader) {
  try {
    return { available: true, ...(await loader()) };
  } catch (error) {
    return { available: false, section: name, message: safeMessage(error) };
  }
}

async function countRows(supabase, table, apply = (query) => query) {
  const result = await apply(supabase.from(table).select("id", { count: "exact", head: true }));
  if (result.error) throw result.error;
  return Number(result.count || 0);
}

function sum(rows, field) {
  return (rows || []).reduce((total, row) => total + Number(row?.[field] || 0), 0);
}

function groupCount(rows, field, fallback = "unknown") {
  return (rows || []).reduce((result, row) => {
    const key = clean(row?.[field], 80) || fallback;
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
}

function todayLondon() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function loadContacts(supabase, options) {
  const active = (query) => query.eq("lifecycle_status", "active").eq("marketing_status", "active");
  const [total, finance, rent2buy, both, unknown, emailReady, smsReady, facebookReady, suppressions] = await Promise.all([
    countRows(supabase, "marketing_contacts", active),
    countRows(supabase, "marketing_contacts", (query) => active(query).eq("pipeline", "finance")),
    countRows(supabase, "marketing_contacts", (query) => active(query).eq("pipeline", "rent2buy")),
    countRows(supabase, "marketing_contacts", (query) => active(query).eq("pipeline", "both")),
    countRows(supabase, "marketing_contacts", (query) => active(query).eq("pipeline", "unknown")),
    countRows(supabase, "marketing_contacts", (query) => active(query).eq("email_ready", true)),
    countRows(supabase, "marketing_contacts", (query) => active(query).eq("sms_ready", true)),
    countRows(supabase, "marketing_contacts", (query) => active(query).eq("facebook_ready", true)),
    countRows(supabase, "marketing_suppression_identities"),
  ]);

  const result = {
    counts: {
      active: total,
      by_pipeline: { finance, rent2buy, both, unknown },
      email_ready: emailReady,
      sms_ready: smsReady,
      facebook_ready: facebookReady,
      permanent_suppression_identities: suppressions,
    },
  };

  if (!options.detail) return result;
  let query = active(
    supabase
      .from("marketing_contacts")
      .select("customer_id,first_name,last_name,company,email,phone,postcode,pipeline,source,tags,email_ready,sms_ready,facebook_ready,duplicate_count,last_seen_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(options.limit)
  );
  if (options.q) {
    const term = options.q.replace(/[,%]/g, "");
    query = query.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,company.ilike.%${term}%,email.ilike.%${term}%,postcode.ilike.%${term}%`);
  }
  const rows = await query;
  if (rows.error) throw rows.error;
  result.contacts = rows.data || [];
  return result;
}

async function loadStock(supabase, options) {
  const [financeCount, rent2buyCount] = await Promise.all([
    countRows(supabase, "facebook_adverts", (query) => query.eq("is_active", true)),
    countRows(supabase, "rent_vehicles", (query) => query.eq("is_active", true)),
  ]);
  const carsTable = clean(process.env.CARS_STOCK_TABLE || process.env.VITE_CARS_STOCK_TABLE, 120);
  let cars = { configured: Boolean(carsTable), available: Boolean(carsTable), count: 0 };
  if (carsTable) {
    try {
      cars.count = await countRows(supabase, carsTable);
    } catch (error) {
      cars = { configured: true, available: false, count: 0, message: safeMessage(error) };
    }
  }

  const result = { counts: { finance: financeCount, rent2buy: rent2buyCount, cars } };
  if (!options.detail) return result;

  let financeQuery = supabase
    .from("facebook_adverts")
    .select("id,title,price,vat,salePrice,vanDescription,vanSpec,weblink,is_active")
    .eq("is_active", true)
    .order("id", { ascending: false })
    .limit(options.limit);
  let rentQuery = supabase
    .from("rent_vehicles")
    .select("id,created_at,registration,monthly,week,initialRental,vanDescription,vanSpec,webLink,is_active")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(options.limit);
  if (options.q) {
    const term = options.q.replace(/[,%]/g, "");
    financeQuery = financeQuery.or(`title.ilike.%${term}%,vanDescription.ilike.%${term}%,vanSpec.ilike.%${term}%`);
    rentQuery = rentQuery.or(`registration.ilike.%${term}%,vanDescription.ilike.%${term}%,vanSpec.ilike.%${term}%`);
  }
  const [financeRows, rentRows] = await Promise.all([financeQuery, rentQuery]);
  if (financeRows.error) throw financeRows.error;
  if (rentRows.error) throw rentRows.error;
  result.vehicles = {
    finance: financeRows.data || [],
    rent2buy: rentRows.data || [],
  };
  return result;
}

async function loadCampaigns(supabase, options) {
  const rows = await supabase
    .from("marketing_campaigns")
    .select("id,name,description,channel,objective,status,tags,campaign_type,template_name,subject_line,preview_text,created_at,updated_at,archived_at")
    .order("updated_at", { ascending: false })
    .limit(Math.max(options.limit, 30));
  if (rows.error) throw rows.error;
  const campaigns = rows.data || [];
  const result = {
    counts: {
      returned_window: campaigns.length,
      by_status: groupCount(campaigns, "status"),
      by_channel: groupCount(campaigns, "channel"),
      by_type: groupCount(campaigns, "campaign_type"),
    },
  };
  if (options.detail) result.campaigns = campaigns.slice(0, options.limit);
  return result;
}

async function loadEmail(supabase, options) {
  const rows = await supabase
    .from("marketing_email_sends")
    .select("id,campaign_id,send_type,status,provider,requested_count,eligible_count,suppressed_count,sent_count,failed_count,skipped_duplicate_count,created_at,started_at,completed_at,error_summary")
    .order("created_at", { ascending: false })
    .limit(Math.max(options.limit, 100));
  if (rows.error) throw rows.error;
  const sends = rows.data || [];
  const production = sends.filter((row) => row.send_type === "production");
  const tests = sends.filter((row) => row.send_type === "test");
  const result = {
    counts: {
      returned_window: sends.length,
      production_sends: production.length,
      test_sends: tests.length,
      production_requested: sum(production, "requested_count"),
      production_eligible: sum(production, "eligible_count"),
      production_suppressed: sum(production, "suppressed_count"),
      production_sent: sum(production, "sent_count"),
      production_failed: sum(production, "failed_count"),
      production_skipped_duplicate: sum(production, "skipped_duplicate_count"),
      by_status: groupCount(production, "status"),
      by_provider: groupCount(production, "provider"),
    },
  };
  if (options.detail) result.recent_sends = sends.slice(0, options.limit);
  return result;
}

async function loadContent(supabase, options) {
  const activityDate = todayLondon();
  const [events, creatives] = await Promise.all([
    supabase
      .from("marketing_daily_activity_events")
      .select("id,activity_date,activity_type,quantity,source,occurred_at")
      .eq("activity_date", activityDate)
      .order("occurred_at", { ascending: false })
      .limit(500),
    supabase
      .from("marketing_creatives")
      .select("id,created_at,status,template_type,hook_style,cta,destination_page,vehicle_id,vehicle_name,registration,pipeline")
      .order("created_at", { ascending: false })
      .limit(Math.max(options.limit, 100)),
  ]);
  if (events.error) throw events.error;
  if (creatives.error) throw creatives.error;
  const activity = events.data || [];
  const activityByType = {};
  for (const row of activity) {
    const type = clean(row.activity_type, 100) || "unknown";
    activityByType[type] = (activityByType[type] || 0) + Number(row.quantity || 1);
  }
  const creativeRows = creatives.data || [];
  const result = {
    activity_date: activityDate,
    counts: {
      daily_activity_by_type: activityByType,
      recent_creatives_window: creativeRows.length,
      creatives_by_pipeline: groupCount(creativeRows, "pipeline"),
      creatives_by_status: groupCount(creativeRows, "status"),
      creatives_by_destination: groupCount(creativeRows, "destination_page"),
    },
  };
  if (options.detail) result.recent_creatives = creativeRows.slice(0, options.limit);
  return result;
}

async function loadKnowledge(supabase, options) {
  const [topics, articles] = await Promise.all([
    supabase.from("knowledge_topics").select("id,status,category,updated_at").order("updated_at", { ascending: false }).limit(500),
    supabase
      .from("knowledge_articles")
      .select("id,title,slug,category,article_type,status,seo_title,live_wix_url,published_at,wix_sync_status,approved_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(Math.max(options.limit, 500)),
  ]);
  if (topics.error) throw topics.error;
  if (articles.error) throw articles.error;
  const topicRows = topics.data || [];
  const articleRows = articles.data || [];
  const result = {
    counts: {
      topics_window: topicRows.length,
      topics_by_status: groupCount(topicRows, "status"),
      articles_window: articleRows.length,
      articles_by_status: groupCount(articleRows, "status"),
      published_with_live_url: articleRows.filter((row) => Boolean(row.live_wix_url)).length,
    },
  };
  if (options.detail) result.recent_articles = articleRows.slice(0, options.limit);
  return result;
}

async function loadVisibility(supabase, options) {
  const [prompts, results, connections] = await Promise.all([
    supabase.from("knowledge_visibility_prompts").select("id,article_id,prompt_source,active,updated_at").order("updated_at", { ascending: false }).limit(1000),
    supabase
      .from("knowledge_visibility_results")
      .select("id,article_id,prompt_id,provider,result_status,checked_at,confidence,source_url,created_at")
      .order("checked_at", { ascending: false })
      .limit(Math.max(options.limit, 1000)),
    supabase.from("knowledge_visibility_provider_connections").select("provider,status,connection_type,last_checked_at,last_success_at,last_error,updated_at").order("provider"),
  ]);
  if (prompts.error) throw prompts.error;
  if (results.error) throw results.error;
  if (connections.error) throw connections.error;
  const promptRows = prompts.data || [];
  const resultRows = results.data || [];
  const connectionRows = connections.data || [];
  const result = {
    counts: {
      prompts: promptRows.length,
      active_prompts: promptRows.filter((row) => row.active).length,
      verified_results_window: resultRows.length,
      results_by_provider: groupCount(resultRows, "provider"),
      results_by_status: groupCount(resultRows, "result_status"),
    },
    provider_connections: connectionRows,
    truth_note: "Connection and evidence state are reported as stored. Missing/unconfigured providers must not be inferred as live.",
  };
  if (options.detail) result.recent_results = resultRows.slice(0, options.limit);
  return result;
}

async function loadVansco(supabase, options) {
  const rows = await supabase
    .from("vansco_stock_watch")
    .select("id,pipeline,vehicle_key,title,registration,source_status,match_status,workflow_status,last_checked_at,last_seen_at,updated_at")
    .order("updated_at", { ascending: false })
    .limit(Math.max(options.limit, 250));
  if (rows.error) throw rows.error;
  const stockWatch = rows.data || [];
  const result = {
    counts: {
      returned_window: stockWatch.length,
      by_pipeline: groupCount(stockWatch, "pipeline"),
      by_source_status: groupCount(stockWatch, "source_status"),
      by_match_status: groupCount(stockWatch, "match_status"),
      by_workflow_status: groupCount(stockWatch, "workflow_status"),
    },
    truth_note: "Vansco Stock Watch is a review/comparison workflow and does not itself prove live CRM stock was changed.",
  };
  if (options.detail) result.recent_items = stockWatch.slice(0, options.limit);
  return result;
}

const SECTION_LOADERS = {
  contacts: loadContacts,
  stock: loadStock,
  campaigns: loadCampaigns,
  email: loadEmail,
  content: loadContent,
  knowledge: loadKnowledge,
  visibility: loadVisibility,
  vansco: loadVansco,
};

export async function loadJasminMarketingSnapshot(options, dependencies = {}) {
  const supabase = dependencies.supabase || getSupabase();
  const sections = {};
  await Promise.all(options.sections.map(async (name) => {
    const loader = SECTION_LOADERS[name];
    if (!loader) return;
    sections[name] = await safeSection(name, () => loader(supabase, options));
  }));
  return {
    success: true,
    readOnly: true,
    system: "Marketing CRM",
    snapshotAt: new Date().toISOString(),
    requested: options.requested,
    q: options.q || "",
    limit: options.limit,
    sections,
    safeguards: {
      dedicatedKey: true,
      mutationsExposed: false,
      productionSendExposed: false,
      publishingExposed: false,
      secretsReturned: false,
    },
  };
}

function setCommonHeaders(response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", `Authorization, Content-Type, ${JASMIN_KEY_HEADER}`);
}

export function createJasminMarketingReadonlyHandler(dependencies = {}) {
  const loadSnapshot = dependencies.loadSnapshot || ((options) => loadJasminMarketingSnapshot(options, dependencies));
  const environment = dependencies.environment || process.env;
  return async function handler(request, response) {
    setCommonHeaders(response);
    if (request.method === "OPTIONS") {
      response.status(204).end();
      return;
    }
    if (request.method !== "GET") {
      response.status(405).json({ success: false, readOnly: true, message: "Method not allowed. Jasmin Marketing CRM access is read-only." });
      return;
    }
    if (!isJasminMarketingAuthorised(request, environment)) {
      response.status(401).json({ success: false, readOnly: true, message: "Jasmin Marketing CRM key not recognised." });
      return;
    }
    try {
      const options = parseJasminMarketingRequest(request);
      response.status(200).json(await loadSnapshot(options));
    } catch (error) {
      response.status(error?.statusCode || 500).json({
        success: false,
        readOnly: true,
        message: safeMessage(error),
      });
    }
  };
}

export default createJasminMarketingReadonlyHandler();

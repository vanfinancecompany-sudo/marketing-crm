import { randomUUID } from "node:crypto";
import { getSupabaseServiceAdmin, normalizeRegistration } from "./_vansco-cache-utils.js";
import { loadStockSourceSnapshot, providerReservedRegistrations, stockSourceProviderConfig } from "./_stock-source-provider.js";
import { buildStockWatchMonitorIssues, summariseMonitorHealth } from "./_stock-watch-monitor.js";

const FINANCE_WIX_SITE_ID = "85f11c52-ee54-495d-aaec-a351831709b5";
const RENT2BUY_AUTHORITY_COLLECTION = "ALLRENT2BUYVANS";
const FINANCE_AUTHORITY_COLLECTION = "VANFINANCE-ALLVANS";
const PAGE_SIZE = 100;
const MAX_ROWS = 2000;
const ACTION_LOG_HOURS = 24;
const API_KEY_HEADER = "x-marketing-customer-database-key";

function clean(value, limit = 5000) {
  return String(value ?? "").trim().slice(0, limit);
}

function extractRegistration(value) {
  const text = clean(value, 500).toUpperCase();
  const match = text.match(/\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/);
  return match ? normalizeRegistration(match[1]) : "";
}

function isAuthorised(request, environment = process.env) {
  const expected = clean(environment.MARKETING_CUSTOMER_DATABASE_API_KEY, 2000);
  const header = clean(request.headers?.[API_KEY_HEADER], 2000);
  const bearer = clean(request.headers?.authorization, 2200).replace(/^Bearer\s+/i, "");
  return Boolean(expected && (header === expected || bearer === expected));
}

function isCronRequest(request) {
  return clean(request.headers?.["x-vercel-cron"], 20) === "1";
}

function wixHeaders(environment = process.env) {
  const headers = { "Content-Type": "application/json", "wix-site-id": FINANCE_WIX_SITE_ID };
  const key = clean(environment.WIX_FINANCE_API_KEY || environment.WIX_API_KEY, 4000);
  if (key) headers.Authorization = key;
  return headers;
}

async function queryWixPublishedRegistrations(collectionId, environment = process.env, fetchImplementation = fetch) {
  const registrations = new Set();
  let scanned = 0;
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const response = await fetchImplementation("https://www.wixapis.com/wix-data/v2/items/query", {
      method: "POST",
      headers: wixHeaders(environment),
      body: JSON.stringify({ dataCollectionId: collectionId, query: { paging: { limit: PAGE_SIZE, offset } }, consistentRead: true }),
      cache: "no-store",
    });
    if (!response.ok) {
      const detail = clean(await response.text(), 800);
      throw new Error(`${collectionId} returned ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    const payload = await response.json();
    const page = Array.isArray(payload?.dataItems) ? payload.dataItems : [];
    scanned += page.length;
    for (const item of page) {
      const status = clean(item?.data?._publishStatus || item?._publishStatus, 50).toUpperCase();
      if (status && status !== "PUBLISHED") continue;
      const registration = normalizeRegistration(item?.data?.title || item?.data?.registration || item?.data?.reg || "");
      if (registration) registrations.add(registration);
    }
    if (page.length < PAGE_SIZE) break;
  }
  return { registrations: Array.from(registrations).sort(), count: registrations.size, scanned };
}

async function loadCrmCounts(supabase) {
  const [financeResult, rentResult] = await Promise.all([
    supabase.from("facebook_adverts").select("title,is_active").eq("is_active", true).limit(1000),
    supabase.from("rent_vehicles").select("registration,is_active").eq("is_active", true).limit(1000),
  ]);
  if (financeResult.error) throw new Error(`Finance CRM stock read failed: ${financeResult.error.message || financeResult.error}`);
  if (rentResult.error) throw new Error(`Rent2Buy CRM stock read failed: ${rentResult.error.message || rentResult.error}`);
  const financeRegs = new Set((financeResult.data || []).map((row) => extractRegistration(row.title)).filter(Boolean));
  const rentRegs = new Set((rentResult.data || []).map((row) => normalizeRegistration(row.registration)).filter(Boolean));
  return {
    financeRows: (financeResult.data || []).length,
    financeRegistrations: Array.from(financeRegs).sort(),
    rent2buyRows: (rentResult.data || []).length,
    rent2buyRegistrations: Array.from(rentRegs).sort(),
  };
}

async function loadRecentActionLogs(supabase, now) {
  const since = new Date(now.getTime() - ACTION_LOG_HOURS * 3_600_000).toISOString();
  const { data, error } = await supabase
    .from("stock_watch_action_logs")
    .select("trace_id,created_at,completed_at,pipeline,action,registration,authority,site_id,status,http_status,duration_ms,matched_records,changed_records,failure_count,error,result")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`Stock Watch action log read failed: ${error.message || error}`);
  return data || [];
}

async function loadPreviousRun(supabase) {
  const { data, error } = await supabase
    .from("stock_watch_monitor_runs")
    .select("id,completed_at,health,provider_id,snapshot")
    .eq("status", "complete")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Previous monitor run read failed: ${error.message || error}`);
  return data || null;
}

const DIAGNOSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["diagnoses"],
  properties: {
    diagnoses: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fingerprint", "diagnosis", "look_here_first", "safe_next_step"],
        properties: {
          fingerprint: { type: "string" },
          diagnosis: { type: "string" },
          look_here_first: { type: "string" },
          safe_next_step: { type: "string" },
        },
      },
    },
  },
};

async function requestAiDiagnosis(issues, snapshot, environment = process.env, fetchImplementation = fetch) {
  const apiKey = clean(environment.OPENAI_API_KEY, 4000);
  if (!apiKey || !issues.length) return { diagnoses: new Map(), model: null, usage: null, skipped: apiKey ? "no_issues" : "no_api_key" };
  const model = clean(environment.OPENAI_STOCK_WATCH_MONITOR_MODEL, 100) || "gpt-5.6-terra";
  const evidence = {
    provider: { id: snapshot.provider?.providerId, label: snapshot.provider?.providerLabel, refresh: snapshot.provider?.refresh },
    counts: snapshot.counts,
    authorities: snapshot.authorities,
    issues: issues.map((item) => ({
      fingerprint: item.fingerprint,
      severity: item.severity,
      code: item.code,
      pipeline: item.pipeline,
      registration: item.registration,
      title: item.title,
      evidence: item.evidence,
      deterministic_likely_cause: item.likelyCause,
      deterministic_look_here: item.lookHere,
      deterministic_directions: item.directions,
    })),
  };
  const response = await fetchImplementation("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: "You are the internal Stock Watch reliability engineer for a UK van dealer. Diagnose only from supplied evidence. Be concrete: identify the first exact route, table, collection, provider adapter, trace ID, or runtime log to inspect. Never recommend automatic CMS mutations, deletes, publishing, or broad record edits. Return concise diagnostic directions only.",
        },
        { role: "user", content: JSON.stringify(evidence) },
      ],
      text: { format: { type: "json_schema", name: "stock_watch_monitor_diagnosis", strict: true, schema: DIAGNOSIS_SCHEMA } },
    }),
  });
  let payload = null;
  try { payload = await response.json(); } catch { throw new Error(`Monitor AI returned non-JSON (${response.status}).`); }
  if (!response.ok) throw new Error(`Monitor AI request failed (${response.status}): ${clean(payload?.error?.message || "Unknown OpenAI error", 1000)}`);
  const output = payload.output_text || payload.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!output) throw new Error("Monitor AI returned no diagnosis text.");
  const parsed = JSON.parse(output);
  const diagnoses = new Map((parsed.diagnoses || []).map((item) => [clean(item.fingerprint, 300), item]));
  return {
    diagnoses,
    model,
    usage: {
      inputTokens: Number(payload?.usage?.input_tokens || 0),
      outputTokens: Number(payload?.usage?.output_tokens || 0),
    },
    skipped: null,
  };
}

async function persistIssues(supabase, runId, issues, aiResult, existingByFingerprint, now) {
  const currentFingerprints = new Set(issues.map((item) => item.fingerprint));
  const allOpen = Array.from(existingByFingerprint.values()).filter((row) => row.status === "open");
  const toResolve = allOpen.filter((row) => !currentFingerprints.has(row.fingerprint)).map((row) => row.fingerprint);
  if (toResolve.length) {
    const { error } = await supabase.from("stock_watch_monitor_issues").update({ status: "resolved", resolved_at: now.toISOString() }).in("fingerprint", toResolve);
    if (error) throw new Error(`Could not resolve old monitor issues: ${error.message || error}`);
  }

  for (const item of issues) {
    const previous = existingByFingerprint.get(item.fingerprint);
    const ai = aiResult?.diagnoses?.get(item.fingerprint);
    const payload = {
      fingerprint: item.fingerprint,
      first_seen_at: previous?.first_seen_at || now.toISOString(),
      last_seen_at: now.toISOString(),
      resolved_at: null,
      status: "open",
      occurrences: Number(previous?.occurrences || 0) + 1,
      pipeline: item.pipeline,
      severity: item.severity,
      code: item.code,
      title: item.title,
      evidence: item.evidence,
      likely_cause: item.likelyCause,
      look_here: ai?.look_here_first || item.lookHere,
      directions: item.directions,
      ai_diagnosis: ai?.diagnosis || previous?.ai_diagnosis || null,
      ai_model: ai ? aiResult.model : previous?.ai_model || null,
      ai_diagnosed_at: ai ? now.toISOString() : previous?.ai_diagnosed_at || null,
      last_run_id: runId,
    };
    const { error } = await supabase.from("stock_watch_monitor_issues").upsert(payload, { onConflict: "fingerprint" });
    if (error) throw new Error(`Could not persist monitor issue ${item.code}: ${error.message || error}`);
  }
}

async function loadExistingIssues(supabase) {
  const { data, error } = await supabase
    .from("stock_watch_monitor_issues")
    .select("fingerprint,first_seen_at,last_seen_at,status,occurrences,severity,ai_diagnosis,ai_model,ai_diagnosed_at")
    .order("last_seen_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`Monitor issue history read failed: ${error.message || error}`);
  return new Map((data || []).map((row) => [row.fingerprint, row]));
}

export async function runStockWatchMonitor({ environment = process.env, fetchImplementation = fetch, now = new Date() } = {}) {
  const supabase = getSupabaseServiceAdmin();
  const config = stockSourceProviderConfig(environment);
  const runId = randomUUID();
  const startedAt = now;
  const { error: startError } = await supabase.from("stock_watch_monitor_runs").insert({
    id: runId,
    started_at: startedAt.toISOString(),
    status: "running",
    health: "unknown",
    provider_id: config.id,
    provider_label: config.label,
    snapshot: {},
  });
  if (startError) throw new Error(`Could not start Stock Watch monitor run: ${startError.message || startError}`);

  try {
    let provider = null;
    let providerError = "";
    try { provider = await loadStockSourceSnapshot({ supabase, environment, fetchImplementation }); }
    catch (error) { providerError = clean(error?.message || error, 2000); }

    const [crmResult, rentWixResult, financeWixResult, actionLogResult, previousRunResult, existingIssuesResult] = await Promise.allSettled([
      loadCrmCounts(supabase),
      queryWixPublishedRegistrations(RENT2BUY_AUTHORITY_COLLECTION, environment, fetchImplementation),
      queryWixPublishedRegistrations(FINANCE_AUTHORITY_COLLECTION, environment, fetchImplementation),
      loadRecentActionLogs(supabase, now),
      loadPreviousRun(supabase),
      loadExistingIssues(supabase),
    ]);

    const crm = crmResult.status === "fulfilled" ? crmResult.value : { financeRows: 0, financeRegistrations: [], rent2buyRows: 0, rent2buyRegistrations: [] };
    const rentWix = rentWixResult.status === "fulfilled" ? rentWixResult.value : { registrations: [], count: 0, scanned: 0 };
    const financeWix = financeWixResult.status === "fulfilled" ? financeWixResult.value : { registrations: [], count: 0, scanned: 0 };
    const actionLogs = actionLogResult.status === "fulfilled" ? actionLogResult.value : [];
    const previousRun = previousRunResult.status === "fulfilled" ? previousRunResult.value : null;
    const existingByFingerprint = existingIssuesResult.status === "fulfilled" ? existingIssuesResult.value : new Map();

    const reserved = provider ? providerReservedRegistrations(provider) : new Set();
    const rentLiveSet = new Set(rentWix.registrations || []);
    const financeLiveSet = new Set(financeWix.registrations || []);
    const snapshot = {
      generatedAt: now.toISOString(),
      providerId: config.id,
      providerError: providerError || null,
      provider: provider || { providerId: config.id, providerLabel: config.label, vehicleCount: 0, vehicles: [], refresh: {} },
      authorities: {
        rent2buy: `VAN FINANCE Wix / ${RENT2BUY_AUTHORITY_COLLECTION}`,
        finance: `VAN FINANCE Wix / ${FINANCE_AUTHORITY_COLLECTION}`,
      },
      counts: {
        providerVehicles: Number(provider?.vehicleCount || 0),
        financeCrm: crm.financeRegistrations.length,
        rent2buyCrm: crm.rent2buyRegistrations.length,
        financeLive: financeWix.count || 0,
        rent2buyLive: rentWix.count || 0,
        financeReserved: Array.from(reserved).filter((reg) => financeLiveSet.has(reg)).length,
        rent2buyReserved: Array.from(reserved).filter((reg) => rentLiveSet.has(reg)).length,
        recentActionLogs: actionLogs.length,
      },
      registrations: {
        financeLive: financeWix.registrations || [],
        rent2buyLive: rentWix.registrations || [],
      },
      queries: {
        crm: crmResult.status === "fulfilled" ? { ok: true } : { ok: false, pipeline: "system", error: clean(crmResult.reason?.message || crmResult.reason) },
        rent2buy: rentWixResult.status === "fulfilled" ? { ok: true, pipeline: "rent2buy", siteId: FINANCE_WIX_SITE_ID, collectionId: RENT2BUY_AUTHORITY_COLLECTION, scanned: rentWix.scanned } : { ok: false, pipeline: "rent2buy", siteId: FINANCE_WIX_SITE_ID, collectionId: RENT2BUY_AUTHORITY_COLLECTION, error: clean(rentWixResult.reason?.message || rentWixResult.reason) },
        finance: financeWixResult.status === "fulfilled" ? { ok: true, pipeline: "finance", siteId: FINANCE_WIX_SITE_ID, collectionId: FINANCE_AUTHORITY_COLLECTION, scanned: financeWix.scanned } : { ok: false, pipeline: "finance", siteId: FINANCE_WIX_SITE_ID, collectionId: FINANCE_AUTHORITY_COLLECTION, error: clean(financeWixResult.reason?.message || financeWixResult.reason) },
        actionLogs: actionLogResult.status === "fulfilled" ? { ok: true } : { ok: false, pipeline: "system", error: clean(actionLogResult.reason?.message || actionLogResult.reason) },
      },
      switchReady: config.switchReady,
    };

    const issues = buildStockWatchMonitorIssues({ snapshot, previousSnapshot: previousRun?.snapshot || null, actionLogs, now });
    const health = summariseMonitorHealth(issues);

    const newSevere = issues.filter((item) => {
      if (!['warning', 'critical'].includes(item.severity)) return false;
      const existing = existingByFingerprint.get(item.fingerprint);
      return !existing?.ai_diagnosis || existing.severity !== item.severity;
    }).slice(0, 12);

    let aiResult = { diagnoses: new Map(), model: null, usage: null, skipped: "healthy_or_known" };
    let aiError = "";
    if (newSevere.length) {
      try { aiResult = await requestAiDiagnosis(newSevere, snapshot, environment, fetchImplementation); }
      catch (error) { aiError = clean(error?.message || error, 2000); }
    }

    await persistIssues(supabase, runId, issues, aiResult, existingByFingerprint, now);

    const completedAt = new Date();
    const storedSnapshot = { ...snapshot, aiError: aiError || null };
    const { error: finishError } = await supabase.from("stock_watch_monitor_runs").update({
      completed_at: completedAt.toISOString(),
      status: "complete",
      health: health.health,
      issue_count: health.issueCount,
      warning_count: health.warningCount,
      critical_count: health.criticalCount,
      ai_used: Boolean(aiResult.model),
      ai_model: aiResult.model,
      ai_input_tokens: aiResult.usage?.inputTokens || null,
      ai_output_tokens: aiResult.usage?.outputTokens || null,
      snapshot: storedSnapshot,
      error: aiError || null,
    }).eq("id", runId);
    if (finishError) throw new Error(`Could not finish monitor run: ${finishError.message || finishError}`);

    return {
      ok: true,
      runId,
      health: health.health,
      issueCount: health.issueCount,
      criticalCount: health.criticalCount,
      warningCount: health.warningCount,
      provider: { id: config.id, label: config.label, switchReady: config.switchReady },
      counts: snapshot.counts,
      issues,
      ai: { used: Boolean(aiResult.model), model: aiResult.model, error: aiError || null },
      completedAt: completedAt.toISOString(),
    };
  } catch (error) {
    const completedAt = new Date();
    await supabase.from("stock_watch_monitor_runs").update({
      completed_at: completedAt.toISOString(),
      status: "failed",
      health: "critical",
      critical_count: 1,
      issue_count: 1,
      error: clean(error?.message || error, 3000),
    }).eq("id", runId);
    throw error;
  }
}

export async function getStockWatchMonitorStatus() {
  const supabase = getSupabaseServiceAdmin();
  const [runResult, issueResult, logResult] = await Promise.all([
    supabase.from("stock_watch_monitor_runs").select("*").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("stock_watch_monitor_issues").select("*").eq("status", "open").order("last_seen_at", { ascending: false }).limit(25),
    supabase.from("stock_watch_action_logs").select("trace_id,created_at,completed_at,pipeline,action,registration,status,duration_ms,changed_records,failure_count,error").order("created_at", { ascending: false }).limit(15),
  ]);
  if (runResult.error) throw new Error(runResult.error.message || "Could not read latest monitor run.");
  if (issueResult.error) throw new Error(issueResult.error.message || "Could not read monitor issues.");
  if (logResult.error) throw new Error(logResult.error.message || "Could not read Stock Watch traces.");
  const run = runResult.data || null;
  return {
    ok: true,
    health: run?.health || "unknown",
    lastRun: run,
    issues: issueResult.data || [],
    recentActions: logResult.data || [],
    provider: run ? { id: run.provider_id, label: run.provider_label } : stockSourceProviderConfig(),
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  const cron = request.method === "GET" && isCronRequest(request);
  if (!cron && !isAuthorised(request)) return response.status(401).json({ ok: false, message: "Marketing CRM access is required." });

  try {
    if (cron) {
      const result = await runStockWatchMonitor();
      return response.status(200).json(result);
    }
    if (request.method === "GET") {
      const result = await getStockWatchMonitorStatus();
      return response.status(200).json(result);
    }
    if (request.method === "POST") {
      const action = clean(request.body?.action, 50).toLowerCase();
      if (action !== "run") return response.status(400).json({ ok: false, message: "Unknown monitor action." });
      const result = await runStockWatchMonitor();
      return response.status(200).json(result);
    }
    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  } catch (error) {
    console.error("STOCK WATCH MONITOR AGENT ERROR", { message: clean(error?.message || error, 2000), stack: clean(error?.stack, 5000) });
    return response.status(500).json({ ok: false, message: error?.message || "Stock Watch Monitor failed." });
  }
}

import { createClient } from "@supabase/supabase-js";
import connectionsHandler from "./marketing-ai-visibility-connections.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const clean = (value, limit = 5000) => String(value || "").trim().slice(0, limit);

function authorize(request) {
  const expected = clean(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY);
  return Boolean(expected && clean(request.headers?.[API_KEY_HEADER]) === expected);
}

function parseBody(request) {
  if (!request.body) return {};
  return typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body;
}

function getSupabase() {
  const url = clean(process.env.SUPABASE_URL, 2000);
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) throw new Error("Supabase is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function captureResponse() {
  const capture = { statusCode: 200, payload: null, headers: {} };
  return {
    capture,
    response: {
      setHeader(name, value) { capture.headers[name] = value; },
      status(code) { capture.statusCode = code; return this; },
      json(payload) { capture.payload = payload; return payload; },
    },
  };
}

function correctedGoogleState(row = {}) {
  const structured = row.structured_evidence && typeof row.structured_evidence === "object"
    ? row.structured_evidence
    : {};
  const impressions = Number(structured.impressions || 0);
  const clicks = Number(structured.clicks || 0);
  const inspectionError = clean(structured.inspection_error) || clean(row.error_details);
  if (inspectionError) {
    return {
      result_status: "error",
      error_details: inspectionError,
      evidence_excerpt: clean(row.evidence_excerpt) ||
        "Google check failed before a usable indexing verdict was returned.",
    };
  }
  if (impressions > 0 || clicks > 0) {
    return {
      result_status: "performance_found",
      error_details: "",
      evidence_excerpt: "Search Analytics performance data was found. A verified indexing verdict was not available.",
    };
  }
  return {
    result_status: "inconclusive",
    error_details: "",
    evidence_excerpt: "Google completed successfully but has not returned an indexing verdict or Search Analytics activity yet.",
  };
}

async function normalizeCompletedGoogleRows(supabase) {
  const { data, error } = await supabase
    .from("knowledge_visibility_results")
    .select("id,article_id,result_status,structured_evidence,response_metadata,error_details,evidence_excerpt")
    .eq("provider", "google_search_console")
    .in("result_status", ["not_checked", "inconclusive"])
    .eq("manually_verified", false);
  if (error) throw new Error(error.message || "Google result states could not be inspected.");
  const candidates = (data || []).filter((row) => row.response_metadata?.official_google_apis === true);
  const counts = { performance_found: 0, inconclusive: 0, error: 0 };
  for (const row of candidates) {
    const next = correctedGoogleState(row);
    const update = await supabase
      .from("knowledge_visibility_results")
      .update({
        ...next,
        error_details: clean(next.error_details),
        evidence_excerpt: clean(next.evidence_excerpt),
      })
      .eq("id", row.id);
    if (update.error) throw new Error(update.error.message || "Google result state could not be corrected.");
    counts[next.result_status] += 1;
  }
  if (candidates.length) {
    await supabase.from("knowledge_visibility_audit_events").insert({
      provider: "google_search_console",
      action: "google_result_state_normalized",
      reason: "Completed Google attempts were classified as performance found, pending or genuine technical failure.",
      details: {
        corrected_count: candidates.length,
        status_counts: counts,
        historical_rows_deleted: 0,
        customer_label_for_inconclusive: "Pending",
      },
    });
  }
  return { corrected: candidates.length, counts };
}

async function normalizationForAction(supabase, action) {
  if (action === "checkGoogle") {
    return {
      corrected: 0,
      counts: { performance_found: 0, inconclusive: 0, error: 0 },
      skipped: true,
    };
  }
  const normalization = await normalizeCompletedGoogleRows(supabase);
  return normalization;
}

function reconcileBulkSummary(summary = {}) {
  const results = (summary.results || []).map((item) => {
    if (item.result_status !== "inconclusive") return item;
    return {
      ...item,
      ok: true,
      customer_status: "pending",
      customer_label: "Pending",
      error: undefined,
      code: undefined,
    };
  });
  const successful = results.filter((item) => item.ok).length;
  const failed = results.length - successful;
  const status_counts = results.reduce((counts, item) => {
    const key = item.customer_status || item.result_status || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  return {
    ...summary,
    successful,
    failed,
    pending: status_counts.pending || 0,
    status_counts,
    results,
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorize(request)) return response.status(401).json({ ok: false, message: "Access key not recognised." });
  let body = {};
  try {
    body = parseBody(request);
    const supabase = getSupabase();
    const normalization = await normalizationForAction(supabase, body.action);
    const { capture, response: capturedResponse } = captureResponse();
    await connectionsHandler(request, capturedResponse);
    if (capture.statusCode >= 400 || capture.payload?.ok === false) {
      return response.status(capture.statusCode).json(capture.payload || { ok: false, message: "Google request failed." });
    }
    const payload = { ...capture.payload, google_state_normalization: normalization };
    if (body.action === "bulkGoogleCheck") {
      payload.summary = reconcileBulkSummary(payload.summary || {});
    }
    if (body.action === "checkGoogle" && payload.result?.result_status === "inconclusive") {
      payload.result = {
        ...payload.result,
        customer_status: "pending",
        customer_label: "Pending",
      };
      payload.message = "Google completed successfully. Indexing verdict pending.";
    }
    return response.status(200).json(payload);
  } catch (error) {
    console.error("AI VISIBILITY GOOGLE STATE ERROR", { action: body.action, message: error.message });
    return response.status(500).json({
      ok: false,
      code: "google_state_failure",
      message: "Google result state could not be reconciled.",
    });
  }
}

import { createClient } from "@supabase/supabase-js";
import { AI_PROVIDER_KEYS, DETECTION_STATUSES, isConfirmedPublishedArticle } from "../lib/aiVisibility.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const ALLOWED_STATUSES = new Set(["detected", "not_detected", "inconclusive"]);
const clean = (value, limit = 10000) => String(value || "").trim().slice(0, limit);

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function authorize(request) {
  const expected = clean(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY);
  return Boolean(expected && clean(request.headers?.[API_KEY_HEADER]) === expected);
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body);
    } catch {
      throw new ApiError(400, "The request body is not valid JSON.");
    }
  }
  return request.body;
}

function getSupabase() {
  const url = clean(process.env.SUPABASE_URL, 2000);
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) throw new ApiError(500, "Supabase is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function data(result, fallback) {
  if (result.error) throw new ApiError(500, result.error.message || fallback);
  return result.data;
}

function validate(entry) {
  const provider = clean(entry.provider, 80);
  const status = clean(entry.result_status, 40);
  const structured = entry.structured_evidence && typeof entry.structured_evidence === "object"
    ? entry.structured_evidence
    : {};
  if (!AI_PROVIDER_KEYS.has(provider)) throw new ApiError(400, "Manual AI evidence is only supported for AI visibility providers.");
  if (!ALLOWED_STATUSES.has(status)) throw new ApiError(400, "Choose Detected, Not detected or Inconclusive.");
  if (!clean(structured.query_used, 500)) throw new ApiError(400, "Record the public query used for this manual check.");
  if (status === "detected") {
    if (structured.detection_verified !== true) {
      throw new ApiError(400, "Detected may only be saved after the public result has been explicitly verified.");
    }
    if (!clean(entry.evidence_excerpt, 10000)) {
      throw new ApiError(400, "Detected results require a verified evidence excerpt or note.");
    }
  }
  return { provider, status, structured };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorize(request)) return response.status(401).json({ ok: false, message: "Access key not recognised." });

  try {
    const body = parseBody(request);
    if (body.action !== "recordManualEvidence") throw new ApiError(400, "Unsupported manual evidence action.");
    const entry = body.result && typeof body.result === "object" ? body.result : {};
    const { provider, status, structured } = validate(entry);
    const supabase = getSupabase();
    const article = data(
      await supabase.from("knowledge_articles").select("*").eq("id", clean(entry.article_id, 100)).single(),
      "Article could not be found.",
    );
    if (!isConfirmedPublishedArticle(article)) {
      throw new ApiError(400, "Only verified live Wix pages can receive visibility evidence.");
    }
    const checkedAt = new Date(entry.checked_at || "");
    if (Number.isNaN(checkedAt.getTime()) || checkedAt.getTime() > Date.now() + 60000) {
      throw new ApiError(400, "A valid check date is required and cannot be in the future.");
    }
    const sourceUrl = clean(entry.source_url, 2000) || null;
    if (sourceUrl) {
      const parsed = new URL(sourceUrl);
      if (parsed.protocol !== "https:") throw new ApiError(400, "Source URL must use HTTPS.");
    }
    const saved = data(
      await supabase.from("knowledge_visibility_results").insert({
        article_id: article.id,
        prompt_id: null,
        provider,
        checked_at: checkedAt.toISOString(),
        result_status: status,
        source_url: sourceUrl,
        evidence_excerpt: clean(entry.evidence_excerpt, 10000),
        structured_evidence: {
          ...structured,
          public_manual_check: true,
          ranking_position_supplied: false,
          automated_provider_call: false,
          scraping_used: false,
        },
        confidence: null,
        response_metadata: {
          entered_by: "administrator",
          public_provider_result: true,
          ranking_position_supplied: false,
          automated_provider_call: false,
          scraping_used: false,
        },
        notes: clean(entry.notes, 5000),
        verification_method: "manual",
        manually_verified: true,
      }).select().single(),
      "Verified manual evidence could not be saved.",
    );
    await supabase.from("knowledge_visibility_audit_events").insert({
      article_id: article.id,
      result_id: saved.id,
      provider,
      action: "manual_result_recorded",
      reason: "Administrator recorded a public manual visibility check.",
      details: {
        result_status: status,
        query_used: structured.query_used,
        manually_verified: true,
        automated_provider_call: false,
        scraping_used: false,
      },
    });
    return response.status(200).json({ ok: true, result: saved });
  } catch (error) {
    console.error("MANUAL AI VISIBILITY ERROR", { message: error.message });
    return response.status(error.status || 500).json({
      ok: false,
      message: error.status ? error.message : "Manual visibility evidence could not be saved.",
    });
  }
}

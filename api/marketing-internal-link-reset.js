import { createClient } from "@supabase/supabase-js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const clean = (value, limit = 5000) => String(value || "").trim().slice(0, limit);

class ApiError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function authorize(request) {
  const expected = clean(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY, 10000);
  const header = clean(request.headers?.[API_KEY_HEADER], 10000);
  const authorization = clean(request.headers?.authorization, 10000);
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return Boolean(expected && (header === expected || bearer === expected));
}

function getSupabase() {
  const url = clean(process.env.SUPABASE_URL, 2000);
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY, 10000);
  if (!url || !key) throw new ApiError(500, "Supabase is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body); } catch { throw new ApiError(400, "The request body is not valid JSON."); }
  }
  return request.body;
}

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorize(request)) return response.status(401).json({ ok: false, message: "Access key not recognised." });

  try {
    const body = parseBody(request);
    const articleId = clean(body.article_id, 100);
    if (!articleId) throw new ApiError(400, "Article id is required.");

    const supabase = getSupabase();
    const existing = await supabase
      .from("knowledge_internal_link_suggestions")
      .select("id,article_id,website_page_id,anchor_text,destination_url,status")
      .eq("article_id", articleId)
      .eq("status", "accepted");
    if (existing.error) throw new ApiError(500, existing.error.message || "Accepted links could not be loaded.");

    const suggestions = existing.data || [];
    if (!suggestions.length) {
      return response.status(200).json({ ok: true, reset_count: 0, remaining_accepted_count: 0, suggestions: [] });
    }

    const now = new Date().toISOString();
    const ids = suggestions.map((item) => item.id);
    const updated = await supabase
      .from("knowledge_internal_link_suggestions")
      .update({ status: "pending", decided_at: null, updated_at: now })
      .in("id", ids)
      .select("id,status,anchor_text,destination_url");
    if (updated.error) throw new ApiError(500, updated.error.message || "Accepted links could not be reset.");

    const verification = await supabase
      .from("knowledge_internal_link_suggestions")
      .select("id,anchor_text,destination_url,status")
      .eq("article_id", articleId)
      .eq("status", "accepted");
    if (verification.error) throw new ApiError(500, verification.error.message || "The reset could not be verified.");

    const remaining = verification.data || [];
    if (remaining.length) {
      throw new ApiError(409, "Accepted links were not fully reset. The Wix draft has not been retried.", {
        reset_count: updated.data?.length || 0,
        remaining_accepted_count: remaining.length,
        remaining_accepted_links: remaining,
      });
    }

    const events = suggestions.map((item) => ({
      suggestion_id: item.id,
      article_id: item.article_id,
      website_page_id: item.website_page_id,
      action: "reset_to_pending",
      reason: "Accepted internal link reset for fresh article review before Wix publishing.",
      details: {
        previous_status: "accepted",
        next_status: "pending",
        anchor_text: item.anchor_text,
        destination_url: item.destination_url,
        automatic_insertion: false,
      },
    }));
    const audit = await supabase.from("knowledge_internal_link_events").insert(events);
    if (audit.error) console.error("INTERNAL LINK RESET AUDIT ERROR", { article_id: articleId, message: audit.error.message });

    return response.status(200).json({
      ok: true,
      reset_count: updated.data?.length || suggestions.length,
      remaining_accepted_count: 0,
      suggestions: updated.data || [],
    });
  } catch (error) {
    console.error("INTERNAL LINK RESET ERROR", { status: error.status || 500, message: clean(error.message, 500), details: error.details || null });
    return response.status(error.status || 500).json({
      ok: false,
      message: error.message || "Accepted links could not be reset.",
      diagnostics: error.details || null,
    });
  }
}

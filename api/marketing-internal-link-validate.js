import { createClient } from "@supabase/supabase-js";
import { findInternalLinkAnchorMatches } from "../lib/internalLinkAnchorValidation.js";

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
    const suggestionId = clean(body.suggestion_id, 100);
    const anchorText = clean(body.anchor_text, 500);
    if (!suggestionId) throw new ApiError(400, "Suggestion id is required.");

    const supabase = getSupabase();
    const suggestionResult = await supabase
      .from("knowledge_internal_link_suggestions")
      .select("id,article_id,status,destination_url")
      .eq("id", suggestionId)
      .single();
    if (suggestionResult.error) throw new ApiError(404, suggestionResult.error.message || "Internal-link suggestion could not be found.");

    const articleResult = await supabase
      .from("knowledge_articles")
      .select("id,title,content_markdown,updated_at")
      .eq("id", suggestionResult.data.article_id)
      .single();
    if (articleResult.error) throw new ApiError(404, articleResult.error.message || "Article could not be found.");

    const validation = findInternalLinkAnchorMatches(articleResult.data.content_markdown, anchorText);
    const payload = {
      ...validation,
      article_id: articleResult.data.id,
      article_title: articleResult.data.title,
      article_updated_at: articleResult.data.updated_at,
      suggestion_id: suggestionId,
    };

    if (!validation.found) {
      throw new ApiError(
        409,
        `The words “${anchorText}” are not present in the current saved article. Choose wording shown as Found in article before applying the link.`,
        payload
      );
    }

    return response.status(200).json({ ok: true, validation: payload });
  } catch (error) {
    return response.status(error.status || 500).json({
      ok: false,
      message: error.message || "Internal-link anchor could not be validated.",
      validation: error.details || null,
    });
  }
}

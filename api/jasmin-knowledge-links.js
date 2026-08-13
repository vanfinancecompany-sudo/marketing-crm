import { createClient } from "@supabase/supabase-js";
import { findInternalLinkAnchorMatches } from "../lib/internalLinkAnchorValidation.js";
import { refreshArticleInternalLinks } from "../lib/internalLinkingService.js";

const JASMIN_KEY_HEADER = "x-jasmin-marketing-key";
const clean = (value, max = 20000) => String(value || "").trim().slice(0, max);

class ApiError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function authorised(request, environment = process.env) {
  const expected = clean(environment.JASMIN_MARKETING_API_KEY, 10000);
  const header = clean(
    request?.headers?.[JASMIN_KEY_HEADER] || request?.headers?.[JASMIN_KEY_HEADER.toLowerCase()],
    10000
  );
  const authorization = clean(request?.headers?.authorization, 10000);
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return Boolean(expected && (header === expected || bearer === expected));
}

function getSupabase() {
  const url = clean(process.env.SUPABASE_URL, 2000);
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY, 10000);
  if (!url || !key) throw new ApiError(500, "Marketing CRM data service is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
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

function resultData(result, fallback, status = 500) {
  if (result.error) throw new ApiError(status, result.error.message || fallback);
  return result.data;
}

async function getArticle(supabase, articleId) {
  const id = clean(articleId, 100);
  if (!id) throw new ApiError(400, "Article id is required.");
  return resultData(
    await supabase
      .from("knowledge_articles")
      .select("id,title,slug,status,content_markdown,updated_at,wix_sync_status")
      .eq("id", id)
      .single(),
    "Article could not be found.",
    404
  );
}

async function listSuggestions(supabase, articleId) {
  return resultData(
    await supabase
      .from("knowledge_internal_link_suggestions")
      .select("id,article_id,website_page_id,status,destination_title,destination_url,anchor_text,original_anchor_text,confidence_score,reason,context,source_content_hash,decided_at,created_at,updated_at")
      .eq("article_id", articleId)
      .neq("status", "superseded")
      .order("confidence_score", { ascending: false })
      .order("created_at", { ascending: true }),
    "Internal-link suggestions could not be loaded."
  ) || [];
}

export function prepareJasminLinkDecision({ suggestion = {}, articleMarkdown = "", decision = "", anchorText = "", now = new Date().toISOString() }) {
  const action = clean(decision, 40);
  const currentStatus = clean(suggestion.status, 40);

  if (action === "edit_anchor") {
    if (!["pending", "accepted"].includes(currentStatus)) {
      throw new ApiError(409, "This internal-link suggestion can no longer be edited.");
    }
  } else if (action === "reject") {
    if (!["pending", "accepted"].includes(currentStatus)) {
      throw new ApiError(409, "Only pending or accepted internal-link suggestions can be rejected.");
    }
  } else if (action !== "accept" || currentStatus !== "pending") {
    throw new ApiError(409, "Only pending internal-link suggestions can be accepted. Accepted suggestions may be edited or rejected when an editorial review retires the link.");
  }

  const requestedAnchor = clean(anchorText || suggestion.anchor_text, 500);
  if (requestedAnchor.length < 2) throw new ApiError(400, "Anchor text must contain at least two characters.");

  let validation = null;
  if (["accept", "edit_anchor"].includes(action)) {
    validation = findInternalLinkAnchorMatches(articleMarkdown, requestedAnchor);
    if (!validation.found) {
      throw new ApiError(
        409,
        `The words “${requestedAnchor}” are not present in the current saved article. Choose anchor wording that exists in the article before accepting the link.`,
        validation
      );
    }
  }

  const status = action === "accept" ? "accepted" : action === "reject" ? "rejected" : currentStatus;
  const eventAction = action === "accept" ? "accepted" : action === "reject" ? "rejected" : "anchor_edited";
  const decidedAt = action === "edit_anchor"
    ? suggestion.decided_at
    : ["accepted", "rejected"].includes(status) ? now : suggestion.decided_at;

  return {
    update: {
      anchor_text: requestedAnchor,
      status,
      decided_at: decidedAt,
      updated_at: now,
    },
    eventAction,
    validation,
    previousStatus: currentStatus,
    retiredAcceptedLink: action === "reject" && currentStatus === "accepted",
  };
}

async function loadArticleLinks(supabase, body) {
  const article = await getArticle(supabase, body.article_id);
  return { article, suggestions: await listSuggestions(supabase, article.id) };
}

async function refreshLinks(supabase, body) {
  const article = await getArticle(supabase, body.article_id);
  if (article.status === "archived") throw new ApiError(409, "Archived articles cannot receive fresh internal-link suggestions.");
  await refreshArticleInternalLinks(supabase, article.id, {
    reason: "Jasmin requested a fresh approved-destination match for editorial review.",
  });
  return { article, suggestions: await listSuggestions(supabase, article.id) };
}

async function decideLink(supabase, body) {
  const suggestionId = clean(body.suggestion_id, 100);
  if (!suggestionId) throw new ApiError(400, "Suggestion id is required.");

  const suggestion = resultData(
    await supabase
      .from("knowledge_internal_link_suggestions")
      .select("*")
      .eq("id", suggestionId)
      .single(),
    "Internal-link suggestion could not be found.",
    404
  );
  const article = await getArticle(supabase, suggestion.article_id);
  const prepared = prepareJasminLinkDecision({
    suggestion,
    articleMarkdown: article.content_markdown,
    decision: body.decision,
    anchorText: body.anchor_text,
  });

  const updated = resultData(
    await supabase
      .from("knowledge_internal_link_suggestions")
      .update(prepared.update)
      .eq("id", suggestion.id)
      .select()
      .single(),
    "Internal-link decision could not be saved."
  );

  resultData(
    await supabase.from("knowledge_internal_link_events").insert({
      suggestion_id: suggestion.id,
      article_id: suggestion.article_id,
      website_page_id: suggestion.website_page_id,
      action: prepared.eventAction,
      reason: clean(body.reason, 1000) || (prepared.retiredAcceptedLink
        ? "Jasmin rejected a previously accepted suggestion after a fresh editorial review retired the legacy link."
        : `Jasmin ${prepared.eventAction.replace("_", " ")} the suggestion after editorial instruction.`),
      details: {
        previous_status: prepared.previousStatus,
        status: updated.status,
        retired_accepted_link: prepared.retiredAcceptedLink,
        previous_anchor_text: suggestion.anchor_text,
        anchor_text: updated.anchor_text,
        destination_url: suggestion.destination_url,
        anchor_validation: prepared.validation,
        automatic_insertion: false,
        decided_via: "jasmin_knowledge_action",
      },
    }),
    "Internal-link audit history could not be saved."
  );

  return {
    article: {
      id: article.id,
      title: article.title,
      status: article.status,
      updated_at: article.updated_at,
    },
    suggestion: updated,
    validation: prepared.validation,
    previous_status: prepared.previousStatus,
    retired_accepted_link: prepared.retiredAcceptedLink,
    article_content_changed: false,
    wix_action_performed: false,
  };
}

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorised(request)) return response.status(401).json({ ok: false, message: "Jasmin access key not recognised." });

  let body = {};
  try {
    body = parseBody(request);
    const supabase = getSupabase();
    let data;
    switch (body.action) {
      case "loadArticleLinks":
        data = await loadArticleLinks(supabase, body);
        break;
      case "refreshArticleLinks":
        data = await refreshLinks(supabase, body);
        break;
      case "decideInternalLink":
        data = await decideLink(supabase, body);
        break;
      default:
        throw new ApiError(400, "Unsupported Jasmin internal-link action.");
    }
    return response.status(200).json({ ok: true, action: body.action, ...data });
  } catch (error) {
    console.error("JASMIN KNOWLEDGE LINKS ERROR", {
      action: clean(body.action, 100),
      article_id: clean(body.article_id, 100),
      suggestion_id: clean(body.suggestion_id, 100),
      status: error.status || 500,
      message: clean(error.message, 500),
    });
    return response.status(error.status || 500).json({
      ok: false,
      message: error.status ? error.message : "Jasmin internal-link request failed.",
      validation: error.details || null,
      wix_action_performed: false,
    });
  }
}

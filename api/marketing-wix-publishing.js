import { createClient } from "@supabase/supabase-js";
import {
  WixPublishingError,
  createOrUpdateWixDraft,
  wixPublishingConfiguration,
} from "../lib/wixPublishing.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const clean = (value, limit = 5000) => String(value || "").trim().slice(0, limit);

class ApiError extends Error {
  constructor(status, message, type = "api") {
    super(message);
    this.status = status;
    this.type = type;
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
  if (!url || !key) {
    throw new ApiError(500, "Supabase is not configured.", "configuration");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body);
    } catch {
      throw new ApiError(400, "The request body is not valid JSON.", "validation");
    }
  }
  return request.body;
}

function data(result, fallback) {
  if (result.error) throw new ApiError(500, result.error.message || fallback);
  return result.data;
}

async function recordSyncEvent(supabase, articleId, result) {
  const event = await supabase.from("knowledge_editorial_events").insert({
    event_type: "system",
    article_id: articleId,
    summary:
      result.operation === "created"
        ? "Wix CMS draft created for editorial review."
        : "Existing Wix CMS draft updated for editorial review.",
    details: {
      action: result.operation === "created" ? "wix_draft_created" : "wix_draft_updated",
      wix_item_id: result.itemId,
      wix_collection_id: result.collectionId,
      wix_sync_status: result.syncStatus,
      payload_version: result.payloadVersion,
      automatic_publication: false,
    },
  });
  if (event.error) {
    console.error("WIX EDITORIAL EVENT ERROR", {
      article_id: articleId,
      message: event.error.message,
    });
  }
}

export async function publishKnowledgeArticleToWix({
  supabase,
  articleId,
  environment = process.env,
  fetchImpl = fetch,
}) {
  if (!clean(articleId, 100)) {
    throw new ApiError(400, "Article id is required.", "validation");
  }
  const article = data(
    await supabase.from("knowledge_articles").select("*").eq("id", articleId).single(),
    "Article could not be found."
  );
  if (article.status !== "approved") {
    throw new ApiError(
      400,
      "Only approved Knowledge Hub articles can be sent to Wix.",
      "validation"
    );
  }
  const suggestions = data(
    await supabase
      .from("knowledge_internal_link_suggestions")
      .select("id,status,anchor_text,destination_url")
      .eq("article_id", article.id)
      .eq("status", "accepted"),
    "Accepted internal links could not be loaded."
  ) || [];
  const configuration = wixPublishingConfiguration(environment);
  const now = new Date().toISOString();
  data(
    await supabase
      .from("knowledge_articles")
      .update({ wix_sync_status: "pending", wix_last_error: "", updated_at: now })
      .eq("id", article.id),
    "Wix sync status could not be prepared."
  );
  try {
    const result = await createOrUpdateWixDraft({
      article,
      suggestions,
      configuration,
      fetchImpl,
    });
    const syncedAt = new Date().toISOString();
    const savedArticle = data(
      await supabase
        .from("knowledge_articles")
        .update({
          wix_item_id: result.itemId,
          wix_collection_id: result.collectionId,
          wix_draft_url: result.dashboardUrl,
          wix_sync_status: result.syncStatus,
          last_wix_sync_at: syncedAt,
          wix_payload_version: result.payloadVersion,
          wix_last_error: "",
          updated_at: syncedAt,
        })
        .eq("id", article.id)
        .select()
        .single(),
      "The Wix draft was created, but its CRM sync result could not be saved."
    );
    await recordSyncEvent(supabase, article.id, result);
    return {
      article: savedArticle,
      wix: {
        operation: result.operation,
        item_id: result.itemId,
        collection_id: result.collectionId,
        sync_status: result.syncStatus,
        synced_at: syncedAt,
        dashboard_url: result.dashboardUrl,
        content_status: "Draft",
        published: false,
      },
    };
  } catch (error) {
    const type = error.type || "api";
    const message = clean(error.message, 1000) || "Wix draft creation failed.";
    const failedAt = new Date().toISOString();
    const failed = await supabase
      .from("knowledge_articles")
      .update({
        wix_sync_status: "error",
        wix_last_error: message,
        last_wix_sync_at: failedAt,
        updated_at: failedAt,
      })
      .eq("id", article.id);
    if (failed.error) {
      console.error("WIX FAILURE STATUS ERROR", {
        article_id: article.id,
        message: failed.error.message,
      });
    }
    throw error;
  }
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }
  if (!authorize(request)) {
    return response.status(401).json({ ok: false, message: "Access key not recognised." });
  }
  let body = {};
  try {
    body = parseBody(request);
    if (body.action !== "createOrUpdateDraft") {
      throw new ApiError(400, "Unsupported Wix publishing action.", "validation");
    }
    const result = await publishKnowledgeArticleToWix({
      supabase: getSupabase(),
      articleId: body.article_id,
    });
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    const type = error.type || (error instanceof WixPublishingError ? error.type : "api");
    console.error("KNOWLEDGE WIX PUBLISHING ERROR", {
      action: clean(body.action, 100),
      article_id: clean(body.article_id, 100),
      type,
      status: error.details?.wix_status || error.status || 500,
      message: clean(error.message, 500),
    });
    return response.status(error.status || 500).json({
      ok: false,
      error_type: type,
      message: error.status || error instanceof WixPublishingError
        ? error.message
        : "Wix draft creation failed.",
    });
  }
}

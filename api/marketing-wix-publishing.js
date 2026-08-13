import { createClient } from "@supabase/supabase-js";
import { WixPublishingError, wixPublishingConfiguration } from "../lib/wixPublishing.js";
import "../lib/wixDraftPublishPluginSupport.js";
import { createOrUpdateKnowledgeRichContentDraft } from "../lib/wixKnowledgeRichContentPublishing.js";
import { evaluatePublishingSafety } from "../lib/publishingSafety.js";
import { londonDateKey } from "../lib/marketingDailyOperations.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const clean = (value, limit = 5000) => String(value || "").trim().slice(0, limit);
class ApiError extends Error { constructor(status, message, type = "api") { super(message); this.status = status; this.type = type; } }
function authorize(request) { const expected = clean(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY, 10000); const header = clean(request.headers?.[API_KEY_HEADER], 10000); const authorization = clean(request.headers?.authorization, 10000); const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : ""; return Boolean(expected && (header === expected || bearer === expected)); }
function getSupabase() { const url = clean(process.env.SUPABASE_URL, 2000); const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY, 10000); if (!url || !key) throw new ApiError(500, "Supabase is not configured.", "configuration"); return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }); }
function parseBody(request) { if (!request.body) return {}; if (typeof request.body === "string") { try { return JSON.parse(request.body); } catch { throw new ApiError(400, "The request body is not valid JSON.", "validation"); } } return request.body; }
function data(result, fallback) { if (result.error) throw new ApiError(500, result.error.message || fallback); return result.data; }

function linkDiagnosticMessage(error, article = {}) {
  const skipped = Array.isArray(error?.details?.suggestions_skipped) ? error.details.suggestions_skipped : [];
  if (!skipped.length) return clean(error?.message, 1000) || "Wix draft creation failed.";
  const reasonLabels = {
    anchor_text_not_found: "anchor text is not present in the current saved article",
    anchor_already_linked: "anchor text is already linked to a different URL",
    unsafe_or_malformed_url: "destination URL is unsafe or malformed",
    empty_anchor_text: "anchor text is empty",
  };
  const summary = skipped.slice(0, 5).map((item) => `“${clean(item.anchor_text, 160) || "(empty anchor)"}” — ${reasonLabels[item.reason] || clean(item.reason, 120) || "not inserted"}`).join("; ");
  const articleLabel = clean(article.title, 180) ? ` for “${clean(article.title, 180)}”` : "";
  return `Accepted link suggestions produced zero Wix LINK decorations${articleLabel}. Skipped: ${summary}. Reanalyse the current saved article, review the new suggestions, then retry the Wix draft.`;
}

async function recordSyncEvent(supabase, articleId, result) {
  const event = await supabase.from("knowledge_editorial_events").insert({
    event_type: "system",
    article_id: articleId,
    summary: result.recoveredMissingItem && result.operation === "created" ? "Missing Wix CMS draft was recreated for editorial review." : result.operation === "created" ? "Wix CMS draft created for editorial review." : "Existing Wix CMS draft updated for editorial review.",
    details: {
      action: result.operation === "created" ? "wix_draft_created" : "wix_draft_updated",
      wix_item_id: result.itemId,
      wix_collection_id: result.collectionId,
      wix_sync_status: result.syncStatus,
      payload_version: result.payloadVersion,
      content_field_type: result.contentFieldType,
      content_field_id: result.contentFieldId,
      accepted_suggestions_loaded: result.diagnostics?.accepted_suggestions_loaded || [],
      suggestions_successfully_inserted: result.diagnostics?.suggestions_successfully_inserted || [],
      suggestions_skipped: result.diagnostics?.suggestions_skipped || [],
      final_link_decoration_count: result.diagnostics?.final_link_decoration_count || 0,
      recovered_missing_item: result.recoveredMissingItem,
      replaced_wix_item_id: result.replacedItemId,
      table_conversion_warnings: result.tableConversionWarnings || [],
      automatic_publication: false,
    },
  });
  if (event.error) console.error("WIX EDITORIAL EVENT ERROR", { article_id: articleId, message: event.error.message });
}

async function recordKnowledgeActivity(supabase, article, result) {
  if (result.operation !== "created" || clean(article.wix_item_id)) return null;
  const payload = { activity_date: londonDateKey(), activity_type: "knowledge_hub_article", quantity: 1, source: "knowledge_hub_wix_draft", source_id: article.id, metadata: { article_id: article.id, article_title: article.title, wix_item_id: result.itemId, wix_sync_status: result.syncStatus, created_or_updated: "created" } };
  const existing = await supabase.from("marketing_daily_activity_events").select("id").eq("activity_type", payload.activity_type).eq("source", payload.source).eq("source_id", payload.source_id).limit(1).maybeSingle();
  if (existing.error) throw existing.error;
  if (!existing.data) { const inserted = await supabase.from("marketing_daily_activity_events").insert(payload); if (inserted.error) throw inserted.error; }
  return null;
}

export async function publishKnowledgeArticleToWix({ supabase, articleId, environment = process.env, fetchImpl = fetch }) {
  if (!clean(articleId, 100)) throw new ApiError(400, "Article id is required.", "validation");
  const article = data(await supabase.from("knowledge_articles").select("*").eq("id", articleId).single(), "Article could not be found.");
  if (article.status !== "approved") throw new ApiError(400, "Only approved Knowledge Hub articles can be sent to Wix.", "validation");

  const [suggestionsResult, assessmentResult, businessKnowledgeResult] = await Promise.all([
    supabase.from("knowledge_internal_link_suggestions").select("id,status,anchor_text,destination_url").eq("article_id", article.id).eq("status", "accepted"),
    supabase.from("knowledge_article_editorial_assessments").select("*").eq("article_id", article.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("knowledge_business_sections").select("section_key,content,entries,active").eq("active", true).order("sort_order", { ascending: true }),
  ]);
  const suggestions = data(suggestionsResult, "Accepted internal links could not be loaded.") || [];
  const assessment = data(assessmentResult, "Editorial assessment could not be loaded.");
  const businessKnowledge = data(businessKnowledgeResult, "Business Knowledge could not be loaded.") || [];
  const safety = evaluatePublishingSafety(article, { assessment, businessKnowledge });
  if (safety.hard_blocked) throw new ApiError(409, `Wix export is blocked. ${safety.hard_block_reasons.join(" ")}`, "validation");

  const configuration = wixPublishingConfiguration(environment);
  const now = new Date().toISOString();
  data(await supabase.from("knowledge_articles").update({ wix_sync_status: "pending", wix_last_error: "", updated_at: now }).eq("id", article.id), "Wix sync status could not be prepared.");

  try {
    const result = await createOrUpdateKnowledgeRichContentDraft({ article, suggestions, configuration, environment, fetchImpl });
    const syncedAt = new Date().toISOString();
    const savedArticle = data(await supabase.from("knowledge_articles").update({ wix_item_id: result.itemId, wix_collection_id: result.collectionId, wix_draft_url: result.dashboardUrl, wix_sync_status: result.syncStatus, last_wix_sync_at: syncedAt, wix_payload_version: result.payloadVersion, wix_last_error: "", updated_at: syncedAt }).eq("id", article.id).select().single(), "The Wix draft was created, but its CRM sync result could not be saved.");
    await recordSyncEvent(supabase, article.id, result);
    let contentOperationsWarning = "";
    try { await recordKnowledgeActivity(supabase, article, result); } catch (activityError) { contentOperationsWarning = "Wix draft created, but Content Operations could not be updated."; console.error("KNOWLEDGE CONTENT OPERATIONS ERROR", { article_id: article.id, message: activityError.message }); }
    return { article: savedArticle, content_operations_warning: contentOperationsWarning, diagnostics: result.diagnostics, wix: { operation: result.operation, item_id: result.itemId, collection_id: result.collectionId, sync_status: result.syncStatus, synced_at: syncedAt, dashboard_url: result.dashboardUrl, content_status: "Draft", content_field_type: result.contentFieldType, content_field_id: result.contentFieldId, final_link_decoration_count: result.diagnostics?.final_link_decoration_count || 0, recovered_missing_item: result.recoveredMissingItem, replaced_item_id: result.replacedItemId, table_conversion_warnings: result.tableConversionWarnings || [], published: false } };
  } catch (error) {
    const type = error.type || "api";
    const message = linkDiagnosticMessage(error, article);
    const failedAt = new Date().toISOString();
    const clearStoredItemId = error.details?.clear_stored_item_id === true;
    const diagnostics = { ...(error.details || {}), article_id: clean(article.id, 200), article_title: clean(article.title, 500) };
    const failed = await supabase.from("knowledge_articles").update({ ...(clearStoredItemId ? { wix_item_id: null, wix_draft_url: null } : {}), wix_sync_status: "error", wix_last_error: clearStoredItemId ? `The previous Wix item no longer exists and its stored link was cleared. ${message}` : message, last_wix_sync_at: failedAt, updated_at: failedAt }).eq("id", article.id);
    if (failed.error) console.error("WIX FAILURE STATUS ERROR", { article_id: article.id, message: failed.error.message });
    if (clearStoredItemId) throw new WixPublishingError(type, `The previous Wix item no longer exists and its stored link was cleared. ${message} Retry to create a new Wix draft.`, error.status || 409, { ...diagnostics, wix_error_code: "WDE0073", stored_item_cleared: true });
    throw new WixPublishingError(type, message, error.status || 500, diagnostics);
  }
}

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorize(request)) return response.status(401).json({ ok: false, message: "Access key not recognised." });
  let body = {};
  try {
    body = parseBody(request);
    if (body.action !== "createOrUpdateDraft") throw new ApiError(400, "Unsupported Wix publishing action.", "validation");
    const result = await publishKnowledgeArticleToWix({ supabase: getSupabase(), articleId: body.article_id });
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    const type = error.type || (error instanceof WixPublishingError ? error.type : "api");
    console.error("KNOWLEDGE WIX PUBLISHING ERROR", { action: clean(body.action, 100), article_id: clean(body.article_id, 100), type, status: error.details?.wix_status || error.status || 500, message: clean(error.message, 500), diagnostics: error.details || null });
    return response.status(error.status || 500).json({ ok: false, error_type: type, message: error.status || error instanceof WixPublishingError ? error.message : "Wix draft creation failed.", diagnostics: error.details || null });
  }
}

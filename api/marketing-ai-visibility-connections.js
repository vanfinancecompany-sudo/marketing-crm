import { createClient } from "@supabase/supabase-js";
import { wixPublishingConfiguration } from "../lib/wixPublishing.js";
import {
  aggregateSearchAnalytics,
  buildWixSyncPlan,
  googleEvidenceStatus,
  wixItemData,
  wixItemId,
  wixItemLiveUrl,
  wixItemSlug,
  wixPublishedTimestamp,
} from "../lib/aiVisibilityLiveConnections.js";
import {
  articleIsPresentInLiveSet,
  isWixKnowledgeManagedArticle,
  lifecycleSummary,
  stableWixIdentityForItem,
  wasInactiveWixArticle,
} from "../lib/aiVisibilityWixLifecycle.js";
import { isConfirmedPublishedArticle } from "../lib/aiVisibility.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const clean = (value, limit = 10000) => String(value || "").trim().slice(0, limit);

class ApiError extends Error {
  constructor(status, message, code = "provider_request_failed") {
    super(message);
    this.status = status;
    this.code = code;
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
      throw new ApiError(400, "The request body is not valid JSON.", "validation");
    }
  }
  return request.body;
}

function getSupabase() {
  const url = clean(process.env.SUPABASE_URL, 2000);
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) throw new ApiError(500, "Supabase is not configured.", "configuration");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function data(result, fallback) {
  if (result.error) throw new ApiError(500, result.error.message || fallback, "database_failure");
  return result.data;
}

class WixLiveReader {
  constructor(configuration, fetchImpl = fetch) {
    this.configuration = configuration;
    this.fetchImpl = fetchImpl;
  }

  async request(path, body) {
    let response;
    try {
      response = await this.fetchImpl(`${this.configuration.apiBaseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: this.configuration.apiKey,
          "wix-site-id": this.configuration.siteId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ApiError(502, "Wix connection unavailable.", "wix_connection_unavailable");
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new ApiError(
          502,
          "Wix permission denied. The existing API key needs Wix Data: Read Data Items access for this site.",
          "permission_denied",
        );
      }
      throw new ApiError(response.status, payload.message || "Wix provider request failed.");
    }
    return payload;
  }

  async listLiveItems() {
    const items = [];
    for (let offset = 0; ; offset += 100) {
      const payload = await this.request("/wix-data/v2/items/query", {
        dataCollectionId: this.configuration.collectionId,
        environment: "LIVE",
        query: { paging: { limit: 100, offset } },
        consistentRead: true,
      });
      if (!Array.isArray(payload.dataItems)) {
        throw new ApiError(
          502,
          "Wix returned an invalid LIVE collection response. Existing records were not deactivated.",
          "wix_invalid_response",
        );
      }
      const page = payload.dataItems;
      items.push(...page);
      if (page.length < 100) return items;
    }
  }
}

function validHttpsUrl(value) {
  const raw = clean(value, 2000);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

async function saveWixMatch(supabase, article, item, matchedBy) {
  const now = new Date().toISOString();
  const itemData = wixItemData(item);
  const liveUrl = validHttpsUrl(wixItemLiveUrl(item)) || validHttpsUrl(article.live_wix_url);
  if (!liveUrl) {
    return { saved: false, error: "Live URL unavailable.", article_id: article.id };
  }
  const publishedAt = wixPublishedTimestamp(item) || article.published_at || now;
  const reactivated = wasInactiveWixArticle(article);
  const changes = {
    wix_item_id: wixItemId(item),
    wix_collection_id: clean(article.wix_collection_id) || clean(process.env.WIX_KNOWLEDGE_COLLECTION_ID),
    live_wix_url: liveUrl,
    wix_sync_status: "live",
    wix_publication_status: "live",
    is_active: true,
    unpublished_at: null,
    published_at: new Date(publishedAt).toISOString(),
    publication_verified_at: now,
    last_wix_verification_at: now,
    last_wix_sync_at: now,
    publication_verification_notes: `Verified from Wix LIVE collection by ${matchedBy}.`,
    updated_at: now,
  };
  const saved = data(
    await supabase.from("knowledge_articles").update(changes).eq("id", article.id).select().single(),
    "Wix publication data could not be saved.",
  );
  await supabase.from("knowledge_visibility_audit_events").insert({
    article_id: article.id,
    action: reactivated ? "publication_reactivated" : "publication_updated",
    reason: reactivated
      ? "Previously inactive Wix Knowledge Hub article was found in the LIVE collection again."
      : "Live Wix publication verified from the existing Wix Data integration.",
    details: {
      matched_by: matchedBy,
      wix_item_id: wixItemId(item),
      live_url: liveUrl,
      wix_title: clean(itemData.title),
      wix_slug: wixItemSlug(item),
      manually_verified: false,
      reactivated,
    },
  });
  return { saved: true, article: saved, reactivated };
}

async function deactivateMissingWixArticles(supabase, articles, liveItems, configuration) {
  const liveIdentities = liveItems.map((item) =>
    stableWixIdentityForItem(item, {
      itemId: wixItemId,
      liveUrl: wixItemLiveUrl,
      slug: wixItemSlug,
    }),
  );
  const candidates = articles.filter(
    (article) =>
      isWixKnowledgeManagedArticle(article, configuration.collectionId) &&
      !articleIsPresentInLiveSet(article, liveIdentities) &&
      (article.is_active !== false ||
        article.wix_sync_status === "live" ||
        article.wix_sync_status === "synced" ||
        article.wix_publication_status === "live"),
  );

  let deactivated = 0;
  const errors = [];
  for (const article of candidates) {
    const now = new Date().toISOString();
    try {
      data(
        await supabase
          .from("knowledge_articles")
          .update({
            is_active: false,
            wix_sync_status: "not_live",
            wix_publication_status: "not_live",
            unpublished_at: now,
            publication_verified_at: null,
            last_wix_verification_at: now,
            last_wix_sync_at: now,
            publication_verification_notes:
              "No matching stable Wix item ID, canonical URL or slug was present in the successful Wix LIVE collection fetch.",
            updated_at: now,
          })
          .eq("id", article.id)
          .select()
          .single(),
        "Inactive Wix publication state could not be saved.",
      );
      await supabase.from("knowledge_visibility_audit_events").insert({
        article_id: article.id,
        action: "publication_deactivated",
        reason: "Article was no longer present in the successfully fetched Wix Knowledge Hub LIVE collection.",
        details: {
          wix_item_id: clean(article.wix_item_id),
          live_url: clean(article.live_wix_url),
          slug: clean(article.slug),
          historical_visibility_results_preserved: true,
        },
      });
      deactivated += 1;
    } catch (error) {
      errors.push({
        article_id: article.id,
        article_title: article.title,
        wix_item_id: article.wix_item_id,
        slug: article.slug,
        error: error.message,
      });
    }
  }
  return { deactivated, errors };
}

async function syncLiveWixArticles(supabase) {
  const configuration = wixPublishingConfiguration(process.env);
  const articles = data(
    await supabase.from("knowledge_articles").select("*").order("updated_at", { ascending: false }),
    "Knowledge Hub articles could not be loaded.",
  );

  // Deactivation is deliberately impossible until this complete LIVE fetch succeeds.
  const liveItems = await new WixLiveReader(configuration).listLiveItems();
  const plan = buildWixSyncPlan({ articles, liveItems });
  let added = 0;
  let updated = 0;
  let active = 0;
  let reactivated = 0;
  const errors = [];
  for (const match of plan.matches) {
    try {
      const wasPublished = isConfirmedPublishedArticle(match.article);
      const result = await saveWixMatch(supabase, match.article, match.item, match.matched_by);
      if (!result.saved) errors.push(result);
      else {
        active += 1;
        if (result.reactivated) reactivated += 1;
        else if (wasPublished) updated += 1;
        else added += 1;
      }
    } catch (error) {
      errors.push({ article_id: match.article.id, error: error.message });
    }
  }

  const deactivation = await deactivateMissingWixArticles(
    supabase,
    articles,
    liveItems,
    configuration,
  );
  errors.push(...deactivation.errors);

  return {
    wix_items_checked: liveItems.length,
    wix_live_items_matched: plan.matches.length,
    live_articles_matched: plan.matches.length,
    published_pages_verified_and_saved: active,
    active_records_updated: active,
    previously_live_records_deactivated: deactivation.deactivated,
    reactivated_records: reactivated,
    items_missing_usable_live_url: errors.filter((item) => item.error === "Live URL unavailable.").length,
    new_published_pages_added: added,
    existing_records_updated: updated,
    drafts_ignored: Math.max(0, articles.filter((article) => article.wix_item_id).length - plan.matches.length),
    unmatched_crm_articles: plan.unmatched_articles,
    unmatched_wix_items: plan.unmatched_wix_items,
    ambiguous_matches: plan.ambiguous,
    ...lifecycleSummary({ active, deactivated: deactivation.deactivated, reactivated, errors }),
  };
}

function googleConfiguration() {
  const clientId = clean(process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID);
  const clientSecret = clean(process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET);
  const refreshToken = clean(process.env.GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN);
  const siteUrl = clean(process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL, 2000);
  const missing = [
    !clientId && "GOOGLE_SEARCH_CONSOLE_CLIENT_ID",
    !clientSecret && "GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET",
    !refreshToken && "GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN",
    !siteUrl && "GOOGLE_SEARCH_CONSOLE_SITE_URL",
  ].filter(Boolean);
  return { clientId, clientSecret, refreshToken, siteUrl, missing };
}

async function googleAccessToken(configuration, fetchImpl = fetch) {
  const response = await fetchImpl("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
      refresh_token: configuration.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new ApiError(502, payload.error_description || "Google account not connected.", "google_not_connected");
  }
  return payload.access_token;
}

async function googleRequest(url, token, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.error?.message || "Google provider request failed.";
    const lower = message.toLowerCase();
    const code = lower.includes("quota") ? "quota_exceeded" : lower.includes("permission") ? "permission_denied" : "provider_request_failed";
    throw new ApiError(response.status, message, code);
  }
  return payload;
}

function dateRange() {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 27);
  return { start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10) };
}

async function fetchGoogleEvidence(configuration, pageUrl, fetchImpl = fetch) {
  const token = await googleAccessToken(configuration, fetchImpl);
  const range = dateRange();
  const analytics = await googleRequest(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(configuration.siteUrl)}/searchAnalytics/query`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        startDate: range.start_date,
        endDate: range.end_date,
        dimensions: ["query"],
        dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "equals", expression: pageUrl }] }],
        rowLimit: 25,
      }),
    },
    fetchImpl,
  );
  const performance = aggregateSearchAnalytics(analytics.rows || []);
  let inspection = null;
  let inspectionError = "";
  try {
    inspection = await googleRequest(
      "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
      token,
      {
        method: "POST",
        body: JSON.stringify({ inspectionUrl: pageUrl, siteUrl: configuration.siteUrl }),
      },
      fetchImpl,
    );
  } catch (error) {
    inspectionError = error.message;
  }
  return { range, performance, inspection, inspection_error: inspectionError };
}

async function upsertGoogleConnection(supabase, configuration, updates = {}) {
  const now = new Date().toISOString();
  const payload = {
    provider: "google_search_console",
    connection_status: updates.connection_status || (configuration.missing.length ? "configuration_required" : "connected"),
    configuration_summary: configuration.missing.length
      ? `Missing secure server configuration: ${configuration.missing.join(", ")}.`
      : `Connected to ${configuration.siteUrl}. Tokens are held in server environment variables.`,
    connection_metadata: { site_url: configuration.siteUrl || null, token_storage: "server_environment" },
    last_successful_check_at: updates.last_successful_check_at || null,
    last_error_at: updates.last_error ? now : null,
    last_error: updates.last_error || "",
    updated_at: now,
  };
  return data(
    await supabase.from("knowledge_visibility_provider_connections").upsert(payload).select().single(),
    "Google connection state could not be saved.",
  );
}

async function checkGoogleForArticle(supabase, articleId, executionId) {
  const article = data(
    await supabase.from("knowledge_articles").select("*").eq("id", articleId).single(),
    "Article could not be found.",
  );
  if (!isConfirmedPublishedArticle(article)) throw new ApiError(400, "Only verified live Wix pages can be checked.", "validation");
  const configuration = googleConfiguration();
  if (configuration.missing.length) {
    await upsertGoogleConnection(supabase, configuration);
    throw new ApiError(400, "Google account not connected.", "google_not_connected");
  }
  const checkExecutionId = clean(executionId, 200) || crypto.randomUUID();
  const duplicate = data(
    await supabase
      .from("knowledge_visibility_results")
      .select("*")
      .eq("article_id", article.id)
      .eq("provider", "google_search_console")
      .contains("response_metadata", { check_execution_id: checkExecutionId })
      .maybeSingle(),
    "Existing Google evidence could not be checked.",
  );
  if (duplicate) return { result: duplicate, duplicate: true };
  try {
    const evidence = await fetchGoogleEvidence(configuration, article.live_wix_url);
    const resultStatus = googleEvidenceStatus(evidence);
    const now = new Date().toISOString();
    const result = data(
      await supabase.from("knowledge_visibility_results").insert({
        article_id: article.id,
        provider: "google_search_console",
        checked_at: now,
        result_status: resultStatus,
        source_url: article.live_wix_url,
        evidence_excerpt:
          resultStatus === "indexed"
            ? "URL Inspection returned PASS."
            : resultStatus === "not_indexed"
              ? "URL Inspection returned FAIL."
              : evidence.performance.impressions > 0
                ? "Performance data found. Indexing status was not asserted."
                : "No reliable indexing verdict or performance evidence was returned.",
        structured_evidence: {
          page_url: article.live_wix_url,
          indexed_status: ["indexed", "not_indexed"].includes(resultStatus) ? resultStatus : "not_determined",
          clicks: evidence.performance.clicks,
          impressions: evidence.performance.impressions,
          ctr: evidence.performance.ctr,
          average_position: evidence.performance.average_position,
          date_range: evidence.range,
          top_queries: evidence.performance.top_queries,
          source_property: configuration.siteUrl,
          inspection_result: evidence.inspection,
          inspection_error: evidence.inspection_error,
        },
        response_metadata: {
          check_execution_id: checkExecutionId,
          official_google_apis: true,
          ranking_position_supplied: false,
        },
        verification_method: "provider",
        manually_verified: false,
      }).select().single(),
      "Google evidence could not be saved.",
    );
    await upsertGoogleConnection(supabase, configuration, { last_successful_check_at: now });
    return { result, duplicate: false };
  } catch (error) {
    await upsertGoogleConnection(supabase, configuration, { last_error: error.message });
    throw error;
  }
}

async function bulkGoogleCheck(supabase, body) {
  const articles = data(
    await supabase.from("knowledge_articles").select("*").order("published_at", { ascending: true }),
    "Published pages could not be loaded.",
  ).filter(isConfirmedPublishedArticle);
  const executionId = clean(body.execution_id, 200) || crypto.randomUUID();
  const results = [];
  for (let index = 0; index < articles.length; index += 5) {
    const batch = articles.slice(index, index + 5);
    const batchResults = await Promise.allSettled(
      batch.map((article) => checkGoogleForArticle(supabase, article.id, `${executionId}:${article.id}`)),
    );
    batchResults.forEach((outcome, offset) => {
      const article = batch[offset];
      results.push(
        outcome.status === "fulfilled"
          ? { article_id: article.id, ok: true, duplicate: outcome.value.duplicate }
          : { article_id: article.id, ok: false, error: outcome.reason.message },
      );
    });
  }
  return {
    execution_id: executionId,
    published_pages_checked: articles.length,
    successful: results.filter((item) => item.ok).length,
    failed: results.filter((item) => !item.ok).length,
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
    let result;
    if (body.action === "syncLiveWixArticles") result = { summary: await syncLiveWixArticles(supabase) };
    else if (body.action === "checkWixPublication") {
      const articleId = clean(body.article_id, 100);
      const summary = await syncLiveWixArticles(supabase);
      result = { summary, article_id: articleId };
    } else if (body.action === "googleConnection") {
      result = { connection: await upsertGoogleConnection(supabase, googleConfiguration()) };
    } else if (body.action === "checkGoogle") {
      result = await checkGoogleForArticle(supabase, clean(body.article_id, 100), body.execution_id);
    } else if (body.action === "bulkGoogleCheck") result = { summary: await bulkGoogleCheck(supabase, body) };
    else throw new ApiError(400, "Unsupported AI Visibility connection action.", "validation");
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error("AI VISIBILITY CONNECTION ERROR", { action: body.action, code: error.code, message: error.message });
    return response.status(error.status || 500).json({
      ok: false,
      code: error.code || "provider_request_failed",
      message: error.status ? error.message : "Provider request failed.",
    });
  }
}

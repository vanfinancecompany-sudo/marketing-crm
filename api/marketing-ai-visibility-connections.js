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
import { isConfirmedPublishedArticle } from "../lib/aiVisibility.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const clean = (value, limit = 10000) => String(value || "").trim().slice(0, limit);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const GOOGLE_COMPLETED_STATUSES = new Set([
  "indexed",
  "not_indexed",
  "performance_found",
  "inconclusive",
]);

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
      const page = payload.dataItems || [];
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
  const changes = {
    wix_item_id: wixItemId(item),
    wix_collection_id: clean(article.wix_collection_id) || clean(process.env.WIX_KNOWLEDGE_COLLECTION_ID),
    live_wix_url: liveUrl,
    wix_sync_status: "live",
    wix_publication_status: "live",
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
    action: "publication_updated",
    reason: "Live Wix publication verified from the existing Wix Data integration.",
    details: {
      matched_by: matchedBy,
      wix_item_id: wixItemId(item),
      live_url: liveUrl,
      wix_title: clean(itemData.title),
      wix_slug: wixItemSlug(item),
      manually_verified: false,
    },
  });
  return { saved: true, article: saved };
}

async function syncLiveWixArticles(supabase) {
  const configuration = wixPublishingConfiguration(process.env);
  const [articles, liveItems] = await Promise.all([
    data(
      await supabase.from("knowledge_articles").select("*").order("updated_at", { ascending: false }),
      "Knowledge Hub articles could not be loaded.",
    ),
    new WixLiveReader(configuration).listLiveItems(),
  ]);
  const plan = buildWixSyncPlan({ articles, liveItems });
  let added = 0;
  let updated = 0;
  const errors = [];
  for (const match of plan.matches) {
    try {
      const wasPublished = isConfirmedPublishedArticle(match.article);
      const result = await saveWixMatch(supabase, match.article, match.item, match.matched_by);
      if (!result.saved) errors.push(result);
      else if (wasPublished) updated += 1;
      else added += 1;
    } catch (error) {
      errors.push({ article_id: match.article.id, error: error.message });
    }
  }
  return {
    wix_items_checked: liveItems.length,
    live_articles_matched: plan.matches.length,
    new_published_pages_added: added,
    existing_records_updated: updated,
    drafts_ignored: Math.max(0, articles.filter((article) => article.wix_item_id).length - plan.matches.length),
    unmatched_crm_articles: plan.unmatched_articles,
    unmatched_wix_items: plan.unmatched_wix_items,
    ambiguous_matches: plan.ambiguous,
    errors,
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
  let inspectionErrorCode = "";
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
    inspectionErrorCode = error.code || "provider_request_failed";
  }
  return {
    range,
    performance,
    inspection,
    inspection_error: inspectionError,
    inspection_error_code: inspectionErrorCode,
  };
}

async function upsertGoogleConnection(supabase, configuration, updates = {}) {
  const now = new Date().toISOString();
  const existing = data(
    await supabase
      .from("knowledge_visibility_provider_connections")
      .select("*")
      .eq("provider", "google_search_console")
      .maybeSingle(),
    "Google connection state could not be loaded.",
  ) || {};
  const previousMetadata =
    existing.connection_metadata && typeof existing.connection_metadata === "object"
      ? existing.connection_metadata
      : {};
  const metadata = {
    ...previousMetadata,
    site_url: configuration.siteUrl || previousMetadata.site_url || null,
    token_storage: "server_environment",
    ...(updates.connection_metadata || {}),
  };
  const nextError = hasOwn(updates, "last_error")
    ? clean(updates.last_error, 5000)
    : clean(existing.last_error, 5000);
  const payload = {
    provider: "google_search_console",
    connection_status:
      updates.connection_status ||
      (configuration.missing.length ? "configuration_required" : "connected"),
    configuration_summary: configuration.missing.length
      ? `Missing secure server configuration: ${configuration.missing.join(", ")}.`
      : `Connected to ${configuration.siteUrl}. Tokens are held in server environment variables.`,
    connection_metadata: metadata,
    last_successful_check_at: hasOwn(updates, "last_successful_check_at")
      ? updates.last_successful_check_at || null
      : existing.last_successful_check_at || null,
    last_error_at: hasOwn(updates, "last_error")
      ? nextError
        ? now
        : null
      : existing.last_error_at || null,
    last_error: nextError,
    updated_at: now,
  };
  return data(
    await supabase
      .from("knowledge_visibility_provider_connections")
      .upsert(payload, { onConflict: "provider" })
      .select()
      .single(),
    "Google connection state could not be saved.",
  );
}

function googlePersistedState(result = {}) {
  const structured = result.structured_evidence && typeof result.structured_evidence === "object"
    ? result.structured_evidence
    : {};
  const impressions = Number(structured.impressions || 0);
  const clicks = Number(structured.clicks || 0);
  const inspectionError = clean(structured.inspection_error, 5000);
  if (inspectionError && impressions <= 0 && clicks <= 0) {
    return {
      result_status: "error",
      error_details: inspectionError,
      evidence_excerpt: "Google URL Inspection failed and no Search Analytics evidence was returned. No indexing verdict was recorded.",
    };
  }
  if (impressions > 0 || clicks > 0) {
    return {
      result_status: "performance_found",
      error_details: null,
      evidence_excerpt: "Search Analytics performance data was found. A verified indexing verdict was not available.",
    };
  }
  return {
    result_status: "inconclusive",
    error_details: null,
    evidence_excerpt: "Google APIs completed, but returned no verified indexing verdict or Search Analytics evidence.",
  };
}

async function normalizeLegacyGoogleNotCheckedResults(supabase) {
  const candidates = data(
    await supabase
      .from("knowledge_visibility_results")
      .select("id,article_id,result_status,structured_evidence,response_metadata,error_details,evidence_excerpt")
      .eq("provider", "google_search_console")
      .eq("result_status", "not_checked")
      .eq("manually_verified", false),
    "Legacy Google result states could not be inspected.",
  ) || [];
  const eligible = candidates.filter(
    (item) => item.response_metadata?.official_google_apis === true,
  );
  let updated = 0;
  for (const item of eligible) {
    const next = googlePersistedState(item);
    data(
      await supabase
        .from("knowledge_visibility_results")
        .update(next)
        .eq("id", item.id),
      "Legacy Google result state could not be corrected.",
    );
    updated += 1;
  }
  if (updated) {
    await supabase.from("knowledge_visibility_audit_events").insert({
      provider: "google_search_console",
      action: "google_result_state_normalized",
      reason: "Completed Google API attempts previously stored as not_checked were reclassified from their persisted evidence.",
      details: {
        updated_count: updated,
        historical_rows_deleted: 0,
        recognised_states: ["performance_found", "inconclusive", "error"],
      },
    });
  }
  return updated;
}

async function recordGoogleFailure(supabase, article, executionId, error) {
  const now = new Date().toISOString();
  try {
    return data(
      await supabase
        .from("knowledge_visibility_results")
        .insert({
          article_id: article.id,
          provider: "google_search_console",
          checked_at: now,
          result_status: "error",
          source_url: article.live_wix_url,
          evidence_excerpt: "Google Search Console check failed. No indexing verdict was recorded.",
          error_details: clean(error.message, 5000),
          response_metadata: {
            check_execution_id: executionId,
            official_google_apis: true,
            failure_code: error.code || "provider_request_failed",
          },
          verification_method: "provider",
          manually_verified: false,
        })
        .select()
        .single(),
      "Google failure evidence could not be saved.",
    );
  } catch (saveError) {
    console.error("GOOGLE FAILURE EVIDENCE SAVE ERROR", {
      article_id: article.id,
      message: saveError.message,
    });
    return null;
  }
}

async function checkGoogleForArticle(supabase, articleId, executionId) {
  const article = data(
    await supabase.from("knowledge_articles").select("*").eq("id", articleId).single(),
    "Article could not be found.",
  );
  if (!isConfirmedPublishedArticle(article)) throw new ApiError(400, "Only verified live Wix pages can be checked.", "validation");
  const configuration = googleConfiguration();
  const checkExecutionId = clean(executionId, 200) || crypto.randomUUID();
  const attemptAt = new Date().toISOString();
  await upsertGoogleConnection(supabase, configuration, {
    connection_metadata: { last_check_attempt_at: attemptAt },
  });
  if (configuration.missing.length) {
    const error = new ApiError(400, "Google account not connected.", "google_not_connected");
    await recordGoogleFailure(supabase, article, checkExecutionId, error);
    await upsertGoogleConnection(supabase, configuration, {
      last_error: error.message,
      connection_metadata: { last_check_completed_at: new Date().toISOString() },
    });
    throw error;
  }
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
  if (duplicate) {
    if (!GOOGLE_COMPLETED_STATUSES.has(duplicate.result_status)) {
      throw new ApiError(
        502,
        duplicate.error_details || "The stored Google attempt did not contain a completed result.",
        "stored_google_result_incomplete",
      );
    }
    return { result: duplicate, duplicate: true };
  }
  try {
    const evidence = await fetchGoogleEvidence(configuration, article.live_wix_url);
    const hasPerformance =
      Number(evidence.performance.impressions || 0) > 0 ||
      Number(evidence.performance.clicks || 0) > 0;
    if (evidence.inspection_error && !hasPerformance) {
      throw new ApiError(
        502,
        `Google URL Inspection failed: ${evidence.inspection_error}`,
        evidence.inspection_error_code || "provider_request_failed",
      );
    }
    const resultStatus = googleEvidenceStatus(evidence);
    if (!GOOGLE_COMPLETED_STATUSES.has(resultStatus)) {
      throw new ApiError(502, "Google completed without a recognised result state.", "unrecognised_google_result");
    }
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
              : resultStatus === "performance_found"
                ? "Search Analytics performance data was found. Indexing status was not asserted."
                : "Google APIs completed, but returned no verified indexing verdict or Search Analytics evidence.",
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
    await upsertGoogleConnection(supabase, configuration, {
      last_successful_check_at: now,
      last_error: "",
      connection_metadata: { last_check_completed_at: now },
    });
    return { result, duplicate: false };
  } catch (error) {
    await recordGoogleFailure(supabase, article, checkExecutionId, error);
    await upsertGoogleConnection(supabase, configuration, {
      last_error: error.message,
      connection_metadata: { last_check_completed_at: new Date().toISOString() },
    });
    throw error;
  }
}

async function bulkGoogleCheck(supabase, body) {
  await normalizeLegacyGoogleNotCheckedResults(supabase);
  const articles = data(
    await supabase.from("knowledge_articles").select("*").order("published_at", { ascending: true }),
    "Published pages could not be loaded.",
  ).filter(isConfirmedPublishedArticle);
  const executionId = clean(body.execution_id, 200) || crypto.randomUUID();
  const configuration = googleConfiguration();
  const startedAt = new Date().toISOString();
  await upsertGoogleConnection(supabase, configuration, {
    connection_metadata: {
      last_bulk_execution_id: executionId,
      last_check_attempt_at: startedAt,
      last_bulk_published_pages: articles.length,
    },
  });
  const results = [];
  for (let index = 0; index < articles.length; index += 5) {
    const batch = articles.slice(index, index + 5);
    const batchResults = await Promise.allSettled(
      batch.map((article) => checkGoogleForArticle(supabase, article.id, `${executionId}:${article.id}`)),
    );
    batchResults.forEach((outcome, offset) => {
      const article = batch[offset];
      if (outcome.status === "fulfilled") {
        const resultStatus = outcome.value.result?.result_status || "";
        const ok = GOOGLE_COMPLETED_STATUSES.has(resultStatus);
        results.push({
          article_id: article.id,
          ok,
          result_status: resultStatus,
          duplicate: outcome.value.duplicate,
          ...(ok ? {} : { error: "A recognised non-error Google result was not persisted." }),
        });
      } else {
        results.push({
          article_id: article.id,
          ok: false,
          result_status: "error",
          code: outcome.reason.code || "provider_request_failed",
          error: outcome.reason.message,
        });
      }
    });
  }
  const completedAt = new Date().toISOString();
  const successful = results.filter((item) => item.ok).length;
  const failed = results.length - successful;
  const status_counts = results.reduce((counts, item) => {
    const key = item.result_status || "unknown";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  await upsertGoogleConnection(supabase, configuration, {
    ...(successful ? { last_successful_check_at: completedAt } : {}),
    last_error: failed
      ? `${failed} of ${articles.length} published Google checks failed. Open the returned error details before retrying.`
      : "",
    connection_metadata: {
      last_check_completed_at: completedAt,
      last_bulk_execution_id: executionId,
      last_bulk_summary: {
        published_pages_checked: articles.length,
        successful,
        failed,
        status_counts,
      },
    },
  });
  return {
    execution_id: executionId,
    started_at: startedAt,
    completed_at: completedAt,
    published_pages_checked: articles.length,
    successful,
    failed,
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
    let result;
    if (body.action === "syncLiveWixArticles") result = { summary: await syncLiveWixArticles(supabase) };
    else if (body.action === "checkWixPublication") {
      const articleId = clean(body.article_id, 100);
      const summary = await syncLiveWixArticles(supabase);
      result = { summary, article_id: articleId };
    } else if (body.action === "googleConnection") {
      const normalized_results = await normalizeLegacyGoogleNotCheckedResults(supabase);
      result = {
        connection: await upsertGoogleConnection(supabase, googleConfiguration()),
        normalized_results,
      };
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

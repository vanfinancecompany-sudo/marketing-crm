import { createClient } from "@supabase/supabase-js";
import { wixPublishingConfiguration } from "../lib/wixPublishing.js";
import { isConfirmedPublishedArticle } from "../lib/aiVisibility.js";
import {
  buildWixSyncPlan,
  resolveWixLiveArticleUrl,
  wixItemData,
  wixItemId,
  wixItemSlug,
  wixPublishedTimestamp,
} from "../lib/aiVisibilityLiveConnections.js";

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

  async request(body) {
    let response;
    try {
      response = await this.fetchImpl(`${this.configuration.apiBaseUrl}/wix-data/v2/items/query`, {
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
      const payload = await this.request({
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

function itemError(article, item, error, resolution = null) {
  const effectiveResolution = resolution || resolveWixLiveArticleUrl(item, {
    articleUrlPrefix: process.env.WIX_KNOWLEDGE_ARTICLE_URL_PREFIX,
  });
  return {
    article_id: article?.id || "",
    article_title: article?.title || "",
    wix_item_id: wixItemId(item),
    slug: wixItemSlug(item),
    dynamic_link_fields: effectiveResolution.dynamic_link_fields || [],
    error: clean(error, 2000),
  };
}

async function saveWixMatch(supabase, article, item, matchedBy) {
  const now = new Date().toISOString();
  const itemData = wixItemData(item);
  const resolution = resolveWixLiveArticleUrl(item, {
    articleUrlPrefix: process.env.WIX_KNOWLEDGE_ARTICLE_URL_PREFIX,
  });
  if (!resolution.url) {
    return {
      saved: false,
      missing_live_url: true,
      ...itemError(
        article,
        item,
        "Live URL unavailable. No valid Wix dynamic-page link was returned and the configured article route could not safely construct one.",
        resolution,
      ),
    };
  }

  const publishedAt = wixPublishedTimestamp(item) || article.published_at || now;
  const parsedPublishedAt = new Date(publishedAt);
  const changes = {
    wix_item_id: wixItemId(item),
    wix_collection_id: clean(article.wix_collection_id) || clean(process.env.WIX_KNOWLEDGE_COLLECTION_ID),
    live_wix_url: resolution.url,
    wix_sync_status: "live",
    wix_publication_status: "live",
    published_at: Number.isNaN(parsedPublishedAt.getTime()) ? now : parsedPublishedAt.toISOString(),
    publication_verified_at: now,
    last_wix_verification_at: now,
    last_wix_sync_at: now,
    publication_verification_notes: `Verified from Wix LIVE collection by ${matchedBy}; URL source ${resolution.source}.`,
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
      live_url: resolution.url,
      live_url_source: resolution.source,
      wix_title: clean(itemData.title),
      wix_slug: wixItemSlug(item),
      manually_verified: false,
    },
  });

  return { saved: true, article: saved, live_url_source: resolution.source };
}

async function syncLiveWixArticles(supabase, articleId = "") {
  const configuration = wixPublishingConfiguration(process.env);
  const [articles, liveItems] = await Promise.all([
    data(
      await supabase
        .from("knowledge_articles")
        .select("*")
        .order("updated_at", { ascending: false }),
      "Knowledge Hub articles could not be loaded.",
    ),
    new WixLiveReader(configuration).listLiveItems(),
  ]);

  const scopedArticles = articleId ? articles.filter((article) => article.id === articleId) : articles;
  if (articleId && !scopedArticles.length) throw new ApiError(404, "Article could not be found.", "validation");

  const plan = buildWixSyncPlan({ articles: scopedArticles, liveItems });
  let added = 0;
  let updated = 0;
  const errors = [];
  let missingUrls = 0;

  for (const match of plan.matches) {
    try {
      const wasPublished = isConfirmedPublishedArticle(match.article);
      const result = await saveWixMatch(supabase, match.article, match.item, match.matched_by);
      if (!result.saved) {
        errors.push(result);
        if (result.missing_live_url) missingUrls += 1;
      } else if (wasPublished) {
        updated += 1;
      } else {
        added += 1;
      }
    } catch (error) {
      errors.push(itemError(match.article, match.item, error.message));
    }
  }

  return {
    wix_items_checked: liveItems.length,
    wix_live_items_matched: plan.matches.length,
    published_pages_verified_and_saved: added + updated,
    items_missing_usable_live_url: missingUrls,
    new_published_pages_added: added,
    existing_records_updated: updated,
    drafts_ignored: Math.max(0, scopedArticles.filter((article) => article.wix_item_id).length - plan.matches.length),
    unmatched_crm_articles: plan.unmatched_articles,
    unmatched_wix_items: articleId ? [] : plan.unmatched_wix_items,
    ambiguous_matches: plan.ambiguous,
    errors,
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorize(request)) return response.status(401).json({ ok: false, message: "Access key not recognised." });

  try {
    const body = parseBody(request);
    const supabase = getSupabase();
    if (body.action === "syncLiveWixArticles") {
      return response.status(200).json({ ok: true, summary: await syncLiveWixArticles(supabase) });
    }
    if (body.action === "checkWixPublication") {
      return response.status(200).json({
        ok: true,
        summary: await syncLiveWixArticles(supabase, clean(body.article_id, 100)),
      });
    }
    throw new ApiError(400, "Unsupported Wix visibility action.", "validation");
  } catch (error) {
    console.error("AI VISIBILITY WIX SYNC ERROR", {
      message: error.message,
      code: error.code,
    });
    return response.status(error.status || 500).json({
      ok: false,
      message: error.status ? error.message : "Wix live article sync failed.",
      error_code: error.code || "provider_request_failed",
    });
  }
}

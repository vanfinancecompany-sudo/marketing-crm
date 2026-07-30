import { createClient } from "@supabase/supabase-js";
import { wixPublishingConfiguration } from "../lib/wixPublishing.js";
import { isConfirmedPublishedArticle } from "../lib/aiVisibility.js";
import {
  resolveWixLiveArticleUrl,
  wixItemId,
  wixItemSlug,
} from "../lib/aiVisibilityLiveConnections.js";
import {
  articleIsPresentInLiveSet,
  deactivationSelectionReason,
  stableWixIdentityForItem,
  wixManagementClassification,
} from "../lib/aiVisibilityWixLifecycle.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const clean = (value, limit = 10000) => String(value || "").trim().slice(0, limit);

function authorize(request) {
  const expected = clean(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY);
  return Boolean(expected && clean(request.headers?.[API_KEY_HEADER]) === expected);
}

function getSupabase() {
  const url = clean(process.env.SUPABASE_URL, 2000);
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) throw new Error("Supabase is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function listLiveItems(configuration) {
  const items = [];
  for (let offset = 0; ; offset += 100) {
    const response = await fetch(`${configuration.apiBaseUrl}/wix-data/v2/items/query`, {
      method: "POST",
      headers: {
        Authorization: configuration.apiKey,
        "wix-site-id": configuration.siteId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dataCollectionId: configuration.collectionId,
        environment: "LIVE",
        query: { paging: { limit: 100, offset } },
        consistentRead: true,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(payload.dataItems)) {
      throw new Error(payload.message || "Wix LIVE diagnostics fetch failed.");
    }
    items.push(...payload.dataItems);
    if (payload.dataItems.length < 100) return items;
  }
}

function safeRecord(article, classification, selection) {
  return {
    id: article.id,
    title: article.title,
    slug: article.slug,
    wix_item_id: article.wix_item_id,
    wix_collection_id: article.wix_collection_id,
    live_wix_url: article.live_wix_url,
    wix_sync_status: article.wix_sync_status,
    wix_publication_status: article.wix_publication_status,
    publication_verified_at: article.publication_verified_at,
    last_wix_verification_at: article.last_wix_verification_at,
    publication_verification_notes: article.publication_verification_notes,
    is_active: article.is_active,
    wix_managed: classification.managed,
    wix_managed_reason: classification.reason,
    selected_for_deactivation: selection.selected,
    deactivation_reason: selection.selection_reason,
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorize(request)) return response.status(401).json({ ok: false, message: "Access key not recognised." });

  try {
    const supabase = getSupabase();
    const configuration = wixPublishingConfiguration(process.env);
    const [articleResult, liveItems] = await Promise.all([
      supabase.from("knowledge_articles").select("*").order("updated_at", { ascending: false }),
      listLiveItems(configuration),
    ]);
    if (articleResult.error) throw new Error(articleResult.error.message);
    const articles = articleResult.data || [];
    const liveIdentities = liveItems.map((item) =>
      stableWixIdentityForItem(item, {
        itemId: wixItemId,
        liveUrl: (candidate) =>
          resolveWixLiveArticleUrl(candidate, {
            articleUrlPrefix: process.env.WIX_KNOWLEDGE_ARTICLE_URL_PREFIX,
          }).url,
        slug: wixItemSlug,
      }),
    );
    const currentlyPublished = articles.filter(isConfirmedPublishedArticle);
    const unmatchedPublished = currentlyPublished.filter(
      (article) => !articleIsPresentInLiveSet(article, liveIdentities),
    );
    const diagnostics = unmatchedPublished.map((article) => {
      const classification = wixManagementClassification(article, configuration.collectionId);
      const selection = deactivationSelectionReason(
        article,
        liveIdentities,
        configuration.collectionId,
      );
      return safeRecord(article, classification, selection);
    });

    return response.status(200).json({
      ok: true,
      deployed_commit: clean(process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA, 100) || "unknown",
      counts: {
        total_article_records_loaded: articles.length,
        currently_published_records: currentlyPublished.length,
        wix_live_items: liveItems.length,
        unmatched_currently_published_records: diagnostics.length,
        unmatched_classified_wix_managed: diagnostics.filter((item) => item.wix_managed).length,
        unmatched_selected_for_deactivation: diagnostics.filter((item) => item.selected_for_deactivation).length,
      },
      unmatched_records: diagnostics,
    });
  } catch (error) {
    return response.status(500).json({ ok: false, message: error.message || "Diagnostics failed." });
  }
}

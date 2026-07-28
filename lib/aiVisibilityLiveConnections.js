const clean = (value) => String(value || "").trim();
const lower = (value) => clean(value).toLowerCase();

export const GOOGLE_PROVIDER = "google_search_console";
export const GOOGLE_PERFORMANCE_STATUS = "performance_found";

export function wixItemData(item = {}) {
  return item.data && typeof item.data === "object" ? item.data : {};
}

export function wixItemId(item = {}) {
  return clean(item.id || item._id || wixItemData(item)._id);
}

export function wixItemSlug(item = {}) {
  const data = wixItemData(item);
  return clean(data.slug || data._slug);
}

export function wixItemCrmArticleId(item = {}) {
  const data = wixItemData(item);
  return clean(data.crmArticleId || data.crm_article_id);
}

export function wixItemLiveUrl(item = {}) {
  const data = wixItemData(item);
  return clean(
    data.liveUrl ||
      data.live_url ||
      data.canonicalUrl ||
      data.canonical_url ||
      data.url ||
      data._url ||
      item.liveUrl ||
      item.url,
  );
}

export function wixPublishedTimestamp(item = {}) {
  const data = wixItemData(item);
  return clean(
    data.publishedAt ||
      data.published_at ||
      item.publishedDate ||
      item.updatedDate ||
      data._updatedDate ||
      item.createdDate ||
      data._createdDate,
  );
}

function uniqueMatch(items, predicate) {
  const matches = items.filter(predicate);
  return {
    item: matches.length === 1 ? matches[0] : null,
    ambiguous: matches.length > 1,
    count: matches.length,
  };
}

export function matchCrmArticleToWixItem(article = {}, liveItems = []) {
  const storedItemId = clean(article.wix_item_id);
  if (storedItemId) {
    const byId = uniqueMatch(liveItems, (item) => wixItemId(item) === storedItemId);
    if (byId.item || byId.ambiguous) return { ...byId, matched_by: "wix_item_id" };
  }

  const articleId = clean(article.id);
  if (articleId) {
    const byCrmId = uniqueMatch(
      liveItems,
      (item) => wixItemCrmArticleId(item) === articleId,
    );
    if (byCrmId.item || byCrmId.ambiguous) {
      return { ...byCrmId, matched_by: "crm_article_id" };
    }
  }

  const slug = lower(article.slug);
  if (slug) {
    const bySlug = uniqueMatch(
      liveItems,
      (item) => lower(wixItemSlug(item)) === slug,
    );
    if (bySlug.item || bySlug.ambiguous) return { ...bySlug, matched_by: "slug" };
  }

  const canonicalUrl = lower(article.live_wix_url);
  if (canonicalUrl) {
    const byUrl = uniqueMatch(
      liveItems,
      (item) => lower(wixItemLiveUrl(item)) === canonicalUrl,
    );
    if (byUrl.item || byUrl.ambiguous) {
      return { ...byUrl, matched_by: "canonical_url" };
    }
  }

  return { item: null, ambiguous: false, count: 0, matched_by: "none" };
}

export function buildWixSyncPlan({ articles = [], liveItems = [] } = {}) {
  const usedWixIds = new Set();
  const matches = [];
  const ambiguous = [];
  const unmatchedArticles = [];

  for (const article of articles) {
    const match = matchCrmArticleToWixItem(article, liveItems);
    if (match.ambiguous) {
      ambiguous.push({
        article_id: article.id,
        article_title: article.title,
        matched_by: match.matched_by,
        candidate_count: match.count,
      });
      continue;
    }
    if (!match.item) {
      unmatchedArticles.push({ article_id: article.id, article_title: article.title });
      continue;
    }
    const itemId = wixItemId(match.item);
    usedWixIds.add(itemId);
    matches.push({ article, item: match.item, matched_by: match.matched_by });
  }

  return {
    matches,
    ambiguous,
    unmatched_articles: unmatchedArticles,
    unmatched_wix_items: liveItems
      .filter((item) => !usedWixIds.has(wixItemId(item)))
      .map((item) => ({
        wix_item_id: wixItemId(item),
        title: clean(wixItemData(item).title),
        slug: wixItemSlug(item),
      })),
  };
}

export function aggregateSearchAnalytics(rows = []) {
  let clicks = 0;
  let impressions = 0;
  let weightedPosition = 0;
  const queries = [];

  for (const row of rows) {
    const rowClicks = Math.max(0, Number(row.clicks || 0));
    const rowImpressions = Math.max(0, Number(row.impressions || 0));
    clicks += rowClicks;
    impressions += rowImpressions;
    weightedPosition += Math.max(0, Number(row.position || 0)) * rowImpressions;
    if (row.keys?.[0]) {
      queries.push({
        query: String(row.keys[0]),
        clicks: rowClicks,
        impressions: rowImpressions,
        ctr: Number(row.ctr || 0),
        position: Number(row.position || 0),
      });
    }
  }

  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : 0,
    average_position: impressions ? weightedPosition / impressions : 0,
    top_queries: queries.slice(0, 25),
  };
}

export function googleEvidenceStatus({ inspection = null, performance = null } = {}) {
  const verdict = clean(inspection?.inspectionResult?.indexStatusResult?.verdict).toUpperCase();
  if (verdict === "PASS") return "indexed";
  if (verdict === "FAIL") return "not_indexed";
  if (Number(performance?.impressions || 0) > 0 || Number(performance?.clicks || 0) > 0) {
    return GOOGLE_PERFORMANCE_STATUS;
  }
  return "not_checked";
}

export function providerStateLabel(connection = {}) {
  if (connection.connection_status === "connected") return "Connected";
  if (connection.last_error) return "Check failed";
  return "Configuration required";
}

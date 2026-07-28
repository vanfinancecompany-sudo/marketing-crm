// Shared live-page resolution and provider evidence helpers.
const clean = (value) => String(value || "").trim();
const lower = (value) => clean(value).toLowerCase();

export const GOOGLE_PROVIDER = "google_search_console";
export const GOOGLE_PERFORMANCE_STATUS = "performance_found";
export const LIVE_SITE_HOST = "www.vanfinancecompany.co.uk";

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

export function wixDynamicLinkFields(item = {}) {
  const data = wixItemData(item);
  return Object.entries(data)
    .filter(([key, value]) => {
      if (typeof value !== "string" || !clean(value)) return false;
      const normalizedKey = lower(key).replaceAll("_", "-");
      return normalizedKey.includes("link") || normalizedKey.includes("dynamic") || normalizedKey.includes("page-url");
    })
    .map(([key, value]) => ({ key, value: clean(value) }));
}

export function wixItemLiveUrl(item = {}) {
  const data = wixItemData(item);
  const explicit = clean(
    data.liveUrl ||
      data.live_url ||
      data.canonicalUrl ||
      data.canonical_url ||
      data.url ||
      data._url ||
      item.liveUrl ||
      item.url,
  );
  if (explicit) return explicit;

  const dynamic = wixDynamicLinkFields(item).find(({ value }) => /^https?:\/\//i.test(value) || value.startsWith("/"));
  return dynamic?.value || "";
}

export function normalizeKnowledgeArticleUrl(value, expectedHost = LIVE_SITE_HOST) {
  const raw = clean(value, 2000);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return "";
    if (lower(parsed.hostname) !== lower(expectedHost)) return "";
    parsed.hostname = expectedHost;
    parsed.pathname = parsed.pathname.replace(/\/{2,}/g, "/");
    if (/\s/.test(parsed.pathname) || !parsed.pathname || parsed.pathname === "/") return "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export function buildKnowledgeArticleUrl(prefix, slug, expectedHost = LIVE_SITE_HOST) {
  const cleanSlug = clean(slug).replace(/^\/+|\/+$/g, "");
  if (!cleanSlug || /\s|\//.test(cleanSlug)) return "";
  const cleanPrefix = clean(prefix, 2000);
  if (!cleanPrefix) return "";
  try {
    const base = new URL(cleanPrefix);
    if (base.protocol !== "https:" || lower(base.hostname) !== lower(expectedHost)) return "";
    const pathname = `${base.pathname.replace(/\/+$/g, "")}/${cleanSlug}`.replace(/\/{2,}/g, "/");
    return normalizeKnowledgeArticleUrl(`${base.origin}${pathname}`, expectedHost);
  } catch {
    return "";
  }
}

export function resolveWixLiveArticleUrl(item = {}, { articleUrlPrefix = "", expectedHost = LIVE_SITE_HOST } = {}) {
  const fields = wixDynamicLinkFields(item);
  const candidates = [wixItemLiveUrl(item), ...fields.map((entry) => entry.value)].filter(Boolean);

  for (const candidate of candidates) {
    const absolute = candidate.startsWith("/") ? `https://${expectedHost}${candidate}` : candidate;
    const normalized = normalizeKnowledgeArticleUrl(absolute, expectedHost);
    if (normalized) {
      return {
        url: normalized,
        source: fields.some((field) => field.value === candidate) ? "wix_dynamic_link_field" : "wix_url_field",
        dynamic_link_fields: fields,
      };
    }
  }

  const constructed = buildKnowledgeArticleUrl(articleUrlPrefix, wixItemSlug(item), expectedHost);
  return {
    url: constructed,
    source: constructed ? "configured_slug_route" : "unavailable",
    dynamic_link_fields: fields,
  };
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
    const byCrmId = uniqueMatch(liveItems, (item) => wixItemCrmArticleId(item) === articleId);
    if (byCrmId.item || byCrmId.ambiguous) return { ...byCrmId, matched_by: "crm_article_id" };
  }

  const slug = lower(article.slug);
  if (slug) {
    const bySlug = uniqueMatch(liveItems, (item) => lower(wixItemSlug(item)) === slug);
    if (bySlug.item || bySlug.ambiguous) return { ...bySlug, matched_by: "slug" };
  }

  const canonicalUrl = lower(article.live_wix_url);
  if (canonicalUrl) {
    const byUrl = uniqueMatch(liveItems, (item) => lower(wixItemLiveUrl(item)) === canonicalUrl);
    if (byUrl.item || byUrl.ambiguous) return { ...byUrl, matched_by: "canonical_url" };
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
      ambiguous.push({ article_id: article.id, article_title: article.title, matched_by: match.matched_by, candidate_count: match.count });
      continue;
    }
    if (!match.item) {
      unmatchedArticles.push({ article_id: article.id, article_title: article.title });
      continue;
    }
    usedWixIds.add(wixItemId(match.item));
    matches.push({ article, item: match.item, matched_by: match.matched_by });
  }

  return {
    matches,
    ambiguous,
    unmatched_articles: unmatchedArticles,
    unmatched_wix_items: liveItems
      .filter((item) => !usedWixIds.has(wixItemId(item)))
      .map((item) => ({ wix_item_id: wixItemId(item), title: clean(wixItemData(item).title), slug: wixItemSlug(item) })),
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
    if (row.keys?.[0]) queries.push({ query: String(row.keys[0]), clicks: rowClicks, impressions: rowImpressions, ctr: Number(row.ctr || 0), position: Number(row.position || 0) });
  }
  return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, average_position: impressions ? weightedPosition / impressions : 0, top_queries: queries.slice(0, 25) };
}

export function googleEvidenceStatus({ inspection = null, performance = null } = {}) {
  const verdict = clean(inspection?.inspectionResult?.indexStatusResult?.verdict).toUpperCase();
  if (verdict === "PASS") return "indexed";
  if (verdict === "FAIL") return "not_indexed";
  if (Number(performance?.impressions || 0) > 0 || Number(performance?.clicks || 0) > 0) return GOOGLE_PERFORMANCE_STATUS;
  return "not_checked";
}

export function providerStateLabel(connection = {}) {
  if (connection.connection_status === "connected") return "Connected";
  if (connection.last_error) return "Check failed";
  return "Configuration required";
}

// Shared live-page resolution and provider evidence helpers.
const clean = (value) => String(value || "").trim();
const lower = (value) => clean(value).toLowerCase();

export const GOOGLE_PROVIDER = "google_search_console";
export const GOOGLE_PERFORMANCE_STATUS = "performance_found";
export const GOOGLE_LIMITED_EVIDENCE_STATUS = "inconclusive";
export const LIVE_SITE_HOST = "www.vanfinancecompany.co.uk";
export const KNOWLEDGE_HUB_ROOT_PATH = "/knowledge-hub";

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
      return (
        normalizedKey.startsWith("link-") ||
        normalizedKey.includes("dynamic") ||
        normalizedKey.includes("page-url") ||
        normalizedKey.includes("article-url")
      );
    })
    .map(([key, value]) => ({ key, value: clean(value) }))
    .sort((first, second) => {
      const priority = (entry) => {
        const key = lower(entry.key).replaceAll("_", "-");
        if (key.startsWith("link-")) return 0;
        if (key.includes("dynamic")) return 1;
        if (key.includes("article-url")) return 2;
        return 3;
      };
      return priority(first) - priority(second);
    });
}

function wixExplicitUrlFields(item = {}) {
  const data = wixItemData(item);
  return [
    ["liveUrl", data.liveUrl],
    ["live_url", data.live_url],
    ["canonicalUrl", data.canonicalUrl],
    ["canonical_url", data.canonical_url],
    ["url", data.url],
    ["_url", data._url],
    ["item.liveUrl", item.liveUrl],
    ["item.url", item.url],
  ]
    .filter(([, value]) => typeof value === "string" && clean(value))
    .map(([key, value]) => ({ key, value: clean(value) }));
}

export function wixItemLiveUrl(item = {}) {
  const dynamic = wixDynamicLinkFields(item).find(
    ({ value }) => /^https?:\/\//i.test(value) || value.startsWith("/"),
  );
  if (dynamic) return dynamic.value;
  return wixExplicitUrlFields(item)[0]?.value || "";
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

export function isSharedKnowledgeHubUrl(value, expectedHost = LIVE_SITE_HOST) {
  const normalized = normalizeKnowledgeArticleUrl(value, expectedHost);
  if (!normalized) return false;
  const parsed = new URL(normalized);
  return parsed.pathname.replace(/\/+$/g, "") === KNOWLEDGE_HUB_ROOT_PATH;
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

function candidateUrl(value, expectedHost) {
  const absolute = value.startsWith("/") ? `https://${expectedHost}${value}` : value;
  return normalizeKnowledgeArticleUrl(absolute, expectedHost);
}

export function resolveWixLiveArticleUrl(
  item = {},
  { articleUrlPrefix = "", expectedHost = LIVE_SITE_HOST } = {},
) {
  const fields = wixDynamicLinkFields(item);
  const slug = wixItemSlug(item);

  // Wix dynamic-page link fields are authoritative and always take precedence
  // over generic URL fields, which may contain the shared Knowledge Hub page.
  for (const field of fields) {
    const normalized = candidateUrl(field.value, expectedHost);
    if (normalized && !isSharedKnowledgeHubUrl(normalized, expectedHost)) {
      return {
        url: normalized,
        source: "wix_dynamic_link_field",
        source_field: field.key,
        dynamic_link_fields: fields,
      };
    }
  }

  // Accept an explicit Wix URL only when it points beyond the shared hub root.
  for (const field of wixExplicitUrlFields(item)) {
    const normalized = candidateUrl(field.value, expectedHost);
    if (normalized && !isSharedKnowledgeHubUrl(normalized, expectedHost)) {
      return {
        url: normalized,
        source: "wix_url_field",
        source_field: field.key,
        dynamic_link_fields: fields,
      };
    }
  }

  // If Wix supplied the authoritative item slug, safely combine it with the
  // configured dynamic-page route. A shared Wix URL may supply the route prefix,
  // but is never saved by itself as an article URL.
  const sharedExplicit = wixExplicitUrlFields(item)
    .map((field) => candidateUrl(field.value, expectedHost))
    .find((value) => isSharedKnowledgeHubUrl(value, expectedHost));
  const prefix = clean(articleUrlPrefix) || sharedExplicit || `https://${expectedHost}${KNOWLEDGE_HUB_ROOT_PATH}/`;
  const constructed = buildKnowledgeArticleUrl(prefix, slug, expectedHost);
  return {
    url: constructed,
    source: constructed ? "wix_slug_route" : "unavailable",
    source_field: constructed ? "slug" : "",
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
  if (canonicalUrl && !isSharedKnowledgeHubUrl(canonicalUrl)) {
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
  return GOOGLE_LIMITED_EVIDENCE_STATUS;
}

export function providerStateLabel(connection = {}) {
  if (connection.connection_status === "connected") return "Connected";
  if (connection.last_error) return "Check failed";
  return "Configuration required";
}

const clean = (value, limit = 5000) => String(value || "").trim().slice(0, limit);

export const RENT2BUY_KNOWLEDGE_SITE_ID = "548f025b-673c-47f7-9bb6-383ab5d946e4";
export const RENT2BUY_KNOWLEDGE_COLLECTION_ID = "Import3";
export const RENT2BUY_KNOWLEDGE_ORIGIN = "https://www.rent2buyvans.co.uk";
const DEFAULT_WIX_API_BASE_URL = "https://www.wixapis.com";
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedArticles = null;
let cacheExpiresAt = 0;

export class Rent2BuyKnowledgeHubError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.name = "Rent2BuyKnowledgeHubError";
    this.status = status;
  }
}

function configuration(environment = process.env) {
  const apiKey = clean(environment.WIX_API_KEY, 10000);
  if (!apiKey) throw new Rent2BuyKnowledgeHubError("Rent2Buy Knowledge Hub search is not configured.", 500);
  return {
    apiKey,
    apiBaseUrl: clean(environment.WIX_API_BASE_URL, 1000) || DEFAULT_WIX_API_BASE_URL,
  };
}

function articleUrl(data = {}) {
  const slug = clean(data.slug, 500);
  const route = clean(data["link-knowledge-hub-articles-title"], 1500) || (slug ? `/knowledge-hub-articles/${slug}` : "");
  if (!route) return "";
  try {
    const url = new URL(route, RENT2BUY_KNOWLEDGE_ORIGIN);
    if (!["rent2buyvans.co.uk", "www.rent2buyvans.co.uk"].includes(url.hostname.toLowerCase())) return "";
    if (!url.pathname.toLowerCase().startsWith("/knowledge-hub-articles/")) return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function normaliseRent2BuyKnowledgeHubItem(item = {}) {
  const data = item?.data && typeof item.data === "object" ? item.data : {};
  if (clean(data._publishStatus, 40).toUpperCase() !== "PUBLISHED") return null;
  const liveUrl = articleUrl(data);
  if (!liveUrl) return null;
  const publishedAt = clean(data.publishDate || item.createdDate || item.updatedDate, 100);
  if (!publishedAt) return null;
  return {
    id: clean(item.id, 100),
    title: clean(data.title, 500),
    slug: clean(data.slug, 500),
    category: "Rent2Buy",
    article_type: "knowledge_hub",
    seo_title: clean(data.seoTitle, 500),
    meta_description: clean(data.metaDescription, 1500),
    excerpt: clean(data.excerpt, 3000),
    content_markdown: "",
    faq_json: null,
    status: "approved",
    live_wix_url: liveUrl,
    published_at: publishedAt,
    publication_verified_at: clean(item.updatedDate || publishedAt, 100),
    wix_sync_status: "live",
    wix_publication_status: "live",
    is_active: true,
  };
}

export function clearRent2BuyKnowledgeHubCache() {
  cachedArticles = null;
  cacheExpiresAt = 0;
}

export async function loadRent2BuyKnowledgeHubArticles({
  environment = process.env,
  fetchImpl = fetch,
  now = Date.now(),
  useCache = true,
} = {}) {
  if (useCache && cachedArticles && now < cacheExpiresAt) return cachedArticles;
  const { apiKey, apiBaseUrl } = configuration(environment);
  let response;
  try {
    response = await fetchImpl(`${apiBaseUrl}/wix-data/v2/items/query`, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "wix-site-id": RENT2BUY_KNOWLEDGE_SITE_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dataCollectionId: RENT2BUY_KNOWLEDGE_COLLECTION_ID,
        query: {
          paging: { limit: 100 },
          fields: [
            "title",
            "slug",
            "excerpt",
            "seoTitle",
            "metaDescription",
            "category",
            "publishDate",
            "_publishStatus",
            "link-knowledge-hub-articles-title",
          ],
        },
        returnTotalCount: true,
      }),
    });
  } catch {
    throw new Rent2BuyKnowledgeHubError("Rent2Buy Knowledge Hub could not be reached.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const status = Number(response.status) || 503;
    const message = status === 401 || status === 403
      ? "Rent2Buy Knowledge Hub credentials were rejected."
      : "Rent2Buy Knowledge Hub could not be loaded.";
    throw new Rent2BuyKnowledgeHubError(message, status === 401 || status === 403 ? 502 : status);
  }
  const articles = (Array.isArray(payload?.dataItems) ? payload.dataItems : [])
    .map(normaliseRent2BuyKnowledgeHubItem)
    .filter(Boolean);
  if (useCache) {
    cachedArticles = articles;
    cacheExpiresAt = now + CACHE_TTL_MS;
  }
  return articles;
}

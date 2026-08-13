import { classifyKnowledgeLinkProduct } from "./internalLinkStrategy.js";

const clean = (value) => String(value || "").trim();

export const KNOWLEDGE_ARTICLE_ROUTE_PREFIX = "/knowledge-hub-articles/";

export function isVerifiedLiveKnowledgeArticle(article = {}) {
  return Boolean(
    article.id &&
    article.status === "approved" &&
    article.is_active !== false &&
    clean(article.slug) &&
    clean(article.wix_item_id) &&
    article.wix_publication_status === "live"
  );
}

export function buildKnowledgeArticleWebsiteIndexRow(article = {}, now = new Date().toISOString()) {
  if (!isVerifiedLiveKnowledgeArticle(article)) return null;
  const slug = clean(article.slug).replace(/^\/+|\/+$/g, "");
  if (!slug) return null;

  return {
    page_key: `knowledge_article_${article.id}`,
    title: clean(article.title) || slug,
    url: `${KNOWLEDGE_ARTICLE_ROUTE_PREFIX}${slug}`,
    product: classifyKnowledgeLinkProduct({ article }),
    page_type: "knowledge_article",
    active: true,
    category: "Knowledge Hub",
    keywords: [],
    vehicle_types: [],
    customer_intent: [],
    priority: 3,
    description: clean(article.excerpt || article.meta_description),
    knowledge_article_id: article.id,
    source: "wix",
    external_id: clean(article.wix_item_id),
    sync_metadata: {
      auto_indexed: true,
      route_source: "wix_dynamic_article_slug",
    },
    last_synced_at: now,
    approval_status: "approved",
    verified: true,
    verification_source: "wix_sync",
    verified_at: now,
  };
}

export function missingKnowledgeArticleWebsiteIndexRows({
  articles = [],
  existingPages = [],
  now = new Date().toISOString(),
} = {}) {
  const indexedArticleIds = new Set(
    (Array.isArray(existingPages) ? existingPages : [])
      .map((page) => clean(page.knowledge_article_id))
      .filter(Boolean)
  );

  return (Array.isArray(articles) ? articles : [])
    .filter(isVerifiedLiveKnowledgeArticle)
    .filter((article) => !indexedArticleIds.has(clean(article.id)))
    .map((article) => buildKnowledgeArticleWebsiteIndexRow(article, now))
    .filter(Boolean);
}

export async function ensureKnowledgeArticleWebsiteIndex({
  supabase,
  articles = [],
  existingPages = [],
  now = new Date().toISOString(),
} = {}) {
  const rows = missingKnowledgeArticleWebsiteIndexRows({ articles, existingPages, now });
  if (!rows.length) return { created: [], rows: existingPages };

  const result = await supabase
    .from("knowledge_business_pages")
    .insert(rows)
    .select();
  if (result.error) throw new Error(result.error.message || "Knowledge Hub article destinations could not be indexed.");

  return {
    created: result.data || [],
    rows: [...(Array.isArray(existingPages) ? existingPages : []), ...(result.data || [])],
  };
}

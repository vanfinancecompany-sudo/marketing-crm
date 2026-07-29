const clean = (value) => String(value || "").trim();
const lower = (value) => clean(value).toLowerCase();

export function normalizeVisibilityUrl(value) {
  const raw = clean(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return "";
  }
}

export function isWixKnowledgeManagedArticle(article = {}, collectionId = "") {
  const configuredCollectionId = clean(collectionId);
  const articleCollectionId = clean(article.wix_collection_id);
  if (configuredCollectionId && articleCollectionId === configuredCollectionId) return true;

  return Boolean(
    clean(article.wix_item_id) &&
      ["live", "synced", "not_live", "unpublished"].includes(clean(article.wix_sync_status)) &&
      /wix live collection|wix data integration|wix knowledge hub/i.test(
        clean(article.publication_verification_notes),
      ),
  );
}

export function stableWixIdentityForArticle(article = {}) {
  return {
    wix_item_id: clean(article.wix_item_id),
    canonical_url: normalizeVisibilityUrl(article.live_wix_url),
    slug: lower(article.slug),
  };
}

export function stableWixIdentityForItem(item = {}, helpers = {}) {
  return {
    wix_item_id: clean(helpers.itemId?.(item)),
    canonical_url: normalizeVisibilityUrl(helpers.liveUrl?.(item)),
    slug: lower(helpers.slug?.(item)),
  };
}

export function identitiesOverlap(articleIdentity = {}, liveIdentity = {}) {
  if (
    articleIdentity.wix_item_id &&
    liveIdentity.wix_item_id &&
    articleIdentity.wix_item_id === liveIdentity.wix_item_id
  ) return true;

  if (
    articleIdentity.canonical_url &&
    liveIdentity.canonical_url &&
    articleIdentity.canonical_url === liveIdentity.canonical_url
  ) return true;

  return Boolean(
    articleIdentity.slug &&
      liveIdentity.slug &&
      articleIdentity.slug === liveIdentity.slug,
  );
}

export function articleIsPresentInLiveSet(article = {}, liveIdentities = []) {
  const articleIdentity = stableWixIdentityForArticle(article);
  return liveIdentities.some((identity) => identitiesOverlap(articleIdentity, identity));
}

export function wasInactiveWixArticle(article = {}) {
  return Boolean(
    article.is_active === false ||
      article.unpublished_at ||
      ["not_live", "unpublished"].includes(clean(article.wix_publication_status)) ||
      ["not_live", "unpublished"].includes(clean(article.wix_sync_status)),
  );
}

export function lifecycleSummary({ active = 0, deactivated = 0, reactivated = 0, errors = [] } = {}) {
  return {
    active_records_updated: Number(active || 0),
    previously_live_records_deactivated: Number(deactivated || 0),
    reactivated_records: Number(reactivated || 0),
    errors: Array.isArray(errors) ? errors : [],
  };
}

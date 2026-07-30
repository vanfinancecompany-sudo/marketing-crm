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

export function isKnowledgeHubUrl(value) {
  const normalizedUrl = normalizeVisibilityUrl(value);
  if (!normalizedUrl) return false;
  try {
    const url = new URL(normalizedUrl);
    const host = url.hostname.replace(/^www\./, "");
    if (host !== "vanfinancecompany.co.uk") return false;
    return /\/(knowledge-hub|knowledge-hub-article)(\/|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function isWixKnowledgeManagedArticle(article = {}, collectionId = "") {
  const configuredCollectionId = clean(collectionId);
  const articleCollectionId = clean(article.wix_collection_id);
  if (configuredCollectionId && articleCollectionId === configuredCollectionId) return true;

  const itemId = clean(article.wix_item_id);
  if (!itemId) return false;

  const hasKnowledgeHubUrl = isKnowledgeHubUrl(article.live_wix_url);
  const syncStatus = lower(article.wix_sync_status);
  const publicationStatus = lower(article.wix_publication_status);
  const hasWixStatus = [
    "live",
    "synced",
    "published",
    "verified",
    "not_live",
    "unpublished",
    "draft",
  ].includes(syncStatus) || [
    "live",
    "published",
    "verified",
    "not_live",
    "unpublished",
    "draft",
  ].includes(publicationStatus);
  const hasWixVerification = Boolean(
    article.publication_verified_at ||
      article.last_wix_verification_at ||
      article.last_wix_sync_at,
  );
  const hasWixNotes = /wix|live collection|data integration|knowledge hub/i.test(
    clean(article.publication_verification_notes),
  );

  // A Wix item ID is required when the configured collection ID is absent.
  // The second signal keeps the scope narrow and avoids treating manual URLs as Wix-managed.
  return Boolean(
    hasKnowledgeHubUrl ||
      (hasWixVerification && hasWixStatus) ||
      (hasWixVerification && hasWixNotes) ||
      (hasWixStatus && hasWixNotes),
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
      ["not_live", "unpublished"].includes(lower(article.wix_publication_status)) ||
      ["not_live", "unpublished"].includes(lower(article.wix_sync_status)),
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

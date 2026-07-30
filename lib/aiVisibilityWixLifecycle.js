const clean = (value) => String(value || "").trim();
const lower = (value) => clean(value).toLowerCase();

const LEGACY_WIX_STATUSES = new Set([
  "live",
  "synced",
  "published",
  "verified",
  "not_live",
  "unpublished",
  "draft",
]);

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

export function articleSpecificKnowledgeHubUrl(value) {
  const normalizedUrl = normalizeVisibilityUrl(value);
  if (!normalizedUrl) return "";
  try {
    const url = new URL(normalizedUrl);
    const host = url.hostname.replace(/^www\./, "");
    if (host !== "vanfinancecompany.co.uk") return "";
    const parts = url.pathname.split("/").filter(Boolean);
    if (!parts.length) return "";
    const section = lower(parts[0]);
    if (!["knowledge-hub", "knowledge-hub-article"].includes(section)) return "";
    if (parts.length < 2 || !clean(parts[1])) return "";
    return normalizedUrl;
  } catch {
    return "";
  }
}

export function isGenericKnowledgeHubUrl(value) {
  return Boolean(isKnowledgeHubUrl(value) && !articleSpecificKnowledgeHubUrl(value));
}

function hasLegacyWixStatus(article = {}) {
  return (
    LEGACY_WIX_STATUSES.has(lower(article.wix_sync_status)) ||
    LEGACY_WIX_STATUSES.has(lower(article.wix_publication_status))
  );
}

function hasHistoricalWixVerification(article = {}) {
  return Boolean(
    article.publication_verified_at ||
      article.last_wix_verification_at ||
      article.last_wix_sync_at ||
      /wix|live collection|data integration|knowledge hub/i.test(
        clean(article.publication_verification_notes),
      ),
  );
}

export function legacyPublishedKnowledgeHubCandidate(article = {}) {
  return Boolean(
    isKnowledgeHubUrl(article.live_wix_url) &&
      article.published_at &&
      article.publication_verified_at &&
      ["live", "synced", "published", "verified", ""].includes(
        lower(article.wix_sync_status),
      ) &&
      ["live", "published", "verified", ""].includes(
        lower(article.wix_publication_status),
      ),
  );
}

export function wixManagementClassification(article = {}, collectionId = "") {
  const configuredCollectionId = clean(collectionId);
  const articleCollectionId = clean(article.wix_collection_id);
  const itemId = clean(article.wix_item_id);
  const knowledgeHubUrl = isKnowledgeHubUrl(article.live_wix_url);
  const wixStatus = hasLegacyWixStatus(article);
  const historicalVerification = hasHistoricalWixVerification(article);
  const legacyPublishedCandidate = legacyPublishedKnowledgeHubCandidate(article);

  if (configuredCollectionId && articleCollectionId === configuredCollectionId) {
    return { managed: true, reason: "configured_wix_collection_id" };
  }
  if (itemId && knowledgeHubUrl) {
    return { managed: true, reason: "wix_item_id_and_knowledge_hub_url" };
  }
  if (itemId && wixStatus && historicalVerification) {
    return { managed: true, reason: "wix_item_id_status_and_verification" };
  }
  if (legacyPublishedCandidate) {
    return {
      managed: true,
      reason: "legacy_published_knowledge_hub_url_and_verification",
    };
  }
  if (!knowledgeHubUrl && !itemId && !articleCollectionId) {
    return { managed: false, reason: "no_stable_wix_or_knowledge_hub_evidence" };
  }
  if (!knowledgeHubUrl && !itemId) {
    return { managed: false, reason: "collection_or_status_without_stable_wix_identity" };
  }
  if (knowledgeHubUrl && !historicalVerification) {
    return { managed: false, reason: "knowledge_hub_url_without_publication_verification" };
  }
  return { managed: false, reason: "insufficient_combined_wix_evidence" };
}

export function isWixKnowledgeManagedArticle(article = {}, collectionId = "") {
  return wixManagementClassification(article, collectionId).managed;
}

export function stableWixIdentityForArticle(article = {}) {
  return {
    wix_item_id: clean(article.wix_item_id),
    canonical_url: articleSpecificKnowledgeHubUrl(article.live_wix_url),
    generic_url_rejected: isGenericKnowledgeHubUrl(article.live_wix_url),
    slug: lower(article.slug),
  };
}

export function stableWixIdentityForItem(item = {}, helpers = {}) {
  const rawUrl = helpers.liveUrl?.(item);
  return {
    wix_item_id: clean(helpers.itemId?.(item)),
    canonical_url: articleSpecificKnowledgeHubUrl(rawUrl),
    generic_url_rejected: isGenericKnowledgeHubUrl(rawUrl),
    slug: lower(helpers.slug?.(item)),
  };
}

export function identityMatch(articleIdentity = {}, liveIdentity = {}) {
  if (
    articleIdentity.wix_item_id &&
    liveIdentity.wix_item_id &&
    articleIdentity.wix_item_id === liveIdentity.wix_item_id
  ) return { matched: true, method: "wix_item_id" };

  if (
    articleIdentity.canonical_url &&
    liveIdentity.canonical_url &&
    articleIdentity.canonical_url === liveIdentity.canonical_url
  ) return { matched: true, method: "article_specific_canonical_url" };

  if (
    articleIdentity.slug &&
    liveIdentity.slug &&
    articleIdentity.slug === liveIdentity.slug
  ) return { matched: true, method: "slug" };

  if (articleIdentity.generic_url_rejected || liveIdentity.generic_url_rejected) {
    return { matched: false, method: "rejected_generic_url" };
  }
  return { matched: false, method: "no_stable_identity_match" };
}

export function identitiesOverlap(articleIdentity = {}, liveIdentity = {}) {
  return identityMatch(articleIdentity, liveIdentity).matched;
}

export function articleLiveSetMatch(article = {}, liveIdentities = []) {
  const articleIdentity = stableWixIdentityForArticle(article);
  let rejectedGenericUrl = Boolean(articleIdentity.generic_url_rejected);
  for (const identity of liveIdentities) {
    const result = identityMatch(articleIdentity, identity);
    if (result.matched) return result;
    if (result.method === "rejected_generic_url") rejectedGenericUrl = true;
  }
  return {
    matched: false,
    method: rejectedGenericUrl ? "rejected_generic_url" : "no_stable_identity_match",
  };
}

export function articleIsPresentInLiveSet(article = {}, liveIdentities = []) {
  return articleLiveSetMatch(article, liveIdentities).matched;
}

export function deactivationSelectionReason(
  article = {},
  liveIdentities = [],
  collectionId = "",
) {
  const classification = wixManagementClassification(article, collectionId);
  if (!classification.managed) {
    return {
      selected: false,
      management_reason: classification.reason,
      selection_reason: "not_wix_managed",
    };
  }
  const liveMatch = articleLiveSetMatch(article, liveIdentities);
  if (liveMatch.matched) {
    return {
      selected: false,
      management_reason: classification.reason,
      selection_reason: `present_in_current_wix_live_set_by_${liveMatch.method}`,
    };
  }
  if (article.is_active === false && lower(article.wix_publication_status) === "unpublished") {
    return {
      selected: false,
      management_reason: classification.reason,
      selection_reason: "already_inactive",
    };
  }
  return {
    selected: true,
    management_reason: classification.reason,
    selection_reason:
      liveMatch.method === "rejected_generic_url"
        ? "generic_knowledge_hub_url_is_not_article_identity"
        : "published_wix_record_missing_from_live_set",
  };
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

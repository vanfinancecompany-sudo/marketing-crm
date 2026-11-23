const IDENTIFIER = /^\d{1,32}$/;
const MESSAGE_ID = /^[a-z0-9_.:$-]{1,160}$/i;
const PRODUCT_BY_ACTIVITY = {
  van_finance_marketplace_post: "finance",
  rent2buy_marketplace_post: "rent2buy",
  rent2buy_facebook_post: "rent2buy",
};
const DESTINATION_BY_PRODUCT = {
  finance: "Van Finance Marketplace",
  rent2buy: "Rent2Buy Marketplace",
};

export function marketplaceListingId(url) {
  if (typeof url !== "string") return null;
  try {
    const parsed = new URL(url, "https://www.facebook.com");
    if (!["https://www.facebook.com", "https://facebook.com"].includes(parsed.origin)) return null;
    return parsed.pathname.match(/^\/marketplace\/item\/(\d{1,32})\/?$/)?.[1] || null;
  } catch {
    return null;
  }
}

export function marketplaceRegistry(receipts) {
  const result = new Map();
  for (const { activity_type, metadata = {} } of receipts) {
    const listingId = marketplaceListingId(metadata.marketplace_listing_url);
    if (!listingId) continue;
    const product = Object.hasOwn(PRODUCT_BY_ACTIVITY, activity_type) ? PRODUCT_BY_ACTIVITY[activity_type] : null;
    const destination = metadata.destination;
    const registration = String(metadata.registration || "").toUpperCase().replace(/\s/g, "");
    const valid = product && /^(?:[A-Z0-9]{4,10})$/.test(registration)
      && (destination === DESTINATION_BY_PRODUCT[product]
        || (product === "rent2buy" && destination === "Facebook Marketplace"));
    const existing = result.get(listingId);
    if (!valid || (existing && (existing.product !== product || existing.registration !== registration))) {
      result.set(listingId, { reason: "Conflicting or incomplete listing receipt" });
    } else if (!existing) {
      result.set(listingId, { product, registration });
    }
  }
  return result;
}

export const FIXTURE_RECEIPTS = [
  {
    activity_type: "van_finance_marketplace_post",
    metadata: {
      destination: "Van Finance Marketplace",
      marketplace_listing_url: "https://www.facebook.com/marketplace/item/1001/",
      registration: "SIM01F",
    },
  },
  {
    activity_type: "rent2buy_marketplace_post",
    metadata: {
      destination: "Rent2Buy Marketplace",
      marketplace_listing_url: "https://www.facebook.com/marketplace/item/2002/",
      registration: "SIM02R",
    },
  },
];

export function inspectInboxSnapshot({ health, threads }, audit, registry, recovering) {
  if (!["healthy", "signed-out", "security-challenge", "layout-changed"].includes(health)
      || !Array.isArray(threads) || threads.length > 16) throw new TypeError("Invalid observer snapshot");
  const accepted = [];
  const counts = {
    baseline: 0, duplicate: 0, outgoing: 0, unread: 0, unreadNotices: 0, closed: 0,
    identity: 0, unmatched: 0, historical: 0, heldForReview: 0,
  };
  const previouslyReady = new Set(recovering ? [] : audit.ready);
  const ready = new Set();
  const unread = new Set(audit.unread);
  const ledger = audit.ledger;
  audit.ready = [];
  if (health !== "healthy") return { health, accepted, counts };

  for (const thread of threads) {
    if (!thread || typeof thread.id !== "string" || !IDENTIFIER.test(thread.id)) {
      counts.identity++;
      continue;
    }
    if (thread.open === false) counts.closed++;
    if (thread.alreadyRead === false) {
      counts.unread++;
      if (!unread.has(thread.id)) counts.unreadNotices++;
      unread.add(thread.id);
      continue;
    }
    if (thread.alreadyRead === true) unread.delete(thread.id);
    if (thread.open === false) continue;
    if (thread.alreadyRead !== true) {
      counts.identity++;
      continue;
    }
    const listingId = marketplaceListingId(thread.listingUrl);
    const receipt = registry.get(listingId);
    if (!receipt?.product) {
      counts.unmatched++;
      continue;
    }
    if (thread.historyReady !== true || !Array.isArray(thread.messages) || thread.messages.length > 64) {
      counts.identity++;
      continue;
    }

    const prior = ledger[thread.id];
    if (prior && prior.listingId !== listingId) {
      counts.unmatched++;
      continue;
    }
    ready.add(thread.id);
    const seen = new Set(prior?.seen || []);
    let cursor = prior?.cursor || 0;
    for (const message of thread.messages) {
      if (message?.direction === "outgoing") {
        counts.outgoing++;
        continue;
      }
      if (message?.direction !== "incoming" || typeof message.id !== "string" || !MESSAGE_ID.test(message.id)
          || !Number.isSafeInteger(message.sequence) || message.sequence < 1) {
        counts.identity++;
        continue;
      }
      if (seen.has(message.id)) {
        counts.duplicate++;
        continue;
      }
      seen.add(message.id);
      cursor = Math.max(cursor, message.sequence);
      if (!prior) {
        counts.baseline++;
        continue;
      }
      if (message.sequence <= prior.cursor) {
        counts.historical++;
        continue;
      }
      if (!previouslyReady.has(thread.id)) {
        counts.heldForReview++;
        continue;
      }
      accepted.push({ threadId: thread.id, listingId, messageId: message.id, product: receipt.product });
    }
    if (cursor > 0) ledger[thread.id] = { listingId, cursor, seen: [...seen] };
  }
  audit.ready = [...ready];
  audit.unread = [...unread];
  return { health, accepted, counts };
}

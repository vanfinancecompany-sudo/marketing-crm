import crypto from "node:crypto";
import {
  loadCarslinkSyncStatus,
  saveCarslinkSyncStatus,
} from "./carslinkSyncState.js";

const CARSLINK_ENDPOINT = "https://api.carslink.ai/api/v1/stock";
const FULL_STOCK_LIMIT = 500;
const FORCE_REFRESH_MS = 12 * 60 * 60 * 1000;
const VFC_PUBLIC_ORIGIN = "https://www.vanfinancecompany.co.uk";
const DEFAULT_DEALER_PHONE = "0330 133 6376";
const DEFAULT_DEALER_EMAIL = "sales@vanfinancecompany.co.uk";

const COLOUR_RULES = [
  ["Black", /\b(?:black|panther black|shadow black|agate black)\b/i],
  ["White", /\b(?:white|frozen white|arctic white|polar white|diamond white|ice white)\b/i],
  ["Silver", /\b(?:silver|moondust silver|metallic silver)\b/i],
  ["Grey", /\b(?:grey|gray|magnetic grey|magnetic gray|graphite grey|graphite gray|nardo grey|nardo gray)\b/i],
  ["Blue", /\b(?:blue|blazer blue|chrome blue|deep impact blue|navy blue)\b/i],
  ["Red", /\b(?:red|race red|solid red)\b/i],
  ["Green", /\b(?:green|british racing green)\b/i],
  ["Orange", /\borange\b/i],
  ["Yellow", /\byellow\b/i],
  ["Brown", /\bbrown\b/i],
  ["Beige", /\bbeige\b/i],
  ["Bronze", /\bbronze\b/i],
  ["Gold", /\bgold\b/i],
  ["Purple", /\bpurple\b/i],
];

function requestOrigin(request) {
  const protocol = request?.headers?.["x-forwarded-proto"] || "https";
  const host = request?.headers?.host;
  if (!host) throw new Error("Unable to determine deployment host for CarsLink payload preview.");
  return `${protocol}://${host}`;
}

function stableFingerprint(preview, listings) {
  const stableListings = [...listings].sort((a, b) => {
    const first = String(a?.source_id || a?.registration || "");
    const second = String(b?.source_id || b?.registration || "");
    return first.localeCompare(second);
  });
  const stableSkipped = [...(preview?.skipped || [])].sort((a, b) => {
    const first = String(a?.registration || a?.source_id || a?.reason || "");
    const second = String(b?.registration || b?.source_id || b?.reason || "");
    return first.localeCompare(second);
  });
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({
      source_count: Number(preview?.source_count || 0),
      listings: stableListings,
      skipped: stableSkipped,
    }))
    .digest("hex");
}

function syncIdFrom(carslink) {
  return String(carslink?.sync_id || carslink?.syncId || "").trim();
}

function queuedCountFrom(carslink, fallback) {
  const value = carslink?.queued_count ?? carslink?.queuedCount ?? carslink?.sent_count ?? carslink?.sentCount;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number(fallback || 0);
}

function isRefreshDue(previous, nowMs) {
  if (!previous?.lastSuccessAt) return true;
  const last = new Date(previous.lastSuccessAt).getTime();
  if (!Number.isFinite(last)) return true;
  return nowMs - last >= FORCE_REFRESH_MS;
}

function normalizeListingUrl(value, registration) {
  const raw = String(value || "").trim();
  const fallback = `${VFC_PUBLIC_ORIGIN}/van-finance/${encodeURIComponent(String(registration || "").toLowerCase())}`;
  if (!raw) return fallback;
  try {
    const parsed = new URL(raw, VFC_PUBLIC_ORIGIN);
    return `${VFC_PUBLIC_ORIGIN}${parsed.pathname}${parsed.search}`;
  } catch {
    return raw.startsWith("/") ? `${VFC_PUBLIC_ORIGIN}${raw}` : fallback;
  }
}

function colourFromListing(listing) {
  const text = [
    listing?.colour,
    listing?.color,
    listing?.variant,
    listing?.description,
    listing?.options,
  ].filter(Boolean).join(" ");
  for (const [colour, pattern] of COLOUR_RULES) {
    if (pattern.test(text)) return colour;
  }
  return "";
}

function enrichCarslinkPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;

  const dealer = {
    ...(payload.dealer || {}),
    phone: String(payload?.dealer?.phone || DEFAULT_DEALER_PHONE).trim(),
    email: String(payload?.dealer?.email || DEFAULT_DEALER_EMAIL).trim(),
    website: VFC_PUBLIC_ORIGIN,
  };

  const listings = Array.isArray(payload.listings)
    ? payload.listings.map((listing) => {
        const colour = colourFromListing(listing);
        return {
          ...listing,
          listing_url: normalizeListingUrl(listing?.listing_url, listing?.registration || listing?.source_id),
          ...(colour ? { colour } : {}),
        };
      })
    : [];

  return { ...payload, dealer, listings };
}

export async function runCarslinkProductionSync({ request, trigger = "manual", force = false } = {}) {
  const productionKey = String(process.env.CARSLINK_PRODUCTION_API_KEY || "").trim();
  if (!productionKey) {
    const error = new Error("CARSLINK_PRODUCTION_API_KEY is not configured in the deployment environment.");
    error.statusCode = 503;
    throw error;
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const previous = await loadCarslinkSyncStatus();
  let preview = null;
  let listings = [];
  let fingerprint = previous?.fingerprint || "";

  try {
    const previewUrl = `${requestOrigin(request)}/api/carslink-sandbox-sync?limit=${FULL_STOCK_LIMIT}`;
    const previewResponse = await fetch(previewUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    preview = await previewResponse.json().catch(() => ({}));

    if (!previewResponse.ok) {
      const error = new Error(preview?.error || `CarsLink payload preview returned HTTP ${previewResponse.status}.`);
      error.statusCode = previewResponse.status;
      throw error;
    }

    const payload = enrichCarslinkPayload(preview?.payload);
    listings = Array.isArray(payload?.listings) ? payload.listings : [];
    if (!payload || listings.length < 1) {
      const error = new Error("No valid listings were available for the CarsLink production sync.");
      error.statusCode = 422;
      throw error;
    }

    fingerprint = stableFingerprint(preview, listings);
    const changed = !previous?.fingerprint || previous.fingerprint !== fingerprint;
    const refreshDue = isRefreshDue(previous, now.getTime());
    const skipped = Array.isArray(preview?.skipped) ? preview.skipped : [];
    const sourceCount = Number(preview?.source_count || 0);

    if (!force && !changed && !refreshDue) {
      const status = await saveCarslinkSyncStatus({
        ...previous,
        automaticEnabled: true,
        state: "healthy",
        lastAction: "checked-no-change",
        lastTrigger: trigger,
        lastCheckedAt: nowIso,
        sourceCount,
        eligibleCount: listings.length,
        skippedCount: skipped.length,
        skipped,
        fingerprint,
        lastError: "",
      });

      return {
        ok: true,
        sent: false,
        reason: "unchanged",
        source_count: sourceCount,
        sent_count: listings.length,
        local_skipped: skipped,
        status,
      };
    }

    await saveCarslinkSyncStatus({
      ...previous,
      automaticEnabled: true,
      state: "syncing",
      lastAction: changed ? "syncing-change" : refreshDue ? "syncing-refresh" : "syncing-manual",
      lastTrigger: trigger,
      lastCheckedAt: nowIso,
      lastAttemptAt: nowIso,
      sourceCount,
      eligibleCount: listings.length,
      skippedCount: skipped.length,
      skipped,
      fingerprint,
      lastError: "",
    });

    const carslinkResponse = await fetch(CARSLINK_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${productionKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const carslink = await carslinkResponse.json().catch(() => ({}));

    if (!carslinkResponse.ok) {
      const error = new Error(carslink?.message || carslink?.error || `CarsLink returned HTTP ${carslinkResponse.status}.`);
      error.statusCode = carslinkResponse.status;
      error.carslink = carslink;
      throw error;
    }

    const syncId = syncIdFrom(carslink);
    const queuedCount = queuedCountFrom(carslink, listings.length);
    const status = await saveCarslinkSyncStatus({
      ...previous,
      automaticEnabled: true,
      state: "healthy",
      lastAction: "synced",
      lastTrigger: trigger,
      lastCheckedAt: nowIso,
      lastAttemptAt: nowIso,
      lastSuccessAt: nowIso,
      syncId,
      sourceCount,
      eligibleCount: listings.length,
      queuedCount,
      skippedCount: skipped.length,
      skipped,
      fingerprint,
      lastError: "",
    });

    return {
      ok: true,
      sent: true,
      environment: "production",
      source_count: sourceCount,
      sent_count: listings.length,
      local_skipped: skipped,
      carslink,
      status,
    };
  } catch (error) {
    const skipped = Array.isArray(preview?.skipped) ? preview.skipped : previous?.skipped || [];
    const sourceCount = Number(preview?.source_count || previous?.sourceCount || 0);
    await saveCarslinkSyncStatus({
      ...previous,
      automaticEnabled: true,
      state: "error",
      lastAction: "error",
      lastTrigger: trigger,
      lastCheckedAt: nowIso,
      lastAttemptAt: listings.length ? nowIso : previous?.lastAttemptAt || null,
      sourceCount,
      eligibleCount: listings.length || Number(previous?.eligibleCount || 0),
      skippedCount: skipped.length,
      skipped,
      fingerprint,
      lastError: error?.message || "CarsLink production sync failed.",
    });
    throw error;
  }
}

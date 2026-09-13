import { normalizeRegistration } from "./_vansco-cache-utils.js";
import { DealerKitSnapshotIncompleteError, fetchDealerKitStockSnapshot } from "./_dealerkit-stock-adapter.js";
import { loadLiveWixListingPresence } from "./stock-watch-wix-listing-presence.js";
import { dealerKitVehicleBelongsToPipeline } from "../lib/dealerKitVehicleSegmentation.js";

const CMS_TIMEOUT_MS = 12000;
const WIX_QUERY_URL = "https://www.wixapis.com/wix-data/v2/items/query";
const WIX_PAGE_SIZE = 100;
const MAX_WIX_ROWS = 2000;
const FINANCE_WIX_SITE_ID = "85f11c52-ee54-495d-aaec-a351831709b5";
const SUPPORTED_PIPELINES = new Set(["finance", "rent2buy", "cars"]);
export const MIN_DEALERKIT_IMAGE_COUNT = 5;
export const MAX_PLACEHOLDER_ADVERT_IMAGES = 2;

const CMS_ENDPOINTS = {
  finance: "https://www.vanfinancecompany.co.uk/_functions/marketingVanFinanceImages",
  rent2buy: "https://www.vanfinancecompany.co.uk/_functions/marketingRent2BuyImages",
};

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function extractRegistration(value) {
  const text = compact(value).toUpperCase();
  const match = text.match(/\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/);
  return normalizeRegistration(match?.[1] || "");
}

function relevantAdvertPipelines(pipeline) {
  return SUPPORTED_PIPELINES.has(pipeline) ? [pipeline] : [];
}

function cmsRegistration(row) {
  return normalizeRegistration(row?.registration || row?.title || "");
}

function cmsImageCount(row) {
  const explicitCount = Number(row?.imageCount ?? row?.numberOfImages);
  const arrays = [row?.images, row?.mainImages, row?.gallery]
    .filter(Array.isArray)
    .map((items) => items.filter(Boolean).length);
  const galleryCount = arrays.length ? Math.max(...arrays) : 0;
  if (Number.isFinite(explicitCount) && explicitCount >= 0) return Math.max(explicitCount, galleryCount);
  return galleryCount;
}

function imageCountMap(items = []) {
  const counts = new Map();
  for (const item of items) {
    const registration = cmsRegistration(item);
    if (!registration) continue;
    const count = cmsImageCount(item);
    counts.set(registration, Math.max(counts.get(registration) || 0, count));
  }
  return counts;
}

function normalizeListingPresence(presence = {}) {
  const registrations = new Set((presence.registrations || []).map(normalizeRegistration).filter(Boolean));
  const vehicles = new Map();
  for (const vehicle of presence.vehicles || []) {
    const registration = normalizeRegistration(vehicle?.registration || "");
    if (registration && !vehicles.has(registration)) vehicles.set(registration, vehicle);
  }
  return { registrations, vehicles };
}

function listingPresenceFromLegacyLocal(localVehicles = [], pipeline = "finance") {
  const vehicles = [];
  for (const row of localVehicles) {
    const registration = normalizeRegistration(row?.registration || row?.reg || "")
      || extractRegistration(row?.title || row?.name || "");
    if (!registration) continue;
    vehicles.push({
      registration,
      title: compact(row?.title || row?.name || registration),
      webLink: compact(row?.weblink || row?.webLink || row?.link || ""),
      picture: compact(row?.picture || row?.image || row?.imageUrl || ""),
      pipeline,
    });
  }
  return { registrations: vehicles.map((vehicle) => vehicle.registration), vehicles };
}

export function buildDealerKitImageReadinessAlerts({
  pipeline,
  listingPresenceByPipeline = null,
  cmsItemsByPipeline = null,
  localVehicles = [],
  cmsItems = [],
  dealerKitVehicles = [],
} = {}) {
  const normalizedPipeline = compact(pipeline).toLowerCase();
  if (!SUPPORTED_PIPELINES.has(normalizedPipeline)) return [];

  // Every Stock Watch lane compares only against its own live advert. A full
  // Rent2Buy gallery must not suppress a Finance due-in alert, and vice versa.
  const relevantPipelines = relevantAdvertPipelines(normalizedPipeline);
  const presenceByPipeline = listingPresenceByPipeline || {
    [normalizedPipeline]: listingPresenceFromLegacyLocal(localVehicles, normalizedPipeline),
  };
  const pagesByPipeline = cmsItemsByPipeline || { [normalizedPipeline]: cmsItems };

  const listingByPipeline = Object.fromEntries(relevantPipelines.map((product) => [
    product,
    normalizeListingPresence(presenceByPipeline?.[product] || {}),
  ]));
  const imageCountsByPipeline = Object.fromEntries(relevantPipelines.map((product) => [
    product,
    imageCountMap(pagesByPipeline?.[product] || []),
  ]));

  const alerts = [];
  for (const dealerKitVehicle of dealerKitVehicles) {
    if (!dealerKitVehicleBelongsToPipeline(dealerKitVehicle, normalizedPipeline)) continue;
    const registration = normalizeRegistration(dealerKitVehicle?.registration || "");
    if (!registration) continue;

    const sourceImageCount = Number(dealerKitVehicle?.imageCount ?? dealerKitVehicle?.images?.length);
    if (!Number.isFinite(sourceImageCount) || sourceImageCount < MIN_DEALERKIT_IMAGE_COUNT) continue;

    const advertisedPipelines = relevantPipelines.filter((product) => listingByPipeline[product].registrations.has(registration));
    if (!advertisedPipelines.length) continue;

    const advertisedImageCounts = {};
    let currentAdvertImageCount = 0;
    let referencePipeline = advertisedPipelines[0];
    for (const product of advertisedPipelines) {
      const reportedCount = imageCountsByPipeline[product].get(registration) || 0;
      // The public image feed can report zero when the live advert is showing only
      // its primary/hero image. Presence in the live listing proves there is an
      // advert, so use one as the safe floor instead of losing a genuine due-in
      // alert such as BD21HCX (Finance 1 image, DealerKit 19 images).
      const effectiveCount = reportedCount > 0 ? reportedCount : 1;
      advertisedImageCounts[product] = effectiveCount;
      if (effectiveCount > currentAdvertImageCount) {
        currentAdvertImageCount = effectiveCount;
        referencePipeline = product;
      }
    }

    // Photo readiness is a due-in/placeholder alert, not a general image-count diff.
    // Once this lane's advert has a normal gallery (3+ images), later DealerKit
    // additions should not create another work item.
    if (currentAdvertImageCount < 1 || currentAdvertImageCount > MAX_PLACEHOLDER_ADVERT_IMAGES) continue;
    if (sourceImageCount <= currentAdvertImageCount) continue;

    const referenceListing = listingByPipeline[referencePipeline].vehicles.get(registration) || null;
    const selectedListing = listingByPipeline[normalizedPipeline]?.vehicles.get(registration) || referenceListing;

    alerts.push({
      id: `images-ready-${normalizedPipeline}-${registration}`,
      pipeline: normalizedPipeline,
      displayStatus: "images_ready",
      matchStatus: "images_ready",
      imageReadinessAlert: true,
      registration,
      title: compact(dealerKitVehicle.title || referenceListing?.title || registration),
      imageUrl: compact(dealerKitVehicle?.primaryImage?.url || dealerKitVehicle?.images?.[0]?.url || selectedListing?.picture || referenceListing?.picture || ""),
      stockUrl: compact(dealerKitVehicle.sourceUrl || ""),
      localStockUrl: compact(selectedListing?.webLink || selectedListing?.weblink || referenceListing?.webLink || referenceListing?.weblink || ""),
      sourceStatus: compact(dealerKitVehicle.sourceStatus || dealerKitVehicle.status || "unknown"),
      workflowStatus: "",
      notes: "",
      safeExactRegistrationMatch: true,
      cmsImageCount: currentAdvertImageCount,
      currentAdvertImageCount,
      sourceImageCount,
      newImageCount: sourceImageCount - currentAdvertImageCount,
      advertisedPipelines,
      advertisedImageCounts,
      referencePipeline,
      crossProductEvidence: false,
      sourceCheckedAt: dealerKitVehicle.checkedAt || "",
      supplierStockId: compact(dealerKitVehicle.supplierStockId || ""),
    });
  }

  return alerts.sort((a, b) => b.newImageCount - a.newImageCount || b.sourceImageCount - a.sourceImageCount || a.registration.localeCompare(b.registration));
}

async function fetchPublicCmsItems(pipeline, fetchImplementation = fetch) {
  const endpoint = CMS_ENDPOINTS[pipeline];
  if (!endpoint) return { items: [], refreshedAt: "" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CMS_TIMEOUT_MS);
  try {
    const response = await fetchImplementation(endpoint, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`${pipeline} CMS vehicle-page feed returned ${response.status}.`);
    const payload = await response.json();
    if (!Array.isArray(payload?.items)) throw new Error(`${pipeline} CMS vehicle-page feed did not return an items array.`);
    return { items: payload.items, refreshedAt: compact(payload.refreshedAt) };
  } finally {
    clearTimeout(timeout);
  }
}

function wixHeaders(environment = process.env) {
  const apiKey = compact(environment.WIX_CAR_API_KEY || environment.WIX_FINANCE_API_KEY || environment.WIX_API_KEY);
  const siteId = compact(environment.WIX_CAR_SITE_ID || environment.WIX_FINANCE_SITE_ID || environment.WIX_SITE_ID || FINANCE_WIX_SITE_ID);
  if (!apiKey) throw new Error("Cars Wix image readiness is not configured.");
  return {
    siteId,
    headers: {
      "Content-Type": "application/json",
      "wix-site-id": siteId,
      Authorization: apiKey,
    },
  };
}

function itemPublishStatus(item) {
  return compact(item?.data?._publishStatus || item?._publishStatus || "").toUpperCase();
}

async function fetchCarCmsItems(fetchImplementation = fetch, environment = process.env) {
  const { headers } = wixHeaders(environment);
  const items = [];
  let refreshedAt = "";

  for (let offset = 0; offset < MAX_WIX_ROWS; offset += WIX_PAGE_SIZE) {
    const response = await fetchImplementation(WIX_QUERY_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        dataCollectionId: "CARPAGES",
        query: { paging: { limit: WIX_PAGE_SIZE, offset } },
        consistentRead: true,
      }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Cars CMS vehicle-page feed returned ${response.status}.`);
    const payload = await response.json();
    const page = Array.isArray(payload?.dataItems) ? payload.dataItems : [];
    for (const item of page) {
      const status = itemPublishStatus(item);
      if (status && status !== "PUBLISHED") continue;
      const data = item?.data || {};
      const registration = normalizeRegistration(data.title || data.registration || data.reg || "");
      if (!registration) continue;
      const updated = data?._updatedDate?.$date || data?._updatedDate || item?._updatedDate?.$date || item?._updatedDate || "";
      if (updated && (!refreshedAt || new Date(updated).getTime() > new Date(refreshedAt).getTime())) refreshedAt = new Date(updated).toISOString();
      items.push({
        registration,
        title: compact(data.titleText || data.title || registration),
        imageCount: Number(data.numberOfImages),
        images: Array.isArray(data.mainImages) ? data.mainImages : [],
      });
    }
    if (page.length < WIX_PAGE_SIZE) break;
  }

  return { items, refreshedAt };
}

async function fetchCmsItems(pipeline, fetchImplementation = fetch, environment = process.env) {
  if (pipeline === "cars") return fetchCarCmsItems(fetchImplementation, environment);
  return fetchPublicCmsItems(pipeline, fetchImplementation);
}

function safeDealerKitDiagnostics(error) {
  const diagnostics = error?.diagnostics || {};
  return {
    apiReportedTotal: diagnostics.apiReportedTotal ?? null,
    recordsFetched: diagnostics.recordsFetched ?? null,
    stableReportedTotal: diagnostics.stableReportedTotal ?? null,
    invalidRecords: Array.isArray(diagnostics.invalidRecords) ? diagnostics.invalidRecords.slice(0, 25) : [],
    duplicateSupplierStockIds: Array.isArray(diagnostics.duplicateSupplierStockIds) ? diagnostics.duplicateSupplierStockIds.slice(0, 25) : [],
    duplicateRegistrations: Array.isArray(diagnostics.duplicateRegistrations) ? diagnostics.duplicateRegistrations.slice(0, 25) : [],
    failedPages: Array.isArray(diagnostics.failedPages) ? diagnostics.failedPages.slice(0, 25) : [],
    failedPositions: Array.isArray(diagnostics.failedPositions) ? diagnostics.failedPositions.slice(0, 25) : [],
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") return response.status(405).json({ ok: false, message: "Method not allowed." });

  const pipeline = compact(request.query?.pipeline || "finance").toLowerCase();
  if (!SUPPORTED_PIPELINES.has(pipeline)) {
    return response.status(400).json({ ok: false, message: "Image readiness is available for Finance, Rent2Buy and Cars only." });
  }

  try {
    const relevantPipelines = relevantAdvertPipelines(pipeline);
    const [dealerKitSnapshot, listingEntries, cmsEntries] = await Promise.all([
      fetchDealerKitStockSnapshot({ allowPartial: true }),
      Promise.all(relevantPipelines.map(async (product) => [product, await loadLiveWixListingPresence(product)])),
      Promise.all(relevantPipelines.map(async (product) => [product, await fetchCmsItems(product)])),
    ]);

    const listingPresenceByPipeline = Object.fromEntries(listingEntries);
    const cmsFeedByPipeline = Object.fromEntries(cmsEntries);
    const incompleteListing = relevantPipelines.find((product) => listingPresenceByPipeline[product]?.complete === false);
    if (incompleteListing) throw new Error(`${incompleteListing} live Wix listing presence is incomplete, so photo readiness was not guessed.`);

    const sourceDegraded = dealerKitSnapshot.complete === false;
    const alerts = buildDealerKitImageReadinessAlerts({
      pipeline,
      listingPresenceByPipeline,
      cmsItemsByPipeline: Object.fromEntries(relevantPipelines.map((product) => [product, cmsFeedByPipeline[product]?.items || []])),
      dealerKitVehicles: dealerKitSnapshot.vehicles,
    });

    const liveAdvertRegistrations = new Set();
    const cmsRegistrations = new Set();
    let singleImageCmsPages = 0;
    for (const product of relevantPipelines) {
      (listingPresenceByPipeline[product]?.registrations || []).forEach((registration) => {
        const normalized = normalizeRegistration(registration);
        if (normalized) liveAdvertRegistrations.add(normalized);
      });
      for (const item of cmsFeedByPipeline[product]?.items || []) {
        const registration = cmsRegistration(item);
        if (registration) cmsRegistrations.add(registration);
        if (registration && cmsImageCount(item) === 1) singleImageCmsPages += 1;
      }
    }

    const refreshedTimes = relevantPipelines
      .map((product) => cmsFeedByPipeline[product]?.refreshedAt)
      .filter(Boolean)
      .map((value) => new Date(value))
      .filter((value) => Number.isFinite(value.getTime()))
      .sort((a, b) => b.getTime() - a.getTime());

    return response.status(200).json({
      ok: true,
      pipeline,
      sourceAvailable: true,
      degraded: sourceDegraded,
      diagnostics: sourceDegraded ? dealerKitSnapshot.diagnostics : undefined,
      alerts,
      summary: {
        liveAdvertisedRegistrations: liveAdvertRegistrations.size,
        localAdvertisedRegistrations: liveAdvertRegistrations.size,
        cmsVehiclePages: cmsRegistrations.size,
        singleImageCmsPages,
        dealerKitVehiclesAvailable: dealerKitSnapshot.vehicleCount,
        imageUpdatesReady: alerts.length,
        sourceCheckedAt: dealerKitSnapshot.checkedAt,
        cmsRefreshedAt: refreshedTimes[0]?.toISOString() || "",
        complete: !sourceDegraded,
        degraded: sourceDegraded,
        sourceAvailable: true,
        minimumDealerKitImageCount: MIN_DEALERKIT_IMAGE_COUNT,
        maximumPlaceholderAdvertImages: MAX_PLACEHOLDER_ADVERT_IMAGES,
        crossProduct: false,
        comparisonScope: "selected_pipeline_only",
        comparedPipelines: relevantPipelines,
        rule: "Alert only when this Stock Watch lane has a live advert with 1 or 2 placeholder/due-in images, DealerKit has at least 5 images, and DealerKit now has more images. A live advert reported as zero by the CMS image feed is treated as one visible primary image. Other product lanes do not suppress the alert.",
      },
    });
  } catch (error) {
    const incomplete = error instanceof DealerKitSnapshotIncompleteError || error?.name === "DealerKitSnapshotIncompleteError";
    return response.status(incomplete ? 503 : 500).json({
      ok: false,
      pipeline,
      sourceAvailable: false,
      message: incomplete
        ? `${error.message} Image readiness has been fail-closed; no zero-result assumption was made.`
        : error?.name === "AbortError"
          ? "CMS vehicle-page image feed timed out."
          : error?.message || "Could not check DealerKit image readiness.",
      summary: { imageUpdatesReady: 0, complete: false, sourceAvailable: false },
      diagnostics: incomplete ? safeDealerKitDiagnostics(error) : undefined,
    });
  }
}

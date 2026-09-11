import { getSupabaseAdmin, normalizeRegistration } from "./_vansco-cache-utils.js";
import { DealerKitSnapshotIncompleteError, fetchDealerKitStockSnapshot } from "./_dealerkit-stock-adapter.js";

const STOCK_LIMIT = 1000;
const CMS_TIMEOUT_MS = 12000;
export const MIN_DEALERKIT_IMAGE_COUNT = 5;

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

function localRegistration(row, pipeline) {
  if (pipeline === "rent2buy") return normalizeRegistration(row?.registration || "");
  return normalizeRegistration(row?.registration || extractRegistration(row?.title || ""));
}

function localVehicleUrl(row, pipeline) {
  return compact(pipeline === "rent2buy" ? row?.webLink : row?.weblink);
}

function cmsRegistration(row) {
  return normalizeRegistration(row?.registration || row?.title || "");
}

function cmsImageCount(row) {
  const explicitCount = Number(row?.imageCount);
  const galleryCount = Array.isArray(row?.images) ? row.images.filter(Boolean).length : 0;
  if (Number.isFinite(explicitCount) && explicitCount >= 0) return Math.max(explicitCount, galleryCount);
  return galleryCount;
}

export function buildDealerKitImageReadinessAlerts({ pipeline, localVehicles = [], cmsItems = [], dealerKitVehicles = [] }) {
  if (!CMS_ENDPOINTS[pipeline]) return [];

  const localByRegistration = new Map();
  for (const row of localVehicles) {
    const registration = localRegistration(row, pipeline);
    if (!registration || localByRegistration.has(registration)) continue;
    localByRegistration.set(registration, row);
  }

  const sourceByRegistration = new Map();
  for (const vehicle of dealerKitVehicles) {
    const registration = normalizeRegistration(vehicle?.registration || "");
    if (!registration || sourceByRegistration.has(registration)) continue;
    sourceByRegistration.set(registration, vehicle);
  }

  const alerts = [];
  for (const page of cmsItems) {
    const registration = cmsRegistration(page);
    if (!registration) continue;

    const localVehicle = localByRegistration.get(registration);
    if (!localVehicle) continue;

    const pageImageCount = cmsImageCount(page);
    if (pageImageCount !== 1) continue;

    const dealerKitVehicle = sourceByRegistration.get(registration);
    const sourceImageCount = Number(dealerKitVehicle?.imageCount);
    if (!dealerKitVehicle || !Number.isFinite(sourceImageCount) || sourceImageCount < MIN_DEALERKIT_IMAGE_COUNT) continue;

    alerts.push({
      id: `images-ready-${pipeline}-${registration}`,
      pipeline,
      displayStatus: "images_ready",
      matchStatus: "images_ready",
      registration,
      title: compact(dealerKitVehicle.title || page.title || localVehicle.title || registration),
      imageUrl: compact(dealerKitVehicle?.primaryImage?.url || dealerKitVehicle?.images?.[0]?.url || localVehicle.picture || ""),
      stockUrl: compact(dealerKitVehicle.sourceUrl || ""),
      localStockUrl: localVehicleUrl(localVehicle, pipeline),
      sourceStatus: compact(dealerKitVehicle.sourceStatus || dealerKitVehicle.status || "unknown"),
      workflowStatus: "",
      notes: "",
      safeExactRegistrationMatch: true,
      cmsImageCount: pageImageCount,
      sourceImageCount,
      sourceCheckedAt: dealerKitVehicle.checkedAt || "",
      supplierStockId: compact(dealerKitVehicle.supplierStockId || ""),
    });
  }

  return alerts.sort((a, b) => b.sourceImageCount - a.sourceImageCount || a.registration.localeCompare(b.registration));
}

async function fetchCmsItems(pipeline, fetchImplementation = fetch) {
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
    if (!response.ok) throw new Error(`CMS vehicle-page feed returned ${response.status}.`);
    const payload = await response.json();
    if (!Array.isArray(payload?.items)) throw new Error("CMS vehicle-page feed did not return an items array.");
    return { items: payload.items, refreshedAt: compact(payload.refreshedAt) };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchLocalVehicles(supabase, pipeline) {
  if (pipeline === "finance") {
    const { data, error } = await supabase
      .from("facebook_adverts")
      .select("id, title, picture, weblink, is_active")
      .eq("is_active", true)
      .limit(STOCK_LIMIT);
    if (error) throw new Error(`Could not load active Finance CRM stock: ${error.message}`);
    return data || [];
  }

  const { data, error } = await supabase
    .from("rent_vehicles")
    .select("id, registration, picture, webLink, is_active")
    .eq("is_active", true)
    .limit(STOCK_LIMIT);
  if (error) throw new Error(`Could not load active Rent2Buy CRM stock: ${error.message}`);
  return data || [];
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

  const pipeline = String(request.query?.pipeline || "finance").toLowerCase();
  if (!CMS_ENDPOINTS[pipeline]) {
    return response.status(400).json({ ok: false, message: "Image readiness is available for Finance and Rent2Buy only." });
  }

  try {
    const supabase = getSupabaseAdmin();
    const [localVehicles, cmsFeed, dealerKitSnapshot] = await Promise.all([
      fetchLocalVehicles(supabase, pipeline),
      fetchCmsItems(pipeline),
      fetchDealerKitStockSnapshot({ allowPartial: false }),
    ]);

    if (!dealerKitSnapshot.complete) {
      return response.status(503).json({
        ok: false,
        pipeline,
        sourceAvailable: false,
        message: "DealerKit returned an incomplete stock snapshot, so image readiness is unavailable until the source is healthy.",
        summary: { imageUpdatesReady: 0, complete: false, sourceAvailable: false },
        diagnostics: dealerKitSnapshot.diagnostics || {},
      });
    }

    const alerts = buildDealerKitImageReadinessAlerts({
      pipeline,
      localVehicles,
      cmsItems: cmsFeed.items,
      dealerKitVehicles: dealerKitSnapshot.vehicles,
    });

    const localRegistrationCount = new Set(localVehicles.map((row) => localRegistration(row, pipeline)).filter(Boolean)).size;
    const cmsPageCount = new Set(cmsFeed.items.map(cmsRegistration).filter(Boolean)).size;
    const singleImageCmsPageCount = cmsFeed.items.filter((row) => cmsRegistration(row) && cmsImageCount(row) === 1).length;

    return response.status(200).json({
      ok: true,
      pipeline,
      sourceAvailable: true,
      alerts,
      summary: {
        localAdvertisedRegistrations: localRegistrationCount,
        cmsVehiclePages: cmsPageCount,
        singleImageCmsPages: singleImageCmsPageCount,
        dealerKitVehiclesAvailable: dealerKitSnapshot.vehicleCount,
        imageUpdatesReady: alerts.length,
        sourceCheckedAt: dealerKitSnapshot.checkedAt,
        cmsRefreshedAt: cmsFeed.refreshedAt,
        complete: true,
        sourceAvailable: true,
        minimumDealerKitImageCount: MIN_DEALERKIT_IMAGE_COUNT,
        rule: "Alert only when the registration is active in this CRM, the matching main CMS vehicle page has exactly one image, and DealerKit has at least 5 vehicle images.",
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

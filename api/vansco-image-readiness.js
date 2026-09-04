import { getSupabaseAdmin, normalizeRegistration } from "./_vansco-cache-utils.js";

const REFRESH_RUNS_TABLE = "vansco_refresh_runs";
const CACHE_TABLE = "vansco_vehicle_cache";
const STOCK_LIMIT = 1000;
const CMS_TIMEOUT_MS = 12000;
export const MIN_VANSCO_IMAGE_COUNT = 5;

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

function sourceCountForRegistration(sourceImageCounts, registration) {
  const value = Number(sourceImageCounts?.[registration]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function rowTime(row) {
  const raw = row?.last_successfully_checked_at || row?.last_attempted_at || row?.updated_at;
  const time = raw ? new Date(raw).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

export function buildImageReadinessAlerts({ pipeline, localVehicles = [], cmsItems = [], cacheRows = [], sourceImageCounts = {} }) {
  if (!CMS_ENDPOINTS[pipeline]) return [];

  const localByRegistration = new Map();
  for (const row of localVehicles) {
    const registration = localRegistration(row, pipeline);
    if (!registration || localByRegistration.has(registration)) continue;
    localByRegistration.set(registration, row);
  }

  const cacheByRegistration = new Map();
  for (const row of cacheRows) {
    if (row?.is_currently_on_vansco === false) continue;
    const registration = normalizeRegistration(row?.registration || "");
    if (!registration) continue;
    const existing = cacheByRegistration.get(registration);
    if (!existing || rowTime(row) >= rowTime(existing)) cacheByRegistration.set(registration, row);
  }

  const alerts = [];
  for (const page of cmsItems) {
    const registration = cmsRegistration(page);
    if (!registration) continue;

    const localVehicle = localByRegistration.get(registration);
    if (!localVehicle) continue;

    const pageImageCount = cmsImageCount(page);
    if (pageImageCount !== 1) continue;

    const sourceImageCount = sourceCountForRegistration(sourceImageCounts, registration);
    if (sourceImageCount === null || sourceImageCount < MIN_VANSCO_IMAGE_COUNT) continue;

    const cacheRow = cacheByRegistration.get(registration);
    if (!cacheRow) continue;

    alerts.push({
      id: `images-ready-${pipeline}-${registration}`,
      pipeline,
      displayStatus: "images_ready",
      matchStatus: "images_ready",
      registration,
      title: compact(cacheRow.title || page.title || localVehicle.title || registration),
      imageUrl: compact(cacheRow.image_url || localVehicle.picture || ""),
      stockUrl: compact(cacheRow.stock_url || ""),
      localStockUrl: localVehicleUrl(localVehicle, pipeline),
      sourceStatus: compact(cacheRow.source_status || "unknown"),
      workflowStatus: "",
      notes: "",
      safeExactRegistrationMatch: true,
      cmsImageCount: pageImageCount,
      sourceImageCount,
      sourceCheckedAt: cacheRow.last_successfully_checked_at || cacheRow.last_attempted_at || "",
    });
  }

  return alerts.sort((a, b) => b.sourceImageCount - a.sourceImageCount || a.registration.localeCompare(b.registration));
}

async function fetchCmsItems(pipeline) {
  const endpoint = CMS_ENDPOINTS[pipeline];
  if (!endpoint) return { items: [], refreshedAt: "" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CMS_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`CMS vehicle-page feed returned ${response.status}.`);
    const payload = await response.json();
    if (!Array.isArray(payload?.items)) throw new Error("CMS vehicle-page feed did not return an items array.");
    return {
      items: payload.items,
      refreshedAt: compact(payload.refreshedAt),
    };
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

async function fetchCurrentVanscoRows(supabase) {
  const { data, error } = await supabase
    .from(CACHE_TABLE)
    .select("registration, title, image_url, stock_url, source_status, is_currently_on_vansco, last_successfully_checked_at, last_attempted_at, updated_at")
    .eq("is_currently_on_vansco", true)
    .limit(2000);
  if (error) throw new Error(`Could not load current Vansco cache: ${error.message}`);
  return data || [];
}

async function fetchLatestImageCountSnapshot(supabase) {
  const { data, error } = await supabase
    .from(REFRESH_RUNS_TABLE)
    .select("id, status, updated_at, last_result")
    .order("updated_at", { ascending: false })
    .limit(12);
  if (error) throw new Error(`Could not load Vansco image-count snapshot: ${error.message}`);

  for (const run of data || []) {
    const snapshot = run?.last_result?.imageCountsByRegistration;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !Object.keys(snapshot).length) continue;
    return {
      imageCountsByRegistration: snapshot,
      runId: run.id || "",
      status: run.status || "",
      updatedAt: run.updated_at || "",
    };
  }

  return { imageCountsByRegistration: {}, runId: "", status: "", updatedAt: "" };
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }

  const pipeline = String(request.query?.pipeline || "finance").toLowerCase();
  if (!CMS_ENDPOINTS[pipeline]) {
    response.status(400).json({ ok: false, message: "Image readiness is available for Finance and Rent2Buy only." });
    return;
  }

  try {
    const supabase = getSupabaseAdmin();
    const [localVehicles, cmsFeed, cacheRows, sourceSnapshot] = await Promise.all([
      fetchLocalVehicles(supabase, pipeline),
      fetchCmsItems(pipeline),
      fetchCurrentVanscoRows(supabase),
      fetchLatestImageCountSnapshot(supabase),
    ]);

    const alerts = buildImageReadinessAlerts({
      pipeline,
      localVehicles,
      cmsItems: cmsFeed.items,
      cacheRows,
      sourceImageCounts: sourceSnapshot.imageCountsByRegistration,
    });

    const localRegistrationCount = new Set(localVehicles.map((row) => localRegistration(row, pipeline)).filter(Boolean)).size;
    const cmsPageCount = new Set(cmsFeed.items.map(cmsRegistration).filter(Boolean)).size;
    const singleImageCmsPageCount = cmsFeed.items.filter((row) => cmsRegistration(row) && cmsImageCount(row) === 1).length;
    const snapshotComplete = sourceSnapshot.status === "complete";

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: true,
      pipeline,
      alerts,
      summary: {
        localAdvertisedRegistrations: localRegistrationCount,
        cmsVehiclePages: cmsPageCount,
        singleImageCmsPages: singleImageCmsPageCount,
        vanscoImageCountsAvailable: Object.keys(sourceSnapshot.imageCountsByRegistration).length,
        imageUpdatesReady: alerts.length,
        snapshotRunId: sourceSnapshot.runId,
        snapshotStatus: sourceSnapshot.status,
        snapshotUpdatedAt: sourceSnapshot.updatedAt,
        cmsRefreshedAt: cmsFeed.refreshedAt,
        complete: snapshotComplete,
        minimumVanscoImageCount: MIN_VANSCO_IMAGE_COUNT,
        rule: "Alert only when the registration is active in this CRM, the matching main CMS vehicle page has exactly one image, and Vansco has at least 5 vehicle images.",
      },
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      pipeline,
      message: error?.name === "AbortError" ? "CMS vehicle-page image feed timed out." : error?.message || "Could not check Vansco image readiness.",
    });
  }
}

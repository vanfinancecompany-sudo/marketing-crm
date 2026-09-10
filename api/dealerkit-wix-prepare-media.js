import { fetchDealerKitStockDetail } from "./_dealerkit-stock-adapter.js";
import { DEALERKIT_REVIEW_TABLE, rowToDealerKitReviewDecision } from "./_dealerkit-review-decisions.js";
import { getSupabaseServiceAdmin } from "./_vansco-cache-utils.js";
import { buildDealerKitWixMediaPlan } from "../lib/dealerKitWixMediaPlan.js";
import { normalizeFinanceRegistration } from "../lib/vanscoWixPrice.js";
import {
  DEALERKIT_IMPORTED_MEDIA_TABLE,
  WIX_MEDIA_GET_FILE_URL,
  WIX_MEDIA_IMPORT_URL,
  buildImportedMediaRow,
  importedMediaRowToClient,
} from "../lib/dealerKitWixVehicleMedia.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const clean = (value, limit = 10000) => String(value ?? "").trim().slice(0, limit);

class ApiError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function authorised(request, environment = process.env) {
  const expected = clean(environment.MARKETING_CUSTOMER_DATABASE_API_KEY, 2000);
  const header = clean(request.headers?.[API_KEY_HEADER], 2000);
  const bearer = clean(request.headers?.authorization, 2200).replace(/^Bearer\s+/i, "");
  return Boolean(expected && (header === expected || bearer === expected));
}

function wixConfiguration(environment = process.env) {
  const apiKey = clean(environment.WIX_API_KEY, 4000);
  const siteId = clean(environment.WIX_SITE_ID, 500);
  if (!apiKey || !siteId) throw new ApiError(500, "Wix Media preparation is not configured.");
  return { apiKey, siteId, apiBaseUrl: clean(environment.WIX_API_BASE_URL, 1000) || "https://www.wixapis.com" };
}

async function wixRequest(configuration, path, { method = "GET", body } = {}) {
  let result;
  try {
    result = await fetch(`${configuration.apiBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: configuration.apiKey,
        "wix-site-id": configuration.siteId,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(502, "Wix Media could not be reached. No vehicle CMS rows were changed.");
  }
  const payload = await result.json().catch(() => ({}));
  if (!result.ok) throw new ApiError(result.status === 401 || result.status === 403 ? 502 : result.status, clean(payload?.message, 1000) || `Wix Media returned ${result.status}.`);
  return payload;
}

async function loadDecision(supabase, registration) {
  const { data, error } = await supabase.from(DEALERKIT_REVIEW_TABLE).select("*").eq("registration", registration).limit(2);
  if (error) throw new ApiError(502, `DealerKit review read failed: ${error.message || error}`);
  if (!data?.length) throw new ApiError(409, `Save the DealerKit review for ${registration} first.`);
  if (data.length !== 1) throw new ApiError(409, `DealerKit review identity for ${registration} is ambiguous.`);
  return rowToDealerKitReviewDecision(data[0]);
}

async function loadMappings(supabase, supplierStockId, wixSiteId) {
  const { data, error } = await supabase.from(DEALERKIT_IMPORTED_MEDIA_TABLE).select("*").eq("supplier_stock_id", supplierStockId).eq("wix_site_id", wixSiteId);
  if (error) throw new ApiError(502, `Imported media map read failed: ${error.message || error}`);
  return data || [];
}

async function verifyExisting(configuration, row) {
  try {
    const payload = await wixRequest(configuration, `${WIX_MEDIA_GET_FILE_URL}?fileId=${encodeURIComponent(row.wix_file_id)}`);
    const file = payload?.file;
    if (!file?.id || clean(file.id, 500) !== clean(row.wix_file_id, 500)) return null;
    if (clean(file.mediaType, 80).toUpperCase() !== "IMAGE") return null;
    return file;
  } catch {
    return null;
  }
}

async function persistMapping(supabase, row) {
  const { data, error } = await supabase.from(DEALERKIT_IMPORTED_MEDIA_TABLE).upsert(row, { onConflict: "supplier_stock_id,dealerkit_image_id,wix_site_id" }).select("*").single();
  if (error) throw new ApiError(502, `Imported media map save failed: ${error.message || error}`);
  return importedMediaRowToClient(data);
}

async function prepareImages(supabase, configuration, vehicle, decision) {
  const mediaPlan = buildDealerKitWixMediaPlan({ vehicle, decision });
  const identityBlockers = (mediaPlan.blockers || []).filter((item) => [
    "missing_registration", "missing_source_id", "missing_image_id", "duplicate_image_id", "unstable_image_identity",
    "invalid_image_url", "no_images", "missing_primary", "primary_not_included",
  ].includes(item.code));
  if (identityBlockers.length) throw new ApiError(409, "DealerKit image review is not safe to import yet.", { blockers: identityBlockers });

  const existingRows = await loadMappings(supabase, vehicle.supplierStockId, configuration.siteId);
  const byImageId = new Map(existingRows.map((row) => [clean(row.dealerkit_image_id, 300), row]));
  const results = [];

  for (const sourceImage of mediaPlan.items) {
    let wixFile = null;
    const existing = byImageId.get(sourceImage.id);
    if (existing) wixFile = await verifyExisting(configuration, existing);

    if (!wixFile) {
      const requestBody = { url: sourceImage.sourceUrl, displayName: sourceImage.proposedBaseName || `${vehicle.registration}-${sourceImage.position}` };
      if (sourceImage.sourceMimeType) requestBody.mimeType = sourceImage.sourceMimeType;
      const imported = await wixRequest(configuration, WIX_MEDIA_IMPORT_URL, { method: "POST", body: requestBody });
      wixFile = imported?.file;
      if (!wixFile?.id || !wixFile?.url) throw new ApiError(502, `Wix did not return a usable media identity for DealerKit image ${sourceImage.id}.`);
    }

    const mapped = await persistMapping(supabase, buildImportedMediaRow({ vehicle, sourceImage, wixFile, wixSiteId: configuration.siteId }));
    results.push(mapped);
  }

  return {
    mediaPlan,
    images: results,
    ready: results.length > 0 && results.every((item) => item.ready),
    pending: results.filter((item) => !item.ready).map((item) => ({ dealerKitImageId: item.dealerKitImageId, status: item.operationStatus })),
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (!authorised(request)) return response.status(401).json({ ok: false, message: "Marketing CRM access is required." });
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });

  try {
    const registration = normalizeFinanceRegistration(request.body?.registration || "");
    const confirmRegistration = normalizeFinanceRegistration(request.body?.confirmRegistration || "");
    if (!registration || registration !== confirmRegistration) throw new ApiError(400, "Type the vehicle registration exactly to prepare its Wix images.");

    const supabase = getSupabaseServiceAdmin();
    const decision = await loadDecision(supabase, registration);
    const productMode = clean(request.body?.productMode, 30);
    const effectiveDecision = {
      ...decision,
      ...(productMode === "finance" ? { financeEnabled: true, rent2buyEnabled: false } : {}),
      ...(productMode === "rent2buy" ? { financeEnabled: false, rent2buyEnabled: true } : {}),
      ...(productMode === "both" ? { financeEnabled: true, rent2buyEnabled: true } : {}),
    };
    const vehicle = await fetchDealerKitStockDetail(decision.supplierStockId, { specifications: false });
    if (normalizeFinanceRegistration(vehicle?.registration || "") !== registration) throw new ApiError(409, "DealerKit registration changed. Re-open and review the vehicle before preparing media.");
    const configuration = wixConfiguration();
    const prepared = await prepareImages(supabase, configuration, vehicle, effectiveDecision);

    response.status(200).json({
      ok: true,
      registration,
      mediaOnly: true,
      cmsWritesAttempted: false,
      categoryWritesAttempted: false,
      ready: prepared.ready,
      images: prepared.images,
      pending: prepared.pending,
      message: prepared.ready
        ? `All ${prepared.images.length} reviewed DealerKit images are READY in Wix Media. No vehicle CMS rows were changed.`
        : `Prepared ${prepared.images.length} DealerKit image(s) in Wix Media. Some are still processing; vehicle publishing remains locked.`,
    });
  } catch (error) {
    response.status(error?.status || 502).json({ ok: false, cmsWritesAttempted: false, message: error?.message || "Could not prepare DealerKit images.", details: error?.details || null });
  }
}

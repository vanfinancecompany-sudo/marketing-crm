import { fetchDealerKitStockDetail } from "./_dealerkit-stock-adapter.js";
import { DEALERKIT_REVIEW_TABLE, rowToDealerKitReviewDecision } from "./_dealerkit-review-decisions.js";
import { getSupabaseServiceAdmin } from "./_vansco-cache-utils.js";
import { VAN_FINANCE_WIX_COLLECTIONS, normalizeFinanceRegistration } from "../lib/vanscoWixPrice.js";
import { DEALERKIT_MANUAL_MEDIA_TABLE, WIX_MEDIA_GET_FILE_URL, manualMediaRowToClient, manualMediaSiteConfiguration } from "../lib/dealerKitWixManualMedia.js";
import { buildDealerKitWixManualMediaReadiness } from "../lib/dealerKitWixManualMediaReadiness.js";
import { DEALERKIT_IMPORTED_MEDIA_TABLE, buildProductImageSets, importedMediaRowToClient } from "../lib/dealerKitWixVehicleMedia.js";
import { RENT2BUY_CATEGORY_COLLECTIONS, normalizeRent2BuyCategories } from "../lib/dealerKitRent2BuyPlan.js";
import { buildControlledPublishConfirmation, buildControlledVehiclePublishPlan } from "../lib/dealerKitControlledPublishPlan.js";

const clean = (value, limit = 10000) => String(value ?? "").trim().slice(0, limit);

export class ControlledPublishError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function controlledWixConfiguration(environment = process.env) {
  const apiKey = clean(environment.WIX_API_KEY, 4000);
  const siteId = clean(environment.WIX_SITE_ID, 500);
  if (!apiKey || !siteId) throw new ControlledPublishError(500, "Controlled Wix publishing is not configured.");
  return { apiKey, siteId, apiBaseUrl: clean(environment.WIX_API_BASE_URL, 1000) || "https://www.wixapis.com" };
}

export async function controlledWixRequest(configuration, path, { method = "POST", body } = {}) {
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
    throw new ControlledPublishError(502, "Wix could not be reached.");
  }
  const payload = await result.json().catch(() => ({}));
  if (!result.ok) {
    const message = clean(payload?.message || payload?.details?.applicationError?.description || payload?.details?.validationError?.fieldViolations?.[0]?.description, 1000);
    throw new ControlledPublishError(result.status === 401 || result.status === 403 ? 502 : result.status, message || `Wix returned status ${result.status}.`, { wixStatus: result.status });
  }
  return payload;
}

async function loadDecision(supabase, registration) {
  const { data, error } = await supabase.from(DEALERKIT_REVIEW_TABLE).select("*").eq("registration", registration).limit(2);
  if (error) throw new ControlledPublishError(502, `DealerKit review state read failed: ${error.message || error}`);
  if (!data?.length) throw new ControlledPublishError(409, `Save the DealerKit review for ${registration} first.`);
  if (data.length !== 1) throw new ControlledPublishError(409, `DealerKit review identity for ${registration} is ambiguous.`);
  return rowToDealerKitReviewDecision(data[0]);
}

async function queryRegistration(configuration, collectionId, registration, collection = null) {
  const payload = await controlledWixRequest(configuration, "/wix-data/v2/items/query", {
    method: "POST",
    body: { dataCollectionId: collectionId, query: { filter: { title: { $eq: registration } }, paging: { limit: 3, offset: 0 } }, consistentRead: true },
  });
  return { collectionId, collection: collection || { id: collectionId }, items: Array.isArray(payload.dataItems) ? payload.dataItems : [] };
}

async function verifyManualRow(row) {
  const stored = manualMediaRowToClient(row);
  const configuration = manualMediaSiteConfiguration(stored.purpose);
  const liveVerifiedAt = new Date().toISOString();
  if (!configuration?.configured || stored.wixSiteId !== configuration.siteId || !stored.wixFileId) {
    return { ...stored, liveVerified: false, liveVerifiedAt, liveVerificationError: "Manual media identity does not match the authoritative Wix site." };
  }
  try {
    const payload = await controlledWixRequest(configuration, `${WIX_MEDIA_GET_FILE_URL}?fileId=${encodeURIComponent(stored.wixFileId)}`, { method: "GET" });
    const file = payload?.file;
    if (!file?.id || clean(file.id, 500) !== stored.wixFileId || clean(file.mediaType, 80).toUpperCase() !== "IMAGE") throw new Error("Wix returned a different or non-image media item.");
    return {
      ...stored,
      url: clean(file.url, 3000) || stored.url,
      thumbnailUrl: clean(file.thumbnailUrl, 3000) || stored.thumbnailUrl,
      liveOperationStatus: clean(file.operationStatus, 80).toUpperCase() || "UNKNOWN",
      liveVerified: true,
      liveVerifiedAt,
      liveVerificationError: null,
    };
  } catch (error) {
    return { ...stored, liveVerified: false, liveVerifiedAt, liveVerificationError: clean(error?.message, 1000) || "Manual media verification failed." };
  }
}

async function loadManualReadiness(supabase, registration) {
  const { data, error } = await supabase.from(DEALERKIT_MANUAL_MEDIA_TABLE).select("*").eq("registration", registration).order("created_at", { ascending: false }).limit(30);
  if (error) throw new ControlledPublishError(502, `Manual media read failed: ${error.message || error}`);
  return buildDealerKitWixManualMediaReadiness(await Promise.all((data || []).map(verifyManualRow)));
}

async function loadImportedReadiness(supabase, configuration, vehicle) {
  const { data, error } = await supabase
    .from(DEALERKIT_IMPORTED_MEDIA_TABLE)
    .select("*")
    .eq("supplier_stock_id", vehicle.supplierStockId)
    .eq("wix_site_id", configuration.siteId);
  if (error) throw new ControlledPublishError(502, `DealerKit Wix media map read failed: ${error.message || error}`);

  const items = [];
  for (const row of data || []) {
    const stored = importedMediaRowToClient(row);
    try {
      const payload = await controlledWixRequest(configuration, `${WIX_MEDIA_GET_FILE_URL}?fileId=${encodeURIComponent(stored.wixFileId)}`, { method: "GET" });
      const file = payload?.file;
      const status = clean(file?.operationStatus, 80).toUpperCase() || "UNKNOWN";
      items.push({ ...stored, wixUrl: clean(file?.url, 3000) || stored.wixUrl, operationStatus: status, ready: status === "READY", liveVerified: Boolean(file?.id === stored.wixFileId && clean(file?.mediaType, 80).toUpperCase() === "IMAGE") });
    } catch {
      items.push({ ...stored, ready: false, liveVerified: false, operationStatus: "UNVERIFIED" });
    }
  }
  return items;
}

function rent2buyCollectionIds(decision = {}) {
  if (!decision.rent2buyEnabled) return [];
  const categories = normalizeRent2BuyCategories(decision.financeCategories || []);
  return Array.from(new Set([...categories.map((key) => RENT2BUY_CATEGORY_COLLECTIONS[key]).filter(Boolean), "VANPAGES"]));
}

export async function buildFreshControlledPublishState(registrationInput, environment = process.env) {
  const registration = normalizeFinanceRegistration(registrationInput || "");
  if (!registration) throw new ControlledPublishError(400, "A valid registration is required.");
  const supabase = getSupabaseServiceAdmin();
  const decision = await loadDecision(supabase, registration);
  const vehicle = await fetchDealerKitStockDetail(decision.supplierStockId, { specifications: true });
  if (normalizeFinanceRegistration(vehicle?.registration || "") !== registration) throw new ControlledPublishError(409, "DealerKit registration changed. Re-open and save the review again.");
  const configuration = controlledWixConfiguration(environment);

  const [manualMediaReadiness, importedDealerKitMedia, vfcWixResults] = await Promise.all([
    loadManualReadiness(supabase, registration),
    loadImportedReadiness(supabase, configuration, vehicle),
    Promise.all(VAN_FINANCE_WIX_COLLECTIONS.map((collection) => queryRegistration(configuration, collection.id, registration, collection))),
  ]);
  const imageSets = buildProductImageSets({ vehicle, decision, importedDealerKitMedia, manualMediaReadiness });
  const r2bIds = rent2buyCollectionIds(decision);
  const rent2buyWixResults = await Promise.all(r2bIds.map((collectionId) => queryRegistration(configuration, collectionId, registration)));
  const plan = buildControlledVehiclePublishPlan({ vehicle, decision, imageSets, vfcWixResults, rent2buyWixResults });
  plan.confirmation = buildControlledPublishConfirmation(plan);

  return { registration, supabase, configuration, decision, vehicle, manualMediaReadiness, importedDealerKitMedia, imageSets, vfcWixResults, rent2buyWixResults, plan };
}

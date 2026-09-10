import { fetchDealerKitStockDetail } from "./_dealerkit-stock-adapter.js";
import {
  DEALERKIT_REVIEW_TABLE,
  rowToDealerKitReviewDecision,
} from "./_dealerkit-review-decisions.js";
import { getSupabaseServiceAdmin } from "./_vansco-cache-utils.js";
import { normalizeFinanceRegistration } from "../lib/vanscoWixPrice.js";
import {
  DEALERKIT_MANUAL_MEDIA_TABLE,
  WIX_MEDIA_GENERATE_UPLOAD_URL,
  WIX_MEDIA_GET_FILE_URL,
  buildManualMediaUploadFileName,
  manualMediaRowToClient,
  manualMediaSiteConfiguration,
  normaliseManualMediaPurpose,
  validateDealerKitManualMediaFile,
  wixFileToManualMediaRow,
} from "../lib/dealerKitWixManualMedia.js";

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

async function loadDecisionByRegistration(supabase, registration) {
  const { data, error } = await supabase
    .from(DEALERKIT_REVIEW_TABLE)
    .select("*")
    .eq("registration", registration)
    .limit(2);
  if (error) throw new ApiError(502, `DealerKit review state read failed: ${error.message || error}`);
  if (!data?.length) throw new ApiError(409, `Save the DealerKit review for ${registration} before uploading Wix media.`);
  if (data.length > 1) throw new ApiError(409, `More than one DealerKit review record exists for ${registration}. Media upload is blocked until that is reconciled.`);
  return rowToDealerKitReviewDecision(data[0]);
}

async function loadFreshVehicle(decision, registration) {
  const vehicle = await fetchDealerKitStockDetail(decision.supplierStockId, { specifications: false });
  const currentRegistration = normalizeFinanceRegistration(vehicle?.registration || "");
  if (!currentRegistration || currentRegistration !== registration) {
    throw new ApiError(409, "DealerKit registration no longer matches the saved review. Re-open the vehicle and review it again before using Wix media.");
  }
  return vehicle;
}

async function loadManualMediaById(supabase, registration, mediaId) {
  const id = clean(mediaId, 100);
  if (!id) throw new ApiError(400, "A staged Wix media record is required.");
  const { data, error } = await supabase
    .from(DEALERKIT_MANUAL_MEDIA_TABLE)
    .select("*")
    .eq("id", id)
    .eq("registration", registration)
    .limit(2);
  if (error) throw new ApiError(502, `Manual Wix media metadata read failed: ${error.message || error}`);
  if (!data?.length) throw new ApiError(404, "That staged Wix media record was not found for this vehicle.");
  if (data.length > 1) throw new ApiError(409, "Duplicate staged Wix media metadata was found. The media action is blocked until that is reconciled.");
  return data[0];
}

function siteConfiguration(purpose) {
  const configuration = manualMediaSiteConfiguration(purpose);
  if (!configuration?.configured) {
    throw new ApiError(500, "Wix manual media upload is not configured for this destination.", {
      missing: configuration?.missing || ["Wix media configuration"],
    });
  }
  return configuration;
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
    throw new ApiError(502, "Wix Media could not be reached. No vehicle records were changed.");
  }

  const payload = await result.json().catch(() => ({}));
  if (!result.ok) {
    const message = clean(
      payload?.message
      || payload?.details?.applicationError?.description
      || payload?.details?.validationError?.fieldViolations?.[0]?.description,
      1000,
    );
    throw new ApiError(
      result.status === 401 || result.status === 403 ? 502 : result.status,
      message || `Wix Media returned status ${result.status}. No vehicle records were changed.`,
      { wix_status: result.status },
    );
  }
  return payload;
}

async function getVerifiedWixFile(configuration, wixFileId) {
  const expectedFileId = clean(wixFileId, 500);
  const payload = await wixRequest(
    configuration,
    `${WIX_MEDIA_GET_FILE_URL}?fileId=${encodeURIComponent(expectedFileId)}`,
    { method: "GET" },
  );
  const file = payload?.file;
  if (!file?.id) throw new ApiError(502, "Wix could not verify the uploaded image.");
  if (clean(file.id, 500) !== expectedFileId) {
    throw new ApiError(409, "Wix returned a different media file than the one requested. The staged media record was not changed.");
  }
  if (file?.siteId && clean(file.siteId, 500) !== configuration.siteId) {
    throw new ApiError(409, "The Wix Media item belongs to a different site. It has not been attached to this review.");
  }
  if (clean(file?.mediaType, 80).toUpperCase() !== "IMAGE") {
    throw new ApiError(409, "The Wix Media item is not an image. It cannot be used by the vehicle publishing workflow.");
  }
  return file;
}

async function listManualMedia(supabase, registration) {
  const { data, error } = await supabase
    .from(DEALERKIT_MANUAL_MEDIA_TABLE)
    .select("*")
    .eq("registration", registration)
    .order("created_at", { ascending: false });
  if (error) throw new ApiError(502, `Manual Wix media metadata read failed: ${error.message || error}`);
  return (data || []).map(manualMediaRowToClient);
}

async function prepareUpload({ request, supabase, registration }) {
  const purpose = normaliseManualMediaPurpose(request.body?.purpose);
  if (!purpose) throw new ApiError(400, "Choose a supported Wix image destination.");

  const file = validateDealerKitManualMediaFile(request.body || {});
  if (!file.valid) throw new ApiError(400, file.errors[0], { errors: file.errors });

  const decision = await loadDecisionByRegistration(supabase, registration);
  await loadFreshVehicle(decision, registration);
  const configuration = siteConfiguration(purpose.key);
  const wixFileName = buildManualMediaUploadFileName({
    registration,
    purpose: purpose.key,
    fileName: file.fileName,
  });

  const payload = await wixRequest(configuration, WIX_MEDIA_GENERATE_UPLOAD_URL, {
    method: "POST",
    body: {
      mimeType: file.mimeType,
      fileName: wixFileName,
      sizeInBytes: String(file.sizeInBytes),
      private: false,
    },
  });
  const uploadUrl = clean(payload?.uploadUrl, 12000);
  if (!uploadUrl) throw new ApiError(502, "Wix did not return a signed upload URL.");

  return {
    action: "prepare_upload",
    registration,
    supplierStockId: decision.supplierStockId,
    purpose: purpose.key,
    purposeLabel: purpose.label,
    siteScope: purpose.siteScope,
    fileName: wixFileName,
    mimeType: file.mimeType,
    sizeInBytes: file.sizeInBytes,
    uploadUrl,
    expiresWithWixSignature: true,
  };
}

async function registerUpload({ request, supabase, registration }) {
  const purpose = normaliseManualMediaPurpose(request.body?.purpose);
  if (!purpose) throw new ApiError(400, "Choose a supported Wix image destination.");
  const wixFileId = clean(request.body?.wixFileId, 500);
  if (!wixFileId) throw new ApiError(400, "The Wix file ID is required to register an upload.");

  const decision = await loadDecisionByRegistration(supabase, registration);
  await loadFreshVehicle(decision, registration);
  const configuration = siteConfiguration(purpose.key);
  const file = await getVerifiedWixFile(configuration, wixFileId);
  const row = wixFileToManualMediaRow({
    file,
    decision,
    purpose: purpose.key,
    siteId: configuration.siteId,
  });
  const { data, error } = await supabase
    .from(DEALERKIT_MANUAL_MEDIA_TABLE)
    .upsert(row, { onConflict: "wix_site_id,wix_file_id" })
    .select("*")
    .single();
  if (error) throw new ApiError(502, `Manual Wix media metadata save failed: ${error.message || error}`);

  return {
    action: "register_upload",
    registration,
    media: manualMediaRowToClient(data),
  };
}

async function refreshUpload({ request, supabase, registration }) {
  const stored = await loadManualMediaById(supabase, registration, request.body?.mediaId);
  const purpose = normaliseManualMediaPurpose(stored.purpose);
  if (!purpose) throw new ApiError(409, "The staged Wix media purpose is no longer supported.");

  const decision = await loadDecisionByRegistration(supabase, registration);
  await loadFreshVehicle(decision, registration);
  if (clean(stored.supplier_stock_id, 300) !== clean(decision.supplierStockId, 300)) {
    throw new ApiError(409, "The staged Wix image belongs to a different DealerKit stock identity. Status refresh is blocked.");
  }

  const configuration = siteConfiguration(purpose.key);
  if (clean(stored.wix_site_id, 500) !== configuration.siteId) {
    throw new ApiError(409, "The staged Wix image is bound to a different Wix site. Status refresh is blocked.");
  }

  const file = await getVerifiedWixFile(configuration, stored.wix_file_id);
  const verifiedRow = wixFileToManualMediaRow({
    file,
    decision,
    purpose: purpose.key,
    siteId: configuration.siteId,
  });
  const { data, error } = await supabase
    .from(DEALERKIT_MANUAL_MEDIA_TABLE)
    .update(verifiedRow)
    .eq("id", stored.id)
    .eq("registration", registration)
    .select("*")
    .single();
  if (error) throw new ApiError(502, `Manual Wix media status refresh failed: ${error.message || error}`);

  return {
    action: "refresh_status",
    registration,
    media: manualMediaRowToClient(data),
    statusRefreshOnly: true,
  };
}

async function selectUpload({ request, supabase, registration }) {
  const stored = await loadManualMediaById(supabase, registration, request.body?.mediaId);
  const purpose = normaliseManualMediaPurpose(stored.purpose);
  if (!purpose) throw new ApiError(409, "The staged Wix media purpose is no longer supported.");

  const decision = await loadDecisionByRegistration(supabase, registration);
  await loadFreshVehicle(decision, registration);
  if (clean(stored.supplier_stock_id, 300) !== clean(decision.supplierStockId, 300)) {
    throw new ApiError(409, "The staged Wix image belongs to a different DealerKit stock identity. Selection is blocked.");
  }

  const configuration = siteConfiguration(purpose.key);
  if (clean(stored.wix_site_id, 500) !== configuration.siteId) {
    throw new ApiError(409, "The staged Wix image is bound to a different Wix site. Selection is blocked.");
  }

  const file = await getVerifiedWixFile(configuration, stored.wix_file_id);
  const operationStatus = clean(file?.operationStatus, 80).toUpperCase();
  if (operationStatus !== "READY") {
    throw new ApiError(409, `Wix Media reports this image as ${operationStatus || "UNKNOWN"}. Only READY images can be selected for publishing.`);
  }

  const verifiedRow = wixFileToManualMediaRow({
    file,
    decision,
    purpose: purpose.key,
    siteId: configuration.siteId,
  });
  const { error: refreshError } = await supabase
    .from(DEALERKIT_MANUAL_MEDIA_TABLE)
    .update(verifiedRow)
    .eq("id", stored.id)
    .eq("registration", registration);
  if (refreshError) throw new ApiError(502, `Manual Wix media verification save failed: ${refreshError.message || refreshError}`);

  const { error: clearError } = await supabase
    .from(DEALERKIT_MANUAL_MEDIA_TABLE)
    .update({ selected_at: null })
    .eq("supplier_stock_id", decision.supplierStockId)
    .eq("purpose", purpose.key)
    .not("selected_at", "is", null);
  if (clearError) throw new ApiError(502, `Could not clear the previous manual image selection: ${clearError.message || clearError}`);

  const selectedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from(DEALERKIT_MANUAL_MEDIA_TABLE)
    .update({ selected_at: selectedAt, updated_at: selectedAt })
    .eq("id", stored.id)
    .eq("registration", registration)
    .eq("supplier_stock_id", decision.supplierStockId)
    .eq("purpose", purpose.key)
    .select("*")
    .single();
  if (error) throw new ApiError(502, `Could not select the staged Wix image: ${error.message || error}`);

  return {
    action: "select_media",
    registration,
    media: manualMediaRowToClient(data),
    selectedPurpose: purpose.key,
    selectionOnly: true,
  };
}

export default async function handler(request, response) {
  if (!authorised(request)) {
    response.status(401).json({ ok: false, message: "Marketing CRM access is required." });
    return;
  }

  if (!["GET", "POST"].includes(request.method)) {
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }

  const registration = normalizeFinanceRegistration(
    request.method === "GET" ? request.query?.registration : request.body?.registration,
  );
  if (!registration) {
    response.status(400).json({ ok: false, message: "A valid vehicle registration is required." });
    return;
  }

  response.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    const supabase = getSupabaseServiceAdmin();
    if (request.method === "GET") {
      await loadDecisionByRegistration(supabase, registration);
      const media = await listManualMedia(supabase, registration);
      response.status(200).json({
        ok: true,
        registration,
        media,
        vehicleWritesAttempted: false,
        cmsWritesAttempted: false,
        categoryWritesAttempted: false,
      });
      return;
    }

    const action = clean(request.body?.action, 80);
    const result = action === "prepare_upload"
      ? await prepareUpload({ request, supabase, registration })
      : action === "register_upload"
        ? await registerUpload({ request, supabase, registration })
        : action === "refresh_status"
          ? await refreshUpload({ request, supabase, registration })
          : action === "select_media"
            ? await selectUpload({ request, supabase, registration })
            : null;
    if (!result) throw new ApiError(400, "Manual Wix media action is not supported.");

    response.status(200).json({
      ok: true,
      ...result,
      vehicleWritesAttempted: false,
      cmsWritesAttempted: false,
      categoryWritesAttempted: false,
    });
  } catch (error) {
    response.status(error?.status || 502).json({
      ok: false,
      vehicleWritesAttempted: false,
      cmsWritesAttempted: false,
      categoryWritesAttempted: false,
      message: error?.message || "Manual Wix media operation failed.",
      details: error?.details || null,
    });
  }
}

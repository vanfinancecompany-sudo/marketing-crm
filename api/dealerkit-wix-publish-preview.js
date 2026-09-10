import { fetchDealerKitStockDetail } from "./_dealerkit-stock-adapter.js";
import {
  DEALERKIT_REVIEW_TABLE,
  rowToDealerKitReviewDecision,
} from "./_dealerkit-review-decisions.js";
import { getSupabaseServiceAdmin } from "./_vansco-cache-utils.js";
import { VAN_FINANCE_WIX_COLLECTIONS, normalizeFinanceRegistration } from "../lib/vanscoWixPrice.js";
import { buildDealerKitWixPublishPreview } from "../lib/dealerKitWixPublishPreview.js";
import {
  DEALERKIT_MANUAL_MEDIA_TABLE,
  WIX_MEDIA_GET_FILE_URL,
  manualMediaRowToClient,
  manualMediaSiteConfiguration,
} from "../lib/dealerKitWixManualMedia.js";
import { buildDealerKitWixManualMediaReadiness } from "../lib/dealerKitWixManualMediaReadiness.js";

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
  if (!apiKey || !siteId) {
    throw new ApiError(500, "Wix publish preview is not configured.", {
      missing: [!apiKey && "WIX_API_KEY", !siteId && "WIX_SITE_ID"].filter(Boolean),
    });
  }
  return {
    apiKey,
    siteId,
    apiBaseUrl: clean(environment.WIX_API_BASE_URL, 1000) || "https://www.wixapis.com",
  };
}

async function wixRequest(configuration, path, { method = "POST", body } = {}) {
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
    throw new ApiError(502, "Wix could not be reached. No Wix changes were attempted.");
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
      message || `Wix returned status ${result.status}. No Wix changes were attempted.`,
      { wix_status: result.status },
    );
  }
  return payload;
}

async function queryRegistration(configuration, collection, registration) {
  const payload = await wixRequest(configuration, "/wix-data/v2/items/query", {
    method: "POST",
    body: {
      dataCollectionId: collection.id,
      query: {
        filter: { title: { $eq: registration } },
        paging: { limit: 3, offset: 0 },
      },
    },
  });
  return {
    collection,
    items: Array.isArray(payload.dataItems) ? payload.dataItems : [],
  };
}

async function loadDecisionByRegistration(supabase, registration) {
  const { data, error } = await supabase
    .from(DEALERKIT_REVIEW_TABLE)
    .select("*")
    .eq("registration", registration)
    .limit(2);
  if (error) throw new ApiError(502, `DealerKit review state read failed: ${error.message || error}`);
  if (!data?.length) throw new ApiError(409, `Save the DealerKit review for ${registration} before preparing a Wix publish preview.`);
  if (data.length > 1) throw new ApiError(409, `More than one DealerKit review record exists for ${registration}. Publishing is blocked until that is reconciled.`);
  return rowToDealerKitReviewDecision(data[0]);
}

async function loadManualMediaRows(supabase, registration) {
  const { data, error } = await supabase
    .from(DEALERKIT_MANUAL_MEDIA_TABLE)
    .select("*")
    .eq("registration", registration)
    .order("created_at", { ascending: false })
    .limit(12);
  if (error) throw new ApiError(502, `Manual Wix media metadata read failed: ${error.message || error}`);
  return data || [];
}

async function liveVerifyManualMediaRow(row) {
  const stored = manualMediaRowToClient(row);
  const configuration = manualMediaSiteConfiguration(stored.purpose);
  const liveVerifiedAt = new Date().toISOString();

  if (!configuration?.configured) {
    return {
      ...stored,
      liveVerified: false,
      liveVerifiedAt,
      liveVerificationError: `Wix media verification is not configured for ${stored.purposeLabel || stored.purpose}.`,
    };
  }
  if (!stored.wixFileId || stored.wixSiteId !== configuration.siteId) {
    return {
      ...stored,
      liveVerified: false,
      liveVerifiedAt,
      liveVerificationError: "Stored manual media identity does not match the intended Wix site.",
    };
  }

  try {
    const payload = await wixRequest(
      configuration,
      `${WIX_MEDIA_GET_FILE_URL}?fileId=${encodeURIComponent(stored.wixFileId)}`,
      { method: "GET" },
    );
    const file = payload?.file;
    if (!file?.id || clean(file.id, 500) !== stored.wixFileId) {
      throw new Error("Wix returned a different media file than the staged identity.");
    }
    if (file?.siteId && clean(file.siteId, 500) !== configuration.siteId) {
      throw new Error("Wix reports this media file on a different site.");
    }
    if (clean(file?.mediaType, 80).toUpperCase() !== "IMAGE") {
      throw new Error("Wix reports this staged item is not an image.");
    }

    const operationStatus = clean(file?.operationStatus, 80).toUpperCase() || "UNKNOWN";
    return {
      ...stored,
      displayName: clean(file?.displayName, 500) || stored.displayName,
      url: clean(file?.url, 3000) || stored.url,
      thumbnailUrl: clean(file?.thumbnailUrl, 3000) || stored.thumbnailUrl,
      liveOperationStatus: operationStatus,
      liveVerified: true,
      liveVerifiedAt,
      liveVerificationError: null,
    };
  } catch (error) {
    return {
      ...stored,
      liveVerified: false,
      liveVerifiedAt,
      liveVerificationError: clean(error?.message, 1000) || "Wix media live verification failed.",
    };
  }
}

async function buildManualMediaSnapshot(supabase, registration) {
  const rows = await loadManualMediaRows(supabase, registration);
  const items = await Promise.all(rows.map(liveVerifyManualMediaRow));
  return buildDealerKitWixManualMediaReadiness(items);
}

export default async function handler(request, response) {
  if (!authorised(request)) {
    response.status(401).json({ ok: false, message: "Marketing CRM access is required." });
    return;
  }
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }

  const registration = normalizeFinanceRegistration(request.query?.registration || "");
  if (!registration) {
    response.status(400).json({ ok: false, message: "A valid vehicle registration is required." });
    return;
  }

  try {
    const supabase = getSupabaseServiceAdmin();
    const decision = await loadDecisionByRegistration(supabase, registration);
    const vehicle = await fetchDealerKitStockDetail(decision.supplierStockId, { specifications: false });
    const currentRegistration = normalizeFinanceRegistration(vehicle?.registration || "");
    if (!currentRegistration || currentRegistration !== registration) {
      throw new ApiError(409, "DealerKit registration no longer matches the saved review. Re-open the vehicle and review it again before publishing.");
    }

    const configuration = wixConfiguration();
    const [wixResults, manualMediaReadiness] = await Promise.all([
      Promise.all(
        VAN_FINANCE_WIX_COLLECTIONS.map((collection) => queryRegistration(configuration, collection, registration)),
      ),
      buildManualMediaSnapshot(supabase, registration),
    ]);
    const preview = buildDealerKitWixPublishPreview({ vehicle, decision, wixResults });
    preview.manualMediaReadiness = manualMediaReadiness;

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: true,
      readOnly: true,
      writesAttempted: false,
      authoritative: false,
      preview,
    });
  } catch (error) {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(error?.status || 502).json({
      ok: false,
      readOnly: true,
      writesAttempted: false,
      message: error?.message || "Could not prepare DealerKit Wix publish preview.",
      details: error?.details || null,
    });
  }
}

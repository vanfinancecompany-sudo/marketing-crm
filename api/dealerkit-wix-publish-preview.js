import { fetchDealerKitStockDetail } from "./_dealerkit-stock-adapter.js";
import {
  DEALERKIT_REVIEW_TABLE,
  rowToDealerKitReviewDecision,
} from "./_dealerkit-review-decisions.js";
import { getSupabaseServiceAdmin } from "./_vansco-cache-utils.js";
import { VAN_FINANCE_WIX_COLLECTIONS, normalizeFinanceRegistration } from "../lib/vanscoWixPrice.js";
import { buildDealerKitWixPublishPreview } from "../lib/dealerKitWixPublishPreview.js";

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

async function wixRequest(configuration, path, body) {
  let result;
  try {
    result = await fetch(`${configuration.apiBaseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: configuration.apiKey,
        "wix-site-id": configuration.siteId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
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
    dataCollectionId: collection.id,
    query: {
      filter: { title: { $eq: registration } },
      paging: { limit: 3, offset: 0 },
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

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }
  if (!authorised(request)) {
    response.status(401).json({ ok: false, message: "Marketing CRM access is required." });
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
    const wixResults = await Promise.all(
      VAN_FINANCE_WIX_COLLECTIONS.map((collection) => queryRegistration(configuration, collection, registration)),
    );
    const preview = buildDealerKitWixPublishPreview({ vehicle, decision, wixResults });

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

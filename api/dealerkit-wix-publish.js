import { fetchDealerKitStockDetail } from "./_dealerkit-stock-adapter.js";
import {
  DEALERKIT_REVIEW_TABLE,
  rowToDealerKitReviewDecision,
} from "./_dealerkit-review-decisions.js";
import { getSupabaseServiceAdmin } from "./_vansco-cache-utils.js";
import { VAN_FINANCE_WIX_COLLECTIONS, normalizeFinanceRegistration } from "../lib/vanscoWixPrice.js";
import {
  buildDealerKitWixPublishPreview,
  dealerKitWixPublishConfirmationMatches,
} from "../lib/dealerKitWixPublishPreview.js";

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

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body); }
    catch { throw new ApiError(400, "The request body is not valid JSON."); }
  }
  return request.body;
}

function wixConfiguration(environment = process.env) {
  const apiKey = clean(environment.WIX_API_KEY, 4000);
  const siteId = clean(environment.WIX_SITE_ID, 500);
  if (!apiKey || !siteId) {
    throw new ApiError(500, "Controlled Wix updating is not configured.", {
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
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(502, "Wix could not be reached. No further Wix changes were attempted.");
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
      message || `Wix returned status ${result.status}.`,
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
  if (!data?.length) throw new ApiError(409, `Save the DealerKit review for ${registration} before updating Wix.`);
  if (data.length > 1) throw new ApiError(409, `More than one DealerKit review record exists for ${registration}. Nothing was changed.`);
  return rowToDealerKitReviewDecision(data[0]);
}

async function buildFreshPreview(registration) {
  const supabase = getSupabaseServiceAdmin();
  const decision = await loadDecisionByRegistration(supabase, registration);
  const vehicle = await fetchDealerKitStockDetail(decision.supplierStockId, { specifications: false });
  const currentRegistration = normalizeFinanceRegistration(vehicle?.registration || "");
  if (!currentRegistration || currentRegistration !== registration) {
    throw new ApiError(409, "DealerKit registration no longer matches the saved review. Re-open and review the vehicle again.");
  }

  const configuration = wixConfiguration();
  const wixResults = await Promise.all(
    VAN_FINANCE_WIX_COLLECTIONS.map((collection) => queryRegistration(configuration, collection, registration)),
  );
  const preview = buildDealerKitWixPublishPreview({ vehicle, decision, wixResults });
  return { configuration, preview };
}

function sameFields(left = {}, right = {}) {
  const keys = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
  return Array.from(keys).every((key) => clean(left?.[key], 1000) === clean(right?.[key], 1000));
}

async function patchFields(configuration, target, fields) {
  const fieldModifications = Object.entries(fields || {}).map(([fieldPath, value]) => ({
    fieldPath,
    action: "SET_FIELD",
    setFieldOptions: { value },
  }));
  if (!fieldModifications.length) return null;
  return wixRequest(configuration, `/wix-data/v2/items/${encodeURIComponent(target.itemId)}`, {
    method: "PATCH",
    body: {
      dataCollectionId: target.collectionId,
      patch: {
        dataItemId: target.itemId,
        fieldModifications,
      },
    },
  });
}

async function applyExistingRows(configuration, preview) {
  const changedTargets = (preview.writeTargets || []).filter((target) => !sameFields(target.current, target.proposed));
  const applied = [];
  try {
    for (const target of changedTargets) {
      if (!target.itemId || !target.collectionId) throw new ApiError(409, "A Wix target lost its item identity. Nothing further was changed.");
      await patchFields(configuration, target, target.proposed);
      applied.push(target);
    }
    return { applied, changedTargets };
  } catch (error) {
    const rollback = [];
    for (const target of [...applied].reverse()) {
      try {
        await patchFields(configuration, target, target.current);
        rollback.push({ collectionId: target.collectionId, ok: true });
      } catch (rollbackError) {
        rollback.push({
          collectionId: target.collectionId,
          ok: false,
          message: clean(rollbackError?.message, 500),
        });
      }
    }
    throw new ApiError(502, "Controlled Wix update did not complete. Records already changed were rolled back where possible. Check the result before retrying.", {
      cause: clean(error?.message, 1000),
      appliedBeforeFailure: applied.map((target) => target.collectionId),
      rollback,
    });
  }
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }
  if (!authorised(request)) {
    response.status(401).json({ ok: false, message: "Marketing CRM access is required." });
    return;
  }

  let body = {};
  try {
    body = parseBody(request);
    if (clean(body.action, 80) !== "apply_existing_vfc_update") {
      throw new ApiError(400, "Unsupported controlled Wix action.");
    }
    const registration = normalizeFinanceRegistration(body.registration || "");
    const typedRegistration = normalizeFinanceRegistration(body.confirmRegistration || "");
    if (!registration) throw new ApiError(400, "A valid vehicle registration is required.");
    if (!typedRegistration || typedRegistration !== registration) {
      throw new ApiError(400, "Type the vehicle registration exactly to confirm this Wix update.");
    }

    const { configuration, preview } = await buildFreshPreview(registration);
    if (!preview.canPublishLater) {
      throw new ApiError(409, "The fresh DealerKit/Wix safety preview is blocked. Nothing was changed.", {
        blockers: preview.blockers,
        warnings: preview.warnings,
      });
    }
    if (!dealerKitWixPublishConfirmationMatches(body.confirmation, preview)) {
      throw new ApiError(409, "DealerKit, the saved review or Wix changed after the preview. Nothing was changed. Preview again before updating.");
    }

    const { applied, changedTargets } = await applyExistingRows(configuration, preview);
    const fresh = await buildFreshPreview(registration);
    const verified = (fresh.preview.writeTargets || []).every((target) => sameFields(target.current, target.proposed));

    console.info("DEALERKIT CONTROLLED WIX UPDATE", {
      registration,
      supplier_stock_id: preview.supplierStockId,
      retail_price: preview.retailPrice,
      monthly_price: preview.monthlyPrice,
      changed_collections: changedTargets.map((target) => target.collectionId),
      applied_collections: applied.map((target) => target.collectionId),
      verified,
    });

    response.status(200).json({
      ok: true,
      registration,
      writeScope: "existing_vfc_price_fields_only",
      recordsConsidered: preview.writeTargets.length,
      recordsUpdated: applied.length,
      verified,
      categoryMembershipChanged: false,
      imagesChanged: false,
      createdRecords: 0,
      deletedRecords: 0,
      message: verified
        ? "Existing Van Finance Wix price fields were updated and re-checked successfully. Category membership and images were not changed."
        : "The Wix update completed but the post-write verification did not fully reconcile. Check the vehicle before retrying.",
    });
  } catch (error) {
    console.error("DEALERKIT CONTROLLED WIX UPDATE ERROR", {
      action: clean(body?.action, 80),
      registration: clean(body?.registration, 30),
      status: error?.status || 500,
      message: clean(error?.message, 1000),
      details: error?.details || null,
    });
    response.status(error?.status || 502).json({
      ok: false,
      message: error?.message || "Controlled Wix update failed.",
      details: error?.details || null,
    });
  }
}

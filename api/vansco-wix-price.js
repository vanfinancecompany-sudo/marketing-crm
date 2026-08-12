import {
  VAN_FINANCE_WIX_COLLECTIONS,
  buildFinanceWixPricePatch,
  calculateFivePercentFlatMonthly,
  financeWixCurrentFields,
  normalizeFinanceRegistration,
  parseRetailPrice,
} from "../lib/vanscoWixPrice.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const clean = (value, limit = 10000) => String(value ?? "").trim().slice(0, limit);

class ApiError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function authorize(request) {
  const expected = clean(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY);
  const header = clean(request.headers?.[API_KEY_HEADER]);
  const authorization = clean(request.headers?.authorization);
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
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
  const apiKey = clean(environment.WIX_API_KEY);
  const siteId = clean(environment.WIX_SITE_ID, 500);
  if (!apiKey || !siteId) throw new ApiError(500, "Wix price updating is not configured.", { missing: [!apiKey && "WIX_API_KEY", !siteId && "WIX_SITE_ID"].filter(Boolean) });
  return { apiKey, siteId, apiBaseUrl: clean(environment.WIX_API_BASE_URL, 1000) || "https://www.wixapis.com" };
}

async function wixRequest(configuration, path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(`${configuration.apiBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: configuration.apiKey,
        "wix-site-id": configuration.siteId,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(502, "Wix could not be reached. No price changes were attempted unless already reported.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = clean(payload?.message || payload?.details?.applicationError?.description || payload?.details?.validationError?.fieldViolations?.[0]?.description, 1000);
    throw new ApiError(response.status === 401 || response.status === 403 ? 502 : response.status, message || `Wix returned status ${response.status}.`, { wix_status: response.status });
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
        paging: { limit: 2, offset: 0 },
      },
    },
  });
  const items = Array.isArray(payload.dataItems) ? payload.dataItems : [];
  if (items.length > 1) throw new ApiError(409, `${collection.label} contains duplicate records for ${registration}. Nothing was changed.`, { collection_id: collection.id, registration });
  return items[0] || null;
}

function sameFields(left = {}, right = {}) {
  const keys = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
  return Array.from(keys).every((key) => clean(left?.[key], 1000) === clean(right?.[key], 1000));
}

async function buildPreview(configuration, registration, retailPrice) {
  const queried = await Promise.all(VAN_FINANCE_WIX_COLLECTIONS.map(async (collection) => ({
    collection,
    item: await queryRegistration(configuration, collection, registration),
  })));
  const matches = queried.flatMap(({ collection, item }) => {
    if (!item) return [];
    const patch = buildFinanceWixPricePatch(collection, item, retailPrice);
    if (!patch) return [];
    return [{
      collection_id: collection.id,
      collection_label: collection.label,
      kind: collection.kind,
      item_id: item.id,
      current: financeWixCurrentFields(collection, item),
      proposed: patch.fields,
    }];
  });
  if (!matches.length) throw new ApiError(404, `No Van Finance Wix CMS records were found for ${registration}. Nothing was changed.`);
  return {
    registration,
    retail_price: retailPrice,
    monthly_price: calculateFivePercentFlatMonthly(retailPrice),
    match_count: matches.length,
    matches,
  };
}

function confirmationMatchesPreview(confirmation, preview) {
  if (!confirmation || confirmation.registration !== preview.registration) return false;
  if (Number(confirmation.retail_price) !== Number(preview.retail_price)) return false;
  if (!Array.isArray(confirmation.matches) || confirmation.matches.length !== preview.matches.length) return false;
  const confirmedByCollection = new Map(confirmation.matches.map((match) => [match.collection_id, match]));
  return preview.matches.every((match) => {
    const confirmed = confirmedByCollection.get(match.collection_id);
    return confirmed?.item_id === match.item_id && sameFields(confirmed?.current, match.current) && sameFields(confirmed?.proposed, match.proposed);
  });
}

async function patchFields(configuration, match, fields) {
  const fieldModifications = Object.entries(fields).map(([fieldPath, value]) => ({
    fieldPath,
    action: "SET_FIELD",
    setFieldOptions: { value },
  }));
  return wixRequest(configuration, `/wix-data/v2/items/${encodeURIComponent(match.item_id)}`, {
    method: "PATCH",
    body: {
      dataCollectionId: match.collection_id,
      patch: {
        dataItemId: match.item_id,
        fieldModifications,
      },
    },
  });
}

async function applyPreview(configuration, preview) {
  const applied = [];
  try {
    for (const match of preview.matches) {
      await patchFields(configuration, match, match.proposed);
      applied.push(match);
    }
    return applied;
  } catch (error) {
    const rollback = [];
    for (const match of [...applied].reverse()) {
      try {
        await patchFields(configuration, match, match.current);
        rollback.push({ collection_id: match.collection_id, ok: true });
      } catch (rollbackError) {
        rollback.push({ collection_id: match.collection_id, ok: false, message: clean(rollbackError.message, 500) });
      }
    }
    throw new ApiError(502, "Wix price update did not complete. Any records already changed were rolled back where possible. Check the result before retrying.", {
      cause: clean(error.message, 1000),
      applied_before_failure: applied.map((match) => match.collection_id),
      rollback,
    });
  }
}

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorize(request)) return response.status(401).json({ ok: false, message: "Access key not recognised." });

  let body = {};
  try {
    body = parseBody(request);
    const action = clean(body.action, 30);
    if (!['preview', 'update'].includes(action)) throw new ApiError(400, "Unsupported action.");
    if (body.pipeline && clean(body.pipeline, 30).toLowerCase() !== "finance") throw new ApiError(400, "Wix price updates are restricted to Van Finance.");
    const registration = normalizeFinanceRegistration(body.registration);
    if (!registration) throw new ApiError(400, "A valid vehicle registration is required.");
    const retailPrice = parseRetailPrice(body.retail_price);
    if (retailPrice === null || retailPrice < 1000 || retailPrice > 100000) throw new ApiError(400, "The Vansco retail price is outside the permitted range.");

    const configuration = wixConfiguration();
    const preview = await buildPreview(configuration, registration, retailPrice);
    if (action === "preview") return response.status(200).json({ ok: true, preview });

    if (!confirmationMatchesPreview(body.confirmation, preview)) {
      throw new ApiError(409, "Wix data changed after the preview, or the confirmation no longer matches. Nothing was changed. Preview again before updating.");
    }

    const applied = await applyPreview(configuration, preview);
    console.info("VANSCO WIX PRICE UPDATE", {
      registration,
      retail_price: retailPrice,
      monthly_price: preview.monthly_price,
      collections: applied.map((match) => match.collection_id),
    });
    return response.status(200).json({ ok: true, updated: { ...preview, updated_count: applied.length } });
  } catch (error) {
    console.error("VANSCO WIX PRICE ERROR", { action: clean(body.action, 30), registration: clean(body.registration, 30), status: error.status || 500, message: clean(error.message, 1000), details: error.details || null });
    return response.status(error.status || 500).json({ ok: false, message: error.message || "Wix price update failed.", details: error.details || null });
  }
}

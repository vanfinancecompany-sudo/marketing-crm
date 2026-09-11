import { fetchDealerKitStockDetail } from "./_dealerkit-stock-adapter.js";
import {
  VAN_FINANCE_WIX_COLLECTIONS,
  buildFinanceWixPricePatch,
  calculateFivePercentFlatMonthly,
  financeWixCurrentFields,
  normalizeFinanceRegistration,
  parseRetailPrice,
} from "../lib/vanscoWixPrice.js";
import {
  CAR_WIX_PRICE_COLLECTIONS,
  RENT2BUY_PRICE_COLLECTIONS,
  buildCarWixPricePatch,
  buildRent2BuyWixPricePatch,
  calculatePublishedRent2BuyPricing,
  carWixCurrentFields,
  rent2BuyWixCurrentFields,
} from "../lib/dealerKitPublishedPrice.js";
import {
  STANDALONE_RENT2BUY_WIX_SITE_ID,
  VAN_FINANCE_RENT2BUY_WIX_SITE_ID,
} from "../lib/dealerKitRent2BuyWixPlan.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const clean = (value, limit = 10000) => String(value ?? "").trim().slice(0, limit);

class ApiError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function authorize(request, environment = process.env) {
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

function firstValue(environment, names, limit = 5000) {
  for (const name of names) {
    const value = clean(environment?.[name], limit);
    if (value) return value;
  }
  return "";
}

function wixConfigurations(environment = process.env) {
  const apiBaseUrl = clean(environment.WIX_API_BASE_URL, 1000) || "https://www.wixapis.com";

  // The long-running Finance price updater has always used WIX_API_KEY. Keep that
  // write-capable identity first for Van Finance and its Rent2Buy collections.
  // WIX_FINANCE_API_KEY can remain a read/create fallback for other workflows.
  const financeApiKey = firstValue(environment, ["WIX_API_KEY", "WIX_FINANCE_API_KEY"]);
  const financeSiteId = firstValue(environment, ["WIX_SITE_ID", "WIX_FINANCE_SITE_ID"], 500) || VAN_FINANCE_RENT2BUY_WIX_SITE_ID;

  const carApiKey = firstValue(environment, ["WIX_CAR_API_KEY", "WIX_API_KEY", "WIX_FINANCE_API_KEY"]);
  const carSiteId = firstValue(environment, ["WIX_CAR_SITE_ID", "WIX_SITE_ID", "WIX_FINANCE_SITE_ID"], 500) || financeSiteId;

  const standaloneApiKey = firstValue(environment, ["WIX_RENT2BUY_API_KEY", "WIX_API_KEY", "WIX_FINANCE_API_KEY"]);

  if (!financeApiKey) throw new ApiError(500, "Van Finance Wix price updating is not configured.");
  if (!carApiKey) throw new ApiError(500, "Car Wix price updating is not configured.");
  if (!standaloneApiKey) throw new ApiError(500, "Standalone Rent2Buy Wix price updating is not configured.");

  return {
    finance: { apiKey: financeApiKey, siteId: financeSiteId, siteLabel: "VAN FINANCE Wix", apiBaseUrl },
    cars: { apiKey: carApiKey, siteId: carSiteId, siteLabel: "CAR Wix", apiBaseUrl },
    rent2buyPrimary: { apiKey: financeApiKey, siteId: VAN_FINANCE_RENT2BUY_WIX_SITE_ID, siteLabel: "VAN FINANCE Wix · Rent2Buy", apiBaseUrl },
    rent2buyStandalone: { apiKey: standaloneApiKey, siteId: STANDALONE_RENT2BUY_WIX_SITE_ID, siteLabel: "RENT2BUY VANS Wix", apiBaseUrl },
  };
}

async function wixRequest(configuration, path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(`${configuration.apiBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: configuration.apiKey,
        "wix-site-id": configuration.siteId,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(502, `Wix could not be reached for ${configuration.siteLabel}.`);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = clean(payload?.message || payload?.details?.applicationError?.description || payload?.details?.validationError?.fieldViolations?.[0]?.description, 1000);
    throw new ApiError(response.status === 401 || response.status === 403 ? 502 : response.status, message || `Wix returned status ${response.status}.`, { wix_status: response.status, site_id: configuration.siteId });
  }
  return payload;
}

async function queryRegistration(configuration, collection, registration) {
  const payload = await wixRequest(configuration, "/wix-data/v2/items/query", {
    method: "POST",
    body: {
      dataCollectionId: collection.id,
      query: { filter: { title: { $eq: registration } }, paging: { limit: 3, offset: 0 } },
      consistentRead: true,
    },
  });
  const items = Array.isArray(payload.dataItems) ? payload.dataItems : [];
  if (items.length > 1) throw new ApiError(409, `${configuration.siteLabel} / ${collection.label} contains duplicate records for ${registration}. Nothing was changed.`, { site_id: configuration.siteId, collection_id: collection.id, registration });
  return items[0] || null;
}

function sameFields(left = {}, right = {}) {
  const keys = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
  return Array.from(keys).every((key) => clean(left?.[key], 2000) === clean(right?.[key], 2000));
}

async function freshDealerKitVehicle(body, pipeline) {
  const registration = normalizeFinanceRegistration(body.registration);
  if (!registration) throw new ApiError(400, "A valid vehicle registration is required.");
  const supplierStockId = clean(body.supplier_stock_id || body.supplierStockId, 300);
  if (supplierStockId) {
    let vehicle;
    try { vehicle = await fetchDealerKitStockDetail(supplierStockId, { specifications: false }); }
    catch (error) { throw new ApiError(502, `DealerKit could not be rechecked: ${clean(error?.message, 500) || "request failed"}`); }
    if (normalizeFinanceRegistration(vehicle?.registration) !== registration) throw new ApiError(409, "DealerKit registration no longer matches this price card. Refresh Stock Watch before updating.");
    if (!["available", "in_stock", "due_in"].includes(clean(vehicle?.status || vehicle?.sourceStatus, 100).toLowerCase().replace(/[\s-]+/g, "_"))) throw new ApiError(409, "DealerKit no longer shows this vehicle as available for a price update. Refresh Stock Watch.");
    const retailPrice = parseRetailPrice(vehicle?.retailPrice);
    if (retailPrice === null || retailPrice < 1000 || retailPrice > 100000) throw new ApiError(409, "DealerKit no longer has a safe advertised retail price for this vehicle.");
    return { ...vehicle, registration, retailPrice, supplierStockId, sourceMode: "fresh_dealerkit" };
  }

  const retailPrice = parseRetailPrice(body.retail_price);
  if (retailPrice === null || retailPrice < 1000 || retailPrice > 100000) throw new ApiError(400, "The DealerKit retail price is outside the permitted range.");
  if (pipeline === "rent2buy" && !Number.isFinite(Number(body.mileage))) throw new ApiError(400, "DealerKit mileage is required to recalculate Rent2Buy pricing.");
  return {
    registration,
    retailPrice,
    mileage: Number.isFinite(Number(body.mileage)) ? Number(body.mileage) : null,
    vatStatus: clean(body.vat_status || body.vatStatus, 80) || "unknown",
    supplierStockId: "",
    sourceMode: "saved_dealerkit_snapshot",
  };
}

function makeMatch(configuration, collection, item, current, proposed) {
  return {
    site_id: configuration.siteId,
    site_label: configuration.siteLabel,
    collection_id: collection.id,
    collection_label: collection.label,
    kind: collection.kind,
    item_id: item.id,
    current,
    proposed,
  };
}

async function financePreview(configuration, vehicle) {
  const queried = await Promise.all(VAN_FINANCE_WIX_COLLECTIONS.map(async (collection) => ({ collection, item: await queryRegistration(configuration, collection, vehicle.registration) })));
  const master = queried.find(({ collection }) => collection.id === "VANFINANCE-ALLVANS");
  if (!master?.item) throw new ApiError(409, `${vehicle.registration} is not currently published in the Van Finance master listing. Nothing was changed.`);
  const matches = queried.flatMap(({ collection, item }) => {
    if (!item) return [];
    const patch = buildFinanceWixPricePatch(collection, item, vehicle.retailPrice);
    return patch ? [makeMatch(configuration, collection, item, financeWixCurrentFields(collection, item), patch.fields)] : [];
  });
  return {
    pipeline: "finance",
    registration: vehicle.registration,
    supplier_stock_id: vehicle.supplierStockId || null,
    source_mode: vehicle.sourceMode,
    retail_price: vehicle.retailPrice,
    monthly_price: calculateFivePercentFlatMonthly(vehicle.retailPrice),
    match_count: matches.length,
    matches,
  };
}

async function carPreview(configuration, vehicle) {
  const queried = await Promise.all(CAR_WIX_PRICE_COLLECTIONS.map(async (collection) => ({ collection, item: await queryRegistration(configuration, collection, vehicle.registration) })));
  const master = queried.find(({ collection }) => collection.id === "CARFINANCE");
  if (!master?.item) throw new ApiError(409, `${vehicle.registration} is not currently published in the Car Finance master listing. Nothing was changed.`);
  const matches = queried.flatMap(({ collection, item }) => {
    if (!item) return [];
    const patch = buildCarWixPricePatch(collection, item, vehicle.retailPrice);
    return patch ? [makeMatch(configuration, collection, item, carWixCurrentFields(collection, item), patch.fields)] : [];
  });
  return {
    pipeline: "cars",
    registration: vehicle.registration,
    supplier_stock_id: vehicle.supplierStockId || null,
    source_mode: vehicle.sourceMode,
    retail_price: vehicle.retailPrice,
    monthly_price: calculateFivePercentFlatMonthly(vehicle.retailPrice),
    match_count: matches.length,
    matches,
  };
}

async function rent2BuyPreview(configurations, vehicle) {
  const queriedSites = await Promise.all(configurations.map(async (configuration) => ({
    configuration,
    rows: await Promise.all(RENT2BUY_PRICE_COLLECTIONS.map(async (collection) => ({ collection, item: await queryRegistration(configuration, collection, vehicle.registration) }))),
  })));
  for (const { configuration, rows } of queriedSites) {
    const master = rows.find(({ collection }) => collection.id === "ALLRENT2BUYVANS");
    if (!master?.item) throw new ApiError(409, `${vehicle.registration} is not published in ${configuration.siteLabel} ALLRENT2BUYVANS. Price sync is held so the two Rent2Buy sites cannot drift.`);
  }
  const pickup = queriedSites.some(({ rows }) => rows.some(({ collection, item }) => collection.id === "PICKUPS" && item));
  const pricing = calculatePublishedRent2BuyPricing({ retailPrice: vehicle.retailPrice, mileage: vehicle.mileage, vatStatus: vehicle.vatStatus, pickup });
  if (!pricing) throw new ApiError(409, "Rent2Buy pricing could not be safely recalculated from the current DealerKit retail price and mileage.");

  const matches = [];
  for (const { configuration, rows } of queriedSites) {
    const standalone = configuration.siteId === STANDALONE_RENT2BUY_WIX_SITE_ID;
    for (const { collection, item } of rows) {
      if (!item) continue;
      const patch = buildRent2BuyWixPricePatch(collection, item, pricing, { standalone });
      if (patch) matches.push(makeMatch(configuration, collection, item, rent2BuyWixCurrentFields(collection, item, { standalone }), patch.fields));
    }
  }
  return {
    pipeline: "rent2buy",
    registration: vehicle.registration,
    supplier_stock_id: vehicle.supplierStockId || null,
    source_mode: vehicle.sourceMode,
    retail_price: vehicle.retailPrice,
    mileage: vehicle.mileage,
    vat_status: vehicle.vatStatus,
    monthly_price: pricing.monthly,
    upfront_price: pricing.upfront,
    term_months: pricing.termMonths,
    following_payments: pricing.followingPayments,
    pickup,
    match_count: matches.length,
    matches,
  };
}

function confirmationMatchesPreview(confirmation, preview) {
  if (!confirmation || confirmation.pipeline !== preview.pipeline || confirmation.registration !== preview.registration) return false;
  if (Number(confirmation.retail_price) !== Number(preview.retail_price)) return false;
  if (!Array.isArray(confirmation.matches) || confirmation.matches.length !== preview.matches.length) return false;
  const key = (match) => `${match.site_id}:${match.collection_id}`;
  const confirmedByTarget = new Map(confirmation.matches.map((match) => [key(match), match]));
  return preview.matches.every((match) => {
    const confirmed = confirmedByTarget.get(key(match));
    return confirmed?.item_id === match.item_id && sameFields(confirmed?.current, match.current) && sameFields(confirmed?.proposed, match.proposed);
  });
}

async function patchFields(configuration, match, fields) {
  const fieldModifications = Object.entries(fields).map(([fieldPath, value]) => ({ fieldPath, action: "SET_FIELD", setFieldOptions: { value } }));
  return wixRequest(configuration, `/wix-data/v2/items/${encodeURIComponent(match.item_id)}`, {
    method: "PATCH",
    body: { dataCollectionId: match.collection_id, patch: { dataItemId: match.item_id, fieldModifications } },
  });
}

function configurationForMatch(configurations, preview, match) {
  if (preview.pipeline === "finance") return configurations.finance;
  if (preview.pipeline === "cars") return configurations.cars;
  if (preview.pipeline === "rent2buy") {
    if (match.site_id === configurations.rent2buyPrimary.siteId) return configurations.rent2buyPrimary;
    if (match.site_id === configurations.rent2buyStandalone.siteId) return configurations.rent2buyStandalone;
  }
  return null;
}

async function applyPreview(configurations, preview) {
  const applied = [];
  try {
    for (const match of preview.matches) {
      const configuration = configurationForMatch(configurations, preview, match);
      if (!configuration) throw new ApiError(500, `No Wix configuration is available for ${match.site_label || match.site_id}.`);
      await patchFields(configuration, match, match.proposed);
      applied.push(match);
    }
    return applied;
  } catch (error) {
    const rollback = [];
    for (const match of [...applied].reverse()) {
      const configuration = configurationForMatch(configurations, preview, match);
      try {
        await patchFields(configuration, match, match.current);
        rollback.push({ site_id: match.site_id, collection_id: match.collection_id, ok: true });
      } catch (rollbackError) {
        rollback.push({ site_id: match.site_id, collection_id: match.collection_id, ok: false, message: clean(rollbackError?.message, 500) || "Rollback failed" });
      }
    }
    throw new ApiError(502, "Published price update did not complete. Any records already changed were rolled back where possible.", { cause: clean(error?.message, 1000), rollback });
  }
}

async function buildPreview(configurations, pipeline, vehicle) {
  if (pipeline === "finance") return financePreview(configurations.finance, vehicle);
  if (pipeline === "cars") return carPreview(configurations.cars, vehicle);
  if (pipeline === "rent2buy") return rent2BuyPreview([configurations.rent2buyPrimary, configurations.rent2buyStandalone], vehicle);
  throw new ApiError(400, "Unsupported price-update pipeline.");
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorize(request)) return response.status(401).json({ ok: false, message: "Marketing CRM access is required." });

  let body = {};
  try {
    body = parseBody(request);
    const action = clean(body.action, 30).toLowerCase();
    const pipeline = clean(body.pipeline, 30).toLowerCase();
    if (!["preview", "update"].includes(action)) throw new ApiError(400, "Unsupported action.");
    if (!["finance", "rent2buy", "cars"].includes(pipeline)) throw new ApiError(400, "Choose Finance Vans, Rent2Buy Vans or Cars.");

    const vehicle = await freshDealerKitVehicle(body, pipeline);
    const configurations = wixConfigurations();
    const preview = await buildPreview(configurations, pipeline, vehicle);
    if (!preview.matches.length) throw new ApiError(404, `No published ${pipeline} Wix rows were found for ${vehicle.registration}. Nothing was changed.`);
    if (action === "preview") return response.status(200).json({ ok: true, preview });

    if (!confirmationMatchesPreview(body.confirmation, preview)) throw new ApiError(409, "DealerKit or Wix data changed after the preview. Nothing was changed. Preview again before updating.");
    const applied = await applyPreview(configurations, preview);
    console.info("DEALERKIT PUBLISHED PRICE UPDATE", { pipeline, registration: vehicle.registration, retail_price: vehicle.retailPrice, monthly_price: preview.monthly_price, targets: applied.map((match) => `${match.site_id}:${match.collection_id}`) });
    return response.status(200).json({ ok: true, updated: { ...preview, updated_count: applied.length } });
  } catch (error) {
    console.error("DEALERKIT PUBLISHED PRICE ERROR", { action: clean(body.action, 30), pipeline: clean(body.pipeline, 30), registration: clean(body.registration, 30), status: error.status || 500, message: clean(error?.message, 1000), details: error?.details || null });
    return response.status(error.status || 500).json({ ok: false, message: error?.message || "Published price update failed.", details: error?.details || null });
  }
}

import { getSupabaseAdmin, optionalTableReason } from "./_vansco-cache-utils.js";

// Keep this aligned with services/marketingVehicles.js fetchMarketingVehicles default.
// The posting pages only load/count this browser-side stock window, so the workspace
// summary must use the same limit or it will report higher numbers than the page.
const STOCK_LIMIT = 80;
const POSTING_VISIBILITY_TABLE = "posting_visibility_state";

function isToday(value) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function normalizePostingVehicleId(vehicleOrId) {
  const rawId = vehicleOrId && typeof vehicleOrId === "object" ? vehicleOrId.id : vehicleOrId;
  return String(rawId ?? "");
}

function normalizeRegistration(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function getPostingActionKey(vehicle, destination) {
  const reg = normalizeRegistration(vehicle?.reg || vehicle?.registration || vehicle?.title || vehicle?.name);
  const id = String(vehicle?.id || "").trim();
  return `${destination || ""}::${reg || id}`;
}

function vehicleFromCreativePayload(row) {
  const preview = row.preview_payload || {};
  return preview.vehicle || {
    id: row.vehicle_id || "",
    reg: row.registration || "",
    registration: row.registration || "",
    title: row.vehicle_name || "",
    name: row.vehicle_name || ""
  };
}

function mapFinanceVehicle(row, index) {
  const title = String(row.title || `finance-${index + 1}`).trim();
  return {
    id: row.id || title || `finance-${index}`,
    title,
    name: title,
    reg: normalizeRegistration(title),
    pipeline: "vanFinance"
  };
}

function mapRentVehicle(row, index) {
  const registration = String(row.registration || `rent-${index + 1}`).trim();
  return {
    id: row.id || registration || `rent-${index}`,
    title: registration,
    name: registration,
    reg: registration,
    registration,
    pipeline: "rent2buy"
  };
}

function mapCarVehicle(row, index) {
  const registration = String(row.registration || row.reg || row.vehicle_reg || row.number_plate || "").trim();
  const title = String(row.title || row.name || row.vehicle || row.make_model || registration || `car-${index + 1}`).trim();
  return {
    id: row.id || registration || title || `car-${index}`,
    title,
    name: title,
    reg: registration,
    registration,
    pipeline: "cars"
  };
}

function isActiveMarketingRow(row) {
  if (row?.is_active === false) return false;
  if (row?.active === false) return false;
  if (String(row?.status || "").toLowerCase() === "inactive") return false;
  if (String(row?.archived || "").toLowerCase() === "true") return false;
  if (String(row?.hidden || "").toLowerCase() === "true") return false;
  return true;
}

function normalizeHiddenIds(value) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();
  return value
    .map((item) => normalizePostingVehicleId(item))
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

async function fetchPostingHiddenState(supabase, warnings = []) {
  const fallback = {
    vanFinanceFacebook: [],
    rent2BuyFacebook: [],
    marketplace: []
  };

  const result = await supabase
    .from(POSTING_VISIBILITY_TABLE)
    .select("page_key, hidden_ids")
    .in("page_key", Object.keys(fallback));

  if (result.error) {
    warnings.push(`posting visibility unavailable: ${optionalTableReason(result.error)}`);
    return fallback;
  }

  return (result.data || []).reduce((state, row) => {
    if (Object.prototype.hasOwnProperty.call(state, row.page_key)) {
      state[row.page_key] = normalizeHiddenIds(row.hidden_ids);
    }
    return state;
  }, fallback);
}

async function fetchCars(supabase, warnings = []) {
  const tableCandidates = ["cars_stock", "car_stock", "cars", "car_vehicles", "facebook_cars", "car_adverts"];

  for (const tableName of tableCandidates) {
    const result = await supabase.from(tableName).select("*").limit(STOCK_LIMIT);
    if (result.error) {
      warnings.push(`${tableName} unavailable: ${optionalTableReason(result.error)}`);
      continue;
    }
    const rows = (result.data || []).filter(isActiveMarketingRow);
    if (rows.length) return rows.map(mapCarVehicle);
  }

  return [];
}

async function fetchStock(supabase, warnings = []) {
  const [financeSettled, rentSettled, carsSettled] = await Promise.allSettled([
    supabase
      .from("facebook_adverts")
      .select("id, title, is_active")
      .eq("is_active", true)
      .limit(STOCK_LIMIT),
    supabase
      .from("rent_vehicles")
      .select("id, registration, is_active")
      .eq("is_active", true)
      .limit(STOCK_LIMIT),
    fetchCars(supabase, warnings)
  ]);

  const financeResult = financeSettled.status === "fulfilled" ? financeSettled.value : { error: financeSettled.reason };
  const rentResult = rentSettled.status === "fulfilled" ? rentSettled.value : { error: rentSettled.reason };
  const cars = carsSettled.status === "fulfilled" ? carsSettled.value : [];

  if (carsSettled.status === "rejected") warnings.push(`cars stock unavailable: ${optionalTableReason(carsSettled.reason)}`);
  if (financeResult.error) warnings.push(`finance stock unavailable: ${optionalTableReason(financeResult.error)}`);
  if (rentResult.error) warnings.push(`Rent2Buy stock unavailable: ${optionalTableReason(rentResult.error)}`);

  const finance = financeResult.error ? [] : (financeResult.data || []).map(mapFinanceVehicle);
  const rent2buy = rentResult.error ? [] : (rentResult.data || []).map(mapRentVehicle);

  return {
    finance,
    rent2buy,
    cars,
    all: [...finance, ...rent2buy, ...cars]
  };
}

async function fetchPostedToday(supabase, warnings = []) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("marketing_creatives")
    .select("id, created_at, status, destination_page, vehicle_id, vehicle_name, registration, pipeline, preview_payload")
    .gte("created_at", startOfToday.toISOString())
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    warnings.push(`posting records unavailable: ${optionalTableReason(error)}`);
    return [];
  }

  return (data || [])
    .filter((row) => isToday(row.created_at))
    .map((row) => ({
      destination: row.destination_page || (row.pipeline === "rent2buy" ? "Rent2Buy Facebook" : "Van Finance Facebook"),
      postedAt: row.created_at,
      vehicle: vehicleFromCreativePayload(row)
    }));
}

function filterHiddenVehicles(vehicles, hiddenIds = []) {
  const hidden = new Set(normalizeHiddenIds(hiddenIds));
  return vehicles.filter((vehicle) => !hidden.has(normalizePostingVehicleId(vehicle)));
}

function buildPostingSummary(stock, postedToday, hiddenState) {
  const postedPostingKeys = new Set(
    postedToday.map((item) => getPostingActionKey(item.vehicle, item.destination))
  );

  const vanFinanceFacebookQueue = filterHiddenVehicles(
    stock.finance.filter(
      (vehicle) => !postedPostingKeys.has(getPostingActionKey(vehicle, "Van Finance Facebook"))
    ),
    hiddenState.vanFinanceFacebook
  );

  const rent2BuyFacebookQueue = filterHiddenVehicles(
    stock.rent2buy.filter(
      (vehicle) => !postedPostingKeys.has(getPostingActionKey(vehicle, "Rent2Buy Facebook"))
    ),
    hiddenState.rent2BuyFacebook
  );

  const marketplaceQueue = filterHiddenVehicles(
    stock.rent2buy.filter(
      (vehicle) => !postedPostingKeys.has(getPostingActionKey(vehicle, "Facebook Marketplace"))
    ),
    hiddenState.marketplace
  );

  return {
    vanFinanceFacebook: vanFinanceFacebookQueue.length,
    rent2BuyFacebook: rent2BuyFacebookQueue.length,
    facebookMarketplace: marketplaceQueue.length
  };
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }

  try {
    const supabase = getSupabaseAdmin();
    const warnings = [];
    const [stockResult, postedTodayResult, hiddenStateResult] = await Promise.allSettled([
      fetchStock(supabase, warnings),
      fetchPostedToday(supabase, warnings),
      fetchPostingHiddenState(supabase, warnings)
    ]);
    const stock = stockResult.status === "fulfilled" ? stockResult.value : { finance: [], rent2buy: [], cars: [], all: [] };
    const postedToday = postedTodayResult.status === "fulfilled" ? postedTodayResult.value : [];
    const hiddenState = hiddenStateResult.status === "fulfilled" ? hiddenStateResult.value : {
      vanFinanceFacebook: [],
      rent2BuyFacebook: [],
      marketplace: []
    };

    if (stockResult.status === "rejected") warnings.push(`stock summary unavailable: ${optionalTableReason(stockResult.reason)}`);
    if (postedTodayResult.status === "rejected") warnings.push(`posting records unavailable: ${optionalTableReason(postedTodayResult.reason)}`);
    if (hiddenStateResult.status === "rejected") warnings.push(`posting visibility unavailable: ${optionalTableReason(hiddenStateResult.reason)}`);

    const checkedAt = new Date().toISOString();

    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({
      ok: true,
      summary: {
        stock: {
          all: stock.all.length,
          vanFinance: stock.finance.length,
          rent2buy: stock.rent2buy.length,
          cars: stock.cars.length
        },
        posting: buildPostingSummary(stock, postedToday, hiddenState),
        checkedAt,
        warnings
      }
    });
  } catch (error) {
    response.status(200).json({
      ok: false,
      summary: {
        stock: { all: 0, vanFinance: 0, rent2buy: 0, cars: 0 },
        posting: { vanFinanceFacebook: 0, rent2BuyFacebook: 0, facebookMarketplace: 0 },
        checkedAt: new Date().toISOString(),
        warnings: [optionalTableReason(error)]
      },
      message: error?.message || "Could not load Workspace live summary."
    });
  }
}

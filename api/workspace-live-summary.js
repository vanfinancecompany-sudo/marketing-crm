import { getSupabaseAdmin } from "./_vansco-cache-utils.js";

// Keep this aligned with services/marketingVehicles.js fetchMarketingVehicles default.
// The posting pages only load/count this browser-side stock window, so the workspace
// summary must use the same limit or it will report higher numbers than the page.
const STOCK_LIMIT = 500;
const POSTING_VISIBILITY_TABLE = "posting_visibility_state";
const CARS_STOCK_TABLE = process.env.VITE_CARS_STOCK_TABLE || process.env.CARS_STOCK_TABLE || "";
const CAR_TABLE_CANDIDATES = ["cars_stock", "car_stock", "cars", "car_vehicles", "facebook_cars", "car_adverts"];
const PLACEHOLDER_CAR_TEXT_PATTERNS = [
  /\bcar title here\b/i,
  /\breg\d+here\b/i,
  /\bregistration here\b/i,
  /\bexample\b/i,
  /\bplaceholder\b/i,
];

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

function extractRegistration(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return "";

  const ukRegMatch = text.match(
    /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/
  );

  return ukRegMatch ? ukRegMatch[1].replace(/\s+/g, " ").trim() : "";
}

function valueOrFallback(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim() !== "") return value;
  }
  return "";
}

function convertWixImage(url) {
  if (!url) return "";
  const value = String(url).trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  const match = value.match(/wix:image:\/\/v1\/([^/]+)/);
  return match ? `https://static.wixstatic.com/media/${match[1]}` : value;
}

function normalizeRegistrationForValidation(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function isLikelyRealRegistration(value) {
  const rawValue = String(value || "");
  if (PLACEHOLDER_CAR_TEXT_PATTERNS.some((pattern) => pattern.test(rawValue))) return false;

  const registration = normalizeRegistrationForValidation(extractRegistration(value) || value);
  if (!registration || registration.length < 5 || registration.length > 8) return false;
  if (PLACEHOLDER_CAR_TEXT_PATTERNS.some((pattern) => pattern.test(registration))) return false;

  return (
    /^[A-Z]{2}[0-9]{2}[A-Z]{3}$/.test(registration) ||
    /^[A-Z][0-9]{1,3}[A-Z]{3}$/.test(registration) ||
    /^[A-Z]{3}[0-9]{1,3}[A-Z]$/.test(registration) ||
    /^[0-9]{1,4}[A-Z]{1,3}$/.test(registration)
  );
}

function isPlaceholderCarRow(row) {
  const text = [
    row?.title,
    row?.name,
    row?.vehicle,
    row?.make_model,
    row?.description,
    row?.registration,
    row?.reg,
    row?.vehicle_reg,
    row?.number_plate,
  ]
    .filter(Boolean)
    .join(" ");

  return PLACEHOLDER_CAR_TEXT_PATTERNS.some((pattern) => pattern.test(text));
}

function isActiveMarketingRow(row) {
  if (row?.is_active === false) return false;
  if (row?.active === false) return false;
  if (String(row?.status || "").toLowerCase() === "inactive") return false;
  if (String(row?.archived || "").toLowerCase() === "true") return false;
  if (String(row?.hidden || "").toLowerCase() === "true") return false;
  return true;
}

function isUsableCarRow(row) {
  if (!isActiveMarketingRow(row)) return false;
  if (isPlaceholderCarRow(row)) return false;

  const registration = valueOrFallback(row.registration, row.reg, row.vehicle_reg, row.number_plate, extractRegistration(row.title || row.name || row.vehicle || ""));
  const imageUrl = convertWixImage(row.picture || row.image || row.image_url || row.imageUrl);

  return isLikelyRealRegistration(registration) && Boolean(imageUrl);
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
    pipeline: "vanFinance",
    originalPipeline: "vanFinance",
    rent2buyEligible: false,
    rent2buyData: null
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

async function fetchPostingHiddenState(supabase) {
  const fallback = {
    vanFinanceFacebook: [],
    rent2BuyFacebook: [],
    marketplace: []
  };

  const result = await supabase
    .from(POSTING_VISIBILITY_TABLE)
    .select("page_key, hidden_ids")
    .in("page_key", Object.keys(fallback));

  if (result.error) return fallback;

  return (result.data || []).reduce((state, row) => {
    if (Object.prototype.hasOwnProperty.call(state, row.page_key)) {
      state[row.page_key] = normalizeHiddenIds(row.hidden_ids);
    }
    return state;
  }, fallback);
}

async function fetchCars(supabase) {
  const tableCandidates = CARS_STOCK_TABLE
    ? [CARS_STOCK_TABLE, ...CAR_TABLE_CANDIDATES.filter((tableName) => tableName !== CARS_STOCK_TABLE)]
    : CAR_TABLE_CANDIDATES;

  for (const tableName of tableCandidates) {
    const result = await supabase.from(tableName).select("*").limit(STOCK_LIMIT);
    if (result.error) continue;
    const rows = (result.data || []).filter(isUsableCarRow);
    if (rows.length) return rows.map(mapCarVehicle);
  }

  return [];
}

async function fetchStock(supabase) {
  const [financeResult, rentResult, cars] = await Promise.all([
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
    fetchCars(supabase)
  ]);

  if (financeResult.error) throw new Error(`Failed to load finance vehicles: ${financeResult.error.message}`);
  if (rentResult.error) throw new Error(`Failed to load Rent2Buy vehicles: ${rentResult.error.message}`);

  const finance = (financeResult.data || []).map(mapFinanceVehicle);
  const rent2buy = (rentResult.data || []).map(mapRentVehicle);
  const rentByReg = new Map(
    rent2buy
      .map((vehicle) => [normalizeRegistration(vehicle.reg || vehicle.registration || vehicle.title || vehicle.name), vehicle])
      .filter(([registration]) => registration)
  );
  const mergedFinance = finance.map((vehicle) => {
    const registration = normalizeRegistration(vehicle.reg || vehicle.registration || vehicle.title || vehicle.name);
    const rentMatch = rentByReg.get(registration) || null;

    return {
      ...vehicle,
      pipeline: "vanFinance",
      originalPipeline: "vanFinance",
      rent2buyEligible: Boolean(rentMatch),
      rent2buyData: rentMatch
    };
  });
  const rent2buyEligible = mergedFinance.filter((vehicle) => vehicle.rent2buyEligible);

  return {
    finance: mergedFinance,
    rent2buy: rent2buyEligible,
    cars,
    all: mergedFinance
  };
}

async function fetchPostedToday(supabase) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("marketing_creatives")
    .select("id, created_at, status, destination_page, vehicle_id, vehicle_name, registration, pipeline, preview_payload")
    .gte("created_at", startOfToday.toISOString())
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw new Error(`Failed to load marketing posting records: ${error.message}`);

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
    const [stock, postedToday, hiddenState] = await Promise.all([
      fetchStock(supabase),
      fetchPostedToday(supabase),
      fetchPostingHiddenState(supabase)
    ]);
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
        checkedAt
      }
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      message: error?.message || "Could not load Workspace live summary."
    });
  }
}

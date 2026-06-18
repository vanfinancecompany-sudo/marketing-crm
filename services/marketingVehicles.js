import { supabase } from "./supabase.js";

const CAR_TABLE_CANDIDATES = ["cars_stock", "car_stock", "cars", "car_vehicles", "facebook_cars", "car_adverts"];
const MARKETING_STOCK_WATCH_LIMIT = 500;

function convertWixImage(url) {
  if (!url) return "";

  const value = String(url).trim();
  if (!value) return "";

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  const match = value.match(/wix:image:\/\/v1\/([^/]+)/);
  if (!match) return value;

  return `https://static.wixstatic.com/media/${match[1]}`;
}

export function extractRegistration(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return "";

  const ukRegMatch = text.match(
    /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/
  );

  return ukRegMatch ? ukRegMatch[1].replace(/\s+/g, " ").trim() : "";
}

function valueOrFallback(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return value;
    }
  }
  return "";
}

function normalizeRegistrationKey(value) {
  return extractRegistration(value).replace(/\s+/g, "").toUpperCase();
}

function isActiveMarketingRow(row) {
  if (row?.is_active === false) return false;
  if (row?.active === false) return false;
  if (String(row?.status || "").toLowerCase() === "inactive") return false;
  if (String(row?.archived || "").toLowerCase() === "true") return false;
  if (String(row?.hidden || "").toLowerCase() === "true") return false;
  return true;
}

function normalizeStockText(value) {
  return String(value || "").trim().toLowerCase();
}

function classifyFinanceVehicleType(row) {
  const text = [
    row?.title,
    row?.vanDescription,
    row?.vanSpec,
  ]
    .map(normalizeStockText)
    .filter(Boolean)
    .join(" ");

  if (!text) return "van";

  const vanSignals = [
    "van",
    "transit",
    "custom",
    "vito",
    "sprinter",
    "vivaro",
    "trafic",
    "crafter",
    "caddy",
    "partner",
    "berlingo",
    "boxer",
    "ducato",
    "movano",
    "master",
    "expert",
    "dispatch",
    "proace",
    "combo",
    "doblo",
    "tipper",
    "luton",
    "dropside",
    "panel van",
    "crew van",
    "crew cab",
    "lwb",
    "mwb",
    "swb",
    "low loader",
    "minibus",
    "9 seater",
  ];

  const carSignals = [
    "car",
    "petrol",
    "hybrid",
    "hatchback",
    "saloon",
    "estate",
    "suv",
    "coupe",
    "convertible",
    "mpv",
    "dualjet",
    "tfsi",
    "tdi",
    "tsi",
    "mhev",
    "a-class",
    "b-class",
    "c-class",
    "e-class",
    "golf",
    "polo",
    "focus",
    "fiesta",
    "qashqai",
    "juke",
    "ignis",
    "audi",
    "bmw",
    "mercedes",
    "suzuki",
    "toyota",
    "nissan",
    "hyundai",
    "kia",
    "volkswagen",
    "skoda",
    "seat",
    "peugeot 208",
    "peugeot 308",
    "renault clio",
    "ford fiesta",
    "ford focus",
  ];

  const hasVanSignal = vanSignals.some((signal) => text.includes(signal));
  if (hasVanSignal) return "van";

  const hasCarSignal = carSignals.some((signal) => text.includes(signal));
  if (hasCarSignal) return "car";

  return "van";
}

export function mapFinanceVehicleRow(row, index) {
  const imageUrl = convertWixImage(row.picture);
  const title = valueOrFallback(row.title, `finance-${index + 1}`);
  const vehicleType = classifyFinanceVehicleType(row);
  const isCar = vehicleType === "car";

  return {
    id: row.id || title || `finance-${index}`,
    title,
    name: title,
    reg: extractRegistration(title),
    picture: imageUrl,
    image: imageUrl,
    price: row.price || "",
    vat: row.vat || "",
    monthly: row.salePrice || "",
    salePrice: row.salePrice || "",
    vanDescription: row.vanDescription || "",
    description: row.vanDescription || "",
    vanSpec: row.vanSpec || "",
    spec: row.vanSpec || "",
    weblink: row.weblink || "",
    link: row.weblink || "",
    pipeline: isCar ? "cars" : "vanFinance",
    vehicleType,
    originalPipeline: "vanFinance",
    source: "vanFinance",
    rent2buyEligible: false,
    rent2buyData: null,
  };
}

export function mapRentVehicleRow(row, index) {
  const imageUrl = convertWixImage(row.picture);
  const registration = valueOrFallback(row.registration, `rent-${index + 1}`);

  return {
    id: row.id || registration || `rent-${index}`,
    title: registration,
    name: registration,
    reg: registration,
    picture: imageUrl,
    image: imageUrl,
    price: row.initialRental || "",
    monthly: row.monthly || "",
    week: row.week || "",
    initialRental: row.initialRental || "",
    vanDescription: row.vanDescription || "",
    description: row.vanDescription || "",
    vanSpec: row.vanSpec || "",
    spec: row.vanSpec || "",
    weblink: row.webLink || "",
    link: row.webLink || "",
    pipeline: "rent2buy",
  };
}

export function mapCarVehicleRow(row, index) {
  const imageUrl = convertWixImage(row.picture || row.image || row.image_url || row.imageUrl);
  const title = valueOrFallback(row.title, row.name, row.vehicle, row.make_model, row.description, `car-${index + 1}`);
  const registration = valueOrFallback(row.registration, row.reg, row.vehicle_reg, row.number_plate, extractRegistration(title));

  return {
    id: row.id || registration || title || `car-${index}`,
    title,
    name: title,
    reg: registration,
    registration,
    picture: imageUrl,
    image: imageUrl,
    price: row.price || row.cashPrice || row.salePrice || "",
    monthly: row.monthly || row.financeMonthly || "",
    salePrice: row.salePrice || row.price || "",
    description: row.description || row.carDescription || row.vanDescription || "",
    spec: row.spec || row.carSpec || row.vanSpec || "",
    weblink: row.weblink || row.webLink || row.link || "",
    link: row.weblink || row.webLink || row.link || "",
    pipeline: "cars",
  };
}

export async function fetchFinanceMarketingVehicles(limitPerPipeline = MARKETING_STOCK_WATCH_LIMIT) {
  const safeLimit = Math.min(Number(limitPerPipeline) || MARKETING_STOCK_WATCH_LIMIT, MARKETING_STOCK_WATCH_LIMIT);

  const financeQuery = supabase
    .from("facebook_adverts")
    .select("id, title, picture, price, vat, salePrice, vanDescription, vanSpec, weblink, is_active")
    .eq("is_active", true)
    .limit(safeLimit);

  const financeResult = await financeQuery;

  if (financeResult.error) {
    throw new Error(`Failed to load finance vehicles: ${financeResult.error.message}`);
  }

  return (financeResult.data || []).map(mapFinanceVehicleRow);
}

export async function fetchRentMarketingVehicles(limitPerPipeline = MARKETING_STOCK_WATCH_LIMIT) {
  const safeLimit = Math.min(Number(limitPerPipeline) || MARKETING_STOCK_WATCH_LIMIT, MARKETING_STOCK_WATCH_LIMIT);

  const rentQuery = supabase
    .from("rent_vehicles")
    .select("id, registration, picture, monthly, week, initialRental, vanDescription, vanSpec, webLink, is_active")
    .eq("is_active", true)
    .limit(safeLimit);

  const rentResult = await rentQuery;
  if (rentResult.error) {
    throw new Error(`Failed to load Rent2Buy vehicles: ${rentResult.error.message}`);
  }

  return (rentResult.data || []).map(mapRentVehicleRow);
}

export async function fetchCarMarketingVehicles(limitPerPipeline = 80) {
  const safeLimit = Math.min(Number(limitPerPipeline) || 80, MARKETING_STOCK_WATCH_LIMIT);
  const errors = [];

  for (const tableName of CAR_TABLE_CANDIDATES) {
    const result = await supabase
      .from(tableName)
      .select("*")
      .limit(safeLimit);

    if (result.error) {
      errors.push(`${tableName}: ${result.error.message}`);
      continue;
    }

    const rows = (result.data || []).filter(isActiveMarketingRow);
    if (rows.length) {
      return rows.map(mapCarVehicleRow);
    }
  }

  throw new Error(`Failed to load Cars vehicles. Tried: ${errors.join(" | ") || CAR_TABLE_CANDIDATES.join(", ")}`);
}

export async function fetchMarketingVehicles(limitPerPipeline = MARKETING_STOCK_WATCH_LIMIT) {
  const [financeVehicles, rentVehicles] = await Promise.all([
    fetchFinanceMarketingVehicles(limitPerPipeline),
    fetchRentMarketingVehicles(limitPerPipeline),
  ]);

  const rentByReg = new Map(
    rentVehicles
      .map((vehicle) => [normalizeRegistrationKey(vehicle.reg || vehicle.registration || vehicle.title || vehicle.name), vehicle])
      .filter(([registration]) => registration)
  );

  const financeWithRentData = financeVehicles.map((vehicle) => {
    const registration = normalizeRegistrationKey(vehicle.reg || vehicle.registration || vehicle.title || vehicle.name);
    const rentMatch = rentByReg.get(registration) || null;

    return {
      ...vehicle,
      pipeline: vehicle.pipeline,
      vehicleType: vehicle.vehicleType || "van",
      originalPipeline: "vanFinance",
      rent2buyEligible: Boolean(rentMatch),
      rent2buyData: rentMatch,
    };
  });

  return financeWithRentData;
}

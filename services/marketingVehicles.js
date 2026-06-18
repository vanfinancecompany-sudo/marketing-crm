import { supabase } from "./supabase.js";

const CARS_STOCK_TABLE = import.meta.env.VITE_CARS_STOCK_TABLE || "";
const MARKETING_STOCK_WATCH_LIMIT = 500;
const PLACEHOLDER_CAR_TEXT_PATTERNS = [
  /\bcar title here\b/i,
  /\breg\d+here\b/i,
  /\bregistration here\b/i,
  /\bexample\b/i,
  /\bplaceholder\b/i,
];

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

function isUsableCarRow(row) {
  if (!isActiveMarketingRow(row)) return false;
  if (isPlaceholderCarRow(row)) return false;

  const registration = valueOrFallback(row.registration, row.reg, row.vehicle_reg, row.number_plate, extractRegistration(row.title || row.name || row.vehicle || ""));
  const imageUrl = convertWixImage(row.picture || row.image || row.image_url || row.imageUrl);

  return isLikelyRealRegistration(registration) && Boolean(imageUrl);
}

export function mapFinanceVehicleRow(row, index) {
  const imageUrl = convertWixImage(row.picture);
  const title = valueOrFallback(row.title, `finance-${index + 1}`);

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
    pipeline: "vanFinance",
    vehicleType: "van",
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

  if (!CARS_STOCK_TABLE) {
    console.warn("Cars stock table not configured yet.");
    return [];
  }

  const result = await supabase
    .from(CARS_STOCK_TABLE)
    .select("*")
    .limit(safeLimit);

  if (result.error) {
    console.warn(`Cars stock table could not be loaded: ${result.error.message}`);
    return [];
  }

  return (result.data || [])
    .filter(isUsableCarRow)
    .map(mapCarVehicleRow);
}

export async function fetchMarketingVehicles(limitPerPipeline = MARKETING_STOCK_WATCH_LIMIT) {
  const [financeVehicles, rentVehicles, carsVehicles] = await Promise.all([
    fetchFinanceMarketingVehicles(limitPerPipeline),
    fetchRentMarketingVehicles(limitPerPipeline),
    fetchCarMarketingVehicles(limitPerPipeline),
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

  return [...financeWithRentData, ...carsVehicles];
}

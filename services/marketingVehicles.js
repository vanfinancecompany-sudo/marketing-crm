import { supabase } from "./supabase.js";
import {
  composeFinanceVehicleWithRent2Buy,
  isUsableCarRow,
  mapCarVehicleRow,
  mapFinanceVehicleRow,
  mapRentVehicleRow,
  normalizeRegistrationKey,
  toMarketingVehicleSelectionContract,
} from "./marketingVehicleContract.js";

export {
  convertWixImage,
  extractRegistration,
  getPrimaryVehicleImage,
  isActiveMarketingRow,
  isUsableCarRow,
  mapCarVehicleRow,
  mapFinanceVehicleRow,
  mapRentVehicleRow,
  normalizeRegistrationKey,
  toMarketingVehicleSelectionContract,
  valueOrFallback,
} from "./marketingVehicleContract.js";

const CARS_STOCK_TABLE = import.meta.env.VITE_CARS_STOCK_TABLE || "";
const MARKETING_STOCK_WATCH_LIMIT = 500;
let carsStockLoadState = {
  configured: Boolean(CARS_STOCK_TABLE),
  tableName: CARS_STOCK_TABLE,
  rawRows: 0,
  loaded: 0,
  error: "",
};

export function getCarsStockLoadState() {
  return { ...carsStockLoadState };
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
    .select("id, created_at, registration, picture, monthly, week, initialRental, vanDescription, vanSpec, webLink, is_active")
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
    carsStockLoadState = {
      configured: false,
      tableName: "",
      rawRows: 0,
      loaded: 0,
      error: "",
    };
    console.warn("Cars stock table not configured yet.");
    return [];
  }

  const result = await supabase
    .from(CARS_STOCK_TABLE)
    .select("*")
    .limit(safeLimit);

  if (result.error) {
    carsStockLoadState = {
      configured: true,
      tableName: CARS_STOCK_TABLE,
      rawRows: 0,
      loaded: 0,
      error: result.error.message || "Unknown Cars stock table load error.",
    };
    console.warn(`Cars stock table could not be loaded: ${result.error.message}`);
    return [];
  }

  const rawRows = result.data || [];
  const vehicles = rawRows
    .filter(isUsableCarRow)
    .map(mapCarVehicleRow);

  carsStockLoadState = {
    configured: true,
    tableName: CARS_STOCK_TABLE,
    rawRows: rawRows.length,
    loaded: vehicles.length,
    error: "",
  };

  return vehicles;
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

    return composeFinanceVehicleWithRent2Buy(vehicle, rentMatch);
  });

  return [...financeWithRentData, ...carsVehicles];
}

export async function getMarketingVehiclesForSelection(limitPerPipeline = MARKETING_STOCK_WATCH_LIMIT) {
  const vehicles = await fetchMarketingVehicles(limitPerPipeline);
  return vehicles.map(toMarketingVehicleSelectionContract);
}

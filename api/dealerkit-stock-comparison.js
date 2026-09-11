import { fetchDealerKitStockSnapshot } from "./_dealerkit-stock-adapter.js";
import { getSupabaseServiceAdmin, normalizeRegistration } from "./_vansco-cache-utils.js";
import { dealerKitVehicleBelongsToPipeline } from "../lib/dealerKitVehicleSegmentation.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const REGISTRATION_PATTERN = /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/i;
const REVIEW_LIMIT = 80;

function clean(value, limit = 3000) {
  return String(value ?? "").trim().slice(0, limit);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isAuthorised(request, environment = process.env) {
  const expected = clean(environment.MARKETING_CUSTOMER_DATABASE_API_KEY, 2000);
  const header = clean(request.headers?.[API_KEY_HEADER], 2000);
  const bearer = clean(request.headers?.authorization, 2200).replace(/^Bearer\s+/i, "");
  return Boolean(expected && (header === expected || bearer === expected));
}

export function extractRegistration(value) {
  const match = clean(value, 800).toUpperCase().match(REGISTRATION_PATTERN);
  return normalizeRegistration(match?.[1] || "");
}

export function classifyLocalVat(value) {
  if (typeof value === "boolean") return value ? "plus_vat" : "no_vat";
  const text = clean(value, 100).toUpperCase();
  if (!text) return "unknown";
  if (/NO\s*VAT|VAT\s*FREE|MARGIN|\bFALSE\b|^0$/.test(text)) return "no_vat";
  if (/VAT\s*INCLUDED|INCLUDING\s*VAT|INC\s*VAT/.test(text)) return "inc_vat";
  if (/\+\s*VAT|PLUS\s*VAT|EX\s*VAT|EXCLUDING\s*VAT|\bTRUE\b|\bYES\b|^1$|^VAT$/.test(text)) return "plus_vat";
  return "unknown";
}

function isCommercial(vehicle) {
  return dealerKitVehicleBelongsToPipeline(vehicle, "finance");
}

function isReservedLike(status) {
  return ["reserved", "sold", "deposit_taken", "awaiting_delivery"].includes(clean(status, 100).toLowerCase());
}

function isSourceAvailable(status) {
  return ["available", "due_in"].includes(clean(status, 100).toLowerCase());
}

function safePriceDifference(sourceVehicle, localVehicle) {
  const sourcePrice = finiteNumber(sourceVehicle?.retailPrice);
  const localPrice = finiteNumber(localVehicle?.price);
  const sourceVat = clean(sourceVehicle?.vatStatus, 50) || "unknown";
  const localVat = classifyLocalVat(localVehicle?.vat);
  if (sourcePrice === null || localPrice === null || sourcePrice === localPrice) return null;
  if (sourceVat === "unknown" || localVat === "unknown" || sourceVat !== localVat) return null;
  return {
    sourcePrice,
    localPrice,
    difference: Math.abs(localPrice - sourcePrice),
    direction: localPrice > sourcePrice ? "source_lower" : "source_higher",
    vatStatus: sourceVat,
  };
}

function financeRowRegistration(row) {
  return extractRegistration(row?.title || row?.registration || row?.reg || "");
}

function rentRowRegistration(row) {
  return normalizeRegistration(row?.registration || row?.reg || row?.title || "");
}

function localMap(rows, registrationOf) {
  const map = new Map();
  for (const row of rows || []) {
    const registration = registrationOf(row);
    if (registration && !map.has(registration)) map.set(registration, row);
  }
  return map;
}

function sourceRecord(vehicle, pipeline, reason, local = null, priceDifference = null) {
  return {
    pipeline,
    reason,
    supplierStockId: clean(vehicle?.supplierStockId, 300),
    registration: clean(vehicle?.registration, 20),
    title: clean(vehicle?.title, 500),
    sourceStatus: clean(vehicle?.sourceStatus, 100),
    status: clean(vehicle?.status, 100),
    retailPrice: finiteNumber(vehicle?.retailPrice),
    vatStatus: clean(vehicle?.vatStatus, 50) || "unknown",
    imageCount: Math.max(0, finiteNumber(vehicle?.imageCount) || 0),
    imageUrl: clean(vehicle?.primaryImage?.url, 3000),
    sourceUrl: clean(vehicle?.sourceUrl, 3000),
    localMatch: Boolean(local),
    localPrice: finiteNumber(local?.price),
    localUrl: clean(local?.weblink || local?.webLink, 3000),
    priceDifference,
  };
}

function localOnlyRecord(row, pipeline, registration, sourceComplete) {
  return {
    pipeline,
    reason: sourceComplete ? "local_not_on_dealerkit" : "local_not_seen_unverified",
    supplierStockId: "",
    registration,
    title: clean(row?.title || row?.registration || "Local stock vehicle", 500),
    sourceStatus: "",
    status: "",
    retailPrice: null,
    vatStatus: "unknown",
    imageCount: 0,
    imageUrl: clean(row?.picture, 3000),
    sourceUrl: "",
    localMatch: true,
    localPrice: finiteNumber(row?.price),
    localUrl: clean(row?.weblink || row?.webLink, 3000),
    priceDifference: null,
  };
}

function priority(reason) {
  const order = {
    price_difference: 1,
    source_status_changed: 2,
    missing_from_finance: 3,
    local_not_on_dealerkit: 4,
    local_not_seen_unverified: 5,
  };
  return order[reason] || 20;
}

export function buildDealerKitComparison({ snapshot = {}, financeRows = [], rentRows = [] } = {}) {
  const sourceVehicles = (Array.isArray(snapshot.vehicles) ? snapshot.vehicles : []).filter(isCommercial);
  const sourceByRegistration = new Map(sourceVehicles.map((vehicle) => [vehicle.registration, vehicle]).filter(([registration]) => registration));
  const financeByRegistration = localMap(financeRows, financeRowRegistration);
  const rentByRegistration = localMap(rentRows, rentRowRegistration);
  const sourceComplete = Boolean(snapshot.complete);
  const reviewRecords = [];

  let financeMatches = 0;
  let financeMissing = 0;
  let financePriceDifferences = 0;
  let financeStatusWarnings = 0;
  let financeFivePlusImageMatches = 0;
  let rentMatches = 0;
  let rentStatusWarnings = 0;

  for (const vehicle of sourceVehicles) {
    const registration = vehicle.registration;
    if (!registration) continue;

    const finance = financeByRegistration.get(registration) || null;
    if (finance) {
      financeMatches += 1;
      if ((vehicle.imageCount || 0) >= 5) financeFivePlusImageMatches += 1;
      if (isReservedLike(vehicle.status)) {
        financeStatusWarnings += 1;
        reviewRecords.push(sourceRecord(vehicle, "finance", "source_status_changed", finance));
      } else {
        const priceDifference = safePriceDifference(vehicle, finance);
        if (priceDifference) {
          financePriceDifferences += 1;
          reviewRecords.push(sourceRecord(vehicle, "finance", "price_difference", finance, priceDifference));
        }
      }
    } else if (isSourceAvailable(vehicle.status)) {
      financeMissing += 1;
      reviewRecords.push(sourceRecord(vehicle, "finance", "missing_from_finance"));
    }

    const rent = rentByRegistration.get(registration) || null;
    if (rent) {
      rentMatches += 1;
      if (isReservedLike(vehicle.status)) {
        rentStatusWarnings += 1;
        reviewRecords.push(sourceRecord(vehicle, "rent2buy", "source_status_changed", rent));
      }
    }
  }

  let financeLocalNotSeen = 0;
  for (const [registration, row] of financeByRegistration.entries()) {
    if (sourceByRegistration.has(registration)) continue;
    financeLocalNotSeen += 1;
    reviewRecords.push(localOnlyRecord(row, "finance", registration, sourceComplete));
  }

  let rentLocalNotSeen = 0;
  for (const [registration, row] of rentByRegistration.entries()) {
    if (sourceByRegistration.has(registration)) continue;
    rentLocalNotSeen += 1;
    reviewRecords.push(localOnlyRecord(row, "rent2buy", registration, sourceComplete));
  }

  reviewRecords.sort((a, b) => priority(a.reason) - priority(b.reason) || a.registration.localeCompare(b.registration));

  return {
    readOnly: true,
    authoritative: false,
    source: {
      provider: "dealerkit",
      complete: sourceComplete,
      apiReportedTotal: finiteNumber(snapshot.apiReportedTotal),
      usableRecords: finiteNumber(snapshot.vehicleCount) ?? sourceVehicles.length,
      commercialRecords: sourceVehicles.length,
      checkedAt: snapshot.checkedAt || new Date().toISOString(),
    },
    finance: {
      localVehicles: financeByRegistration.size,
      exactMatches: financeMatches,
      missingFromFinance: financeMissing,
      priceDifferences: financePriceDifferences,
      sourceStatusWarnings: financeStatusWarnings,
      localNotSeen: financeLocalNotSeen,
      sourceFivePlusImageMatches: financeFivePlusImageMatches,
    },
    rent2buy: {
      localVehicles: rentByRegistration.size,
      exactMatches: rentMatches,
      sourceStatusWarnings: rentStatusWarnings,
      localNotSeen: rentLocalNotSeen,
    },
    reviewRecordCount: reviewRecords.length,
    reviewRecords: reviewRecords.slice(0, REVIEW_LIMIT),
    truncated: reviewRecords.length > REVIEW_LIMIT,
  };
}

async function loadLocalStock(supabase) {
  const [financeResult, rentResult] = await Promise.all([
    supabase
      .from("facebook_adverts")
      .select("id,title,picture,price,vat,weblink,is_active")
      .eq("is_active", true)
      .limit(1000),
    supabase
      .from("rent_vehicles")
      .select("id,registration,picture,monthly,webLink,is_active")
      .eq("is_active", true)
      .limit(1000),
  ]);

  if (financeResult.error) throw new Error(`Finance stock read failed: ${financeResult.error.message || financeResult.error}`);
  if (rentResult.error) throw new Error(`Rent2Buy stock read failed: ${rentResult.error.message || rentResult.error}`);
  return { financeRows: financeResult.data || [], rentRows: rentResult.data || [] };
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }
  if (!isAuthorised(request)) {
    response.status(401).json({ ok: false, message: "Marketing CRM access is required." });
    return;
  }

  try {
    const [snapshot, local] = await Promise.all([
      fetchDealerKitStockSnapshot({ allowPartial: true }),
      loadLocalStock(getSupabaseServiceAdmin()),
    ]);
    const comparison = buildDealerKitComparison({ snapshot, ...local });
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(200).json({ ok: true, ...comparison });
  } catch (error) {
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.status(502).json({ ok: false, message: error?.message || "Could not compare DealerKit stock." });
  }
}

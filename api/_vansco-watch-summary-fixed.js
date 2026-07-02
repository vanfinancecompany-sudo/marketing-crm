import { buildVanscoWatchSummary as buildBaseVanscoWatchSummary } from "./_vansco-watch-summary.js";
import {
  CACHE_TABLE,
  WATCH_TABLE,
  extractVanscoId,
  getSupabaseAdmin,
  normalizeActionRecord,
  normalizeCacheRow,
  normalizeRegistration,
  normalizeUrl,
} from "./_vansco-cache-utils.js";

const CAR_TABLE_CANDIDATES = ["cars_stock", "car_stock", "cars", "car_vehicles", "facebook_cars", "car_adverts"];
const STOCK_LIMIT = 500;
const CAR_KEYWORDS = /\b(audi|bmw|jaguar|jeep|kia|lexus|mercedes-benz|mercedes|skoda|suzuki|hyundai|tesla|q2|q3|a1|a3|a4|a5|i10|i20|estate|hatchback|cabriolet|suv|coupe|saloon|convertible|sportback|xdrive|petrol|hybrid|electric|mhev)\b/i;
const VAN_WORDS = /\b(van|minibus|panel|commercial|crew|cab|pickup|pick-up|motorhome|camper|chassis|luton|dropside|taxi|black cab|city van|leader van|transit|vivaro|sprinter|crafter|vito|boxer|relay|ducato|caddy|berlingo|partner|dispatch|trafic|movano|master|proace)\b/i;

function textForVehicle(row) {
  return [row.title, row.name, row.vehicle, row.make_model, row.description, row.stock_url, row.stockUrl, row.vehicle_type, row.vehicleCategory]
    .filter(Boolean)
    .join(" ");
}

function looksLikeCar(row) {
  const text = textForVehicle(row);
  const explicitCategory = String(row.vehicle_type || row.vehicleCategory || "").toLowerCase();
  if (VAN_WORDS.test(text)) return false;
  return explicitCategory === "car" || /used-cars/i.test(text) || CAR_KEYWORDS.test(text);
}

function extractRegistration(value) {
  const text = String(value || "").trim().toUpperCase();
  const match = text.match(/\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/);
  return match ? match[1].replace(/\s+/g, "").trim() : "";
}

function registrationFromVehicle(row) {
  return normalizeRegistration(row.registration || row.reg || row.vehicle_reg || row.number_plate || extractRegistration(row.title || row.name || row.vehicle || row.make_model || ""));
}

function workflowStatusOf(record) {
  return String(record?.workflowStatus || record?.workflow_status || "").toLowerCase();
}

function isActiveRow(row) {
  if (row?.is_active === false) return false;
  if (row?.active === false) return false;
  if (String(row?.status || "").toLowerCase() === "inactive") return false;
  if (String(row?.archived || "").toLowerCase() === "true") return false;
  if (String(row?.hidden || "").toLowerCase() === "true") return false;
  return true;
}

function isReservedLikeStatus(status) {
  return ["reserved", "sold", "deposit_taken"].includes(String(status || "").toLowerCase());
}

function isTemporaryHiddenStatus(status) {
  return status === "ignored" || status === "hidden";
}

function isAdvertisedStatus(status) {
  return status === "added_to_crm" || status === "marked_advertised" || status === "advertised_awaiting_refresh";
}

function isNeverShowStatus(status) {
  return status === "never_show_again" || status.startsWith("not_listing_");
}

function recordCheckedTimeMs(record) {
  const rawValue = record?.lastCheckedAt || record?.lastSuccessfullyCheckedAt || record?.updatedAt || record?.updated_at;
  const time = rawValue ? new Date(rawValue).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function dedupeRecords(records) {
  const byKey = new Map();
  for (const record of records) {
    const registration = normalizeRegistration(record.registration);
    const key = registration || record.stockUrl || record.vehicleKey || record.id;
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing || recordCheckedTimeMs(record) >= recordCheckedTimeMs(existing)) byKey.set(key, record);
  }
  return Array.from(byKey.values());
}

function actionKeys(row) {
  const reg = normalizeRegistration(row.registration);
  const url = normalizeUrl(row.stock_url || row.stockUrl || row.stock_url_raw || "");
  const vanscoId = String(row.vansco_id || row.vanscoId || extractVanscoId(url) || "").toLowerCase();
  return { reg, url, vanscoId };
}

function recordKeys(row) {
  const reg = normalizeRegistration(row.registration);
  const url = normalizeUrl(row.stock_url || row.stockUrl || "");
  const vanscoId = String(row.vansco_id || row.vanscoId || extractVanscoId(url) || "").toLowerCase();
  return { reg, url, vanscoId };
}

function applyAction(cacheRecord, action) {
  const normalized = normalizeCacheRow(cacheRecord, action);
  if (!action) return normalized;
  const workflowStatus = workflowStatusOf(action);
  return {
    ...normalized,
    watchActionId: action.id || action.watchActionId || normalized.watchActionId || "",
    workflowStatus,
    workflow_status: workflowStatus,
    notes: action.notes ?? normalized.notes ?? "",
    actionMatched: true,
  };
}

async function fetchFinanceRegistrations(supabase) {
  const result = await supabase
    .from("facebook_adverts")
    .select("id, title, is_active")
    .eq("is_active", true)
    .limit(STOCK_LIMIT);

  if (result.error) throw new Error(`Failed to load finance vehicles: ${result.error.message}`);
  return new Set((result.data || []).map((row) => normalizeRegistration(extractRegistration(row.title))).filter(Boolean));
}

async function fetchCarRegistrations(supabase) {
  for (const tableName of CAR_TABLE_CANDIDATES) {
    const result = await supabase.from(tableName).select("*").limit(STOCK_LIMIT);
    if (result.error) continue;
    const registrations = (result.data || []).filter(isActiveRow).map(registrationFromVehicle).filter(Boolean);
    if (registrations.length) return new Set(registrations);
  }
  return new Set();
}

async function fetchCarsVanscoRecords(supabase) {
  const [{ data: cacheRows, error: cacheError }, { data: watchRows, error: watchError }] = await Promise.all([
    supabase.from(CACHE_TABLE).select("*").order("last_seen_in_url_list_at", { ascending: false }).limit(2000),
    supabase.from(WATCH_TABLE).select("*").eq("pipeline", "cars").limit(2000),
  ]);

  if (cacheError) throw cacheError;
  if (watchError) throw watchError;

  const actionByRegistration = new Map();
  const actionByUrl = new Map();
  const actionByVanscoId = new Map();

  (watchRows || []).forEach((row) => {
    const normalized = normalizeActionRecord(row);
    const action = {
      ...normalized,
      workflowStatus: workflowStatusOf(normalized) || workflowStatusOf(row),
      workflow_status: workflowStatusOf(normalized) || workflowStatusOf(row),
      notes: normalized.notes ?? row.notes ?? "",
    };
    const keys = actionKeys(row);
    if (keys.reg) actionByRegistration.set(keys.reg, action);
    if (keys.url) actionByUrl.set(keys.url, action);
    if (keys.vanscoId) actionByVanscoId.set(keys.vanscoId, action);
  });

  return dedupeRecords((cacheRows || []).filter(looksLikeCar).map((row) => {
    const keys = recordKeys(row);
    const action =
      (keys.reg && actionByRegistration.get(keys.reg)) ||
      (keys.url && actionByUrl.get(keys.url)) ||
      (keys.vanscoId && actionByVanscoId.get(keys.vanscoId)) ||
      null;
    return applyAction(row, action);
  }));
}

function classifyCarsRecord(record, carRegistrations, financeRegistrations) {
  const registration = normalizeRegistration(record.registration);
  const workflowStatus = workflowStatusOf(record);
  const reservedOnVansco = isReservedLikeStatus(record.sourceStatus);

  if (record.isCurrentlyOnVansco === false) return "hidden_not_current";
  if (!registration) return "hidden_no_registration";
  if (carRegistrations.has(registration)) return reservedOnVansco ? "reserved" : "hidden_already_ok";
  if (financeRegistrations.has(registration)) return "advertised";
  if (isNeverShowStatus(workflowStatus)) return "never";
  if (isAdvertisedStatus(workflowStatus)) return "advertised";
  if (isTemporaryHiddenStatus(workflowStatus)) return reservedOnVansco ? "hidden" : "back_in_stock";
  if (reservedOnVansco) return "hidden_reserved_not_advertised";
  return "missing";
}

async function buildCorrectedCarsSummary(supabase) {
  const [records, carRegistrations, financeRegistrations] = await Promise.all([
    fetchCarsVanscoRecords(supabase),
    fetchCarRegistrations(supabase),
    fetchFinanceRegistrations(supabase),
  ]);

  const statuses = records.map((record) => classifyCarsRecord(record, carRegistrations, financeRegistrations));
  return {
    missing: statuses.filter((status) => status === "missing").length,
    advertised: statuses.filter((status) => status === "advertised").length,
    latestDetailCheck: records.reduce((latest, record) => {
      const value = record.lastCheckedAt || record.lastSuccessfullyCheckedAt || record.updatedAt;
      if (!value) return latest;
      if (!latest) return value;
      return new Date(value) > new Date(latest) ? value : latest;
    }, ""),
  };
}

export async function buildVanscoWatchSummary() {
  const summary = await buildBaseVanscoWatchSummary();
  const supabase = getSupabaseAdmin();
  const correctedCars = await buildCorrectedCarsSummary(supabase);

  return {
    ...summary,
    cars: {
      ...(summary.cars || {}),
      ...correctedCars,
    },
  };
}

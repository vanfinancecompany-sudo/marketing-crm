import {
  CACHE_TABLE,
  WATCH_TABLE,
  extractVanscoId,
  getSupabaseAdmin,
  isMissingOptionalTableError,
  normalizeActionRecord,
  normalizeCacheRow,
  normalizeRegistration as normalizeCacheRegistration,
  normalizeUrl,
  optionalTableReason,
} from "./_vansco-cache-utils.js";

const PIPELINES = ["finance", "rent2buy", "cars"];
const CAR_TABLE_CANDIDATES = ["cars_stock", "car_stock", "cars", "car_vehicles", "facebook_cars", "car_adverts"];
const STOCK_LIMIT = 500;
const EMPTY_PIPELINE_SUMMARY = { missing: 0, localNotVansco: 0, latestDetailCheck: "" };

const VAN_KEYWORDS = /\b(transit|transit custom|custom|tipper|dropside|luton|crew van|minibus|panel van|box van|pickup|pick-up|chassis cab|relay|dispatch|scudo|daily|doblo|partner|berlingo|sprinter|crafter|vito|evito|e-vito|vivaro|movano|box-van|kangoo|trafic|traffic|master|ducato|talento|expert|transporter|caddy|maxus|combo|proace|primastar|nv200|nv300|bailey|pegasus|winnebago|motorhome|caravan|camper|townstar|vn5|levc|boxer|relay|jumper|bipper|nemo|vauxhall combo|citroen nemo|peugeot partner|mercedes-benz evito|mercedes evito)\b/i;
const VAN_PHRASES = /\b(l1h1|l2h1|l3h2|panel van|double cab|crew cab|welfare|dropside|tail lift|twin side loading door|high roof|medium roof|long wheelbase|short wheelbase|crew bus|crew van|double cab|commercial vehicle|black cab|city van|leader van|minibus)\b/i;
const CAR_KEYWORDS = /\b(audi|bmw|jaguar|jeep|kia|lexus|mercedes-benz|mercedes|skoda|suzuki|hyundai|tesla|q2|q3|a1|a3|a4|a5|i10|i20|estate|hatchback|cabriolet|suv|coupe|saloon|convertible|sportback|xdrive|petrol|hybrid|electric|mhev)\b/i;
const COMMERCIAL_NEGATIVE_KEYWORDS = /\b(van|minibus|panel|commercial|crew|cab|pickup|pick-up|motorhome|camper|chassis|luton|dropside|taxi|black cab|city van|leader van)\b/i;

function rowCategoryText(row) {
  return [
    row.title,
    row.stock_url,
    row.stockUrl,
    row.vansco_id,
    row.vehicle_type,
    row.vehicleCategory,
  ].filter(Boolean).join(" ");
}

function looksLikeVan(row) {
  const text = rowCategoryText(row);
  return VAN_KEYWORDS.test(text) || VAN_PHRASES.test(text) || /used-vans|no-vat-vans/i.test(text);
}

function looksLikeCar(row) {
  const text = rowCategoryText(row);
  const explicitCategory = String(row.vehicle_type || row.vehicleCategory || "").toLowerCase();
  const explicitCar = explicitCategory === "car" || /used-cars/i.test(text);

  if (looksLikeVan(row)) return false;
  if (COMMERCIAL_NEGATIVE_KEYWORDS.test(text)) return false;

  return explicitCar || CAR_KEYWORDS.test(text);
}

function rowMatchesPipeline(row, pipeline) {
  if (pipeline === "cars") return looksLikeCar(row);
  return !looksLikeCar(row);
}

function compactWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractRegistration(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return "";

  const ukRegMatch = text.match(
    /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/
  );

  return ukRegMatch ? ukRegMatch[1].replace(/\s+/g, " ").trim() : "";
}

function normalizeWatchRegistration(value) {
  const text = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!text || text.length < 5 || text.length > 8) return "";
  if (!/[A-Z]/.test(text) || !/[0-9]/.test(text)) return "";
  return text;
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

function isActiveMarketingRow(row) {
  if (row?.is_active === false) return false;
  if (row?.active === false) return false;
  if (String(row?.status || "").toLowerCase() === "inactive") return false;
  if (String(row?.archived || "").toLowerCase() === "true") return false;
  if (String(row?.hidden || "").toLowerCase() === "true") return false;
  return true;
}

function mapFinanceVehicleRow(row, index) {
  const imageUrl = convertWixImage(row.picture);
  const title = valueOrFallback(row.title, `finance-${index + 1}`);
  return {
    id: row.id || title || `finance-${index}`,
    title,
    name: title,
    reg: extractRegistration(title),
    image: imageUrl,
    weblink: row.weblink || "",
    link: row.weblink || "",
  };
}

function mapRentVehicleRow(row, index) {
  const imageUrl = convertWixImage(row.picture);
  const registration = valueOrFallback(row.registration, `rent-${index + 1}`);
  return {
    id: row.id || registration || `rent-${index}`,
    title: registration,
    name: registration,
    reg: registration,
    image: imageUrl,
    weblink: row.webLink || "",
    link: row.webLink || "",
  };
}

function mapCarVehicleRow(row, index) {
  const imageUrl = convertWixImage(row.picture || row.image || row.image_url || row.imageUrl);
  const title = valueOrFallback(row.title, row.name, row.vehicle, row.make_model, row.description, `car-${index + 1}`);
  const registration = valueOrFallback(row.registration, row.reg, row.vehicle_reg, row.number_plate, extractRegistration(title));
  return {
    id: row.id || registration || title || `car-${index}`,
    title,
    name: title,
    reg: registration,
    registration,
    image: imageUrl,
    weblink: row.weblink || row.webLink || row.link || "",
    link: row.weblink || row.webLink || row.link || "",
  };
}

function workflowStatusOf(record) {
  return String(record?.workflowStatus || record?.workflow_status || "").toLowerCase();
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
  return status === "never_show_again" || status === "not_listing_spec" || status === "not_listing_price" || status === "not_listing_mileage";
}

function isBlockedAction(row) {
  const status = workflowStatusOf(row);
  return status === "ignored" || status.startsWith("not_listing_");
}

function recordCheckedTimeMs(record) {
  const rawValue = record?.lastCheckedAt || record?.lastSuccessfullyCheckedAt || record?.updatedAt || record?.updated_at;
  const time = rawValue ? new Date(rawValue).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function latestIso(values) {
  return values.reduce((latest, value) => {
    if (!value) return latest;
    if (!latest) return value;
    return new Date(value) > new Date(latest) ? value : latest;
  }, "");
}

function dedupeDisplayRecords(records) {
  const byKey = new Map();
  records.forEach((record) => {
    const registration = normalizeWatchRegistration(record.registration);
    const key = registration || record.stockUrl || record.vehicleKey || record.id;
    if (!key) return;
    const existing = byKey.get(key);
    if (!existing || recordCheckedTimeMs(record) >= recordCheckedTimeMs(existing)) byKey.set(key, record);
  });
  return Array.from(byKey.values());
}

function dedupeLocalVehiclesByRegistration(vehicles) {
  const byReg = new Map();
  vehicles.forEach((vehicle, index) => {
    const registration = normalizeWatchRegistration(vehicle.reg || vehicle.registration || vehicle.title || vehicle.name);
    if (!registration) return;
    if (!byReg.has(registration)) byReg.set(registration, { vehicle, index, registration });
  });
  return Array.from(byReg.values());
}

function classifyWatchRecord(record, localRegistrationSet, selectedPipeline) {
  const registration = normalizeWatchRegistration(record.registration);
  const hasExactLocalMatch = Boolean(registration && localRegistrationSet?.has(registration));
  const workflowStatus = workflowStatusOf(record);
  const reservedOnVansco = isReservedLikeStatus(record.sourceStatus);
  const currentlyOnVansco = record.isCurrentlyOnVansco !== false;
  const baseRecord = { ...record, pipeline: selectedPipeline, workflowStatus, safeExactRegistrationMatch: hasExactLocalMatch };

  if (!currentlyOnVansco) return { ...baseRecord, displayStatus: "hidden_not_current", matchStatus: "hidden_not_current" };
  if (!registration) return { ...baseRecord, displayStatus: "hidden_no_registration", matchStatus: "hidden_no_registration" };
  if (hasExactLocalMatch && reservedOnVansco) return { ...baseRecord, displayStatus: "reserved", matchStatus: "reserved_still_listed" };
  if (hasExactLocalMatch) return { ...baseRecord, displayStatus: "hidden_already_ok", matchStatus: "listed" };
  if (isNeverShowStatus(workflowStatus)) return { ...baseRecord, displayStatus: "never", matchStatus: "never_show_again" };
  if (isAdvertisedStatus(workflowStatus)) return { ...baseRecord, displayStatus: "advertised", matchStatus: "advertised_awaiting_refresh" };
  if (isTemporaryHiddenStatus(workflowStatus)) {
    if (!reservedOnVansco) return { ...baseRecord, displayStatus: "back_in_stock", matchStatus: "hidden_back_in_stock" };
    return { ...baseRecord, displayStatus: "hidden", matchStatus: "hidden" };
  }
  if (reservedOnVansco) return { ...baseRecord, displayStatus: "hidden_reserved_not_advertised", matchStatus: "hidden_reserved_not_advertised" };
  return { ...baseRecord, displayStatus: "missing", matchStatus: "missing" };
}

function actionKeys(row) {
  const reg = normalizeCacheRegistration(row.registration);
  const url = normalizeUrl(row.stock_url || row.stockUrl || row.stock_url_raw || "");
  const vanscoId = String(row.vansco_id || row.vanscoId || extractVanscoId(url) || "").toLowerCase();
  return { reg, url, vanscoId };
}

function recordKeys(row) {
  const reg = normalizeCacheRegistration(row.registration);
  const url = normalizeUrl(row.stock_url || row.stockUrl || "");
  const vanscoId = String(row.vansco_id || row.vanscoId || extractVanscoId(url) || "").toLowerCase();
  return { reg, url, vanscoId };
}

function applyMatchedAction(cacheRecord, action) {
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

async function fetchLocalVehiclesForPipeline(supabase, pipeline, warnings = []) {
  if (pipeline === "finance") {
    const result = await supabase
      .from("facebook_adverts")
      .select("id, title, picture, price, vat, salePrice, vanDescription, vanSpec, weblink, is_active")
      .eq("is_active", true)
      .limit(STOCK_LIMIT);
    if (result.error) {
      warnings.push(`finance stock unavailable: ${optionalTableReason(result.error)}`);
      return [];
    }
    return (result.data || []).map(mapFinanceVehicleRow);
  }

  if (pipeline === "rent2buy") {
    const result = await supabase
      .from("rent_vehicles")
      .select("id, registration, picture, monthly, week, initialRental, vanDescription, vanSpec, webLink, is_active")
      .eq("is_active", true)
      .limit(STOCK_LIMIT);
    if (result.error) {
      warnings.push(`Rent2Buy stock unavailable: ${optionalTableReason(result.error)}`);
      return [];
    }
    return (result.data || []).map(mapRentVehicleRow);
  }

  const errors = [];
  for (const tableName of CAR_TABLE_CANDIDATES) {
    const result = await supabase.from(tableName).select("*").limit(STOCK_LIMIT);
    if (result.error) {
      errors.push(`${tableName}: ${result.error.message}`);
      continue;
    }

    const rows = (result.data || []).filter(isActiveMarketingRow);
    if (rows.length) return rows.map(mapCarVehicleRow);
  }

  warnings.push(`cars stock unavailable: ${errors.join(" | ") || CAR_TABLE_CANDIDATES.join(", ")}`);
  return [];
}

async function fetchVanscoRecordsForPipeline(supabase, cacheRows, pipeline, warnings = []) {
  const { data: watchRows, error: watchError } = await supabase
    .from(WATCH_TABLE)
    .select("*")
    .eq("pipeline", pipeline)
    .limit(2000);

  if (watchError) {
    if (!isMissingOptionalTableError(watchError)) warnings.push(`Vansco watch actions unavailable: ${optionalTableReason(watchError)}`);
    return (cacheRows || [])
      .filter((row) => rowMatchesPipeline(row, pipeline))
      .map((row) => normalizeCacheRow(row, null));
  }

  const pipelineCacheRows = (cacheRows || []).filter((row) => rowMatchesPipeline(row, pipeline));
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

  const records = pipelineCacheRows.map((row) => {
    const keys = recordKeys(row);
    const action =
      (keys.reg && actionByRegistration.get(keys.reg)) ||
      (keys.url && actionByUrl.get(keys.url)) ||
      (keys.vanscoId && actionByVanscoId.get(keys.vanscoId)) ||
      null;
    return applyMatchedAction(row, action);
  });

  const ignoredOnly = (watchRows || [])
    .map(normalizeActionRecord)
    .filter((row) => {
      const keys = actionKeys(row);
      const inCache = records.some((record) => {
        const recordKey = recordKeys(record);
        return Boolean(
          (keys.reg && recordKey.reg === keys.reg) ||
          (keys.url && recordKey.url === keys.url) ||
          (keys.vanscoId && recordKey.vanscoId === keys.vanscoId)
        );
      });
      return !inCache && isBlockedAction(row);
    });

  return [...records, ...ignoredOnly];
}

async function buildPipelineSummary(supabase, cacheRows, pipeline) {
  const warnings = [];
  const [recordsResult, localVehiclesResult] = await Promise.allSettled([
    fetchVanscoRecordsForPipeline(supabase, cacheRows, pipeline, warnings),
    fetchLocalVehiclesForPipeline(supabase, pipeline, warnings),
  ]);
  const records = recordsResult.status === "fulfilled" ? recordsResult.value : [];
  const localVehicles = localVehiclesResult.status === "fulfilled" ? localVehiclesResult.value : [];

  if (recordsResult.status === "rejected") warnings.push(`Vansco records unavailable: ${optionalTableReason(recordsResult.reason)}`);
  if (localVehiclesResult.status === "rejected") warnings.push(`local stock unavailable: ${optionalTableReason(localVehiclesResult.reason)}`);

  const currentRawRecords = dedupeDisplayRecords(records);
  const localRegistrations = new Set(
    localVehicles
      .map((vehicle) => normalizeWatchRegistration(vehicle.reg || vehicle.registration || vehicle.title || vehicle.name))
      .filter(Boolean)
  );
  const activeRecords = currentRawRecords.map((record) => classifyWatchRecord(record, localRegistrations, pipeline));
  const currentVanscoRegistrationSet = new Set(
    currentRawRecords
      .filter((record) => record.isCurrentlyOnVansco !== false)
      .map((record) => normalizeWatchRegistration(record.registration))
      .filter(Boolean)
  );
  const localNotVanscoRecords = dedupeLocalVehiclesByRegistration(localVehicles).filter(
    ({ registration }) => registration && !currentVanscoRegistrationSet.has(registration)
  );

  return {
    missing: activeRecords.filter((record) => record.displayStatus === "missing").length,
    localNotVansco: localNotVanscoRecords.length,
    latestDetailCheck: latestIso(currentRawRecords.map((record) => record.lastCheckedAt || record.lastSuccessfullyCheckedAt || record.updatedAt)),
    warnings,
  };
}

export async function buildVanscoWatchSummary() {
  const supabase = getSupabaseAdmin();
  const { data: cacheRows, error: cacheError } = await supabase
    .from(CACHE_TABLE)
    .select("*")
    .order("last_seen_in_url_list_at", { ascending: false })
    .limit(2000);

  if (cacheError) {
    const fallback = Object.fromEntries(PIPELINES.map((pipeline) => [pipeline, { ...EMPTY_PIPELINE_SUMMARY, warnings: [optionalTableReason(cacheError)] }]));
    return fallback;
  }

  const entries = await Promise.allSettled(
    PIPELINES.map(async (pipeline) => [pipeline, await buildPipelineSummary(supabase, cacheRows || [], pipeline)])
  );

  return Object.fromEntries(
    entries.map((entry, index) => {
      if (entry.status === "fulfilled") return entry.value;
      return [PIPELINES[index], { ...EMPTY_PIPELINE_SUMMARY, warnings: [optionalTableReason(entry.reason)] }];
    })
  );
}

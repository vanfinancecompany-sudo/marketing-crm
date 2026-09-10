import { normalizeRegistration } from "./_vansco-cache-utils.js";

const DEALERKIT_API_ORIGIN = "https://api.dealerkit.uk";
const DEALERKIT_STOCK_PATH = "/integrators/stock";
const DEFAULT_PER_PAGE = 100;
const MAX_STOCK_RECORDS = 2000;
const MAX_FALLBACK_ITEMS = 100;

function clean(value, limit = 4000) {
  return String(value ?? "").trim().slice(0, limit);
}

function finiteNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  if (typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function iso(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function normaliseStatus(value) {
  const raw = clean(value, 100);
  const status = raw.toLowerCase().replace(/[\s-]+/g, "_");
  const aliases = {
    in_stock: "available",
    instock: "available",
    available: "available",
    live: "available",
    due_in: "due_in",
    reserved: "reserved",
    sold: "sold",
    deposit_taken: "deposit_taken",
    awaiting_delivery: "awaiting_delivery",
    non_stock: "non_stock",
    nonstock: "non_stock",
  };
  return aliases[status] || status || "unknown";
}

function normaliseVatStatus(value) {
  const raw = clean(value, 100);
  const status = raw.toLowerCase().replace(/[\s_]+/g, "-");
  if (["ex-vat", "excluding-vat", "+vat", "plus-vat"].includes(status)) return "plus_vat";
  if (["inc-vat", "including-vat", "vat-inclusive", "vat-included"].includes(status)) return "inc_vat";
  if (["no-vat", "vat-free", "margin", "margin-scheme"].includes(status)) return "no_vat";
  return "unknown";
}

function normaliseImages(media = {}) {
  const source = [];
  if (media?.cover_image?.url) source.push(media.cover_image);
  if (Array.isArray(media?.images)) source.push(...media.images);

  const seen = new Set();
  const images = [];
  for (const image of source) {
    const id = clean(image?.id, 300) || null;
    const url = clean(image?.url, 3000) || null;
    if (!url) continue;
    const key = id || url;
    if (seen.has(key)) continue;
    seen.add(key);
    images.push({
      id,
      url,
      order: images.length,
      identityStable: Boolean(id),
      identitySource: id ? "dealerkit" : "missing",
    });
  }
  return images;
}

function specificationItems(group) {
  return Array.isArray(group?.items) ? group.items : [];
}

export function mapDealerKitListing(listing = {}) {
  const vehicle = listing?.vehicle || {};
  const prices = listing?.prices || {};
  const advertised = prices?.advertised || {};
  const cash = prices?.cash || {};
  const monthly = prices?.monthly || {};
  const advertising = listing?.advertising || {};
  const images = normaliseImages(listing?.media || {});
  const registration = normalizeRegistration(vehicle?.registration || vehicle?.plate || "");
  const supplierStockId = clean(listing?.id, 300);

  if (!registration || !supplierStockId) return null;

  const make = clean(vehicle?.manufacturer, 200);
  const model = clean(vehicle?.model, 300);
  const derivative = clean(vehicle?.derivative, 800);
  const trim = clean(vehicle?.trim, 300);
  const title = [make, model, derivative].filter(Boolean).join(" ").trim();
  const rawStatus = clean(listing?.status ?? listing?.meta?.status, 100);
  const rawVatStatus = clean(advertised?.vat_status, 100);

  return {
    providerId: "dealerkit",
    supplierStockId,
    registration,
    title,
    make,
    model,
    derivative,
    trim,
    bodyType: clean(vehicle?.body_type, 300),
    vehicleType: clean(vehicle?.type, 100),
    sourceStatus: rawStatus || "unknown",
    status: normaliseStatus(rawStatus),
    availability: normaliseStatus(rawStatus),
    retailPrice: finiteNumber(advertised?.amount),
    sourceVatStatus: rawVatStatus || null,
    vatStatus: normaliseVatStatus(rawVatStatus),
    cashPrice: finiteNumber(cash?.amount),
    cashVatAmount: finiteNumber(cash?.vat_amount),
    dealerMonthlyPrice: finiteNumber(monthly?.amount),
    mileage: finiteNumber(vehicle?.mileage),
    year: finiteNumber(vehicle?.year ?? vehicle?.year_of_manufacture),
    registrationDate: clean(vehicle?.registration_date, 50) || null,
    fuel: clean(vehicle?.fuel_type, 120),
    transmission: clean(vehicle?.transmission_type, 120),
    colour: clean(vehicle?.manufacturer_colour || vehicle?.colour, 200),
    ulezCompliant: typeof vehicle?.ulez_compliant === "boolean" ? vehicle.ulez_compliant : null,
    bhp: finiteNumber(vehicle?.bhp),
    torqueNm: finiteNumber(vehicle?.torque_nm),
    motExpiry: clean(vehicle?.mot_expiry, 50) || null,
    insuranceGroup: clean(vehicle?.insurance_group, 100) || null,
    description: clean(advertising?.comments, 12000),
    attentionGrabber: clean(advertising?.attention_grabber, 1000),
    primaryImage: images[0] || null,
    images,
    imageCount: images.length,
    sourceUrl: clean(listing?.links?.website, 3000),
    specifications: {
      standard: specificationItems(vehicle?.specifications?.standard),
      options: specificationItems(vehicle?.specifications?.options),
      technical: specificationItems(vehicle?.specifications?.technical),
    },
    sourceCreatedAt: iso(listing?.created_at ?? listing?.meta?.created_at),
    sourceUpdatedAt: iso(listing?.updated_at ?? listing?.meta?.updated_at),
    checkedAt: iso(listing?.updated_at ?? listing?.meta?.updated_at),
  };
}

function dealerKitConfig(environment = process.env) {
  const secret = clean(environment.DEALERKIT_API_SECRET, 5000);
  const dealerId = clean(environment.DEALERKIT_DEALER_ID, 100);
  if (!secret) throw new Error("DEALERKIT_API_SECRET is required for DealerKit stock access.");
  if (!dealerId) throw new Error("DEALERKIT_DEALER_ID is required for DealerKit stock access.");
  return { secret, dealerId };
}

function stockUrl(dealerId, { page = 1, perPage = DEFAULT_PER_PAGE, specifications = false } = {}) {
  const url = new URL(`${DEALERKIT_API_ORIGIN}${DEALERKIT_STOCK_PATH}`);
  url.searchParams.set("dealer_id", dealerId);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));
  if (specifications) url.searchParams.set("specifications", "true");
  return url;
}

function stockDetailUrl(stockId, dealerId, { specifications = false } = {}) {
  const url = new URL(`${DEALERKIT_API_ORIGIN}${DEALERKIT_STOCK_PATH}/${encodeURIComponent(stockId)}`);
  url.searchParams.set("dealer_id", dealerId);
  if (specifications) url.searchParams.set("specifications", "true");
  return url;
}

async function requestJson(url, secret, fetchImplementation) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetchImplementation(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${secret}`,
        "user-agent": "VFC-DealerKit-Stock-Adapter/1.0",
      },
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    return { ok: response.ok, status: response.status, payload, responseBytes: text.length };
  } finally {
    clearTimeout(timeout);
  }
}

function pageMeta(payload = {}) {
  const meta = payload?.meta || {};
  return {
    total: finiteNumber(meta?.total),
    currentPage: finiteNumber(meta?.current_page ?? meta?.currentPage),
    lastPage: finiteNumber(meta?.last_page ?? meta?.lastPage),
    perPage: finiteNumber(meta?.per_page ?? meta?.perPage),
  };
}

function dedupeWithDiagnostics(rows) {
  const byId = new Map();
  const duplicateSupplierStockIds = new Set();
  const registrationToIds = new Map();

  for (const row of rows) {
    if (!row?.supplierStockId) continue;
    if (byId.has(row.supplierStockId)) duplicateSupplierStockIds.add(row.supplierStockId);
    byId.set(row.supplierStockId, row);

    const ids = registrationToIds.get(row.registration) || new Set();
    ids.add(row.supplierStockId);
    registrationToIds.set(row.registration, ids);
  }

  const duplicateRegistrations = Array.from(registrationToIds.entries())
    .filter(([, ids]) => ids.size > 1)
    .map(([registration, ids]) => ({ registration, supplierStockIds: Array.from(ids).sort() }));

  return {
    vehicles: Array.from(byId.values()),
    duplicateSupplierStockIds: Array.from(duplicateSupplierStockIds).sort(),
    duplicateRegistrations,
  };
}

function expectedPageCount(page, perPage, total) {
  const startIndex = (page - 1) * perPage;
  return Math.max(0, Math.min(perPage, total - startIndex));
}

function invalidRecordDiagnostic(item, position, extra = {}) {
  return {
    position,
    idPresent: Boolean(clean(item?.id, 300)),
    registrationPresent: Boolean(normalizeRegistration(item?.vehicle?.registration || item?.vehicle?.plate || "")),
    sourceStatus: clean(item?.status ?? item?.meta?.status, 100) || "unknown",
    vehicleType: clean(item?.vehicle?.type, 100) || "unknown",
    ...extra,
  };
}

async function mapOrRecoverListing({ item, position, dealerId, secret, fetchImplementation }) {
  const mapped = mapDealerKitListing(item);
  if (mapped) return { vehicle: mapped, recoveredByDetail: false, invalid: null };

  const stockId = clean(item?.id, 300);
  if (!stockId) {
    return { vehicle: null, recoveredByDetail: false, invalid: invalidRecordDiagnostic(item, position, { detailStatus: null }) };
  }

  const detail = await requestJson(stockDetailUrl(stockId, dealerId), secret, fetchImplementation);
  const detailMapped = detail.ok && detail.payload?.data ? mapDealerKitListing(detail.payload.data) : null;
  if (detailMapped) return { vehicle: detailMapped, recoveredByDetail: true, invalid: null };

  return {
    vehicle: null,
    recoveredByDetail: false,
    invalid: invalidRecordDiagnostic(item, position, { detailStatus: detail.status }),
  };
}

async function recoverPageBySingleItemReads({
  page,
  perPage,
  total,
  dealerId,
  secret,
  fetchImplementation,
}) {
  const start = ((page - 1) * perPage) + 1;
  const end = Math.min(page * perPage, total);
  const count = Math.max(0, end - start + 1);
  if (count > MAX_FALLBACK_ITEMS) {
    return {
      vehicles: [],
      failedPositions: [{ start, end, status: 0, reason: "fallback_guard" }],
      invalidRecords: [],
      detailRecoveries: [],
      reportedTotals: [],
    };
  }

  const vehicles = [];
  const failedPositions = [];
  const invalidRecords = [];
  const detailRecoveries = [];
  const reportedTotals = [];
  for (let position = start; position <= end; position += 1) {
    const result = await requestJson(stockUrl(dealerId, { page: position, perPage: 1 }), secret, fetchImplementation);
    const meta = pageMeta(result.payload);
    if (meta.total !== null) reportedTotals.push(meta.total);
    if (!result.ok || !Array.isArray(result.payload?.data) || !result.payload.data[0]) {
      failedPositions.push({ position, status: result.status, responseBytes: result.responseBytes });
      continue;
    }
    const resolution = await mapOrRecoverListing({
      item: result.payload.data[0],
      position,
      dealerId,
      secret,
      fetchImplementation,
    });
    if (resolution.vehicle) vehicles.push(resolution.vehicle);
    if (resolution.recoveredByDetail) detailRecoveries.push({ position });
    if (resolution.invalid) invalidRecords.push(resolution.invalid);
  }
  return { vehicles, failedPositions, invalidRecords, detailRecoveries, reportedTotals };
}

export class DealerKitSnapshotIncompleteError extends Error {
  constructor(message, diagnostics = {}) {
    super(message);
    this.name = "DealerKitSnapshotIncompleteError";
    this.diagnostics = diagnostics;
  }
}

export async function fetchDealerKitStockSnapshot({
  environment = process.env,
  fetchImplementation = fetch,
  perPage = DEFAULT_PER_PAGE,
  allowPartial = false,
} = {}) {
  const { secret, dealerId } = dealerKitConfig(environment);
  const firstResult = await requestJson(stockUrl(dealerId, { page: 1, perPage }), secret, fetchImplementation);
  if (!firstResult.ok || !firstResult.payload || !Array.isArray(firstResult.payload?.data)) {
    throw new Error(`DealerKit stock list failed on page 1 with HTTP ${firstResult.status}.`);
  }

  const firstMeta = pageMeta(firstResult.payload);
  const total = firstMeta.total ?? firstResult.payload.data.length;
  const lastPage = firstMeta.lastPage ?? Math.max(1, Math.ceil(total / perPage));
  if (total < 0 || total > MAX_STOCK_RECORDS) {
    throw new Error(`DealerKit reported an unsafe stock total of ${total}.`);
  }

  const vehicles = [];
  const failedPages = [];
  const failedPositions = [];
  const invalidRecords = [];
  const detailRecoveries = [];
  const pageCounts = [];
  const reportedTotals = new Set([total]);

  for (let page = 1; page <= lastPage; page += 1) {
    const result = page === 1
      ? firstResult
      : await requestJson(stockUrl(dealerId, { page, perPage }), secret, fetchImplementation);
    const meta = pageMeta(result.payload);
    if (meta.total !== null) reportedTotals.add(meta.total);
    const rows = Array.isArray(result.payload?.data) ? result.payload.data : [];
    const expected = expectedPageCount(page, perPage, total);
    const pageIsUsable = result.ok && Array.isArray(result.payload?.data) && rows.length === expected;

    pageCounts.push({
      page,
      status: result.status,
      observed: rows.length,
      expected,
      recovered: !pageIsUsable,
    });

    if (pageIsUsable) {
      for (let index = 0; index < rows.length; index += 1) {
        const position = ((page - 1) * perPage) + index + 1;
        const resolution = await mapOrRecoverListing({
          item: rows[index],
          position,
          dealerId,
          secret,
          fetchImplementation,
        });
        if (resolution.vehicle) vehicles.push(resolution.vehicle);
        if (resolution.recoveredByDetail) detailRecoveries.push({ position });
        if (resolution.invalid) invalidRecords.push(resolution.invalid);
      }
      continue;
    }

    failedPages.push({
      page,
      status: result.status,
      responseBytes: result.responseBytes,
      observed: rows.length,
      expected,
      reason: result.ok ? "unexpected_page_count" : "http_error",
    });
    const recovered = await recoverPageBySingleItemReads({ page, perPage, total, dealerId, secret, fetchImplementation });
    vehicles.push(...recovered.vehicles);
    failedPositions.push(...recovered.failedPositions);
    invalidRecords.push(...recovered.invalidRecords);
    detailRecoveries.push(...recovered.detailRecoveries);
    for (const observedTotal of recovered.reportedTotals) reportedTotals.add(observedTotal);
  }

  const deduped = dedupeWithDiagnostics(vehicles);
  const stableReportedTotal = reportedTotals.size === 1;
  const complete = (
    failedPositions.length === 0
    && invalidRecords.length === 0
    && deduped.duplicateSupplierStockIds.length === 0
    && deduped.duplicateRegistrations.length === 0
    && stableReportedTotal
    && deduped.vehicles.length === total
  );
  const diagnostics = {
    apiReportedTotal: total,
    reportedTotals: Array.from(reportedTotals).sort((a, b) => a - b),
    stableReportedTotal,
    pageCounts,
    rawMappedRecords: vehicles.length,
    recordsFetched: deduped.vehicles.length,
    detailRecoveries,
    invalidRecords,
    duplicateSupplierStockIds: deduped.duplicateSupplierStockIds,
    duplicateRegistrations: deduped.duplicateRegistrations,
    failedPages,
    failedPositions,
    complete,
  };

  if (!complete && !allowPartial) {
    throw new DealerKitSnapshotIncompleteError(
      `DealerKit stock snapshot is incomplete or unstable: ${deduped.vehicles.length} usable records against an initial total of ${total}.`,
      diagnostics,
    );
  }

  const anomalyCount = failedPositions.length
    + invalidRecords.length
    + deduped.duplicateSupplierStockIds.length
    + deduped.duplicateRegistrations.length
    + (stableReportedTotal ? 0 : 1);
  const checkedAt = new Date().toISOString();
  return {
    providerId: "dealerkit",
    providerLabel: "DealerKit",
    checkedAt,
    complete,
    apiReportedTotal: total,
    vehicles: deduped.vehicles,
    vehicleCount: deduped.vehicles.length,
    diagnostics,
    refresh: {
      id: null,
      runType: "dealerkit_api",
      status: complete ? "complete" : "partial",
      stage: complete ? "complete" : "incomplete_source",
      startedAt: null,
      updatedAt: checkedAt,
      completedAt: checkedAt,
      total,
      processed: vehicles.length + failedPositions.length + invalidRecords.length,
      succeeded: deduped.vehicles.length,
      failed: anomalyCount,
      remaining: Math.max(0, total - deduped.vehicles.length),
      error: complete ? null : "DealerKit returned an incomplete or unstable stock snapshot; authoritative cutover is blocked.",
    },
  };
}

export async function fetchDealerKitStockDetail(stockId, {
  environment = process.env,
  fetchImplementation = fetch,
  specifications = true,
} = {}) {
  const id = clean(stockId, 300);
  if (!id) throw new Error("DealerKit stock ID is required.");
  const { secret, dealerId } = dealerKitConfig(environment);
  const result = await requestJson(stockDetailUrl(id, dealerId, { specifications }), secret, fetchImplementation);
  if (!result.ok || !result.payload?.data) throw new Error(`DealerKit stock detail failed with HTTP ${result.status}.`);
  const mapped = mapDealerKitListing(result.payload.data);
  if (!mapped) throw new Error("DealerKit stock detail did not contain a usable registration and stock ID.");
  return mapped;
}

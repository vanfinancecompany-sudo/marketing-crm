import { fetchStableDealerKitStockSnapshot } from "./_dealerkit-stable-stock-snapshot.js";
import { fetchDealerKitStockDetail } from "./_dealerkit-stock-adapter.js";
import {
  dealerKitObservationVehicle,
  loadDealerKitSourceState,
  syncDealerKitSourceState,
} from "./_dealerkit-source-state.js";
import {
  WATCH_TABLE,
  getSupabaseServiceAdmin,
  normalizeActionRecord,
  normalizeRegistration,
} from "./_vansco-cache-utils.js";
import {
  classifyDealerKitVehicle,
  dealerKitVehicleBelongsToPipeline,
  summariseDealerKitSegments,
} from "../lib/dealerKitVehicleSegmentation.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const RECENT_SOURCE_STATE_DAYS = 3;
const MAX_TRANSITION_PROBES = 40;
const TRANSITION_PROBE_CONCURRENCY = 5;
const DETAIL_RETRY_ATTEMPTS = 2;
const SNAPSHOT_CACHE_TTL_MS = 20_000;
const DETAIL_CACHE_TTL_MS = 30_000;
const DETAIL_ERROR_CACHE_TTL_MS = 8_000;
const RESERVED_WORKFLOW_STATUSES = new Set(["reserved", "sold", "deposit_taken", "awaiting_delivery", "removed_from_dealerkit"]);

let cachedSnapshot = null;
let cachedSnapshotAt = 0;
let snapshotInFlight = null;
const historicalDetailCache = new Map();
const historicalDetailInFlight = new Map();

function clean(value, limit = 3000) {
  return String(value ?? "").trim().slice(0, limit);
}

function isAuthorised(request, environment = process.env) {
  const expected = clean(environment.MARKETING_CUSTOMER_DATABASE_API_KEY, 2000);
  const header = clean(request.headers?.[API_KEY_HEADER], 2000);
  const bearer = clean(request.headers?.authorization, 2200).replace(/^Bearer\s+/i, "");
  return Boolean(expected && (header === expected || bearer === expected));
}

function pipelineVehicle(vehicle, pipeline) {
  return dealerKitVehicleBelongsToPipeline(vehicle, pipeline);
}

function orphanActionBelongsToPipeline(action, pipeline) {
  const segment = classifyDealerKitVehicle(action).segment;
  if (segment === "unknown") return true;
  return pipeline === "cars" ? segment === "car" : segment === "commercial";
}

function normalizedSourceStatus(vehicle = {}) {
  const status = clean(vehicle.status || vehicle.availability || vehicle.sourceStatus, 100).toLowerCase();
  if (["available", "due_in", "reserved", "sold", "deposit_taken", "awaiting_delivery", "removed_from_dealerkit", "source_unresolved"].includes(status)) return status;
  return status || "unknown";
}

function workflowSourceStatus(vehicle = {}) {
  const lifecycleStatus = normalizedSourceStatus(vehicle);
  if (["awaiting_delivery", "removed_from_dealerkit"].includes(lifecycleStatus)) return "reserved";
  return lifecycleStatus;
}

function isDetailNotFound(error) {
  return /DealerKit stock detail failed with HTTP 404\.?/i.test(clean(error?.message || error));
}

function detailErrorStatus(error) {
  const match = clean(error?.message || error, 500).match(/HTTP\s+(\d{3})/i);
  return match ? Number(match[1]) : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadStockWatchSnapshot({ forceFresh = false } = {}) {
  const now = Date.now();
  if (!forceFresh && cachedSnapshot && (now - cachedSnapshotAt) < SNAPSHOT_CACHE_TTL_MS) {
    return cachedSnapshot;
  }
  if (!forceFresh && snapshotInFlight) return snapshotInFlight;

  const work = fetchStableDealerKitStockSnapshot({
    allowPartial: true,
    // The operator display already exposes degraded-source diagnostics and
    // registration-first recovery. Do one source pass here; destructive Wix
    // actions continue to perform their own fresh final verification.
    stabilityAttempts: 1,
  }).then((snapshot) => {
    cachedSnapshot = snapshot;
    cachedSnapshotAt = Date.now();
    return snapshot;
  }).finally(() => {
    if (snapshotInFlight === work) snapshotInFlight = null;
  });

  if (!forceFresh) snapshotInFlight = work;
  return work;
}

async function readHistoricalDetailUncached(stockId, loadDetail) {
  let lastError = null;
  for (let attempt = 1; attempt <= DETAIL_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await loadDetail(stockId, { specifications: false });
    } catch (error) {
      lastError = error;
      if (isDetailNotFound(error)) throw error;
      if (attempt < DETAIL_RETRY_ATTEMPTS) await sleep(120 * attempt);
    }
  }
  throw lastError || new Error("DealerKit stock detail could not be read.");
}

async function readHistoricalDetail(stockId, loadDetail) {
  // Test-injected readers should remain deterministic and uncached.
  if (loadDetail !== fetchDealerKitStockDetail) return readHistoricalDetailUncached(stockId, loadDetail);

  const key = clean(stockId, 300);
  const now = Date.now();
  const cached = historicalDetailCache.get(key);
  if (cached && cached.expiresAt > now) {
    if (cached.error) throw cached.error;
    return cached.detail;
  }
  if (historicalDetailInFlight.has(key)) return historicalDetailInFlight.get(key);

  const work = readHistoricalDetailUncached(key, loadDetail)
    .then((detail) => {
      historicalDetailCache.set(key, { detail, error: null, expiresAt: Date.now() + DETAIL_CACHE_TTL_MS });
      return detail;
    })
    .catch((error) => {
      const ttl = isDetailNotFound(error) ? DETAIL_CACHE_TTL_MS : DETAIL_ERROR_CACHE_TTL_MS;
      historicalDetailCache.set(key, { detail: null, error, expiresAt: Date.now() + ttl });
      throw error;
    })
    .finally(() => historicalDetailInFlight.delete(key));

  historicalDetailInFlight.set(key, work);
  return work;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length).fill(null);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function resolveRecentDealerKitTransitions({
  supabase,
  snapshot,
  pipeline,
  loadDetail = fetchDealerKitStockDetail,
}) {
  const state = await loadDealerKitSourceState(supabase, {
    sinceDays: RECENT_SOURCE_STATE_DAYS,
    limit: 1000,
  });
  if (state.available === false) {
    return {
      vehicles: [],
      available: false,
      missingTable: Boolean(state.missingTable),
      candidates: 0,
      probed: 0,
      detailErrors: 0,
      unresolved: 0,
    };
  }

  const currentRegistrations = new Set((snapshot.vehicles || [])
    .map((vehicle) => normalizeRegistration(vehicle?.registration || ""))
    .filter(Boolean));

  const candidates = (state.rows || [])
    .map((row) => ({ row, vehicle: dealerKitObservationVehicle(row) }))
    .filter(({ vehicle }) => vehicle?.registration && vehicle?.supplierStockId)
    .filter(({ vehicle }) => !currentRegistrations.has(normalizeRegistration(vehicle.registration)))
    .filter(({ vehicle }) => pipelineVehicle(vehicle, pipeline))
    .slice(0, MAX_TRANSITION_PROBES);

  let detailErrors = 0;
  let unresolved = 0;
  const resolved = await mapWithConcurrency(candidates, TRANSITION_PROBE_CONCURRENCY, async ({ row, vehicle }) => {
    const registration = normalizeRegistration(vehicle.registration);
    const stockId = clean(vehicle.supplierStockId, 300);
    try {
      const detail = await readHistoricalDetail(stockId, loadDetail);
      if (normalizeRegistration(detail?.registration) !== registration) {
        unresolved += 1;
        return {
          ...vehicle,
          status: "source_unresolved",
          availability: "source_unresolved",
          sourceStatus: "DealerKit identity mismatch",
          checkedAt: new Date().toISOString(),
          sourceResolution: "historical_identity_detail_mismatch",
          sourceResolutionError: `DealerKit stock ID ${stockId} did not resolve back to ${registration}.`,
          lastKnownSourceStatus: normalizedSourceStatus(vehicle),
          lastSeenInDealerKitAt: row?.last_seen_at || vehicle.checkedAt || null,
        };
      }
      return {
        ...detail,
        sourceResolution: "historical_identity_detail",
        lastKnownSourceStatus: normalizedSourceStatus(vehicle),
        lastSeenInDealerKitAt: row?.last_seen_at || vehicle.checkedAt || null,
      };
    } catch (error) {
      if (isDetailNotFound(error)) {
        return {
          ...vehicle,
          status: "removed_from_dealerkit",
          availability: "removed_from_dealerkit",
          sourceStatus: "Removed from DealerKit API",
          checkedAt: new Date().toISOString(),
          sourceResolution: "historical_identity_detail_404",
          lastKnownSourceStatus: normalizedSourceStatus(vehicle),
          lastSeenInDealerKitAt: row?.last_seen_at || vehicle.checkedAt || null,
        };
      }

      detailErrors += 1;
      unresolved += 1;
      return {
        ...vehicle,
        status: "source_unresolved",
        availability: "source_unresolved",
        sourceStatus: "DealerKit source check failed",
        checkedAt: new Date().toISOString(),
        sourceResolution: "historical_identity_detail_error",
        sourceResolutionError: clean(error?.message || error, 500) || "DealerKit stock detail could not be verified.",
        sourceResolutionHttpStatus: detailErrorStatus(error),
        lastKnownSourceStatus: normalizedSourceStatus(vehicle),
        lastSeenInDealerKitAt: row?.last_seen_at || vehicle.checkedAt || null,
      };
    }
  });

  return {
    vehicles: resolved.filter(Boolean),
    available: true,
    missingTable: false,
    candidates: candidates.length,
    probed: candidates.length,
    detailErrors,
    unresolved,
  };
}

function vehicleRecord(vehicle, action = null) {
  const registration = normalizeRegistration(vehicle.registration || "");
  const workflowStatus = clean(action?.workflowStatus || action?.workflow_status, 100).toLowerCase();
  const checkedAt = vehicle.checkedAt || vehicle.sourceUpdatedAt || new Date().toISOString();
  const segmentation = classifyDealerKitVehicle(vehicle);
  const lifecycleStatus = normalizedSourceStatus(vehicle);
  return {
    id: `dealerkit-${clean(vehicle.supplierStockId, 300)}`,
    vehicleKey: clean(vehicle.supplierStockId, 300),
    supplierStockId: clean(vehicle.supplierStockId, 300),
    providerId: "dealerkit",
    registration,
    title: clean(vehicle.title, 1000) || registration || "DealerKit vehicle",
    stockUrl: clean(vehicle.sourceUrl, 3000),
    sourceUrl: clean(vehicle.sourceUrl, 3000),
    imageUrl: clean(vehicle.primaryImage?.url, 3000),
    imageCount: Math.max(0, Number(vehicle.imageCount || vehicle.images?.length || 0)),
    advertisedPrice: Number.isFinite(Number(vehicle.retailPrice)) ? Number(vehicle.retailPrice) : null,
    advertisedPriceText: Number.isFinite(Number(vehicle.retailPrice)) ? `£${Number(vehicle.retailPrice).toLocaleString("en-GB", { maximumFractionDigits: 2 })}` : "",
    vatStatus: clean(vehicle.vatStatus, 50) || "unknown",
    sourceStatus: workflowSourceStatus(vehicle),
    sourceLifecycleStatus: lifecycleStatus,
    sourceResolution: clean(vehicle.sourceResolution, 100),
    sourceResolutionError: clean(vehicle.sourceResolutionError, 500),
    sourceResolutionHttpStatus: Number.isFinite(Number(vehicle.sourceResolutionHttpStatus)) ? Number(vehicle.sourceResolutionHttpStatus) : null,
    lastKnownSourceStatus: clean(vehicle.lastKnownSourceStatus, 100),
    lastSeenInDealerKitAt: vehicle.lastSeenInDealerKitAt || null,
    isCurrentlyOnVansco: true,
    isCurrentDealerKitBulkRecord: vehicle.isCurrentDealerKitBulkRecord === true,
    lastCheckedAt: checkedAt,
    lastSuccessfullyCheckedAt: checkedAt,
    lastError: clean(vehicle.sourceResolutionError, 500),
    workflowStatus,
    workflow_status: workflowStatus,
    watchActionId: clean(action?.id || action?.watchActionId, 100),
    notes: action?.notes ?? "",
    actionMatched: Boolean(action),
    make: clean(vehicle.make, 200),
    model: clean(vehicle.model, 300),
    derivative: clean(vehicle.derivative, 800),
    bodyType: clean(vehicle.bodyType, 300),
    vehicleType: clean(vehicle.vehicleType, 100),
    vehicleCategory: clean(vehicle.vehicleCategory, 200),
    vehicleClass: clean(vehicle.vehicleClass, 200),
    sourceSegment: segmentation.segment,
    sourceSegmentReason: segmentation.reason,
    mileage: Number.isFinite(Number(vehicle.mileage)) ? Number(vehicle.mileage) : null,
    year: Number.isFinite(Number(vehicle.year)) ? Number(vehicle.year) : null,
    fuel: clean(vehicle.fuel, 120),
    transmission: clean(vehicle.transmission, 120),
  };
}

function orphanActionRecord(action, pipeline) {
  const registration = normalizeRegistration(action.registration || "");
  if (!registration) return null;
  const workflowStatus = clean(action.workflowStatus || action.workflow_status, 100).toLowerCase();
  if (!["ignored", "hidden", "not_listing_spec", "not_listing_price", "not_listing_mileage", "added_to_crm", "marked_advertised", "advertised_awaiting_refresh"].includes(workflowStatus)) return null;
  return {
    ...action,
    id: action.id || `dealerkit-action-${pipeline}-${registration}`,
    vehicleKey: `dealerkit-action-${pipeline}-${registration}`,
    supplierStockId: "",
    providerId: "dealerkit",
    registration,
    title: clean(action.title, 1000) || registration,
    imageUrl: clean(action.imageUrl || action.image_url, 3000),
    stockUrl: clean(action.stockUrl || action.stock_url, 3000),
    sourceUrl: "",
    sourceStatus: "unknown",
    sourceLifecycleStatus: "unknown",
    isCurrentlyOnVansco: true,
    workflowStatus,
    workflow_status: workflowStatus,
    watchActionId: action.id || action.watchActionId || "",
    notes: action.notes || "",
    lastCheckedAt: action.updatedAt || action.updated_at || null,
    lastSuccessfullyCheckedAt: action.updatedAt || action.updated_at || null,
  };
}

function unavailableSourceState(error = null) {
  return {
    available: false,
    written: 0,
    missingTable: false,
    error: clean(error?.message || error, 1500) || null,
  };
}

function unavailableTransitions(error = null) {
  return {
    vehicles: [],
    available: false,
    missingTable: false,
    candidates: 0,
    probed: 0,
    detailErrors: 0,
    unresolved: 0,
    error: clean(error?.message || error, 1500) || null,
  };
}

export default async function handler(request, response) {
  if (!isAuthorised(request)) {
    response.status(401).json({ ok: false, message: "Marketing CRM access is required." });
    return;
  }
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }

  response.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const pipeline = ["finance", "rent2buy", "cars"].includes(clean(request.query?.pipeline, 30).toLowerCase())
      ? clean(request.query.pipeline, 30).toLowerCase()
      : "finance";
    const forceFresh = ["1", "true", "yes"].includes(clean(request.query?.fresh, 20).toLowerCase());
    const supabase = getSupabaseServiceAdmin();
    const [snapshot, actionsResult] = await Promise.all([
      loadStockWatchSnapshot({ forceFresh }),
      supabase.from(WATCH_TABLE).select("*").eq("pipeline", pipeline).limit(2000),
    ]);
    if (actionsResult.error) throw new Error(`Could not read Stock Watch decisions: ${actionsResult.error.message || actionsResult.error}`);

    let sourceStateSync;
    try {
      sourceStateSync = await syncDealerKitSourceState(supabase, snapshot);
    } catch (error) {
      sourceStateSync = unavailableSourceState(error);
    }

    let transitions;
    try {
      transitions = await resolveRecentDealerKitTransitions({ supabase, snapshot, pipeline });
    } catch (error) {
      transitions = unavailableTransitions(error);
    }

    const actions = (actionsResult.data || []).map(normalizeActionRecord);
    const actionByRegistration = new Map(actions
      .map((action) => [normalizeRegistration(action.registration || ""), action])
      .filter(([registration]) => registration));
    const currentSourceVehicles = (snapshot.vehicles || [])
      .filter((vehicle) => pipelineVehicle(vehicle, pipeline))
      .map((vehicle) => ({ ...vehicle, isCurrentDealerKitBulkRecord: true }));
    const currentRegistrations = new Set(currentSourceVehicles.map((vehicle) => normalizeRegistration(vehicle.registration)).filter(Boolean));
    const transitionVehicles = transitions.vehicles
      .filter((vehicle) => {
        const registration = normalizeRegistration(vehicle.registration || "");
        return registration && !currentRegistrations.has(registration);
      })
      .map((vehicle) => ({ ...vehicle, isCurrentDealerKitBulkRecord: false }));
    const sourceVehicles = [...currentSourceVehicles, ...transitionVehicles];
    const segmentCounts = summariseDealerKitSegments(snapshot.vehicles || []);
    const records = sourceVehicles.map((vehicle) => vehicleRecord(vehicle, actionByRegistration.get(normalizeRegistration(vehicle.registration)) || null));
    const sourceRegistrations = new Set(records.map((record) => record.registration).filter(Boolean));

    for (const action of actions) {
      const registration = normalizeRegistration(action.registration || "");
      if (!registration || sourceRegistrations.has(registration)) continue;
      if (!orphanActionBelongsToPipeline(action, pipeline)) continue;
      const orphan = orphanActionRecord(action, pipeline);
      if (orphan) records.push(orphan);
    }

    const usableRegistrations = records.filter((record) => record.registration).length;
    const availableCount = sourceVehicles.filter((vehicle) => ["available", "due_in"].includes(normalizedSourceStatus(vehicle))).length;
    const reservedCount = sourceVehicles.filter((vehicle) => RESERVED_WORKFLOW_STATUSES.has(normalizedSourceStatus(vehicle))).length;

    response.status(200).json({
      ok: true,
      pipeline,
      source: {
        provider: "dealerkit",
        complete: Boolean(snapshot.complete),
        apiReportedTotal: Number(snapshot.apiReportedTotal || 0),
        usableRecords: Number(snapshot.vehicleCount || snapshot.vehicles?.length || 0),
        pipelineRecords: currentSourceVehicles.length,
        lifecycleRecoveredRecords: transitionVehicles.length,
        segmentCounts,
        unclassifiedRecords: segmentCounts.unknown,
        issues: snapshot.diagnostics || null,
        checkedAt: snapshot.checkedAt || new Date().toISOString(),
        sourceState: {
          available: sourceStateSync.available !== false && transitions.available !== false,
          written: Number(sourceStateSync.written || 0),
          missingTable: Boolean(sourceStateSync.missingTable || transitions.missingTable),
          transitionCandidates: transitions.candidates,
          transitionProbes: transitions.probed,
          transitionDetailErrors: transitions.detailErrors,
          transitionUnresolved: transitions.unresolved,
          error: sourceStateSync.error || transitions.error || null,
        },
      },
      records,
      summary: {
        provider: "dealerkit",
        currentUrlCount: Number(snapshot.vehicleCount || snapshot.vehicles?.length || 0),
        currentPipelineUrlCount: currentSourceVehicles.length,
        lifecycleRecoveredCount: transitionVehicles.length,
        lifecycleUnresolvedCount: Number(transitions.unresolved || 0),
        hiddenOtherTabTypeCount: Math.max(0, Number(snapshot.vehicleCount || snapshot.vehicles?.length || 0) - currentSourceVehicles.length),
        cachedRegs: usableRegistrations,
        usableCachedRegistrations: usableRegistrations,
        currentNoRegistrationCount: 0,
        currentReservedCount: reservedCount,
        currentAvailableOrUnknownCount: availableCount,
        currentCheckedCount: sourceVehicles.length,
        currentUncheckedCount: Number(transitions.unresolved || 0),
        detailRefreshedToday: currentSourceVehicles.length,
        failedDetailChecks: Math.max(0, Number(snapshot.apiReportedTotal || 0) - Number(snapshot.vehicleCount || snapshot.vehicles?.length || 0)) + Number(transitions.detailErrors || 0),
        latestUrlListCheckedAt: snapshot.checkedAt || new Date().toISOString(),
        sourceComplete: Boolean(snapshot.complete),
        sourceStateAvailable: sourceStateSync.available !== false && transitions.available !== false,
        totalsNote: `Operator Stock Watch is sourced from DealerKit and segmented before card classification. ${segmentCounts.unknown} unclassified record(s) are held out of all product tabs for safety. Known registrations that disappear from the bulk feed are resolved by their saved DealerKit identity without treating unrelated source failures as global absence.`,
      },
    });
  } catch (error) {
    response.status(502).json({ ok: false, message: error?.message || "Could not load DealerKit Stock Watch records." });
  }
}

import { fetchDealerKitStockSnapshot } from "./_dealerkit-stock-adapter.js";
import {
  WATCH_TABLE,
  getSupabaseServiceAdmin,
  normalizeActionRecord,
  normalizeRegistration,
} from "./_vansco-cache-utils.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";

function clean(value, limit = 3000) {
  return String(value ?? "").trim().slice(0, limit);
}

function isAuthorised(request, environment = process.env) {
  const expected = clean(environment.MARKETING_CUSTOMER_DATABASE_API_KEY, 2000);
  const header = clean(request.headers?.[API_KEY_HEADER], 2000);
  const bearer = clean(request.headers?.authorization, 2200).replace(/^Bearer\s+/i, "");
  return Boolean(expected && (header === expected || bearer === expected));
}

function isCar(vehicle = {}) {
  const type = clean(vehicle.vehicleType, 100).toLowerCase();
  const body = clean(vehicle.bodyType, 200).toLowerCase();
  return type === "car" || type === "cars" || /\b(car|hatchback|saloon|estate|coupe|convertible|suv)\b/.test(`${type} ${body}`);
}

function pipelineVehicle(vehicle, pipeline) {
  return pipeline === "cars" ? isCar(vehicle) : !isCar(vehicle);
}

function normalizedSourceStatus(vehicle = {}) {
  const status = clean(vehicle.status || vehicle.availability || vehicle.sourceStatus, 100).toLowerCase();
  if (["available", "due_in", "reserved", "sold", "deposit_taken", "awaiting_delivery"].includes(status)) return status;
  return status || "unknown";
}

function vehicleRecord(vehicle, action = null) {
  const registration = normalizeRegistration(vehicle.registration || "");
  const workflowStatus = clean(action?.workflowStatus || action?.workflow_status, 100).toLowerCase();
  const checkedAt = vehicle.checkedAt || vehicle.sourceUpdatedAt || new Date().toISOString();
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
    sourceStatus: normalizedSourceStatus(vehicle),
    isCurrentlyOnVansco: true,
    lastCheckedAt: checkedAt,
    lastSuccessfullyCheckedAt: checkedAt,
    lastError: "",
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
    isCurrentlyOnVansco: true,
    workflowStatus,
    workflow_status: workflowStatus,
    watchActionId: action.id || action.watchActionId || "",
    notes: action.notes || "",
    lastCheckedAt: action.updatedAt || action.updated_at || null,
    lastSuccessfullyCheckedAt: action.updatedAt || action.updated_at || null,
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
    const supabase = getSupabaseServiceAdmin();
    const [snapshot, actionsResult] = await Promise.all([
      fetchDealerKitStockSnapshot({ allowPartial: true }),
      supabase.from(WATCH_TABLE).select("*").eq("pipeline", pipeline).limit(2000),
    ]);
    if (actionsResult.error) throw new Error(`Could not read Stock Watch decisions: ${actionsResult.error.message || actionsResult.error}`);

    const actions = (actionsResult.data || []).map(normalizeActionRecord);
    const actionByRegistration = new Map(actions
      .map((action) => [normalizeRegistration(action.registration || ""), action])
      .filter(([registration]) => registration));
    const sourceVehicles = (snapshot.vehicles || []).filter((vehicle) => pipelineVehicle(vehicle, pipeline));
    const records = sourceVehicles.map((vehicle) => vehicleRecord(vehicle, actionByRegistration.get(vehicle.registration) || null));
    const sourceRegistrations = new Set(records.map((record) => record.registration).filter(Boolean));

    for (const action of actions) {
      const registration = normalizeRegistration(action.registration || "");
      if (!registration || sourceRegistrations.has(registration)) continue;
      const orphan = orphanActionRecord(action, pipeline);
      if (orphan) records.push(orphan);
    }

    const usableRegistrations = records.filter((record) => record.registration).length;
    const availableCount = sourceVehicles.filter((vehicle) => ["available", "due_in"].includes(normalizedSourceStatus(vehicle))).length;
    const reservedCount = sourceVehicles.filter((vehicle) => ["reserved", "sold", "deposit_taken", "awaiting_delivery"].includes(normalizedSourceStatus(vehicle))).length;

    response.status(200).json({
      ok: true,
      pipeline,
      source: {
        provider: "dealerkit",
        complete: Boolean(snapshot.complete),
        apiReportedTotal: Number(snapshot.apiReportedTotal || 0),
        usableRecords: Number(snapshot.vehicleCount || snapshot.vehicles?.length || 0),
        pipelineRecords: sourceVehicles.length,
        issues: snapshot.diagnostics || null,
        checkedAt: snapshot.checkedAt || new Date().toISOString(),
      },
      records,
      summary: {
        provider: "dealerkit",
        currentUrlCount: Number(snapshot.vehicleCount || snapshot.vehicles?.length || 0),
        currentPipelineUrlCount: sourceVehicles.length,
        hiddenOtherTabTypeCount: Math.max(0, Number(snapshot.vehicleCount || snapshot.vehicles?.length || 0) - sourceVehicles.length),
        cachedRegs: usableRegistrations,
        usableCachedRegistrations: usableRegistrations,
        currentNoRegistrationCount: 0,
        currentReservedCount: reservedCount,
        currentAvailableOrUnknownCount: availableCount,
        currentCheckedCount: sourceVehicles.length,
        currentUncheckedCount: 0,
        detailRefreshedToday: sourceVehicles.length,
        failedDetailChecks: Math.max(0, Number(snapshot.apiReportedTotal || 0) - Number(snapshot.vehicleCount || snapshot.vehicles?.length || 0)),
        latestUrlListCheckedAt: snapshot.checkedAt || new Date().toISOString(),
        sourceComplete: Boolean(snapshot.complete),
        totalsNote: "Operator Stock Watch is sourced from DealerKit. Saved Hide, Mark advertised and Never show again decisions remain per tab. Legacy Vansco/Dragon refresh jobs are not used by this operator feed.",
      },
    });
  } catch (error) {
    response.status(502).json({ ok: false, message: error?.message || "Could not load DealerKit Stock Watch records." });
  }
}

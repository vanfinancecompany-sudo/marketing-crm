import { getSupabaseServiceAdmin } from "./_vansco-cache-utils.js";
import { controlledCarWixConfiguration } from "./_dealerkit-car-controlled-publish-state.js";
import { controlledWixRequest } from "./_dealerkit-controlled-publish-state.js";
import { loadCompleteWixStockSnapshot } from "../lib/wixStockSnapshot.js";
import {
  buildCarStockReconciliationPreview,
  normalizeCarRegistration,
  publishedCarsFromWixRows,
} from "../lib/carStockReconciliation.js";

const CAR_COLLECTION = "CARFINANCE";
const TARGET_TABLE = "car_adverts";
const PAGE_SIZE = 100;
const MAX_ROWS = 1000;
const WRITE_CONCURRENCY = 8;
const API_KEY_HEADER = "x-marketing-customer-database-key";

function clean(value) {
  return String(value ?? "").trim();
}

function automaticRun(request) {
  return clean(request.query?.auto).toLowerCase() === "true";
}

function syncEnabled(environment = process.env) {
  return clean(environment.CARS_STOCK_SYNC_ENABLED).toLowerCase() === "true";
}

export function needsLargeCarsReconciliationConfirmation(preview = {}) {
  const active = Number(preview?.counts?.crmActiveRegistrations || 0);
  const deactivate = Number(preview?.counts?.deactivate || 0);
  if (active <= 0 || deactivate < 5) return false;
  return deactivate / active >= 0.5;
}

function authorisedCron(request, environment = process.env) {
  const expected = clean(environment.CRON_SECRET);
  const supplied = clean(request.headers?.authorization);
  return Boolean(expected && supplied === `Bearer ${expected}`);
}

function authorisedManual(request, environment = process.env) {
  const expected = clean(environment.MARKETING_CUSTOMER_DATABASE_API_KEY);
  const header = clean(request.headers?.[API_KEY_HEADER]);
  const bearer = clean(request.headers?.authorization).replace(/^Bearer\s+/i, "");
  return Boolean(expected && (header === expected || bearer === expected));
}

async function queryWixPage(configuration, offset) {
  return controlledWixRequest(configuration, "/wix-data/v2/items/query", {
    method: "POST",
    body: {
      dataCollectionId: CAR_COLLECTION,
      query: { paging: { limit: PAGE_SIZE, offset } },
      consistentRead: true,
      returnTotalCount: true,
    },
  });
}

async function loadPublishedCars() {
  const configuration = controlledCarWixConfiguration();
  const { items, total } = await loadCompleteWixStockSnapshot({
    queryPage: (offset) => queryWixPage(configuration, offset),
    source: "Cars Wix CARFINANCE",
    pageSize: PAGE_SIZE,
    maxRows: MAX_ROWS,
  });
  const parsed = publishedCarsFromWixRows(items);

  if (!parsed.vehicles.length) {
    throw new Error("Wix returned no published Cars stock. Existing Marketing CRM Cars were left unchanged.");
  }
  if (parsed.duplicatePublishedRegistrations.length) {
    throw new Error(
      `Wix Cars stock contains duplicate published registrations: ${parsed.duplicatePublishedRegistrations.join(", ")}. Existing Marketing CRM Cars were left unchanged.`
    );
  }

  return {
    siteId: configuration.siteId,
    wixRows: total,
    vehicles: parsed.vehicles,
  };
}

async function loadExistingCars(supabase) {
  const { data, error } = await supabase
    .from(TARGET_TABLE)
    .select("id,registration,title,is_active,created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not read Marketing CRM Cars stock: ${error.message || error}`);
  return data || [];
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function runWithConcurrency(items, worker, concurrency = WRITE_CONCURRENCY) {
  const results = [];
  for (const batch of chunk(items, Math.max(1, concurrency))) {
    results.push(...await Promise.allSettled(batch.map(worker)));
  }
  return results;
}

async function deactivateIds(supabase, ids) {
  let changed = 0;
  for (const batch of chunk([...new Set(ids)], 100)) {
    if (!batch.length) continue;
    const { data, error } = await supabase
      .from(TARGET_TABLE)
      .update({ is_active: false })
      .in("id", batch)
      .select("id");
    if (error) throw error;
    changed += data?.length || 0;
  }
  return changed;
}

export function buildCarsWritePlan(sourceVehicles = [], existingRows = []) {
  const existingByRegistration = new Map();
  for (const row of existingRows) {
    const registration = normalizeCarRegistration(row?.registration || row?.title);
    if (!registration) continue;
    const group = existingByRegistration.get(registration) || [];
    group.push(row);
    existingByRegistration.set(registration, group);
  }

  const sourceRegistrations = new Set(
    sourceVehicles.map((vehicle) => normalizeCarRegistration(vehicle?.registration)).filter(Boolean)
  );
  const updates = [];
  const inserts = [];
  const duplicateIds = [];

  for (const vehicle of sourceVehicles) {
    const registration = normalizeCarRegistration(vehicle?.registration);
    const group = existingByRegistration.get(registration) || [];
    const keeper = group[0] || null;
    if (keeper?.id) {
      updates.push({ id: keeper.id, payload: { ...vehicle, registration, is_active: true } });
      duplicateIds.push(
        ...group.slice(1)
          .filter((row) => row?.id && row?.is_active !== false)
          .map((row) => row.id)
      );
    } else {
      inserts.push({ ...vehicle, registration, is_active: true });
    }
  }

  const staleIds = existingRows
    .filter((row) => row?.id && row?.is_active !== false)
    .filter((row) => {
      const registration = normalizeCarRegistration(row?.registration || row?.title);
      return registration && !sourceRegistrations.has(registration);
    })
    .map((row) => row.id);

  return {
    updates,
    inserts,
    deactivateIds: [...new Set([...staleIds, ...duplicateIds])],
  };
}

async function syncCarsStock({ allowLargeReconciliation = false } = {}) {
  const [source, supabase] = await Promise.all([
    loadPublishedCars(),
    Promise.resolve(getSupabaseServiceAdmin()),
  ]);
  const existingRows = await loadExistingCars(supabase);
  const preview = buildCarStockReconciliationPreview(source.vehicles, existingRows);

  if (!preview.safeToApply) {
    throw new Error(`Cars stock reconciliation failed its safety preview: ${preview.warnings.join(" ") || "unsafe source"}`);
  }
  if (needsLargeCarsReconciliationConfirmation(preview) && !allowLargeReconciliation) {
    throw new Error(
      `Cars stock reconciliation circuit breaker: ${preview.counts.deactivate} of ${preview.counts.crmActiveRegistrations} active Cars would be deactivated. Run the authenticated manual sync with confirmLarge=true after reviewing the read-only preview.`
    );
  }

  const plan = buildCarsWritePlan(source.vehicles, existingRows);

  const updateResults = await runWithConcurrency(plan.updates, async ({ id, payload }) => {
    const { error } = await supabase.from(TARGET_TABLE).update(payload).eq("id", id);
    if (error) throw error;
    return id;
  });
  const failedUpdates = updateResults.filter((result) => result.status === "rejected");
  if (failedUpdates.length) {
    throw new Error(`Cars update failed for ${failedUpdates.length} current vehicle(s). No stale Cars were deactivated.`);
  }

  let inserted = 0;
  for (const batch of chunk(plan.inserts, 100)) {
    if (!batch.length) continue;
    const { data, error } = await supabase.from(TARGET_TABLE).insert(batch).select("id");
    if (error) {
      throw new Error(`Cars insert failed. No stale Cars were deactivated: ${error.message || error}`);
    }
    inserted += data?.length || batch.length;
  }

  const deactivated = await deactivateIds(supabase, plan.deactivateIds);
  const { count: activeCount, error: countError } = await supabase
    .from(TARGET_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);
  if (countError) throw countError;

  return {
    ok: true,
    synced: true,
    source: "wix-cms",
    collection: CAR_COLLECTION,
    wixRows: source.wixRows,
    uniquePublished: source.vehicles.length,
    updated: plan.updates.length,
    inserted,
    deactivated,
    active: activeCount ?? source.vehicles.length,
    preview: preview.counts,
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  const automatic = automaticRun(request);

  if (automatic) {
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      return response.status(405).json({ ok: false, message: "Automatic Cars stock sync uses GET." });
    }
    if (!authorisedCron(request)) {
      return response.status(401).json({ ok: false, message: "Cars stock cron access is required." });
    }
  } else {
    if (request.method !== "POST") {
      response.setHeader("Allow", "POST");
      return response.status(405).json({ ok: false, message: "Manual Cars stock sync uses POST." });
    }
    if (!authorisedManual(request)) {
      return response.status(401).json({ ok: false, message: "Marketing CRM access is required." });
    }
  }

  if (!syncEnabled()) {
    return response.status(200).json({
      ok: true,
      synced: false,
      reason: "disabled",
      message: "Cars stock reconciliation is installed but CARS_STOCK_SYNC_ENABLED is not enabled.",
    });
  }

  try {
    const allowLargeReconciliation =
      !automatic &&
      (request.body?.confirmLarge === true ||
        clean(request.query?.confirmLarge).toLowerCase() === "true");
    const result = await syncCarsStock({ allowLargeReconciliation });
    console.info("[sync-cars-stock] complete", {
      automatic,
      wixRows: result.wixRows,
      active: result.active,
      updated: result.updated,
      inserted: result.inserted,
      deactivated: result.deactivated,
    });
    return response.status(200).json(result);
  } catch (error) {
    console.error("[sync-cars-stock] failed", {
      automatic,
      message: clean(error?.message).slice(0, 1000),
    });
    return response.status(502).json({
      ok: false,
      synced: false,
      message: error?.message || "Could not reconcile Cars stock.",
    });
  }
}

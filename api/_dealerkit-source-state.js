import { normalizeRegistration } from "./_vansco-cache-utils.js";

export const DEALERKIT_SOURCE_STATE_TABLE = "dealerkit_stock_state";

function clean(value, limit = 4000) {
  return String(value ?? "").trim().slice(0, limit);
}

function iso(value, fallback = null) {
  const parsed = value ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback;
}

function sourceStatus(vehicle = {}) {
  return clean(vehicle.status || vehicle.availability || vehicle.sourceStatus, 100).toLowerCase() || "unknown";
}

export function dealerKitSourceStatePayload(vehicle = {}, checkedAt = new Date().toISOString()) {
  const registration = normalizeRegistration(vehicle.registration || "");
  const supplierStockId = clean(vehicle.supplierStockId, 300);
  if (!registration || !supplierStockId) return null;
  const seenAt = iso(checkedAt, new Date().toISOString());
  return {
    registration,
    supplier_stock_id: supplierStockId,
    last_status: sourceStatus(vehicle),
    source_status: clean(vehicle.sourceStatus || vehicle.status || vehicle.availability, 100) || "unknown",
    title: clean(vehicle.title, 1000) || null,
    source_url: clean(vehicle.sourceUrl, 3000) || null,
    image_url: clean(vehicle.primaryImage?.url || vehicle.imageUrl, 3000) || null,
    source_updated_at: iso(vehicle.sourceUpdatedAt || vehicle.checkedAt),
    last_seen_at: seenAt,
    vehicle_snapshot: vehicle,
    updated_at: seenAt,
  };
}

export function isMissingDealerKitSourceStateTableError(error) {
  const code = clean(error?.code, 100).toUpperCase();
  const message = clean(error?.message || error, 2000).toLowerCase();
  return code === "42P01" || code === "PGRST205" || message.includes(DEALERKIT_SOURCE_STATE_TABLE) && (message.includes("does not exist") || message.includes("schema cache"));
}

export async function syncDealerKitSourceState(supabase, snapshot = {}, { now = new Date() } = {}) {
  const checkedAt = iso(snapshot.checkedAt, now.toISOString());
  const rows = (snapshot.vehicles || [])
    .map((vehicle) => dealerKitSourceStatePayload(vehicle, checkedAt))
    .filter(Boolean);
  if (!rows.length) return { available: true, written: 0 };

  const { error } = await supabase
    .from(DEALERKIT_SOURCE_STATE_TABLE)
    .upsert(rows, { onConflict: "registration" });
  if (error) {
    if (isMissingDealerKitSourceStateTableError(error)) return { available: false, written: 0, missingTable: true };
    throw new Error(`Could not persist DealerKit source state: ${error.message || error}`);
  }
  return { available: true, written: rows.length };
}

export async function loadDealerKitSourceState(supabase, { sinceDays = 30, limit = 2000 } = {}) {
  const since = new Date(Date.now() - Math.max(1, Number(sinceDays) || 30) * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from(DEALERKIT_SOURCE_STATE_TABLE)
    .select("registration,supplier_stock_id,last_status,source_status,title,source_url,image_url,source_updated_at,first_seen_at,last_seen_at,vehicle_snapshot,updated_at")
    .gte("last_seen_at", since)
    .order("last_seen_at", { ascending: false })
    .limit(Math.max(1, Math.min(5000, Number(limit) || 2000)));
  if (error) {
    if (isMissingDealerKitSourceStateTableError(error)) return { available: false, rows: [], missingTable: true };
    throw new Error(`Could not read DealerKit source state: ${error.message || error}`);
  }
  return { available: true, rows: data || [] };
}

export function dealerKitObservationVehicle(row = {}) {
  const snapshot = row?.vehicle_snapshot && typeof row.vehicle_snapshot === "object" ? row.vehicle_snapshot : {};
  const registration = normalizeRegistration(row.registration || snapshot.registration || "");
  if (!registration) return null;
  return {
    ...snapshot,
    registration,
    supplierStockId: clean(row.supplier_stock_id || snapshot.supplierStockId, 300),
    title: clean(row.title || snapshot.title, 1000) || registration,
    sourceUrl: clean(row.source_url || snapshot.sourceUrl, 3000),
    primaryImage: snapshot.primaryImage || (row.image_url ? { url: row.image_url } : null),
    sourceStatus: clean(row.source_status || snapshot.sourceStatus || row.last_status, 100) || "unknown",
    status: clean(row.last_status || snapshot.status || snapshot.availability, 100).toLowerCase() || "unknown",
    availability: clean(row.last_status || snapshot.availability || snapshot.status, 100).toLowerCase() || "unknown",
    sourceUpdatedAt: row.source_updated_at || snapshot.sourceUpdatedAt || null,
    checkedAt: row.last_seen_at || snapshot.checkedAt || null,
  };
}

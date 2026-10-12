import { normalizeVehicleId } from "./vanscoGoogleVehicleAdsSelection.js";

export const BLOCKING_STATUSES = new Set(["sold"]);
export const WARNING_STATUSES = new Set(["reserved", "deposit_taken", "awaiting_delivery", "removed_from_dealerkit"]);
const normalize = (value) => String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");

export function googleVehicleStockRisk({ vehicleId, stock, feedIds, blockedIds = [] } = {}) {
  const id = normalizeVehicleId(vehicleId);
  if (blockedIds.map(normalizeVehicleId).includes(id)) return "sold";
  const status = normalize(stock?.last_status || stock?.source_status);
  if (BLOCKING_STATUSES.has(status)) return "sold";
  if (WARNING_STATUSES.has(status)) return status === "removed_from_dealerkit" ? "missing" : "reserved";
  if (!feedIds.has(id)) return "missing";
  return "";
}

export function makeMerchantAction({ id, registration, title, reason, now = new Date().toISOString() }) {
  const vehicleId = normalizeVehicleId(id);
  return {
    id: vehicleId + ":" + now,
    vehicleId,
    registration: String(registration || "").trim().toUpperCase(),
    title: String(title || "").trim().slice(0, 500),
    reason: ["sold", "reserved", "missing", "manual"].includes(reason) ? reason : "manual",
    removedAt: now,
    confirmedAt: null,
  };
}

export function confirmMerchantAction(actions = [], actionId, now = new Date().toISOString()) {
  if (!actions.some((action) => action.id === actionId && !action.confirmedAt)) {
    throw new Error("The Merchant Center reminder is no longer pending.");
  }
  return actions.map((action) => action.id === actionId ? { ...action, confirmedAt: now } : action);
}

export function merchantPending(actions = []) {
  return actions.filter((action) => !action.confirmedAt);
}

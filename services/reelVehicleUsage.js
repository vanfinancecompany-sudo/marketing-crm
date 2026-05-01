import { supabase } from "./supabase.js";

const USAGE_TABLE = "reel_vehicle_usage";
export const REEL_VEHICLE_COOLDOWN_DAYS = 5;

function normalizeReelType(reelType) {
  return reelType === "rent2buy" ? "rent2buy" : "finance";
}

function isMissingUsageTable(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "42P01" || error?.code === "PGRST205" || message.includes(USAGE_TABLE);
}

export async function fetchRecentReelVehicleUsage(reelTypes, days = REEL_VEHICLE_COOLDOWN_DAYS) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const scopedTypes = [...new Set(reelTypes.map(normalizeReelType))];
  if (!scopedTypes.length) {
    return { rows: [], setupMissing: false };
  }

  const { data, error } = await supabase
    .from(USAGE_TABLE)
    .select("reel_type,vehicle_key,registration,vehicle_title,used_at")
    .in("reel_type", scopedTypes)
    .gte("used_at", cutoff.toISOString())
    .order("used_at", { ascending: false });

  if (error) {
    if (isMissingUsageTable(error)) {
      return { rows: [], setupMissing: true };
    }
    throw error;
  }

  return { rows: data || [], setupMissing: false };
}

export async function logReelVehicleUsage(usages) {
  const payload = usages
    .filter((usage) => usage?.vehicle_key)
    .map((usage) => ({
      reel_type: normalizeReelType(usage.reel_type),
      vehicle_key: usage.vehicle_key,
      registration: usage.registration || null,
      vehicle_title: usage.vehicle_title || null,
      source: usage.source || "generate",
    }));

  if (!payload.length) return { setupMissing: false };

  const { error } = await supabase.from(USAGE_TABLE).insert(payload);

  if (error) {
    if (isMissingUsageTable(error)) {
      return { setupMissing: true };
    }
    throw error;
  }

  return { setupMissing: false };
}

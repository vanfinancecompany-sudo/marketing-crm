import { createClient } from "@supabase/supabase-js";
import { list, put } from "@vercel/blob";
import {
  DEFAULT_BUFFER_AUTOMATION_CONFIG,
  londonDateKeyForValue,
  normalizeBufferAutomationConfig,
} from "./bufferAutomation.js";
import {
  londonWeekday,
  resolveTargetsForDate,
} from "./marketingDailyOperations.js";

const CONFIG_PREFIX = "buffer-automation-v3/config-";
const LEGACY_CONFIG_PREFIX = "buffer-automation-v2/config-";

function blobAvailable() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

function newestConfigBlob(blobs = []) {
  return [...blobs].sort((first, second) => {
    const firstTime = new Date(first?.uploadedAt || 0).getTime();
    const secondTime = new Date(second?.uploadedAt || 0).getTime();
    if (firstTime !== secondTime) return secondTime - firstTime;
    return String(second?.pathname || "").localeCompare(String(first?.pathname || ""));
  })[0] || null;
}

async function readConfigBlob(blob) {
  if (!blob?.url) return null;
  const response = await fetch(`${blob.url}?v=${encodeURIComponent(blob.pathname)}`, { cache: "no-store" });
  if (!response.ok) return null;
  return response.json();
}

async function loadStoredBufferAutomationConfig() {
  if (!blobAvailable()) return { ...DEFAULT_BUFFER_AUTOMATION_CONFIG };
  try {
    const currentResult = await list({ prefix: CONFIG_PREFIX, limit: 50 });
    const currentBlob = newestConfigBlob(currentResult?.blobs || []);
    const currentConfig = await readConfigBlob(currentBlob);
    if (currentConfig) return normalizeBufferAutomationConfig(currentConfig);

    const legacyResult = await list({ prefix: LEGACY_CONFIG_PREFIX, limit: 50 });
    const legacyBlob = newestConfigBlob(legacyResult?.blobs || []);
    const legacyConfig = await readConfigBlob(legacyBlob);
    if (legacyConfig) {
      return normalizeBufferAutomationConfig({
        ...DEFAULT_BUFFER_AUTOMATION_CONFIG,
        enabled: legacyConfig.enabled === undefined
          ? DEFAULT_BUFFER_AUTOMATION_CONFIG.enabled
          : Boolean(legacyConfig.enabled),
      });
    }

    return { ...DEFAULT_BUFFER_AUTOMATION_CONFIG };
  } catch (error) {
    console.warn("[buffer-automation] config load fallback", {
      message: error?.message || String(error),
    });
    return { ...DEFAULT_BUFFER_AUTOMATION_CONFIG };
  }
}

function contentOperationsSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

async function loadContentOperationsTargets(dateKey) {
  const supabase = contentOperationsSupabase();
  if (!supabase) return null;

  const date = new Date(`${dateKey}T12:00:00Z`);
  const weekday = londonWeekday(date);
  const [scheduleResult, overrideResult] = await Promise.all([
    supabase
      .from("marketing_daily_target_schedules")
      .select("*")
      .eq("weekday", weekday)
      .lte("effective_from", dateKey)
      .order("effective_from", { ascending: false })
      .limit(1),
    supabase
      .from("marketing_daily_target_overrides")
      .select("*")
      .eq("activity_date", dateKey)
      .limit(1),
  ]);

  if (scheduleResult.error) throw scheduleResult.error;
  if (overrideResult.error) throw overrideResult.error;

  return resolveTargetsForDate({
    dateKey,
    weekday,
    schedules: scheduleResult.data || [],
    overrides: overrideResult.data || [],
  });
}

export function alignBufferAutomationConfigToDailyTargets(config, targets) {
  const safe = normalizeBufferAutomationConfig(config);
  if (!targets) return safe;

  const offDay = Boolean(targets.off_day);
  const facebookTarget = offDay
    ? 0
    : Math.max(
        Number(targets.van_finance_facebook_post || 0),
        Number(targets.rent2buy_facebook_post || 0),
      );

  return normalizeBufferAutomationConfig({
    ...safe,
    vanFinancePostsPerDay: facebookTarget,
    rent2buyPostsPerDay: facebookTarget,
    vanFinanceReelsPerDay: offDay ? 0 : targets.van_finance_reel,
    rent2buyReelsPerDay: offDay ? 0 : targets.rent2buy_reel,
  });
}

export async function loadBufferAutomationConfig({
  useDailyTargets = true,
  dateKey = londonDateKeyForValue(),
} = {}) {
  const stored = await loadStoredBufferAutomationConfig();
  if (!useDailyTargets) return stored;

  try {
    const targets = await loadContentOperationsTargets(dateKey);
    return targets ? alignBufferAutomationConfigToDailyTargets(stored, targets) : stored;
  } catch (error) {
    console.warn("[buffer-automation] Content Operations target sync fallback", {
      dateKey,
      message: error?.message || String(error),
    });
    return stored;
  }
}

export async function saveBufferAutomationConfig(value) {
  if (!blobAvailable()) throw new Error("Vercel Blob is not configured for Buffer automation settings.");
  const config = normalizeBufferAutomationConfig({
    ...value,
    updatedAt: new Date().toISOString(),
  });
  await put(`${CONFIG_PREFIX}${Date.now()}.json`, JSON.stringify(config, null, 2), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
  });
  return config;
}

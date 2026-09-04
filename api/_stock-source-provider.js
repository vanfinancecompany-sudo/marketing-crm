import { getSupabaseServiceAdmin, normalizeRegistration } from "./_vansco-cache-utils.js";

const DEFAULT_PROVIDER_ID = "vansco_dragon";
const CURRENT_PROVIDER_ALIASES = new Set(["vansco", "dragon", "dragon2000", "vansco_dragon"]);
const HTTP_PROVIDER_ALIASES = new Set(["normalized_http", "http_json", "external_api"]);

function clean(value, limit = 2000) {
  return String(value ?? "").trim().slice(0, limit);
}

function iso(value) {
  const parsed = value ? new Date(value) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function normaliseStatus(value) {
  const text = clean(value, 100).toLowerCase().replace(/[\s-]+/g, "_");
  if (["reserved", "sold", "deposit_taken"].includes(text)) return text;
  if (["available", "in_stock", "instock", "live"].includes(text)) return "available";
  return text || "unknown";
}

function normaliseVehicle(row = {}) {
  const registration = normalizeRegistration(row.registration || row.reg || row.title || "");
  if (!registration) return null;
  const imageCount = Number(row.imageCount ?? row.image_count ?? row.images?.length);
  return {
    registration,
    status: normaliseStatus(row.status ?? row.sourceStatus ?? row.source_status),
    imageCount: Number.isFinite(imageCount) && imageCount >= 0 ? imageCount : null,
    sourceUrl: clean(row.sourceUrl ?? row.stockUrl ?? row.stock_url ?? row.url),
    checkedAt: iso(row.checkedAt ?? row.lastSuccessfullyCheckedAt ?? row.last_successfully_checked_at ?? row.updated_at),
  };
}

function dedupeVehicles(rows = []) {
  const byRegistration = new Map();
  for (const raw of rows) {
    const vehicle = normaliseVehicle(raw);
    if (!vehicle) continue;
    const existing = byRegistration.get(vehicle.registration);
    if (!existing) {
      byRegistration.set(vehicle.registration, vehicle);
      continue;
    }
    const currentTime = new Date(vehicle.checkedAt || 0).getTime();
    const existingTime = new Date(existing.checkedAt || 0).getTime();
    if (currentTime >= existingTime) byRegistration.set(vehicle.registration, vehicle);
  }
  return Array.from(byRegistration.values());
}

export function stockSourceProviderConfig(environment = process.env) {
  const providerId = clean(environment.STOCK_SOURCE_PROVIDER_ID, 100).toLowerCase() || DEFAULT_PROVIDER_ID;
  if (CURRENT_PROVIDER_ALIASES.has(providerId)) {
    return {
      id: "vansco_dragon",
      label: "Vansco / Dragon2000",
      kind: "supabase_cache",
      switchReady: true,
    };
  }
  if (HTTP_PROVIDER_ALIASES.has(providerId)) {
    return {
      id: "normalized_http",
      label: clean(environment.STOCK_SOURCE_PROVIDER_LABEL, 120) || "External stock provider",
      kind: "normalized_http",
      switchReady: true,
    };
  }
  return {
    id: providerId,
    label: clean(environment.STOCK_SOURCE_PROVIDER_LABEL, 120) || providerId,
    kind: "unknown",
    switchReady: false,
  };
}

async function loadVanscoDragonSnapshot(supabase) {
  const [runResult, rowsResult] = await Promise.all([
    supabase
      .from("vansco_refresh_runs")
      .select("id,run_type,status,stage,started_at,updated_at,completed_at,total_urls,processed_count,success_count,failure_count,remaining_count,last_error,last_result")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("vansco_vehicle_cache")
      .select("registration,source_status,stock_url,last_successfully_checked_at,updated_at,is_currently_on_vansco")
      .eq("is_currently_on_vansco", true)
      .limit(2000),
  ]);

  if (runResult.error) throw new Error(`Could not read stock-source refresh state: ${runResult.error.message || runResult.error}`);
  if (rowsResult.error) throw new Error(`Could not read stock-source vehicle cache: ${rowsResult.error.message || rowsResult.error}`);

  const run = runResult.data || {};
  const imageCounts = run?.last_result?.imageCountsByRegistration || {};
  const vehicles = dedupeVehicles((rowsResult.data || []).map((row) => ({
    ...row,
    imageCount: Number.isFinite(Number(imageCounts?.[normalizeRegistration(row.registration)]))
      ? Number(imageCounts[normalizeRegistration(row.registration)])
      : null,
  })));

  return {
    providerId: "vansco_dragon",
    providerLabel: "Vansco / Dragon2000",
    checkedAt: iso(run.completed_at || run.updated_at || vehicles.map((item) => item.checkedAt).filter(Boolean).sort().at(-1)),
    vehicles,
    vehicleCount: vehicles.length,
    refresh: {
      id: run.id || null,
      runType: run.run_type || null,
      status: clean(run.status, 100).toLowerCase() || "unknown",
      stage: clean(run.stage, 100).toLowerCase() || "unknown",
      startedAt: iso(run.started_at),
      updatedAt: iso(run.updated_at),
      completedAt: iso(run.completed_at),
      total: Number(run.total_urls || 0),
      processed: Number(run.processed_count || 0),
      succeeded: Number(run.success_count || 0),
      failed: Number(run.failure_count || 0),
      remaining: Number(run.remaining_count || 0),
      error: clean(run.last_error, 1500) || null,
    },
  };
}

async function loadNormalizedHttpSnapshot(config, environment, fetchImplementation) {
  const url = clean(environment.STOCK_SOURCE_PROVIDER_URL, 2000);
  if (!url) throw new Error("STOCK_SOURCE_PROVIDER_URL is required for the normalized HTTP stock-source adapter.");
  const headers = { Accept: "application/json" };
  const token = clean(environment.STOCK_SOURCE_PROVIDER_TOKEN, 2000);
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImplementation(url, { method: "GET", headers, cache: "no-store" });
  if (!response.ok) throw new Error(`External stock provider returned ${response.status} ${response.statusText}.`);
  const payload = await response.json();
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.vehicles) ? payload.vehicles : Array.isArray(payload?.items) ? payload.items : [];
  const vehicles = dedupeVehicles(rows);
  return {
    providerId: config.id,
    providerLabel: config.label,
    checkedAt: iso(payload?.checkedAt || payload?.checked_at || new Date()),
    vehicles,
    vehicleCount: vehicles.length,
    refresh: {
      id: clean(payload?.runId || payload?.run_id) || null,
      runType: "external",
      status: clean(payload?.status, 100).toLowerCase() || (vehicles.length ? "complete" : "unknown"),
      stage: clean(payload?.stage, 100).toLowerCase() || "external",
      startedAt: iso(payload?.startedAt || payload?.started_at),
      updatedAt: iso(payload?.updatedAt || payload?.updated_at || payload?.checkedAt || payload?.checked_at),
      completedAt: iso(payload?.completedAt || payload?.completed_at || payload?.checkedAt || payload?.checked_at),
      total: Number(payload?.total ?? vehicles.length),
      processed: Number(payload?.processed ?? vehicles.length),
      succeeded: Number(payload?.succeeded ?? vehicles.length),
      failed: Number(payload?.failed ?? 0),
      remaining: Number(payload?.remaining ?? 0),
      error: clean(payload?.error, 1500) || null,
    },
  };
}

export async function loadStockSourceSnapshot({
  supabase = getSupabaseServiceAdmin(),
  environment = process.env,
  fetchImplementation = fetch,
} = {}) {
  const config = stockSourceProviderConfig(environment);
  if (config.kind === "supabase_cache") return loadVanscoDragonSnapshot(supabase);
  if (config.kind === "normalized_http") return loadNormalizedHttpSnapshot(config, environment, fetchImplementation);
  throw new Error(`Unsupported stock-source provider: ${config.id}. Add an adapter before switching STOCK_SOURCE_PROVIDER_ID.`);
}

export function providerReservedRegistrations(snapshot = {}) {
  return new Set((snapshot.vehicles || [])
    .filter((vehicle) => ["reserved", "sold", "deposit_taken"].includes(vehicle.status))
    .map((vehicle) => vehicle.registration)
    .filter(Boolean));
}

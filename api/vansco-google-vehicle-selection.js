import { cleanDealerKitGoogleVehicleAdsCsv } from "../lib/dealerKitGoogleVehicleAdsFeed.js";
import { getGoogleVehicleRows, validatedSelectedVehicleIds } from "../lib/vanscoGoogleVehicleAdsSelection.js";
import { getSupabaseServiceAdmin, isMissingSupabaseObjectError } from "./_vansco-cache-utils.js";
import { isMarketingStockWatchActionAuthorized } from "./vansco-watch-action.js";

const TABLE = "vansco_google_vehicle_ads_selection";
const DEALERKIT_URL = "https://api.dealerkit.uk/google-vehicle-listing-feed";
const clean = (value) => String(value ?? "").trim();

async function fetchCurrentVehicles(environment, fetcher = fetch) {
  const username = clean(environment.DEALERKIT_GVA_USERNAME);
  const password = clean(environment.DEALERKIT_GVA_PASSWORD);
  if (!username || !password) throw new Error("DealerKit feed credentials not configured.");
  const authorization = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  const result = await fetcher(DEALERKIT_URL, {
    headers: { Authorization: `Basic ${authorization}`, Accept: "text/csv,text/plain" },
  });
  if (!result.ok) throw new Error("DealerKit vehicle feed is unavailable.");
  const cleaned = cleanDealerKitGoogleVehicleAdsCsv(await result.text());
  return getGoogleVehicleRows(cleaned.csv);
}

async function getSetting(client) {
  const { data, error } = await client.from(TABLE).select("mode,selected_ids,updated_at").eq("id", "vansco").maybeSingle();
  if (error) {
    if (isMissingSupabaseObjectError(error)) return {
      mode: "all", selectedIds: [], updatedAt: null, previewOnly: true,
    };
    throw error;
  }
  return { mode: data?.mode === "selected" ? "selected" : "all", selectedIds: data?.selected_ids || [], updatedAt: data?.updated_at || null, previewOnly: false };
}

export async function handleVanscoGoogleVehicleSelection(request, response, deps = {}) {
  const environment = deps.environment || process.env;
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  if (!isMarketingStockWatchActionAuthorized(request, environment)) {
    return response.status(401).json({ ok: false, message: "Marketing CRM access is required." });
  }
  if (!["GET", "POST"].includes(request.method)) {
    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }
  try {
    const supabase = (deps.getSupabase || getSupabaseServiceAdmin)();
    const setting = await getSetting(supabase);
    if (request.method === "GET") {
      const vehicles = await fetchCurrentVehicles(environment, deps.fetcher || fetch);
      return response.status(200).json({ ok: true, ...setting, vehicles });
    }
    if (setting.previewOnly) return response.status(503).json({
      ok: false, message: "Vehicle-selection database table must be installed before saving changes.",
    });
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body || {};
    const action = clean(body.action);
    let mode = setting.mode;
    let selectedIds = setting.selectedIds;
    if (action === "save") {
      const current = await fetchCurrentVehicles(environment, deps.fetcher || fetch);
      selectedIds = validatedSelectedVehicleIds(body.selectedIds, current.map(vehicle => vehicle.id));
      if (mode === "selected" && selectedIds.length === 0) {
        return response.status(400).json({ ok: false, message: "You cannot clear all selections while selected-only mode is active. Pause the Shopping campaign or disable selected-only mode first." });
      }
    } else if (action === "activate") {
      if (!setting.selectedIds.length) {
        return response.status(400).json({ ok: false, message: "Save at least one selected vehicle before activation." });
      }
      const current = await fetchCurrentVehicles(environment, deps.fetcher || fetch);
      const available = new Set(current.map(vehicle => vehicle.id));
      if (!setting.selectedIds.some(id => available.has(id))) {
        return response.status(400).json({ ok: false, message: "Selected vehicles are no longer in the DealerKit feed. Refresh your list first." });
      }
      mode = "selected";
    } else if (action === "deactivate") {
      mode = "all";
    } else {
      return response.status(400).json({ ok: false, message: "Unknown action." });
    }
    const { error } = await supabase.from(TABLE).upsert({
      id: "vansco", mode, selected_ids: selectedIds, updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
    if (error) throw error;
    return response.status(200).json({ ok: true, mode, selectedIds, message: mode === "selected" ? "Selected vehicles will appear in the next Google feed refresh." : "Selection saved. Feed stays unchanged until you activate selected-only mode." });
  } catch (error) {
    console.error("[vansco-gva-selection] error", { message: error?.message || String(error) });
    return response.status(503).json({ ok: false, message: "Vehicle selection is temporarily unavailable. Check the Vansco selection database setup and DealerKit feed." });
  }
}
export default function handler(req, res) { return handleVanscoGoogleVehicleSelection(req, res); }

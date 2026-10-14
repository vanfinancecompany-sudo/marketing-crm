import { cleanDealerKitGoogleVehicleAdsCsv } from "../lib/dealerKitGoogleVehicleAdsFeed.js";
import { getGoogleVehicleRows, googleVehicleFeedExclusion, normalizeVehicleId, validatedSelectedVehicleIds } from "../lib/vanscoGoogleVehicleAdsSelection.js";
import { googleVehicleStockRisk, makeMerchantAction, confirmMerchantAction, merchantPending } from "../lib/vanscoGoogleVehicleAdsSafety.js";
import { getSupabaseServiceAdmin, isMissingSupabaseObjectError } from "./_vansco-cache-utils.js";
import { isMarketingStockWatchActionAuthorized } from "./vansco-watch-action.js";

const TABLE = "vansco_google_vehicle_ads_selection";
const DEALERKIT_URL = "https://api.dealerkit.uk/google-vehicle-listing-feed";
const clean = (value) => String(value ?? "").trim();
const MAX_ACTION_HISTORY = 250;

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
  const { data, error } = await client.from(TABLE)
    .select("mode,selected_ids,updated_at,merchant_actions,blocked_sold_ids")
    .eq("id", "vansco").maybeSingle();
  if (error) {
    if (isMissingSupabaseObjectError(error)) {
      return { mode: "all", selectedIds: [], updatedAt: null, merchantActions: [], blockedSoldIds: [], previewOnly: true };
    }
    throw error;
  }
  return {
    mode: data?.mode === "selected" ? "selected" : "all",
    selectedIds: data?.selected_ids || [],
    updatedAt: data?.updated_at || null,
    merchantActions: Array.isArray(data?.merchant_actions) ? data.merchant_actions : [],
    blockedSoldIds: data?.blocked_sold_ids || [],
    previewOnly: false,
  };
}

// Read the same observed DealerKit identity and lifecycle table as Stock Watch.
// Never modify Stock Watch or treat disappearing feed rows as proof of a sale.
async function readDealerKitObservations(client) {
  const { data, error } = await client.from("dealerkit_stock_state")
    .select("supplier_stock_id,registration,last_status,source_status,last_seen_at,title")
    .limit(1500);
  if (error) throw new Error("DealerKit Stock Watch status information is unavailable.");
  return new Map((data || []).filter(row => row.supplier_stock_id)
    .map(row => [normalizeVehicleId(row.supplier_stock_id), row]));
}

function vehicleInfo(id, stockMap, vehicleMap) {
  const key = normalizeVehicleId(id);
  const stock = stockMap?.get(key);
  const vehicle = vehicleMap?.get(key);
  return { id: key, registration: stock?.registration || "", title: vehicle?.title || stock?.title || key };
}

function addRemovalAction(merchantActions, id, reason, stockMap, vehicleMap) {
  const vehicle = vehicleInfo(id, stockMap, vehicleMap);
  return [...merchantActions, makeMerchantAction({ ...vehicle, reason })].slice(-MAX_ACTION_HISTORY);
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
      const [vehicles, stockMap] = await Promise.all([
        fetchCurrentVehicles(environment, deps.fetcher || fetch),
        readDealerKitObservations(supabase),
      ]);
      const feedIds = new Set(vehicles.map(v => v.id));
      const pendingRemovalIds = merchantPending(setting.merchantActions).map(item => item.vehicleId);
      const listed = vehicles.map(vehicle => {
        const stock = stockMap.get(vehicle.id);
        return {
          ...vehicle,
          registration: stock?.registration || "",
          stockStatus: stock?.last_status || "unknown",
          stockCheckedAt: stock?.last_seen_at || null,
          feedExclusion: googleVehicleFeedExclusion(vehicle.id, { stock, blockedIds: setting.blockedSoldIds, pendingRemovalIds }),
        };
      });
      // Preserve visibility of selected stock after DealerKit stops advertising it.
      for (const id of setting.selectedIds) {
        if (feedIds.has(id)) continue;
        const stock = stockMap.get(id);
        listed.unshift({
          id, title: stock?.title || id, price: "", imageUrl: "",
          vehicleUrl: "", storeCode: "", registration: stock?.registration || "",
          stockStatus: stock?.last_status || "unknown", stockCheckedAt: stock?.last_seen_at || null,
          missingFromFeed: true,
        });
      }
      const alerts = setting.mode === "selected"
        ? setting.selectedIds.flatMap(id => {
          const stock = stockMap.get(id);
          const risk = googleVehicleStockRisk({
            vehicleId: id, stock, feedIds, blockedIds: setting.blockedSoldIds,
          });
          return risk ? [{
            ...vehicleInfo(id, stockMap, new Map(vehicles.map(v => [v.id, v]))),
            risk,
            stockStatus: stock?.last_status || "unknown",
            checkedAt: stock?.last_seen_at || null,
          }] : [];
        })
        : [];
      return response.status(200).json({
        ok: true, ...setting, vehicles: listed,
        automaticCount: listed.filter(vehicle => !vehicle.missingFromFeed && !vehicle.feedExclusion).length,
        alerts, merchantPending: merchantPending(setting.merchantActions),
        lastStockWatchCheckedAt: [...stockMap.values()]
          .map(row => row.last_seen_at).filter(Boolean).sort().at(-1) || null,
      });
    }
    if (setting.previewOnly) return response.status(503).json({
      ok: false, message: "Vehicle-selection database table must be installed before saving changes.",
    });
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body || {};
    const action = clean(body.action);
    let mode = setting.mode;
    let selectedIds = setting.selectedIds;
    let blockedSoldIds = setting.blockedSoldIds;
    let merchantActions = setting.merchantActions;
    let message = "";

    if (action === "confirm_merchant") {
      const actionId = clean(body.actionId);
      const pendingAction = merchantActions.find(a => a.id === actionId && !a.confirmedAt);
      if (!pendingAction) return response.status(400).json({ ok: false, message: "No pending Merchant Center reminder found." });
      if (selectedIds.includes(pendingAction.vehicleId)) {
        return response.status(400).json({ ok: false, message: "Remove this vehicle from the Google selection first." });
      }
      merchantActions = confirmMerchantAction(merchantActions, actionId);
      message = "Merchant Center refresh marked as checked by you. This is an operator confirmation, not a Google API verification.";
    } else if (action === "save" || action === "remove") {
      const stockMap = await readDealerKitObservations(supabase);
      const vehicles = action === "save" ? await fetchCurrentVehicles(environment, deps.fetcher || fetch) : [];
      const vehicleMap = new Map(vehicles.map(v => [v.id, v]));
      if (action === "save") {
        selectedIds = validatedSelectedVehicleIds(body.selectedIds, vehicles.map(v => v.id));
        if (selectedIds.some(id => blockedSoldIds.includes(id))) {
          return response.status(400).json({ ok: false, message: "A vehicle marked sold cannot be reselected for Google advertising." });
        }
      } else {
        const id = normalizeVehicleId(body.vehicleId);
        if (!selectedIds.includes(id)) return response.status(400).json({ ok: false, message: "This vehicle is no longer in the selected Google feed." });
        selectedIds = selectedIds.filter(value => value !== id);
        const sold = clean(body.reason).toLowerCase() === "sold" || (stockMap.get(id)?.last_status || "").toLowerCase() === "sold";
        if (sold) blockedSoldIds = Array.from(new Set([...blockedSoldIds, id]));
      }
      if (mode === "selected" && !selectedIds.length) {
        return response.status(400).json({ ok: false, message: "Select a replacement before removing the last Google vehicle, or pause the Shopping campaign." });
      }
      if (mode === "selected") {
        for (const id of setting.selectedIds.filter(id => !selectedIds.includes(id))) {
          const source = (stockMap.get(id)?.last_status || "").toLowerCase();
          const reason = action === "remove" && clean(body.reason).toLowerCase() === "sold"
            ? "sold"
            : source === "sold" ? "sold" : ["reserved", "deposit_taken", "awaiting_delivery"].includes(source) ? "reserved" : "manual";
          if (source === "sold") blockedSoldIds = Array.from(new Set([...blockedSoldIds, id]));
          merchantActions = addRemovalAction(merchantActions, id, reason, stockMap, vehicleMap);
        }
      }
      message = "Google feed selection updated. IMPORTANT: Open Merchant Center, request a feed Update and confirm it below.";
    } else if (action === "block") {
      // A manual hold wins over DealerKit feed availability and remains until
      // the operator explicitly restores the vehicle.
      const id = normalizeVehicleId(body.vehicleId);
      const vehicles = await fetchCurrentVehicles(environment, deps.fetcher || fetch);
      const vehicleMap = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]));
      if (!id || !vehicleMap.has(id)) {
        return response.status(400).json({ ok: false, message: "Vehicle is not in the current DealerKit Google feed." });
      }
      if (!blockedSoldIds.includes(id)) {
        const stockMap = await readDealerKitObservations(supabase);
        if (mode === "selected" && selectedIds.length === 1 && selectedIds.includes(id)) {
          return response.status(400).json({ ok: false, message: "Cannot remove the last selected vehicle. Switch to automatic mode first." });
        }
        blockedSoldIds = [...blockedSoldIds, id];
        selectedIds = selectedIds.filter(selectedId => selectedId !== id);
        merchantActions = addRemovalAction(merchantActions, id, "sold", stockMap, vehicleMap);
      }
      message = "Vehicle blocked from the Google feed. Google will remove it on its next scheduled feed fetch; request Update for faster removal.";
    } else if (action === "unblock") {
      const id = normalizeVehicleId(body.vehicleId);
      if (!blockedSoldIds.includes(id)) {
        return response.status(400).json({ ok: false, message: "Vehicle is not manually blocked." });
      }
      if (merchantPending(merchantActions).some(item => item.vehicleId === id)) {
        return response.status(400).json({ ok: false, message: "Verify the Merchant Center removal reminder before restoring this vehicle." });
      }
      const stockMap = await readDealerKitObservations(supabase);
      if (googleVehicleFeedExclusion(id, { stock: stockMap.get(id) }) === "unavailable") {
        return response.status(400).json({ ok: false, message: "DealerKit still reports this vehicle unavailable. It cannot be restored." });
      }
      blockedSoldIds = blockedSoldIds.filter(blockedId => blockedId !== id);
      message = "Manual block cleared. If DealerKit still advertises this vehicle as available, the next Google feed fetch can include it.";
    } else if (action === "activate") {
      if (!setting.selectedIds.length) return response.status(400).json({ ok: false, message: "Save at least one selected vehicle first." });
      mode = "selected";
      message = "Selected vehicles will appear in the next Google feed refresh.";
    } else if (action === "deactivate") {
      // Automatic mode still enforces sold, reserved, pending-removal and
      // operator blocks, so returning to it cannot widen unsafe stock.
      mode = "all";
      message = "Automatic available-stock mode enabled. New DealerKit arrivals will join the next Merchant Center fetch.";
    } else {
      return response.status(400).json({ ok: false, message: "Unknown action." });
    }

    const { error } = await supabase.from(TABLE).upsert({
      id: "vansco", mode, selected_ids: selectedIds, blocked_sold_ids: blockedSoldIds,
      merchant_actions: merchantActions, updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
    if (error) throw error;
    return response.status(200).json({
      ok: true, mode, selectedIds, blockedSoldIds,
      merchantActions, merchantPending: merchantPending(merchantActions), message,
    });
  } catch (error) {
    console.error("[vansco-gva-selection] error", { message: error?.message || String(error) });
    return response.status(503).json({ ok: false, message: error?.message || "Vansco Google Vehicle Ads selection unavailable." });
  }
}
export default function handler(req, res) { return handleVanscoGoogleVehicleSelection(req, res); }

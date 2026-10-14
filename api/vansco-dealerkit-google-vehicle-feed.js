import { cleanDealerKitGoogleVehicleAdsCsv } from "../lib/dealerKitGoogleVehicleAdsFeed.js";
import { filteredGoogleVehicleCsv, normalizeVehicleId } from "../lib/vanscoGoogleVehicleAdsSelection.js";
import { getSupabaseServiceAdmin } from "./_vansco-cache-utils.js";

export const config = { maxDuration: 60 };

const DEALERKIT_GVA_URL = "https://api.dealerkit.uk/google-vehicle-listing-feed";

function clean(value) {
  return String(value ?? "").trim();
}

export default async function handler(request, response) {
  response.setHeader("X-Robots-Tag", "noindex, nofollow");
  response.setHeader("Cache-Control", "no-store, max-age=0");

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).send("Method not allowed.");
  }

  const username = clean(process.env.DEALERKIT_GVA_USERNAME);
  const password = clean(process.env.DEALERKIT_GVA_PASSWORD);

  if (!username || !password) {
    console.error("[dealerkit-gva-clean-feed] credentials are not configured");
    return response.status(503).send("Vehicle feed is temporarily unavailable.\n");
  }

  try {
    const authorization = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
    const upstream = await fetch(DEALERKIT_GVA_URL, {
      headers: {
        Accept: "text/csv,text/plain;q=0.9,*/*;q=0.8",
        Authorization: `Basic ${authorization}`,
      },
    });

    if (!upstream.ok) {
      console.error("[dealerkit-gva-clean-feed] DealerKit request failed", {
        status: upstream.status,
      });
      return response.status(503).send("Vehicle feed is temporarily unavailable.\n");
    }

    const sourceCsv = await upstream.text();
    const cleaned = cleanDealerKitGoogleVehicleAdsCsv(sourceCsv);

    if (!cleaned.vehicleCount) {
      console.error("[dealerkit-gva-clean-feed] DealerKit returned no vehicles");
      return response.status(503).send("No Google Vehicle Ads vehicles are currently available.\n");
    }

    // Rebuild the actual Merchant feed on each fetch. New DealerKit vehicles
    // appear automatically in all-stock mode, and explicitly unavailable or
    // blocked vehicles are excluded in BOTH automatic and manual modes.
    // Missing settings or Stock Watch data fail closed rather than advertising
    // sold stock. DealerKit feed absence alone never proves a vehicle was sold.
    const client = getSupabaseServiceAdmin();
    const [selectionResult, stockResult] = await Promise.all([
      client.from("vansco_google_vehicle_ads_selection")
        .select("mode,selected_ids,blocked_sold_ids,merchant_actions")
        .eq("id", "vansco").maybeSingle(),
      client.from("dealerkit_stock_state")
        .select("supplier_stock_id,last_status,source_status")
        .limit(1500),
    ]);
    if (selectionResult.error || !selectionResult.data) {
      throw new Error("Google vehicle selection settings are unavailable.");
    }
    if (stockResult.error) throw new Error("DealerKit stock status checks are unavailable.");
    const selection = selectionResult.data;
    const stockById = new Map((stockResult.data || [])
      .filter(row => row.supplier_stock_id)
      .map(row => [normalizeVehicleId(row.supplier_stock_id), row]));
    const pendingRemovalIds = (Array.isArray(selection.merchant_actions) ? selection.merchant_actions : [])
      .filter(action => !action.confirmedAt)
      .map(action => action.vehicleId);
    const outbound = filteredGoogleVehicleCsv(cleaned.csv, {
      mode: selection.mode === "selected" ? "selected" : "all",
      selectedIds: selection.selected_ids || [],
      blockedIds: selection.blocked_sold_ids || [],
      pendingRemovalIds,
      stockById,
    });

    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'inline; filename="vansco-google-vehicle-listings.csv"');
    response.setHeader("X-Vansco-GVA-Source", "dealerkit");
    response.setHeader("X-Vansco-Vehicle-Count", String(outbound.vehicleCount));
    response.setHeader("X-Vansco-Descriptions-Cleaned", String(cleaned.cleanedDescriptionCount));
    response.setHeader("X-Vansco-Unavailable-Excluded", String(outbound.excludedUnavailable));
    response.setHeader("X-Vansco-Blocked-Excluded", String(outbound.excludedBlocked));

    return response.status(200).send(outbound.csv);
  } catch (error) {
    console.error("[dealerkit-gva-clean-feed] failed", {
      message: error?.message || String(error),
    });
    return response.status(503).send("Vehicle feed is temporarily unavailable.\n");
  }
}

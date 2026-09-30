import { convertWixImage } from "./marketingVehicleContract.js";

export async function fetchStockWatchWixListingPresence(pipeline) {
  const response = await fetch(`/api/stock-watch-wix-listing-presence?pipeline=${encodeURIComponent(pipeline)}`, {
    headers: { accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "Could not load live Wix listing presence.");
  }
  return payload;
}

const ADVERTISED_COLLECTIONS = Object.freeze({
  finance: "VANFINANCE-ALLVANS",
  rent2buy: "ALLRENT2BUYVANS",
  cars: "CARFINANCE",
});

export function advertisedWixVehicles(presence, pipeline) {
  const collectionId = ADVERTISED_COLLECTIONS[pipeline];
  if (!collectionId || presence?.ok === false || presence?.pipeline !== pipeline
    || presence?.complete !== true || presence?.publishedListingsComplete !== true
    || !Array.isArray(presence?.publishedListings)) {
    throw new Error("Published Wix advert records are unavailable or incomplete. All advertised stock is paused.");
  }
  return presence.publishedListings.map((vehicle) => {
    if (vehicle.collection_id !== collectionId || vehicle.publishStatus !== "PUBLISHED"
      || !vehicle.wixItemId || !vehicle.registration) {
      throw new Error("Published Wix advert identity is not verified for this stock lane. All advertised stock is paused.");
    }
    const picture = typeof vehicle.picture === "string" ? vehicle.picture : vehicle.picture?.url || vehicle.picture?.src || "";
    return { ...vehicle, imageUrl: convertWixImage(picture) };
  });
}

export async function fetchAdvertisedWixVehicles(pipeline, comparison = null, { loadPresence = fetchStockWatchWixListingPresence } = {}) {
  const presence = comparison ? comparison.presence : await loadPresence(pipeline);
  return advertisedWixVehicles(presence, pipeline);
}

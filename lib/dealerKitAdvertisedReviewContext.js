import { convertWixImage } from "../services/marketingVehicleContract.js";

const COLLECTIONS = Object.freeze({
  finance: "VANFINANCE-ALLVANS",
  rent2buy: "ALLRENT2BUYVANS",
  cars: "CARFINANCE",
});

function registrationKey(value) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Read-only context from the verified published listing, never a source-photo choice.
export function currentWixAdvertForReview(record, registration, product) {
  if (record === null || record === undefined) return null;
  const key = registrationKey(registration);
  if (!COLLECTIONS[product] || record.collection_id !== COLLECTIONS[product]
    || record.publishStatus !== "PUBLISHED" || !record.wixItemId
    || !key || registrationKey(record.registration) !== key) {
    throw new Error("Current Wix advert could not be verified for this vehicle and lane. Reopen review from All advertised stock.");
  }
  const picture = typeof record.picture === "string" ? record.picture : record.picture?.url || record.picture?.src || "";
  return { ...record, registration: key, product, imageUrl: convertWixImage(picture) };
}

export function currentWixAdvertPrice(advert) {
  if (advert.product === "rent2buy" && advert.monthly !== null && advert.monthly !== undefined && Number.isFinite(Number(advert.monthly))) {
    return `£${Number(advert.monthly).toLocaleString("en-GB", { maximumFractionDigits: 2 })} p/m`;
  }
  if (advert.priceText) return advert.priceText;
  if (advert.price !== null && advert.price !== undefined && Number.isFinite(Number(advert.price))) {
    return `£${Number(advert.price).toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
  }
  return "Price unavailable";
}

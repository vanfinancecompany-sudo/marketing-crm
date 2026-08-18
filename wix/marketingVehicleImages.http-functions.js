// Wix Velo deployment source for Backend/http-functions.js.
//
// This file is intentionally kept in the Marketing CRM repository as the
// source-of-truth for the small read-only bridge used by the YouTube Generator.
// Merge these exports into the VAN FINANCE Wix site's Backend/http-functions.js
// and publish the site. The Marketing CRM then reads image URLs directly from
// Wix instead of requiring a manual CMS export/upload.

import wixData from "wix-data";
import { ok, serverError } from "wix-http-functions";

const RESPONSE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=300",
};

const SOURCES = {
  vanFinance: {
    collectionId: "VANFINANCEPAGES",
    galleryField: "mainImages",
    countField: "imageCount",
    monthlyField: "mthPrice",
    priceField: "priceVat",
  },
  rent2buy: {
    collectionId: "VANPAGES",
    galleryField: "mediaGallery",
    countField: "numberOfImages",
    monthlyField: "monthlyPayments",
    priceField: "intialRentalCharge",
  },
};

function clean(value) {
  return String(value ?? "").trim();
}

function galleryUrls(item, field) {
  const gallery = Array.isArray(item?.[field]) ? item[field] : [];
  return gallery
    .map((entry) => clean(entry?.src || entry?.url || entry))
    .filter(Boolean);
}

function toVehicleRow(item, source) {
  return {
    registration: clean(item?.title).toUpperCase(),
    title: clean(item?.titleText),
    images: galleryUrls(item, source.galleryField),
    imageCount: Number(clean(item?.[source.countField])) || galleryUrls(item, source.galleryField).length,
    monthly: clean(item?.[source.monthlyField]),
    price: clean(item?.[source.priceField]),
  };
}

async function vehicleImageResponse(productKey) {
  const source = SOURCES[productKey];

  try {
    const result = await wixData
      .query(source.collectionId)
      .limit(1000)
      .find({ suppressAuth: true, suppressHooks: true, consistentRead: true });

    const items = (result.items || [])
      .map((item) => toVehicleRow(item, source))
      .filter((item) => item.registration && item.images.length);

    return ok({
      headers: RESPONSE_HEADERS,
      body: JSON.stringify({
        product: productKey,
        refreshedAt: new Date().toISOString(),
        count: items.length,
        items,
      }),
    });
  } catch (error) {
    console.error("MARKETING VEHICLE IMAGE FEED ERROR", {
      productKey,
      message: error?.message || String(error),
    });

    return serverError({
      headers: RESPONSE_HEADERS,
      body: JSON.stringify({
        product: productKey,
        count: 0,
        items: [],
        error: "Vehicle image feed could not be loaded.",
      }),
    });
  }
}

export function get_marketingVanFinanceImages() {
  return vehicleImageResponse("vanFinance");
}

export function get_marketingRent2BuyImages() {
  return vehicleImageResponse("rent2buy");
}

import {
  RENT2BUY_ALL_VANS_COLLECTION_ID,
} from "../lib/rent2buyMonthlyPriceSync.js";

const WIX_QUERY_URL = "https://www.wixapis.com/wix-data/v2/items/query";
const LIVE_RENT2BUY_STOCK_SITE_ID = "85f11c52-ee54-495d-aaec-a351831709b5";
const DEFAULT_SYNC_ENDPOINT = "https://crm-roan-rho.vercel.app/api/sync-rent-vehicles";
const PAGE_SIZE = 100;
const MAX_ROWS = 2000;

function clean(value) {
  return String(value ?? "").trim();
}

function first(...values) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return "";
}

function normalizeRegistration(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function updatedMillis(data = {}) {
  const raw = typeof data?._updatedDate === "object"
    ? data?._updatedDate?.$date
    : data?._updatedDate;
  const value = Date.parse(raw || "");
  return Number.isFinite(value) ? value : 0;
}

function wixHeaders() {
  const headers = {
    "Content-Type": "application/json",
    "wix-site-id":
      clean(process.env.WIX_RENT2BUY_STOCK_SITE_ID) ||
      clean(process.env.WIX_FINANCE_SITE_ID) ||
      LIVE_RENT2BUY_STOCK_SITE_ID,
  };
  const apiKey = clean(process.env.WIX_FINANCE_API_KEY || process.env.WIX_API_KEY);
  if (apiKey) headers.Authorization = apiKey;
  return headers;
}

async function queryWixPage(offset) {
  const response = await fetch(WIX_QUERY_URL, {
    method: "POST",
    headers: wixHeaders(),
    body: JSON.stringify({
      dataCollectionId:
        clean(process.env.WIX_RENT2BUY_STOCK_COLLECTION) || RENT2BUY_ALL_VANS_COLLECTION_ID,
      query: { paging: { limit: PAGE_SIZE, offset } },
      consistentRead: true,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const detail = clean(await response.text()).slice(0, 500);
    throw new Error(
      `Rent2Buy Wix stock query failed (${response.status})${detail ? `: ${detail}` : ""}`
    );
  }

  const payload = await response.json();
  return Array.isArray(payload?.dataItems) ? payload.dataItems : [];
}

async function loadCurrentRent2BuyStock() {
  const rows = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    const page = await queryWixPage(offset);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  const latest = new Map();
  for (const item of rows) {
    const data = item?.data || {};
    if (clean(data?._publishStatus).toUpperCase() === "DRAFT") continue;

    const registration = normalizeRegistration(data.title || data.registration);
    if (!registration) continue;

    const current = latest.get(registration);
    if (current && updatedMillis(current) > updatedMillis(data)) continue;
    latest.set(registration, data);
  }

  const vehicles = [...latest.entries()].map(([registration, data]) => ({
    picture: first(data.picture, data.image, data.mainImage),
    registration,
    monthly: first(data.mth, data.monthly, data.monthlyPayments, data.weeklyPrice),
    week: first(
      data.week,
      data.weekly,
      data.numberOfMonths,
      data.term,
      data.followedBy35Months,
      data.followedBy47Months,
      data.followedBy47Months1
    ),
    initialRental: first(
      data.initialRental2250Vat,
      data.intialRentalCharge,
      data.initialRental
    ),
    vanDescription: first(
      data.vanDescription,
      data.descriptionText,
      data.titleText,
      data.mitsubishiL200Barbarian,
      registration
    ),
    vanSpec: first(
      data.vanSpec,
      data.specification,
      data.specText,
      data.vehicleSpecificationText
    ),
    webLink: first(data.webLink, data.weblink, data.link),
  }));

  if (!vehicles.length) {
    throw new Error(
      "Wix returned no usable Rent2Buy vehicles. Existing synced stock was left unchanged."
    );
  }

  return { wixRows: rows.length, vehicles };
}

async function pushToRent2BuyStock(vehicles) {
  const endpoint = clean(process.env.RENT2BUY_SYNC_ENDPOINT) || DEFAULT_SYNC_ENDPOINT;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(vehicles),
    cache: "no-store",
  });

  const text = await response.text();
  let payload = {};
  try {
    payload = JSON.parse(text);
  } catch {
    payload = {};
  }

  if (!response.ok || payload?.success !== true) {
    const detail = clean(payload?.error || payload?.message || text).slice(0, 500);
    throw new Error(
      `Rent2Buy stock receiver failed (${response.status})${detail ? `: ${detail}` : ""}`
    );
  }

  return payload;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");

  if (!["GET", "POST"].includes(request.method || "")) {
    response.setHeader("Allow", "GET, POST");
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }

  try {
    const { wixRows, vehicles } = await loadCurrentRent2BuyStock();
    const result = await pushToRent2BuyStock(vehicles);

    console.info("RENT2BUY FACEBOOK STOCK SYNC", {
      wix_rows: wixRows,
      current: vehicles.length,
      inserted: Number(result.inserted || 0),
      updated: Number(result.updated || 0),
      unchanged: Number(result.unchanged || 0),
      deactivated: Number(result.deactivated || 0),
      reactivated: Number(result.reactivated || 0),
      automatic: clean(request.query?.auto).toLowerCase() === "true",
    });

    return response.status(200).json({
      ok: true,
      source: "live-rent2buy-wix-cms",
      collection:
        clean(process.env.WIX_RENT2BUY_STOCK_COLLECTION) || RENT2BUY_ALL_VANS_COLLECTION_ID,
      wixRows,
      active: vehicles.length,
      inserted: Number(result.inserted || 0),
      updated: Number(result.updated || 0),
      unchanged: Number(result.unchanged || 0),
      deactivated: Number(result.deactivated || 0),
      reactivated: Number(result.reactivated || 0),
    });
  } catch (error) {
    console.error("RENT2BUY FACEBOOK STOCK SYNC ERROR", {
      message: clean(error?.message).slice(0, 1000),
    });
    return response.status(500).json({
      ok: false,
      message: error?.message || "Could not sync Rent2Buy Facebook stock.",
    });
  }
}

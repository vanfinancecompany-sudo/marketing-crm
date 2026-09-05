import { normalizeRegistration } from "./_vansco-cache-utils.js";

const WIX_QUERY_URL = "https://www.wixapis.com/wix-data/v2/items/query";
const PAGE_SIZE = 100;
const MAX_ROWS_PER_COLLECTION = 2000;

const FINANCE_WIX_SITE_ID = "85f11c52-ee54-495d-aaec-a351831709b5";

const FINANCE_SOURCES = Object.freeze([
  {
    siteId: FINANCE_WIX_SITE_ID,
    siteLabel: "VAN FINANCE Wix · Finance CMS",
    collectionId: "VANFINANCE-ALLVANS",
    collectionLabel: "VAN FINANCE - ALL VANS",
  },
]);

const CAR_SOURCES = Object.freeze([
  { siteId: FINANCE_WIX_SITE_ID, siteLabel: "VAN FINANCE Wix", collectionId: "CARFINANCE", collectionLabel: "CAR FINANCE" },
]);

// ALLRENT2BUYVANS is the canonical live-card source for both current Rent2Buy
// frontends. Category collections are membership/detail helpers only and must not
// resurrect a vehicle that is already Draft in ALLRENT2BUYVANS.
const RENT2BUY_SOURCES = Object.freeze([
  {
    siteId: FINANCE_WIX_SITE_ID,
    siteLabel: "VAN FINANCE Wix · Rent2Buy CMS",
    collectionId: "ALLRENT2BUYVANS",
    collectionLabel: "ALL VANS",
  },
]);

function clean(value) {
  return String(value ?? "").trim();
}

function parsePrice(value) {
  const numeric = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function wixHeaders(siteId) {
  const headers = {
    "Content-Type": "application/json",
    "wix-site-id": siteId,
  };
  const apiKey = clean(process.env.WIX_FINANCE_API_KEY || process.env.WIX_API_KEY);
  if (apiKey) headers.Authorization = apiKey;
  return headers;
}

function itemRegistration(item) {
  const data = item?.data || {};
  return normalizeRegistration(data.title || data.registration || data.reg || data.vehicleRegistration || "");
}

function itemPublishStatus(item) {
  return clean(item?.data?._publishStatus || item?._publishStatus || "").toUpperCase();
}

function itemPrice(item) {
  const data = item?.data || {};
  return parsePrice(data.price ?? data.priceVat ?? data.salePrice ?? null);
}

function itemUpdatedAt(item) {
  const value = item?.data?._updatedDate?.$date || item?.data?._updatedDate || item?._updatedDate?.$date || item?._updatedDate || null;
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

async function loadSource(source) {
  const vehiclesByRegistration = new Map();
  let scanned = 0;

  for (let offset = 0; offset < MAX_ROWS_PER_COLLECTION; offset += PAGE_SIZE) {
    const response = await fetch(WIX_QUERY_URL, {
      method: "POST",
      headers: wixHeaders(source.siteId),
      body: JSON.stringify({
        dataCollectionId: source.collectionId,
        query: { paging: { limit: PAGE_SIZE, offset } },
        consistentRead: true,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      const detail = clean(await response.text()).slice(0, 500);
      throw new Error(`${source.siteLabel} / ${source.collectionLabel} returned ${response.status}${detail ? `: ${detail}` : ""}`);
    }

    const payload = await response.json();
    const page = Array.isArray(payload?.dataItems) ? payload.dataItems : [];
    scanned += page.length;

    for (const item of page) {
      const status = itemPublishStatus(item);
      if (status && status !== "PUBLISHED") continue;
      const registration = itemRegistration(item);
      if (!registration) continue;
      vehiclesByRegistration.set(registration, {
        registration,
        title: clean(item?.data?.vanDescription || item?.data?.title || registration),
        price: itemPrice(item),
        updated_at: itemUpdatedAt(item),
        collection_id: source.collectionId,
      });
    }

    if (page.length < PAGE_SIZE) break;
  }

  const vehicles = Array.from(vehiclesByRegistration.values());
  return {
    ...source,
    registrations: vehicles.map((vehicle) => vehicle.registration),
    vehicles,
    scanned,
  };
}

export function sourcesForPipeline(pipelineValue) {
  const pipeline = clean(pipelineValue).toLowerCase();
  if (pipeline === "finance") return FINANCE_SOURCES;
  if (pipeline === "cars") return CAR_SOURCES;
  if (pipeline === "rent2buy") return RENT2BUY_SOURCES;
  return [];
}

export async function loadLiveWixListingPresence(pipelineValue) {
  const pipeline = clean(pipelineValue).toLowerCase();
  const sources = sourcesForPipeline(pipeline);
  if (!sources.length) {
    return {
      ok: false,
      pipeline,
      complete: false,
      registrations: [],
      vehicles: [],
      registrationCount: 0,
      sources: [],
      errors: [{ error: "Live Wix listing presence is not configured for this pipeline." }],
      authority: "Not configured",
    };
  }

  const settled = await Promise.allSettled(sources.map(loadSource));
  const vehiclesByRegistration = new Map();
  const results = settled.map((result, index) => {
    const source = sources[index];
    if (result.status === "rejected") {
      return {
        ...source,
        ok: false,
        scanned: 0,
        registrations: [],
        vehicles: [],
        error: clean(result.reason?.message || result.reason || "Wix listing check failed."),
      };
    }
    result.value.vehicles.forEach((vehicle) => vehiclesByRegistration.set(vehicle.registration, vehicle));
    return { ...result.value, ok: true, error: "" };
  });

  const errors = results.filter((result) => !result.ok);
  const vehicles = Array.from(vehiclesByRegistration.values()).sort((a, b) => a.registration.localeCompare(b.registration));
  const authority = pipeline === "cars"
    ? "Live CARFINANCE Wix listing state"
    : pipeline === "finance"
      ? "Published VANFINANCE-ALLVANS rows in the VAN FINANCE Wix CMS only"
      : "Published ALLRENT2BUYVANS rows in the VAN FINANCE Wix CMS only";

  return {
    ok: true,
    pipeline,
    complete: errors.length === 0,
    registrations: vehicles.map((vehicle) => vehicle.registration),
    vehicles,
    registrationCount: vehicles.length,
    sources: results,
    errors: errors.map((item) => ({ siteLabel: item.siteLabel, collectionLabel: item.collectionLabel, error: item.error })),
    authority,
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }

  const pipeline = clean(request.query?.pipeline).toLowerCase();
  const presence = await loadLiveWixListingPresence(pipeline);
  if (!presence.ok && presence.authority === "Not configured") {
    return response.status(400).json({ ok: false, message: "Live Wix listing presence is only available for Finance, Cars and Rent2Buy." });
  }
  return response.status(200).json(presence);
}

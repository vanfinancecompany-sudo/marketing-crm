import { normalizeRegistration } from "./_vansco-cache-utils.js";

const WIX_QUERY_URL = "https://www.wixapis.com/wix-data/v2/items/query";
const PAGE_SIZE = 100;
const MAX_ROWS_PER_COLLECTION = 2000;

const FINANCE_WIX_SITE_ID = "85f11c52-ee54-495d-aaec-a351831709b5";

const CAR_SOURCES = Object.freeze([
  { siteId: FINANCE_WIX_SITE_ID, siteLabel: "VAN FINANCE Wix", collectionId: "CARFINANCE", collectionLabel: "CAR FINANCE" },
]);

const RENT2BUY_COLLECTIONS = Object.freeze([
  { id: "ALLRENT2BUYVANS", label: "ALL VANS" },
  { id: "MEDIUMVANS", label: "MWB" },
  { id: "PICKUPS", label: "PICKUPS" },
  { id: "SmallVans", label: "SMALL" },
  { id: "TIPPERS-LUTONS-DROPSDIES", label: "TIPPER" },
  { id: "LWBVANS", label: "LWB" },
  { id: "ELECTRICVANS", label: "ELECTRIC" },
  { id: "CREWVANS", label: "CREW" },
  { id: "AUTOMATICVANS", label: "AUTOMATIC" },
]);

// Both public Rent2Buy experiences now consume the VAN FINANCE Wix Rent2Buy CMS.
// The old standalone RENT2BUY VANS Wix CMS is intentionally excluded so stale
// published rows there cannot resurrect vehicles already drafted in the live CMS.
const RENT2BUY_SOURCES = Object.freeze(
  RENT2BUY_COLLECTIONS.map((collection) => ({
    siteId: FINANCE_WIX_SITE_ID,
    siteLabel: "VAN FINANCE Wix · Rent2Buy CMS",
    collectionId: collection.id,
    collectionLabel: collection.label,
  }))
);

function clean(value) {
  return String(value ?? "").trim();
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

async function loadSource(source) {
  const registrations = new Set();
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
      if (registration) registrations.add(registration);
    }

    if (page.length < PAGE_SIZE) break;
  }

  return {
    ...source,
    registrations: Array.from(registrations),
    scanned,
  };
}

export function sourcesForPipeline(pipelineValue) {
  const pipeline = clean(pipelineValue).toLowerCase();
  if (pipeline === "cars") return CAR_SOURCES;
  if (pipeline === "rent2buy") return RENT2BUY_SOURCES;
  return [];
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }

  const pipeline = clean(request.query?.pipeline).toLowerCase();
  const sources = sourcesForPipeline(pipeline);
  if (!sources.length) {
    return response.status(400).json({ ok: false, message: "Live Wix listing presence is only available for Cars and Rent2Buy." });
  }

  const settled = await Promise.allSettled(sources.map(loadSource));
  const registrations = new Set();
  const results = settled.map((result, index) => {
    const source = sources[index];
    if (result.status === "rejected") {
      return {
        ...source,
        ok: false,
        scanned: 0,
        registrations: [],
        error: clean(result.reason?.message || result.reason || "Wix listing check failed."),
      };
    }
    result.value.registrations.forEach((registration) => registrations.add(registration));
    return { ...result.value, ok: true, error: "" };
  });

  const errors = results.filter((result) => !result.ok);
  return response.status(200).json({
    ok: true,
    pipeline,
    complete: errors.length === 0,
    registrations: Array.from(registrations).sort(),
    registrationCount: registrations.size,
    sources: results,
    errors: errors.map((item) => ({ siteLabel: item.siteLabel, collectionLabel: item.collectionLabel, error: item.error })),
    authority: pipeline === "cars"
      ? "Live CARFINANCE Wix listing state"
      : "Live Rent2Buy listing/category state in the VAN FINANCE Wix CMS only",
  });
}

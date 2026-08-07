const DEFAULT_WIX_API_BASE_URL = "https://www.wixapis.com";
const FINANCE_VEHICLE_COLLECTION_ID = "VANFINANCEPAGES";
const RENT2BUY_VEHICLE_COLLECTION_ID = "VANPAGES";
const VEHICLE_CACHE_TTL_MS = 5 * 60 * 1000;
const SITE_HOSTS = new Set(["vanfinancecompany.co.uk", "www.vanfinancecompany.co.uk"]);
const vehicleCache = new Map();

const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);

function compactRegistration(value) {
  const compact = clean(value, 40).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length < 5 || compact.length > 8 || !/[A-Z]/.test(compact) || !/\d/.test(compact)) return "";
  return compact;
}

function registrationCandidates(value) {
  const compact = compactRegistration(value);
  if (!compact) return [];
  const candidates = [compact];
  if (/^[A-Z]{2}\d{2}[A-Z]{3}$/.test(compact)) candidates.push(`${compact.slice(0, 4)} ${compact.slice(4)}`);
  return [...new Set(candidates)];
}

function safeSiteUrl(value) {
  const candidate = clean(value, 2000);
  if (!candidate) throw new Error("A Van Finance Company page URL is required.");
  const url = new URL(candidate);
  if (url.protocol !== "https:" || !SITE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("The assistant page URL must belong to the Van Finance Company website.");
  }
  return url;
}

function pathSegments(url) {
  return url.pathname.split("/").map((part) => decodeURIComponent(part).trim()).filter(Boolean);
}

export function inferPublicWixPageContext(pageUrl) {
  const url = safeSiteUrl(pageUrl);
  const segments = pathSegments(url);
  const first = clean(segments[0], 120).toLowerCase();
  const second = clean(segments[1], 80);

  if (first === "van-finance" && second) {
    const registration = compactRegistration(second);
    if (registration) {
      return {
        page_type: "finance_vehicle",
        product: "finance",
        collection_id: FINANCE_VEHICLE_COLLECTION_ID,
        registration,
        page_url: url.href,
      };
    }
  }

  if (["guaranteed-rent2buy-vans", "guaranteed-rent2buy-van"].includes(first) && second) {
    const registration = compactRegistration(second);
    if (registration) {
      return {
        page_type: "rent2buy_general",
        product: "rent2buy",
        collection_id: RENT2BUY_VEHICLE_COLLECTION_ID,
        registration,
        page_url: url.href,
      };
    }
  }

  const path = url.pathname.toLowerCase();
  if (/rent(?:2|[- ]?to[- ]?)buy|rent-?2-?buy/.test(path)) {
    return { page_type: "rent2buy_general", product: "rent2buy", collection_id: null, registration: null, page_url: url.href };
  }
  if (path === "/" || path === "") {
    return { page_type: "homepage", product: null, collection_id: null, registration: null, page_url: url.href };
  }
  if (path.includes("finance")) {
    return { page_type: "finance_general", product: "finance", collection_id: null, registration: null, page_url: url.href };
  }
  return { page_type: "homepage", product: null, collection_id: null, registration: null, page_url: url.href };
}

function wixReadConfiguration(environment = process.env) {
  const apiKey = clean(environment.WIX_API_KEY, 10000);
  const siteId = clean(environment.WIX_SITE_ID, 500);
  if (!apiKey || !siteId) return null;
  return {
    apiKey,
    siteId,
    apiBaseUrl: clean(environment.WIX_API_BASE_URL, 1000) || DEFAULT_WIX_API_BASE_URL,
  };
}

async function queryVehicleItem({ collectionId, registration, configuration, fetchImpl }) {
  for (const candidate of registrationCandidates(registration)) {
    const response = await fetchImpl(`${configuration.apiBaseUrl}/wix-data/v2/items/query`, {
      method: "POST",
      headers: {
        Authorization: configuration.apiKey,
        "wix-site-id": configuration.siteId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        dataCollectionId: collectionId,
        query: {
          filter: { title: { $eq: candidate } },
          paging: { limit: 2 },
        },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Wix vehicle lookup failed with status ${response.status}.`);
    const item = Array.isArray(payload.dataItems) ? payload.dataItems[0] : null;
    if (item?.data) return item;
  }
  return null;
}

function mapVehicleContext(route, item) {
  const data = item?.data || {};
  const registration = compactRegistration(data.title || route.registration) || route.registration;
  const identity = {
    registration: registration || null,
    vehicle_id: clean(item?.id, 100) || null,
    title: clean(data.titleText, 200) || null,
  };

  if (route.collection_id === FINANCE_VEHICLE_COLLECTION_ID) {
    return {
      page_type: "finance_vehicle",
      vehicle: {
        ...identity,
        pricing: {
          finance_monthly: data.mthPrice ?? null,
          finance_retail_vat: data.priceVat ?? null,
        },
      },
    };
  }

  if (route.collection_id === RENT2BUY_VEHICLE_COLLECTION_ID) {
    return {
      page_type: "rent2buy_general",
      vehicle: {
        ...identity,
        pricing: {
          rent2buy_monthly: data.monthlyPayments ?? null,
          rent2buy_initial: data.intialRentalCharge ?? null,
        },
        term_months: data.numberOfMonths ?? null,
      },
    };
  }

  return { page_type: route.page_type, vehicle: {} };
}

function fallbackContext(route) {
  if (!route.registration) return { page_type: route.page_type, vehicle: {} };
  return {
    page_type: route.page_type,
    vehicle: {
      registration: route.registration,
      vehicle_id: null,
      title: null,
      pricing: {},
      term_months: null,
    },
  };
}

function cacheKey(route) {
  return `${route.collection_id || "general"}:${route.registration || route.page_type}`;
}

export function clearPublicWixVehicleContextCache() {
  vehicleCache.clear();
}

export async function resolvePublicWixPageContext(pageUrl, { environment = process.env, fetchImpl = fetch } = {}) {
  const route = inferPublicWixPageContext(pageUrl);
  if (!route.collection_id || !route.registration) return fallbackContext(route);

  const key = cacheKey(route);
  const cached = vehicleCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.context;

  const configuration = wixReadConfiguration(environment);
  if (!configuration) return fallbackContext(route);

  try {
    const item = await queryVehicleItem({
      collectionId: route.collection_id,
      registration: route.registration,
      configuration,
      fetchImpl,
    });
    const context = item ? mapVehicleContext(route, item) : fallbackContext(route);
    vehicleCache.set(key, { context, expiresAt: Date.now() + VEHICLE_CACHE_TTL_MS });
    return context;
  } catch (error) {
    console.warn("PUBLIC WIX VEHICLE CONTEXT LOOKUP FAILED", {
      collection_id: route.collection_id,
      registration: route.registration,
      message: clean(error?.message, 500),
    });
    return fallbackContext(route);
  }
}

export const PUBLIC_WIX_VEHICLE_COLLECTIONS = Object.freeze({
  finance: FINANCE_VEHICLE_COLLECTION_ID,
  rent2buy: RENT2BUY_VEHICLE_COLLECTION_ID,
});

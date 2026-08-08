const DEFAULT_WIX_API_BASE_URL = "https://www.wixapis.com";
const FINANCE_VEHICLE_COLLECTION_ID = "VANFINANCEPAGES";
const RENT2BUY_VEHICLE_COLLECTION_ID = "VANPAGES";
const VEHICLE_CACHE_TTL_MS = 5 * 60 * 1000;
const VFC_SITE_HOSTS = new Set(["vanfinancecompany.co.uk", "www.vanfinancecompany.co.uk"]);
const RENT2BUY_SITE_HOSTS = new Set(["rent2buyvans.co.uk", "www.rent2buyvans.co.uk"]);
const SITE_HOSTS = new Set([...VFC_SITE_HOSTS, ...RENT2BUY_SITE_HOSTS]);
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
  if (!candidate) throw new Error("A Van Finance Company or Rent2Buy page URL is required.");
  const url = new URL(candidate);
  if (url.protocol !== "https:" || !SITE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("The assistant page URL must belong to the Van Finance Company or Rent2Buy website.");
  }
  return url;
}

function pathSegments(url) {
  return url.pathname.split("/").map((part) => decodeURIComponent(part).trim()).filter(Boolean);
}

function rent2BuyVehicleRoute(first, second) {
  if (!["van-pages", "van-page", "guaranteed-rent2buy-vans", "guaranteed-rent2buy-van"].includes(first) || !second) return null;
  return compactRegistration(second) || null;
}

export function inferPublicWixPageContext(pageUrl) {
  const url = safeSiteUrl(pageUrl);
  const host = url.hostname.toLowerCase();
  const rent2BuyOnlySite = RENT2BUY_SITE_HOSTS.has(host);
  const segments = pathSegments(url);
  const first = clean(segments[0], 120).toLowerCase();
  const second = clean(segments[1], 80);

  // rent2buyvans.co.uk is a single-product site. Every page is locked to Rent2Buy,
  // including its homepage and any path that happens to contain the word "finance".
  if (rent2BuyOnlySite) {
    const registration = rent2BuyVehicleRoute(first, second);
    if (registration) {
      return {
        page_type: "rent2buy_general",
        product: "rent2buy",
        collection_id: RENT2BUY_VEHICLE_COLLECTION_ID,
        registration,
        page_url: url.href,
        site_host: host,
        public_page_first: true,
      };
    }
    return {
      page_type: "rent2buy_general",
      product: "rent2buy",
      collection_id: null,
      registration: null,
      page_url: url.href,
      site_host: host,
      public_page_first: true,
    };
  }

  if (first === "van-finance" && second) {
    const registration = compactRegistration(second);
    if (registration) {
      return {
        page_type: "finance_vehicle",
        product: "finance",
        collection_id: FINANCE_VEHICLE_COLLECTION_ID,
        registration,
        page_url: url.href,
        site_host: host,
        public_page_first: false,
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
        site_host: host,
        public_page_first: false,
      };
    }
  }

  const path = url.pathname.toLowerCase();
  if (/rent(?:2|[- ]?to[- ]?)buy|rent-?2-?buy/.test(path)) {
    return { page_type: "rent2buy_general", product: "rent2buy", collection_id: null, registration: null, page_url: url.href, site_host: host, public_page_first: false };
  }
  if (path === "/" || path === "") {
    return { page_type: "homepage", product: null, collection_id: null, registration: null, page_url: url.href, site_host: host, public_page_first: false };
  }
  if (path.includes("finance")) {
    return { page_type: "finance_general", product: "finance", collection_id: null, registration: null, page_url: url.href, site_host: host, public_page_first: false };
  }
  return { page_type: "homepage", product: null, collection_id: null, registration: null, page_url: url.href, site_host: host, public_page_first: false };
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

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&pound;|&#163;/gi, "£")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlToVisibleText(html) {
  return decodeHtmlEntities(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pageRegistrationMatches(text, registration) {
  const pageCompact = clean(text, 500000).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return Boolean(registration && pageCompact.includes(registration));
}

function priceText(match) {
  return clean(match?.[1], 160).replace(/\s+/g, " ") || null;
}

function mapPublicPageText(route, text) {
  if (!pageRegistrationMatches(text, route.registration)) return null;

  if (route.collection_id === FINANCE_VEHICLE_COLLECTION_ID) {
    const retail = priceText(text.match(/(£\s*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s*\+?\s*VAT)/i));
    const monthly = priceText(text.match(/FINANCE\s+FROM\s+ONLY[\s\S]{0,100}?(£\s*\d{1,4}(?:,\d{3})*(?:\.\d{1,2})?)/i));
    if (!retail && !monthly) return null;
    return {
      page_type: "finance_vehicle",
      vehicle: {
        registration: route.registration,
        vehicle_id: null,
        title: null,
        pricing: {
          finance_monthly: monthly,
          finance_retail_vat: retail,
        },
      },
    };
  }

  if (route.collection_id === RENT2BUY_VEHICLE_COLLECTION_ID) {
    const initial = priceText(text.match(/INITIAL\s+RENTAL\s+CHARGE[\s\S]{0,100}?(£\s*\d{1,4}(?:,\d{3})*(?:\.\d{1,2})?\s*\+?\s*VAT(?:\s*\([^)]{1,80}\))?)/i));
    const monthly = priceText(text.match(/MONTHLY\s+PAYMENTS[\s\S]{0,100}?(£\s*\d{1,4}(?:,\d{3})*(?:\.\d{1,2})?\s*\+?\s*VAT(?:\s*\([^)]{1,80}\))?)/i));
    const termMatch = text.match(/\b(\d{2})\s*X\s+MONTHLY\s+PAYMENTS\b/i);
    const term = termMatch ? Number.parseInt(termMatch[1], 10) : null;
    if (!initial && !monthly && !term) return null;
    return {
      page_type: "rent2buy_general",
      vehicle: {
        registration: route.registration,
        vehicle_id: null,
        title: null,
        pricing: {
          rent2buy_monthly: monthly,
          rent2buy_initial: initial,
        },
        term_months: term,
      },
    };
  }

  return null;
}

async function queryPublicVehiclePage(route, fetchImpl) {
  const response = await fetchImpl(route.page_url, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "VFC-Rent2Buy-AI-Assistant/1.0",
    },
  });
  if (!response.ok || typeof response.text !== "function") {
    throw new Error(`Public vehicle page lookup failed with status ${response.status}.`);
  }
  const html = await response.text();
  return mapPublicPageText(route, htmlToVisibleText(html));
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
  return `${route.site_host || "site"}:${route.collection_id || "general"}:${route.registration || route.page_type}`;
}

function hasResolvedVehicleData(context) {
  const pricing = context?.vehicle?.pricing || {};
  return Boolean(
    clean(context?.vehicle?.title, 200)
    || clean(pricing.finance_monthly, 160)
    || clean(pricing.finance_retail_vat, 160)
    || clean(pricing.rent2buy_monthly, 160)
    || clean(pricing.rent2buy_initial, 160)
    || context?.vehicle?.term_months
  );
}

export function clearPublicWixVehicleContextCache() {
  vehicleCache.clear();
}

async function resolveFromPublicPage(route, fetchImpl) {
  try {
    const pageContext = await queryPublicVehiclePage(route, fetchImpl);
    if (pageContext && hasResolvedVehicleData(pageContext)) return pageContext;
  } catch (error) {
    console.warn("PUBLIC VEHICLE PAGE CONTEXT LOOKUP FAILED", {
      site_host: route.site_host,
      registration: route.registration,
      message: clean(error?.message, 500),
    });
  }
  return null;
}

export async function resolvePublicWixPageContext(pageUrl, { environment = process.env, fetchImpl = fetch } = {}) {
  const route = inferPublicWixPageContext(pageUrl);
  if (!route.collection_id || !route.registration) return fallbackContext(route);

  const key = cacheKey(route);
  const cached = vehicleCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.context;

  // The separate Rent2Buy site is intentionally self-contained. Its trusted public vehicle page is the
  // first source so no second Wix site ID/API key is required just to install the assistant.
  if (route.public_page_first) {
    const publicContext = await resolveFromPublicPage(route, fetchImpl);
    if (publicContext) {
      vehicleCache.set(key, { context: publicContext, expiresAt: Date.now() + VEHICLE_CACHE_TTL_MS });
      return publicContext;
    }
  }

  const configuration = wixReadConfiguration(environment);
  if (configuration) {
    try {
      const item = await queryVehicleItem({
        collectionId: route.collection_id,
        registration: route.registration,
        configuration,
        fetchImpl,
      });
      if (item) {
        const context = mapVehicleContext(route, item);
        if (hasResolvedVehicleData(context)) {
          vehicleCache.set(key, { context, expiresAt: Date.now() + VEHICLE_CACHE_TTL_MS });
          return context;
        }
      }
    } catch (error) {
      console.warn("PUBLIC WIX VEHICLE CONTEXT LOOKUP FAILED", {
        collection_id: route.collection_id,
        registration: route.registration,
        message: clean(error?.message, 500),
      });
    }
  }

  if (!route.public_page_first) {
    const publicContext = await resolveFromPublicPage(route, fetchImpl);
    if (publicContext) {
      vehicleCache.set(key, { context: publicContext, expiresAt: Date.now() + VEHICLE_CACHE_TTL_MS });
      return publicContext;
    }
  }

  // Do not cache the identity-only fallback. A later request should be able to recover from a transient lookup failure.
  return fallbackContext(route);
}

export const PUBLIC_WIX_VEHICLE_COLLECTIONS = Object.freeze({
  finance: FINANCE_VEHICLE_COLLECTION_ID,
  rent2buy: RENT2BUY_VEHICLE_COLLECTION_ID,
});

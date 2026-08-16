const DEFAULT_WIX_API_BASE_URL = "https://www.wixapis.com";
const FINANCE_VEHICLE_COLLECTION_ID = "VANFINANCEPAGES";
const RENT2BUY_VEHICLE_COLLECTION_ID = "VANPAGES";
const VEHICLE_CACHE_TTL_MS = 5 * 60 * 1000;
const VFC_SITE_HOSTS = new Set(["vanfinancecompany.co.uk", "www.vanfinancecompany.co.uk"]);
const RENT2BUY_SITE_HOSTS = new Set(["rent2buyvans.co.uk", "www.rent2buyvans.co.uk"]);
const SITE_HOSTS = new Set([...VFC_SITE_HOSTS, ...RENT2BUY_SITE_HOSTS]);
const vehicleCache = new Map();
const PUBLIC_SPECIFICATION_LABELS = Object.freeze([
  ["REGISTRATION", "REGISTRATION"],
  ["YEAR", "YEAR"],
  ["MILEAGE", "MILEAGE"],
  ["MILLAGE", "MILEAGE"],
  ["EURO", "EURO"],
  ["ENGINE SIZE", "ENGINE SIZE"],
  ["FUEL TYPE", "FUEL TYPE"],
  ["COLOUR", "COLOUR"],
  ["COLOR", "COLOR"],
  ["TRANSMISSION", "TRANSMISSION"],
  ["BHP", "BHP"],
  ["MPG", "MPG"],
]);

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
        public_page_first: false,
      };
    }
    return {
      page_type: "rent2buy_general",
      product: "rent2buy",
      collection_id: null,
      registration: null,
      page_url: url.href,
      site_host: host,
      public_page_first: false,
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
  const normalisedRegistration = compactRegistration(registration);
  const candidates = registrationCandidates(registration);
  for (const [candidateIndex, candidate] of candidates.entries()) {
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
    const items = Array.isArray(payload.dataItems) ? payload.dataItems : [];
    const item = items.find((entry) => compactRegistration(entry?.data?.title) === normalisedRegistration) || null;
    if (item?.data) return item;
    if (items.length) {
      console.warn("PUBLIC WIX VEHICLE CONTEXT REGISTRATION MISMATCH", {
        collection_id: collectionId,
        registration: normalisedRegistration,
        wix_status: response.status,
        item_count: items.length,
        lookup_candidate: candidateIndex === 0 ? "compact" : "display_spaced",
      });
    }
  }
  console.info("PUBLIC WIX VEHICLE CONTEXT NOT FOUND", {
    collection_id: collectionId,
    registration: normalisedRegistration,
    lookup_candidates: candidates.length,
  });
  return null;
}

function mapVehicleContext(route, item) {
  const data = item?.data || {};
  const registration = compactRegistration(data.title || route.registration) || route.registration;
  const identity = {
    registration: registration || null,
    vehicle_id: clean(item?.id, 100) || null,
    title: clean(data.titleText, 200) || null,
    year: clean(data.year, 80) || null,
  };

  if (route.collection_id === FINANCE_VEHICLE_COLLECTION_ID) {
    return {
      page_type: "finance_vehicle",
      vehicle: {
        ...identity,
        description: clean(data.vehicleDescriptionTextClick || data.descriptionLine, 7000) || null,
        highlights: clean(data.descriptionLine, 2000) || null,
        specification: clean(data.vehicleSpecificationText, 7000) || null,
        apply_link: clean(data.applyLink, 1000) || null,
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
        description: clean(data.descriptionText, 7000) || null,
        highlights: clean(data.vehcleTickDescription, 7000) || null,
        specification: clean(data.specText, 7000) || null,
        apply_link: clean(data.applyLink, 1000) || null,
        pricing: {
          rent2buy_monthly: data.monthlyPayments ?? null,
          rent2buy_initial: data.intialRentalCharge ?? null,
        },
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
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function htmlHeadingText(html) {
  return [...String(html || "").matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)]
    .map((match) => htmlToVisibleText(match[1]))
    .filter(Boolean);
}

function publicVehicleSummary(headings = []) {
  for (let index = 0; index < headings.length - 2; index += 1) {
    if (!/^(?:19|20)\d{2}\/\d{2}$/.test(headings[index + 1])) continue;
    if (!/^£\s*\d/.test(headings[index + 2])) continue;
    const title = clean(headings[index], 200);
    if (title && !/^VAN FINANCE COMPANY$/i.test(title)) {
      return { title, year: headings[index + 1] };
    }
  }
  return { title: null, year: null };
}

function publicSpecification(headings = [], registration = "") {
  const normalisedRegistration = compactRegistration(registration);
  const sourceIndex = headings.findIndex((heading) => {
    if (!/\bREGISTRATION\s*:/i.test(heading)) return false;
    const match = heading.match(/\bREGISTRATION\s*:\s*([A-Z0-9 ]{5,10}?)(?=\s+(?:YEAR|MILEAGE|MILLAGE)\s*:|$)/i);
    return compactRegistration(match?.[1]) === normalisedRegistration;
  });
  if (sourceIndex < 0) return { specification: null, description: null, highlights: null, year: null };

  const source = headings[sourceIndex];
  const labelAlternation = PUBLIC_SPECIFICATION_LABELS
    .map(([label]) => label.replace(/ /g, "\\s+"))
    .join("|");
  const fields = [];
  let year = null;
  for (const [sourceLabel, targetLabel] of PUBLIC_SPECIFICATION_LABELS) {
    const match = source.match(new RegExp(
      `\\b${sourceLabel.replace(/ /g, "\\s+")}\\s*:\\s*(.+?)(?=\\s+(?:${labelAlternation})\\s*:|$)`,
      "i",
    ));
    if (!match?.[1]) continue;
    const value = clean(match[1], 160).replace(/\s+/g, " ");
    if (!value) continue;
    if (targetLabel === "YEAR") year = value;
    if (!fields.some((entry) => entry.startsWith(`${targetLabel}:`))) fields.push(`${targetLabel}: ${value}`);
  }

  const description = clean(headings[sourceIndex - 1], 3000) || null;
  const highlightsSource = clean(headings[sourceIndex + 1], 3000);
  const highlights = /^\s*[✓✔✅]/.test(highlightsSource)
    ? clean(highlightsSource.split(/\bALSO INCLUDES\s*:/i)[0], 2000) || null
    : null;
  return {
    specification: fields.length ? fields.join("\n") : null,
    description,
    highlights,
    year,
  };
}

function publicApplyLink(html, pageUrl) {
  for (const match of String(html || "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    if (!/\bAPPLY(?:\s+NOW|\s+FOR|\s+TODAY)?\b/i.test(htmlToVisibleText(match[2]))) continue;
    const href = match[1].match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (!href) continue;
    try {
      const resolved = new URL(decodeHtmlEntities(href), pageUrl);
      if (resolved.protocol === "https:" && SITE_HOSTS.has(resolved.hostname.toLowerCase())) return resolved.href;
    } catch {
      // Ignore malformed or off-site links in public page fallback data.
    }
  }
  return null;
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

function mapPublicPageText(route, text, html = "") {
  if (!pageRegistrationMatches(text, route.registration)) return null;

  const headings = htmlHeadingText(html);
  const summary = publicVehicleSummary(headings);
  const specification = publicSpecification(headings, route.registration);
  const commonVehicle = {
    registration: route.registration,
    vehicle_id: null,
    title: summary.title,
    year: specification.year || summary.year,
    description: specification.description,
    highlights: specification.highlights,
    specification: specification.specification,
    apply_link: publicApplyLink(html, route.page_url),
  };

  if (route.collection_id === FINANCE_VEHICLE_COLLECTION_ID) {
    const retail = priceText(text.match(/(£\s*\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?\s*\+?\s*VAT)/i));
    const monthly = priceText(text.match(/FINANCE\s+FROM\s+ONLY[\s\S]{0,100}?(£\s*\d{1,4}(?:,\d{3})*(?:\.\d{1,2})?)/i));
    return {
      page_type: "finance_vehicle",
      vehicle: {
        ...commonVehicle,
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
    return {
      page_type: "rent2buy_general",
      vehicle: {
        ...commonVehicle,
        pricing: {
          rent2buy_monthly: monthly,
          rent2buy_initial: initial,
        },
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
  return mapPublicPageText(route, htmlToVisibleText(html), html);
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
    },
  };
}

function cacheKey(route) {
  return `${route.site_host || "site"}:${route.collection_id || "general"}:${route.registration || route.page_type}`;
}

function hasResolvedVehicleData(context) {
  const vehicle = context?.vehicle || {};
  const pricing = vehicle.pricing || {};
  return Boolean(
    clean(vehicle.title, 200)
    || clean(vehicle.description, 500)
    || clean(vehicle.highlights, 500)
    || clean(vehicle.specification, 500)
    || clean(pricing.finance_monthly, 160)
    || clean(pricing.finance_retail_vat, 160)
    || clean(pricing.rent2buy_monthly, 160)
    || clean(pricing.rent2buy_initial, 160)
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

  // Both VFC and Rent2Buy vehicle collections are available through the configured Wix site data.
  // CMS is the authoritative source because it contains the complete description/specification, not just visible HTML.
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
  } else {
    console.warn("PUBLIC WIX VEHICLE CONTEXT CONFIGURATION INCOMPLETE", {
      collection_id: route.collection_id,
      registration: route.registration,
      wix_api_key_configured: Boolean(clean(environment.WIX_API_KEY, 10000)),
      wix_site_id_configured: Boolean(clean(environment.WIX_SITE_ID, 500)),
    });
  }

  // The trusted public vehicle page is a resilience fallback when Wix Data is unavailable or misconfigured.
  // It is still registration-bound and only exposes bounded fields visibly rendered by Wix for this stock item.
  const publicContext = await resolveFromPublicPage(route, fetchImpl);
  if (publicContext) {
    vehicleCache.set(key, { context: publicContext, expiresAt: Date.now() + VEHICLE_CACHE_TTL_MS });
    return publicContext;
  }

  // Do not cache the identity-only fallback. A later request should be able to recover from a transient lookup failure.
  return fallbackContext(route);
}

export const PUBLIC_WIX_VEHICLE_COLLECTIONS = Object.freeze({
  finance: FINANCE_VEHICLE_COLLECTION_ID,
  rent2buy: RENT2BUY_VEHICLE_COLLECTION_ID,
});

import { supabase } from "./supabase.js";
import { fetchFinanceMarketingVehicles, fetchRentMarketingVehicles } from "./marketingVehicles.js";

const WATCH_TABLE = "vansco_stock_watch";
const VAN_SCO_SOURCE_URL = "https://www.vansco.co.uk/all-stock/";
const VAN_SCO_REQUEST_TIMEOUT_MS = 58000;
const PRICE_PATTERN = /(?:\u00A3|&pound;)\s?[0-9][0-9,]*/i;
const YEAR_PATTERN = /\b(20\d{2}|19\d{2})\b/;
const MILEAGE_PATTERN = /\b([0-9][0-9,]{1,})\s*(?:miles|mile|mi)\b/i;
const REGISTRATION_PATTERN =
  /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/i;
const INVALID_REGISTRATION_VALUES = new Set([
  "VANSCO",
  "VANSCOLTD",
  "ALLSTOCK",
  "HOMESTOCK",
  "UNKNOWN",
  "NOTFOUND",
  "NULL",
  "UNDEFINED",
  "NA",
  "N/A",
]);

const PIPELINE_CONFIG = {
  finance: {
    label: "Finance Vans",
    badge: "Finance Vans",
    localSource: "facebook_adverts",
  },
  rent2buy: {
    label: "Rent2Buy Vans",
    badge: "Rent2Buy Vans",
    localSource: "rent_vehicles",
  },
  cars: {
    label: "Cars",
    badge: "Cars",
    localSource: "cars",
  },
};

export const CARS_TABLE_CANDIDATES = ["cars_stock", "car_stock", "cars", "car_vehicles"];

export const WATCH_PIPELINES = [
  { value: "finance", label: "Finance Vans" },
  { value: "rent2buy", label: "Rent2Buy Vans" },
  { value: "cars", label: "Cars" },
];

export const WORKFLOW_OPTIONS = [
  { value: "new", label: "New" },
  { value: "review_later", label: "Review Later" },
  { value: "added_to_crm", label: "Added to CRM" },
  { value: "added_to_wix", label: "Added to Wix" },
  { value: "removed_from_crm", label: "Removed from CRM" },
  { value: "removed_from_wix", label: "Removed from Wix" },
  { value: "keep_listed", label: "Keep Listed" },
  { value: "not_listing_mileage", label: "Not Listing - Mileage" },
  { value: "not_listing_price", label: "Not Listing - Price" },
  { value: "not_listing_spec", label: "Not Listing - Spec" },
  { value: "ignored", label: "Ignored" },
];

export const WATCH_FILTERS = [
  { value: "missing", label: "Missing from my stock" },
  { value: "listed", label: "Already listed" },
  { value: "needs_review", label: "Needs Review" },
  { value: "no_longer_on_vansco", label: "No longer on Vansco - high confidence only" },
  { value: "reserved_still_listed", label: "Reserved on Vansco" },
  { value: "new", label: "New" },
  { value: "review_later", label: "Review Later" },
  { value: "added_to_crm", label: "Added to CRM" },
  { value: "added_to_wix", label: "Added to Wix" },
  { value: "removed_from_crm", label: "Removed from CRM" },
  { value: "removed_from_wix", label: "Removed from Wix" },
  { value: "not_listing_or_ignored", label: "Not Listing / Ignored" },
  { value: "all", label: "All" },
];

export const DETAIL_FETCH_PRESETS = [
  { value: "fast", label: "Fast check (review-only)", limit: 100 },
  { value: "standard", label: "Standard check", limit: 100 },
  { value: "full", label: "Full check", limit: 0 },
];

export function pipelineLabel(pipeline) {
  return PIPELINE_CONFIG[pipeline]?.label || pipeline;
}

export function workflowLabel(workflowStatus) {
  return WORKFLOW_OPTIONS.find((option) => option.value === workflowStatus)?.label || "New";
}

export function matchStatusLabel(matchStatus) {
  switch (matchStatus) {
    case "listed":
      return "Already listed";
    case "needs_review":
      return "Needs Review";
    case "no_longer_on_vansco":
      return "No longer on Vansco - high confidence only";
    case "reserved_still_listed":
      return "Reserved on Vansco but still listed by me";
    case "missing":
    default:
      return "Missing from my stock";
  }
}

export function sourceStatusLabel(sourceStatus) {
  switch (sourceStatus) {
    case "reserved":
      return "Reserved";
    case "sold":
      return "Sold";
    case "deposit_taken":
      return "Deposit Taken";
    case "available":
      return "Available";
    default:
      return "Unknown";
  }
}

export function isSuppressedWorkflowStatus(workflowStatus) {
  return workflowStatus === "ignored" || workflowStatus?.startsWith("not_listing_");
}

export function formatWatchTimestamp(value) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function compactWhitespace(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function cleanOptionalText(value) {
  const text = compactWhitespace(value);
  return text || null;
}

function isUuid(value) {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function cleanTimestamp(value) {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString();
}

function cleanWatchRecordPayload(payload) {
  const cleaned = { ...payload };

  if ("id" in cleaned) {
    if (isUuid(cleaned.id)) {
      cleaned.id = cleaned.id;
    } else {
      delete cleaned.id;
    }
  }

  const timestampFields = ["first_seen_at", "last_seen_at", "last_checked_at", "created_at", "updated_at"];
  timestampFields.forEach((field) => {
    if (!(field in cleaned)) return;

    const nextValue = cleanTimestamp(cleaned[field]);
    if (nextValue) {
      cleaned[field] = nextValue;
    } else {
      delete cleaned[field];
    }
  });

  ["title", "registration", "image_url", "stock_url", "price", "mileage", "year", "vehicle_category", "notes"].forEach(
    (field) => {
      if (!(field in cleaned)) return;
      if (field === "stock_url") {
        cleaned[field] = compactWhitespace(cleaned[field]) || VAN_SCO_SOURCE_URL;
        return;
      }

      const nextValue = cleanOptionalText(cleaned[field]);
      if (nextValue === null) {
        delete cleaned[field];
      } else {
        cleaned[field] = nextValue;
      }
    }
  );

  return cleaned;
}

function convertStoredImage(value) {
  const text = compactWhitespace(value);
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;

  const wixMatch = text.match(/wix:image:\/\/v1\/([^/]+)/i);
  if (wixMatch) {
    return `https://static.wixstatic.com/media/${wixMatch[1]}`;
  }

  return text;
}

function normalizeText(value) {
  return compactWhitespace(value).toLowerCase();
}

function normalizeRegistration(value) {
  const text = compactWhitespace(value).toUpperCase();
  if (!text) return "";
  const cleaned = text.replace(/[^A-Z0-9]/g, "");
  if (!cleaned || cleaned.length < 5 || cleaned.length > 8) return "";
  if (!/[A-Z]/.test(cleaned) || !/[0-9]/.test(cleaned)) return "";
  if (INVALID_REGISTRATION_VALUES.has(cleaned)) return "";
  const match = cleaned.match(REGISTRATION_PATTERN);
  const candidate = (match?.[1] || cleaned).replace(/[^A-Z0-9]/g, "");
  if (!candidate || candidate.length < 5 || candidate.length > 8) return "";
  if (!/[A-Z]/.test(candidate) || !/[0-9]/.test(candidate)) return "";
  if (INVALID_REGISTRATION_VALUES.has(candidate)) return "";
  return candidate;
}

function normalizeUrl(value) {
  const text = compactWhitespace(value);
  if (!text) return "";

  try {
    const url = new URL(text, VAN_SCO_SOURCE_URL);
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((key) =>
      url.searchParams.delete(key)
    );
    const normalized = url.toString().replace(/\/$/, "");
    return normalized;
  } catch {
    return text.replace(/\/$/, "");
  }
}

function digitsOnly(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function normalizeYear(value) {
  const match = compactWhitespace(value).match(YEAR_PATTERN);
  return match?.[1] || "";
}

function normalizeMileage(value) {
  const match = compactWhitespace(value).match(MILEAGE_PATTERN);
  return digitsOnly(match?.[1] || value);
}

function extractPrice(value) {
  return compactWhitespace(value).match(PRICE_PATTERN)?.[0] || "";
}

function detectSourceStatus(text) {
  const normalized = compactWhitespace(text);
  if (!normalized) return "unknown";
  if (/deposit taken/i.test(normalized)) return "deposit_taken";
  if (/reserved/i.test(normalized)) return "reserved";
  if (/\bsold\b/i.test(normalized)) return "sold";
  if (/\bavailable\b/i.test(normalized)) return "available";
  return "unknown";
}

function isReservedLikeSourceStatus(sourceStatus) {
  return ["reserved", "sold", "deposit_taken"].includes(sourceStatus);
}

function detectVehicleCategory({ text, href }) {
  const haystack = `${compactWhitespace(text)} ${compactWhitespace(href)}`.toLowerCase();
  if (/\bcar(s)?\b/.test(haystack)) return "car";
  if (/\bvan(s)?\b/.test(haystack)) return "van";
  return "unknown";
}

function normalizeImageUrl(value) {
  return normalizeUrl(value);
}

function buildMetaKeyParts(vehicle) {
  if (!isStrongVehicleTitle(vehicle.title)) return [];
  const title = normalizeText(vehicle.title);
  const year = normalizeYear(vehicle.year);
  const mileage = normalizeMileage(vehicle.mileage);
  if (!year && !mileage) return [];
  return [title, year, mileage].filter(Boolean);
}

function deriveVehicleKey(vehicle, fallbackSeed = "") {
  const registration = normalizeRegistration(vehicle.registration || vehicle.reg || "");
  if (registration) return `reg:${registration}`;

  const stockUrl = normalizeUrl(vehicle.stockUrl || vehicle.weblink || vehicle.webLink || vehicle.link);
  if (stockUrl) return `url:${stockUrl}`;

  const metaParts = buildMetaKeyParts(vehicle);
  if (metaParts.length) return `meta:${metaParts.join("|")}`;

  const fallback = normalizeText(vehicle.title || fallbackSeed || "vehicle");
  return `fallback:${fallback || "vehicle"}`;
}

function isStrongVehicleTitle(value) {
  const text = compactWhitespace(value);
  if (!text || text.length < 18) return false;
  const words = text.split(/\s+/).filter(Boolean);
  return words.length >= 3;
}

function hasValidRegistration(vehicle) {
  return Boolean(normalizeRegistration(vehicle?.registration));
}

function computeRegistrationConfidence({
  sourceVehicles,
  detailPagesFailed,
  detailFetchLimitApplied,
  detailFetchMode,
  partialScan,
  parserWarnings,
}) {
  const validRegistrations = sourceVehicles.filter((vehicle) => hasValidRegistration(vehicle)).length;
  const totalVehicles = sourceVehicles.length;
  const registrationCoverage = totalVehicles ? validRegistrations / totalVehicles : 0;
  const detailLimitHit =
    detailFetchMode !== "full" && detailFetchLimitApplied > 0 && totalVehicles >= detailFetchLimitApplied;
  const scanComplete =
    !partialScan &&
    !detailPagesFailed &&
    !detailLimitHit &&
    !(parserWarnings || []).some((warning) => /limited to|timeout|fewer than 10|partial scan/i.test(warning));
  const highConfidence = scanComplete && validRegistrations >= 25 && registrationCoverage >= 0.8;

  return {
    validRegistrations,
    totalVehicles,
    registrationCoverage,
    scanComplete,
    registrationConfidence: highConfidence ? "high" : "low",
    highConfidence,
  };
}

function vehicleCompletenessScore(vehicle) {
  return [
    vehicle.registration ? 5 : 0,
    vehicle.imageUrl ? 3 : 0,
    vehicle.stockUrl ? 3 : 0,
    compactWhitespace(vehicle.title).length,
    vehicle.price ? 1 : 0,
    vehicle.mileage ? 1 : 0,
    vehicle.year ? 1 : 0,
  ].reduce((total, value) => total + value, 0);
}

function chooseBetterVehicleRecord(currentVehicle, nextVehicle) {
  return vehicleCompletenessScore(nextVehicle) > vehicleCompletenessScore(currentVehicle)
    ? { ...currentVehicle, ...nextVehicle }
    : { ...nextVehicle, ...currentVehicle };
}

function buildVehicleLookup(vehicles) {
  const byRegistration = new Map();

  vehicles.forEach((vehicle) => {
    const registration = normalizeRegistration(vehicle.registration);
    if (registration) byRegistration.set(registration, vehicle);
  });

  return {
    byRegistration,
  };
}

function findMatchingLocalVehicle(sourceVehicle, lookup) {
  const registration = normalizeRegistration(sourceVehicle.registration);
  if (registration && lookup.byRegistration.has(registration)) {
    return {
      vehicle: lookup.byRegistration.get(registration),
      method: "registration",
    };
  }

  return {
    vehicle: null,
    method: "none",
  };
}

function isPotentialVehicleLink(url) {
  const value = normalizeUrl(url);
  if (!value) return false;

  const lower = value.toLowerCase();
  if (!/^https?:\/\//.test(lower)) return false;
  if (!/(vansco\.co\.uk|dragon2000\.net)/.test(lower)) return false;

  const blocked = [
    "/all-stock",
    "/used-vans",
    "/used-cars",
    "/no-vat-vans",
    "/finance",
    "/warranty",
    "/insurance",
    "/reviews",
    "/part-exchange",
    "/sell-your-vehicle",
    "/contact",
    "/privacy-policy",
    "/cookies",
    "/complaints",
    "/sitemap",
    "api.whatsapp.com",
    "facebook.com",
    "twitter.com",
    "instagram.com",
    "youtube.com",
  ];

  return !blocked.some((fragment) => lower.includes(fragment));
}

function findVehicleContainer(anchor) {
  let current = anchor;

  for (let depth = 0; current && depth < 7; depth += 1) {
    const text = compactWhitespace(current.textContent);
    const hasImage = Boolean(current.querySelector?.("img"));

    if (
      text.length >= 24 &&
      text.length <= 900 &&
      (hasImage || PRICE_PATTERN.test(text) || MILEAGE_PATTERN.test(text) || YEAR_PATTERN.test(text))
    ) {
      return current;
    }

    current = current.parentElement;
  }

  return anchor.parentElement || anchor;
}

function pickVehicleTitle(container, anchor, fallbackHref) {
  const headingText = compactWhitespace(
    container.querySelector?.("h1, h2, h3, h4, h5, h6, strong, .vehicle-title, .stock-title")?.textContent
  );
  if (headingText && headingText.length > 4) return headingText;

  const anchorText = compactWhitespace(anchor.textContent);
  if (anchorText && anchorText.length > 4 && !PRICE_PATTERN.test(anchorText)) return anchorText;

  const lines = compactWhitespace(container.textContent)
    .split(/(?=[A-Z][a-z])|(?=\u00A3)|(?=\d{4})/)
    .map((line) => compactWhitespace(line))
    .filter(Boolean);

  const candidate = lines.find(
    (line) =>
      line.length > 6 &&
      !PRICE_PATTERN.test(line) &&
      !/or from p\/m|view more|prev|next|finance/i.test(line)
  );

  if (candidate) return candidate;

  const hrefName = normalizeUrl(fallbackHref).split("/").pop()?.replace(/[-_]+/g, " ");
  return hrefName || "Vansco vehicle";
}

function extractJsonLdVehicleCandidates(document) {
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  const candidates = [];

  function visit(node) {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    if (typeof node !== "object") return;

    const title = compactWhitespace(
      node.name ||
      node.headline ||
      node.vehicleModel ||
      node.alternateName ||
      ""
    );
    const stockUrl = normalizeUrl(node.url || node.mainEntityOfPage || "");
    const imageUrl = normalizeImageUrl(
      Array.isArray(node.image) ? node.image[0] : node.image?.url || node.image || ""
    );
    const price = compactWhitespace(node.offers?.priceCurrency && node.offers?.price
      ? `${node.offers.priceCurrency === "GBP" ? "£" : `${node.offers.priceCurrency} `}${node.offers.price}`
      : node.offers?.price || "");
    const mileage = compactWhitespace(
      node.mileageFromOdometer?.value || node.vehicleMileage || node.mileage || ""
    );
    const year = normalizeYear(node.vehicleModelDate || node.modelDate || node.productionDate || title);
    const registration = normalizeRegistration(
      node.identifier?.value || node.sku || node.registration || title
    );

    if (title && stockUrl) {
      candidates.push({
        title,
        stockUrl,
        imageUrl,
        price,
        mileage,
        year,
        registration,
        sourceStatus: detectSourceStatus(JSON.stringify(node)),
        vehicleCategory: detectVehicleCategory({ text: JSON.stringify(node), href: stockUrl }),
      });
    }

    Object.values(node).forEach(visit);
  }

  scripts.forEach((script) => {
    const raw = script.textContent?.trim();
    if (!raw) return;

    try {
      visit(JSON.parse(raw));
    } catch {
      // Ignore malformed script blocks from the source page.
    }
  });

  return candidates;
}

function dedupeSourceVehicles(vehicles) {
  const deduped = new Map();

  vehicles.forEach((vehicle) => {
    const key = vehicle.vehicleKey;
    if (!key) return;

    if (!deduped.has(key)) {
      deduped.set(key, vehicle);
      return;
    }

    deduped.set(key, chooseBetterVehicleRecord(deduped.get(key), vehicle));
  });

  return {
    vehicles: Array.from(deduped.values()),
    duplicateCount: Math.max(0, vehicles.length - deduped.size),
  };
}

function dedupeWatchRecords(records) {
  const deduped = new Map();

  records.forEach((record) => {
    const dedupeKey = `${record.pipeline}::${record.vehicle_key}`;
    if (!deduped.has(dedupeKey)) {
      deduped.set(dedupeKey, record);
      return;
    }

    const existing = deduped.get(dedupeKey);
    const mergedVehicle = chooseBetterVehicleRecord(
      {
        title: existing.title,
        registration: existing.registration,
        imageUrl: existing.image_url,
        stockUrl: existing.stock_url,
        price: existing.price,
        mileage: existing.mileage,
        year: existing.year,
      },
      {
        title: record.title,
        registration: record.registration,
        imageUrl: record.image_url,
        stockUrl: record.stock_url,
        price: record.price,
        mileage: record.mileage,
        year: record.year,
      }
    );

    deduped.set(dedupeKey, {
      ...existing,
      ...record,
      title: mergedVehicle.title || existing.title || record.title,
      registration: mergedVehicle.registration || existing.registration || record.registration,
      image_url: mergedVehicle.imageUrl || existing.image_url || record.image_url,
      stock_url: mergedVehicle.stockUrl || existing.stock_url || record.stock_url,
      price: mergedVehicle.price || existing.price || record.price,
      mileage: mergedVehicle.mileage || existing.mileage || record.mileage,
      year: mergedVehicle.year || existing.year || record.year,
      notes: existing.notes || record.notes || null,
      first_seen_at: existing.first_seen_at || record.first_seen_at,
      last_seen_at: record.last_seen_at || existing.last_seen_at,
      last_checked_at: record.last_checked_at || existing.last_checked_at,
    });
  });

  return {
    records: Array.from(deduped.values()),
    duplicateCount: Math.max(0, records.length - deduped.size),
  };
}

function parseVehicleCardsFromHtml(html) {
  if (typeof DOMParser === "undefined") {
    throw new Error("DOMParser is not available in this browser.");
  }

  const document = new DOMParser().parseFromString(html, "text/html");
  const anchors = Array.from(document.querySelectorAll("a[href]"));
  const htmlLength = String(html || "").length;
  const discoveredVehicles = [];
  const parserWarnings = [];

  anchors.forEach((anchor) => {
    const href = normalizeUrl(anchor.getAttribute("href"));
    if (!isPotentialVehicleLink(href)) return;

    const container = findVehicleContainer(anchor);
    if (!container) return;

    const text = compactWhitespace(container.textContent || anchor.textContent);
    if (!text || text.length < 24) return;

    const title = pickVehicleTitle(container, anchor, href);
    const imageUrl = normalizeUrl(
      container.querySelector("img")?.getAttribute("src") ||
        container.querySelector("img")?.getAttribute("data-src") ||
        anchor.querySelector("img")?.getAttribute("src") ||
        ""
    );

    const price = extractPrice(text);
    const mileage = compactWhitespace(text.match(MILEAGE_PATTERN)?.[0] || "");
    const year = normalizeYear(text);
    const registration = normalizeRegistration(text);
    const sourceStatus = detectSourceStatus(text);
    const vehicleCategory = detectVehicleCategory({ text, href });
    const vehicleKey = deriveVehicleKey(
      {
        title,
        registration,
        stockUrl: href,
        year,
        mileage,
      },
      href
    );

    discoveredVehicles.push({
      vehicleKey,
      title,
      registration,
      imageUrl,
      stockUrl: href,
      price,
      mileage,
      year,
      sourceStatus,
      vehicleCategory,
    });
  });

  extractJsonLdVehicleCandidates(document).forEach((candidate) => {
    discoveredVehicles.push({
      ...candidate,
      vehicleKey: deriveVehicleKey(candidate, candidate.stockUrl || candidate.title),
    });
  });

  const deduped = dedupeSourceVehicles(discoveredVehicles);

  if (!deduped.vehicles.length) {
    parserWarnings.push("No vehicles found in Vansco HTML. Site may require JS-rendered scraping or a feed.");
  }

  return {
    vehicles: deduped.vehicles,
    parserWarnings,
    htmlLength,
    duplicateCount: deduped.duplicateCount,
  };
}

function filterSourceVehiclesForPipeline(vehicles, pipeline) {
  if (pipeline === "cars") {
    return vehicles.filter((vehicle) => vehicle.vehicleCategory === "car");
  }

  return vehicles.filter((vehicle) => vehicle.vehicleCategory !== "car");
}

function mapFinanceVehicleRow(row, index) {
  const title = compactWhitespace(row.title || `Finance vehicle ${index + 1}`);
  const registration = normalizeRegistration(row.title);
  return {
    vehicleKey: deriveVehicleKey({
      title,
      registration,
      stockUrl: row.weblink || "",
      price: row.price || "",
    }, title),
    title,
    registration,
    imageUrl: convertStoredImage(row.picture),
    stockUrl: row.weblink || "",
    price: row.price || "",
    mileage: "",
    year: normalizeYear(row.title),
    vehicleCategory: "van",
  };
}

function mapRentVehicleRow(row, index) {
  const registration = normalizeRegistration(row.registration || `Rent2Buy vehicle ${index + 1}`);
  const title = compactWhitespace(row.registration || `Rent2Buy vehicle ${index + 1}`);
  return {
    vehicleKey: deriveVehicleKey({
      title,
      registration,
      stockUrl: row.webLink || "",
      price: row.initialRental || row.monthly || "",
    }, title),
    title,
    registration,
    imageUrl: convertStoredImage(row.picture),
    stockUrl: row.webLink || "",
    price: row.initialRental || row.monthly || "",
    mileage: "",
    year: "",
    vehicleCategory: "van",
  };
}

function mapCarsVehicleRow(row, index) {
  const title = compactWhitespace(
    row.title ||
      row.name ||
      row.vehicle_title ||
      row.registration ||
      `Car vehicle ${index + 1}`
  );
  const registration = normalizeRegistration(row.registration || row.reg || title);
  const imageUrl = convertStoredImage(row.picture || row.image || row.image_url || "");
  const stockUrl = row.weblink || row.webLink || row.stock_url || row.link || "";
  const mileage = compactWhitespace(row.mileage || row.miles || row.odometer || "");
  const year = normalizeYear(row.year || title || row.description || "");

  return {
    vehicleKey: deriveVehicleKey(
      {
        title,
        registration,
        stockUrl,
        price: row.price || "",
        mileage,
        year,
      },
      title
    ),
    title,
    registration,
    imageUrl,
    stockUrl,
    price: compactWhitespace(row.price || row.salePrice || ""),
    mileage,
    year,
    vehicleCategory: "car",
  };
}

async function fetchFinanceStockGroup() {
  const vehicles = await fetchFinanceMarketingVehicles(120);
  return vehicles.map((vehicle) => ({
    vehicleKey: deriveVehicleKey(
      {
        title: vehicle.title,
        registration: vehicle.reg,
        stockUrl: vehicle.weblink || vehicle.link || "",
        price: vehicle.price || "",
      },
      vehicle.title
    ),
    title: compactWhitespace(vehicle.title || ""),
    registration: normalizeRegistration(vehicle.reg || ""),
    rawRegistration: compactWhitespace(vehicle.reg || ""),
    imageUrl: convertStoredImage(vehicle.picture || vehicle.image || ""),
    stockUrl: vehicle.weblink || vehicle.link || "",
    price: vehicle.price || "",
    mileage: "",
    year: normalizeYear(vehicle.title || ""),
    vehicleCategory: "van",
  }));
}

async function fetchRent2BuyStockGroup() {
  const vehicles = await fetchRentMarketingVehicles(120);
  return vehicles.map((vehicle) => ({
    vehicleKey: deriveVehicleKey(
      {
        title: vehicle.title,
        registration: vehicle.reg,
        stockUrl: vehicle.weblink || vehicle.link || "",
        price: vehicle.initialRental || vehicle.monthly || "",
      },
      vehicle.title
    ),
    title: compactWhitespace(vehicle.title || ""),
    registration: normalizeRegistration(vehicle.reg || ""),
    rawRegistration: compactWhitespace(vehicle.reg || ""),
    imageUrl: convertStoredImage(vehicle.picture || vehicle.image || ""),
    stockUrl: vehicle.weblink || vehicle.link || "",
    price: vehicle.initialRental || vehicle.monthly || "",
    mileage: "",
    year: "",
    vehicleCategory: "van",
  }));
}

async function fetchCarsStockGroup() {
  let lastError = null;

  for (const tableName of CARS_TABLE_CANDIDATES) {
    const { data, error } = await supabase.from(tableName).select("*").limit(2000);

    if (error) {
      lastError = error;
      continue;
    }

    const activeRows = (data || []).filter((row) => row.is_active !== false);
    return {
      rows: activeRows.map(mapCarsVehicleRow),
      sourceTable: tableName,
    };
  }

  return {
    rows: [],
    sourceTable: null,
    warning: "Cars stock table is not configured yet.",
    errorMessage: lastError?.message || "Cars stock table was not found.",
  };
}

async function fetchLocalStockGroup(pipeline) {
  if (pipeline === "finance") {
    return {
      vehicles: await fetchFinanceStockGroup(),
      sourceTable: PIPELINE_CONFIG.finance.localSource,
      registrationField: "vehicle.reg (derived from facebook_adverts.title via Stock page mapper)",
    };
  }

  if (pipeline === "rent2buy") {
    return {
      vehicles: await fetchRent2BuyStockGroup(),
      sourceTable: PIPELINE_CONFIG.rent2buy.localSource,
      registrationField: "vehicle.reg (from rent_vehicles.registration via Stock page mapper)",
    };
  }

  return fetchCarsStockGroup().then((result) => ({
    vehicles: result.rows,
    sourceTable: result.sourceTable,
    warning: result.warning || "",
    registrationField: result.sourceTable ? "registration/reg" : "",
  }));
}

function normalizeWatchRecord(row) {
  return {
    id: row.id,
    pipeline: row.pipeline,
    vehicleKey: row.vehicle_key,
    title: row.title || "",
    registration: row.registration || "",
    imageUrl: row.image_url || "",
    stockUrl: row.stock_url || "",
    price: row.price || "",
    mileage: row.mileage || "",
    year: row.year || "",
    vehicleCategory: row.vehicle_category || "",
    sourceStatus: row.source_status || "unknown",
    matchStatus: row.match_status || "missing",
    workflowStatus: row.workflow_status || "new",
    firstSeenAt: row.first_seen_at || row.created_at || "",
    lastSeenAt: row.last_seen_at || "",
    lastCheckedAt: row.last_checked_at || row.updated_at || "",
    notes: row.notes || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

export async function fetchVanscoWatchRecords(pipeline) {
  const { data, error } = await supabase
    .from(WATCH_TABLE)
    .select("*")
    .eq("pipeline", pipeline)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load Vansco Stock Watch data: ${error.message}`);
  }

  return (data || []).map(normalizeWatchRecord);
}

export async function updateVanscoWatchRecord(id, updates) {
  const payload = {};
  if (updates.workflowStatus) payload.workflow_status = updates.workflowStatus;
  if (typeof updates.notes === "string") payload.notes = updates.notes;
  if (updates.matchStatus) payload.match_status = updates.matchStatus;
  if (updates.sourceStatus) payload.source_status = updates.sourceStatus;

  const { data, error } = await supabase
    .from(WATCH_TABLE)
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new Error(`Failed to update Vansco Stock Watch record: ${error.message}`);
  }

  return normalizeWatchRecord(data);
}

async function fetchVanscoSourceBatch(pipeline, options = {}) {
  const params = new URLSearchParams({
    pipeline: String(pipeline || "finance"),
    _: String(Date.now()),
  });

  if (options.detailFetchMode) {
    params.set("detailFetchMode", options.detailFetchMode);
  }
  if (Number.isFinite(options.detailOffset) && options.detailOffset > 0) {
    params.set("detailOffset", String(options.detailOffset));
  }
  if (Number.isFinite(options.detailBatchSize) && options.detailBatchSize > 0) {
    params.set("detailBatchSize", String(options.detailBatchSize));
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), VAN_SCO_REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`/api/vansco-stock?${params.toString()}`, {
      headers: {
        accept: "application/json",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(
        "Vansco Stock Watch timed out before the server responded. Try Fast check or Standard check, or retry Full check later."
      );
      timeoutError.debugInfo = {
        endpointUsed: `/api/vansco-stock?${params.toString()}`,
        requestTimedOut: true,
        requestTimeoutMs: VAN_SCO_REQUEST_TIMEOUT_MS,
        partialScan: true,
        lowConfidenceWarning:
          "Partial Vansco scan. Results are review-only and should not be used for stock decisions.",
      };
      throw timeoutError;
    }

    throw error;
  } finally {
    window.clearTimeout(timeout);
  }

  const text = await response.text();
  let payload = {};

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { message: text };
  }

  if (!response.ok) {
    const error = new Error(payload.message || "Vansco source fetch failed.");
    error.debugInfo = payload.diagnostics || null;
    throw error;
  }

  return payload;
}

function mergeVanscoBatchPayloads(batchPayloads, detailBatchSize) {
  const firstPayload = batchPayloads[0] || {};
  const mergedVehicles = batchPayloads.flatMap((payload) => payload.vehicles || []);
  const parserWarnings = Array.from(
    new Set(batchPayloads.flatMap((payload) => payload.diagnostics?.parserWarnings || []))
  );
  const categoryPageFailures = Array.from(
    new Set(batchPayloads.flatMap((payload) => payload.diagnostics?.categoryPageFailures || []))
  );
  const sampleTitles = mergedVehicles.slice(0, 3).map((vehicle) => vehicle.title).filter(Boolean);
  const sampleRegistrations = mergedVehicles
    .map((vehicle) => normalizeRegistration(vehicle.registration || ""))
    .filter(Boolean)
    .slice(0, 20);

  const totalVehicleUrlsFound = firstPayload.diagnostics?.totalVehicleUrlsFound || mergedVehicles.length;
  const detailPagesFetched = batchPayloads.reduce(
    (total, payload) => total + (payload.diagnostics?.detailPagesFetched || 0),
    0
  );
  const detailPagesFailed = batchPayloads.reduce(
    (total, payload) => total + (payload.diagnostics?.detailPagesFailed || 0),
    0
  );
  const vehiclesWithRegistration = mergedVehicles.filter((vehicle) => normalizeRegistration(vehicle.registration)).length;
  const vehiclesWithImage = mergedVehicles.filter((vehicle) => normalizeUrl(vehicle.imageUrl)).length;
  const vehiclesWithSourceStatus = mergedVehicles.filter(
    (vehicle) => vehicle.sourceStatus && vehicle.sourceStatus !== "unknown"
  ).length;
  const vehiclesWithValidMatchKey = mergedVehicles.filter(
    (vehicle) => normalizeRegistration(vehicle.registration) || normalizeUrl(vehicle.stockUrl)
  ).length;
  const partialScan =
    (firstPayload.diagnostics?.sourceFamily || "unknown") === "sitemap-fallback" ||
    detailPagesFailed > 0 ||
    mergedVehicles.length < totalVehicleUrlsFound;

  return {
    ...firstPayload,
    fetchedAt: new Date().toISOString(),
    vehicles: mergedVehicles,
    hasMore: false,
    diagnostics: {
      ...(firstPayload.diagnostics || {}),
      parserWarnings,
      categoryPageFailures,
      pagesFetched: batchPayloads.reduce((total, payload) => total + (payload.pagesFetched || 0), 0),
      detailPagesFetched,
      detailPagesFailed,
      vehiclesParsed: mergedVehicles.length,
      vehicleDetailUrlsKept: mergedVehicles.length,
      vehiclesEnrichedWithRegistration: vehiclesWithRegistration,
      vehiclesEnrichedWithImage: vehiclesWithImage,
      vehiclesWithSourceStatus,
      vehiclesWithValidMatchKey,
      totalVehicleUrlsFound,
      partialScan,
      detailFetchMode: "full",
      detailFetchLimitApplied: mergedVehicles.length,
      detailBatchSize,
      sampleTitles,
      sampleRegistrations,
      registrationsExtractedFromTitleBrackets: batchPayloads.reduce(
        (total, payload) => total + (payload.diagnostics?.registrationsExtractedFromTitleBrackets || 0),
        0
      ),
      rejectedFakeRegistrationsCount: batchPayloads.reduce(
        (total, payload) => total + (payload.diagnostics?.rejectedFakeRegistrationsCount || 0),
        0
      ),
      sampleRejectedFakeRegistrations: Array.from(
        new Set(batchPayloads.flatMap((payload) => payload.diagnostics?.sampleRejectedFakeRegistrations || []))
      ).slice(0, 20),
    },
  };
}

async function fetchVanscoSourceHtml(pipeline, options = {}) {
  if (options.detailFetchMode !== "full") {
    return fetchVanscoSourceBatch(pipeline, options);
  }

  const detailBatchSize = Math.max(1, Number(options.detailBatchSize || 40));
  const batchPayloads = [];
  let detailOffset = 0;

  while (true) {
    const batchPayload = await fetchVanscoSourceBatch(pipeline, {
      ...options,
      detailOffset,
      detailBatchSize,
    });
    batchPayloads.push(batchPayload);

    const batchCount = (batchPayload.vehicles || []).length;
    if (!batchPayload.hasMore || batchCount === 0) break;
    detailOffset += batchCount;
  }

  return mergeVanscoBatchPayloads(batchPayloads, detailBatchSize);
}

function normalizeApiVehicle(vehicle, fallbackCategory = "unknown") {
  const normalizedStockUrl = normalizeUrl(vehicle.stockUrl || "");
  return {
    vehicleKey: normalizedStockUrl ? `url:${normalizedStockUrl}` : deriveVehicleKey(
      {
        title: vehicle.title,
        registration: vehicle.registration,
        stockUrl: normalizedStockUrl,
        year: vehicle.year,
        mileage: vehicle.mileage,
      },
      normalizedStockUrl || vehicle.title
    ),
    title: compactWhitespace(vehicle.title || ""),
    registration: normalizeRegistration(vehicle.registration || ""),
    imageUrl: normalizeUrl(vehicle.imageUrl || ""),
    stockUrl: normalizedStockUrl,
    price: compactWhitespace(vehicle.price || ""),
    mileage: compactWhitespace(vehicle.mileage || ""),
    year: normalizeYear(vehicle.year || ""),
    sourceStatus: vehicle.sourceStatus || "unknown",
    vehicleCategory: vehicle.vehicleCategory || fallbackCategory,
    sourceCategory: vehicle.sourceCategory || "",
  };
}

function mergeRecordData(base, next) {
  return cleanWatchRecordPayload({
    ...base,
    ...next,
    notes: base.notes || next.notes || null,
    first_seen_at: base.first_seen_at || next.first_seen_at,
  });
}

export async function runVanscoStockCheck(pipeline, options = {}) {
  const [{ vehicles: localVehicles, sourceTable, warning: localWarning = "", registrationField = "" }, existingRecords, sourcePayload] = await Promise.all([
    fetchLocalStockGroup(pipeline),
    fetchVanscoWatchRecords(pipeline),
    fetchVanscoSourceHtml(pipeline, options),
  ]);

  const parsedHtml = Array.isArray(sourcePayload.vehicles) && sourcePayload.vehicles.length
    ? {
        vehicles: sourcePayload.vehicles.map((vehicle) =>
          normalizeApiVehicle(vehicle, pipeline === "cars" ? "car" : "van")
        ),
        parserWarnings: sourcePayload.diagnostics?.parserWarnings || [],
        htmlLength: sourcePayload.diagnostics?.htmlLength || sourcePayload.htmlLength || 0,
        duplicateCount: 0,
      }
    : parseVehicleCardsFromHtml(sourcePayload.html || "");
  const parsedSourceVehicles = filterSourceVehiclesForPipeline(parsedHtml.vehicles, pipeline);
  const localLookup = buildVehicleLookup(localVehicles);
  const existingByKey = new Map(existingRecords.map((record) => [record.vehicleKey, record]));
  const now = cleanTimestamp(sourcePayload.fetchedAt) || new Date().toISOString();
  const matchedLocalKeys = new Set();
  const nextRecords = [];
  const diagnostics = {
    pageFetched: Boolean(sourcePayload.html),
    htmlLength: parsedHtml.htmlLength || sourcePayload.htmlLength || 0,
    vehiclesParsed: parsedHtml.vehicles.length,
    vehiclesParsedForPipeline: parsedSourceVehicles.length,
    parserWarnings: [...(parsedHtml.parserWarnings || [])],
    sourceDuplicateKeysCollapsed: parsedHtml.duplicateCount || 0,
    upsertDuplicateKeysCollapsed: 0,
    upsertPayloadCount: 0,
    idsRemovedBeforeUpsert: 0,
    finalPayloadContainsId: false,
    localWarning,
    sourceTable: sourceTable || "",
    registrationField,
    endpointUsed: sourcePayload.endpointUsed || VAN_SCO_SOURCE_URL,
    sourceFamily: sourcePayload.diagnostics?.sourceFamily || "unknown",
    pagesFetched: sourcePayload.pagesFetched || 1,
    candidateLinksFound: sourcePayload.diagnostics?.candidateLinksFound || 0,
    sitemapUrlsFound: sourcePayload.diagnostics?.sitemapUrlsFound || 0,
    totalVehicleUrlsFound: sourcePayload.diagnostics?.totalVehicleUrlsFound || 0,
    categoryPagesFetched: sourcePayload.diagnostics?.categoryPagesFetched || 0,
    categoryPageFailures: sourcePayload.diagnostics?.categoryPageFailures || [],
    vehiclesParsedByCategory: sourcePayload.diagnostics?.vehiclesParsedByCategory || {},
    detailPagesFetched: sourcePayload.diagnostics?.detailPagesFetched || 0,
    detailPagesFailed: sourcePayload.diagnostics?.detailPagesFailed || 0,
    vehiclesEnrichedWithRegistration: sourcePayload.diagnostics?.vehiclesEnrichedWithRegistration || 0,
    vehiclesEnrichedWithImage: sourcePayload.diagnostics?.vehiclesEnrichedWithImage || 0,
    vehiclesWithValidMatchKey: sourcePayload.diagnostics?.vehiclesWithValidMatchKey || 0,
    partialScan: Boolean(sourcePayload.diagnostics?.partialScan),
    detailFetchMode: sourcePayload.diagnostics?.detailFetchMode || options.detailFetchMode || "standard",
    detailFetchLimitApplied: sourcePayload.diagnostics?.detailFetchLimitApplied ?? null,
    vanscoRegistrationsExtractedFromTitleBrackets:
      sourcePayload.diagnostics?.registrationsExtractedFromTitleBrackets || 0,
    rejectedFakeRegistrationsCount: sourcePayload.diagnostics?.rejectedFakeRegistrationsCount || 0,
    sampleRejectedFakeRegistrations: sourcePayload.diagnostics?.sampleRejectedFakeRegistrations || [],
    matchesByRegistration: 0,
    matchesByUrl: 0,
    matchesByFallbackTitle: 0,
    vanscoValidRegistrationsFound: 0,
    vanscoVehiclesWithoutValidRegistrationMovedToNeedsReview: 0,
    crmRecordCount: localVehicles.length,
    crmValidRegistrationsFound: localVehicles.filter((vehicle) => hasValidRegistration(vehicle)).length,
    crmRawRegistrationsSample: localVehicles
      .map((vehicle) => compactWhitespace(vehicle.rawRegistration || vehicle.registration || ""))
      .filter(Boolean)
      .slice(0, 20),
    crmNormalizedRegistrationsSample: localVehicles
      .map((vehicle) => normalizeRegistration(vehicle.rawRegistration || vehicle.registration || ""))
      .filter(Boolean)
      .slice(0, 20),
    vanscoRawRegistrationsSample: parsedSourceVehicles
      .map((vehicle) => compactWhitespace(vehicle.registration || ""))
      .filter(Boolean)
      .slice(0, 20),
    vanscoNormalizedRegistrationsSample: parsedSourceVehicles
      .map((vehicle) => normalizeRegistration(vehicle.registration || ""))
      .filter(Boolean)
      .slice(0, 20),
    exactRegistrationOverlapCount: 0,
    sampleMatchedRegistrations: [],
    scanComplete: false,
    registrationConfidence: "low",
    noLongerHighConfidenceOnly: true,
    missingCountBasedOnValidRegistrationsOnly: 0,
    needsReviewCount: 0,
    staleRowsDeleted: 0,
    lowConfidenceWarning: "",
    sampleTitles: sourcePayload.diagnostics?.sampleTitles || parsedSourceVehicles.slice(0, 3).map((vehicle) => vehicle.title),
  };

  const registrationConfidence = computeRegistrationConfidence({
    sourceVehicles: parsedSourceVehicles,
    detailPagesFailed: diagnostics.detailPagesFailed,
    detailFetchLimitApplied: diagnostics.detailFetchLimitApplied,
    detailFetchMode: diagnostics.detailFetchMode,
    partialScan: diagnostics.partialScan,
    parserWarnings: [
      ...(diagnostics.parserWarnings || []),
      ...(diagnostics.sourceFamily === "sitemap-fallback" ? ["Sitemap fallback was used."] : []),
    ],
  });

  diagnostics.vanscoValidRegistrationsFound = registrationConfidence.validRegistrations;
  diagnostics.scanComplete = registrationConfidence.scanComplete;
  diagnostics.registrationConfidence = registrationConfidence.registrationConfidence;

  const crmNormalizedSet = new Set(
    localVehicles
      .map((vehicle) => normalizeRegistration(vehicle.rawRegistration || vehicle.registration || ""))
      .filter(Boolean)
  );
  const vanscoNormalizedSet = new Set(
    parsedSourceVehicles.map((vehicle) => normalizeRegistration(vehicle.registration || "")).filter(Boolean)
  );
  const overlap = [...crmNormalizedSet].filter((registration) => vanscoNormalizedSet.has(registration));
  diagnostics.exactRegistrationOverlapCount = overlap.length;
  diagnostics.sampleMatchedRegistrations = overlap.slice(0, 20);

  if (!parsedSourceVehicles.length) {
    const error = new Error("No vehicles found in Vansco HTML. Site may require JS-rendered scraping or a feed.");
    error.debugInfo = diagnostics;
    throw error;
  }

  parsedSourceVehicles.forEach((sourceVehicle) => {
    const matchResult = findMatchingLocalVehicle(sourceVehicle, localLookup);
    const matchedLocalVehicle = matchResult.vehicle;
    const sourceHasValidRegistration = hasValidRegistration(sourceVehicle);
    const matchedByRegistration = matchedLocalVehicle && matchResult.method === "registration";
    if (matchedLocalVehicle && matchedByRegistration) {
      matchedLocalKeys.add(matchedLocalVehicle.vehicleKey);
    }
    if (matchResult.method === "registration") diagnostics.matchesByRegistration += 1;
    if (matchResult.method === "url") diagnostics.matchesByUrl += 1;
    if (matchResult.method === "fallback_title") diagnostics.matchesByFallbackTitle += 1;

    const vehicleKey = matchedLocalVehicle?.vehicleKey || sourceVehicle.vehicleKey;
    const existingRecord = existingByKey.get(vehicleKey) || existingByKey.get(sourceVehicle.vehicleKey);
    const stockUrl =
      sourceVehicle.stockUrl ||
      matchedLocalVehicle?.stockUrl ||
      existingRecord?.stockUrl ||
      VAN_SCO_SOURCE_URL;
    let matchStatus = "needs_review";
    const isSitemapFallback = diagnostics.sourceFamily === "sitemap-fallback";

    if (diagnostics.partialScan) {
      matchStatus = "needs_review";
    } else if (isSitemapFallback) {
      matchStatus = "needs_review";
    } else if (!sourceHasValidRegistration) {
      matchStatus = "needs_review";
      diagnostics.vanscoVehiclesWithoutValidRegistrationMovedToNeedsReview += 1;
    } else if (matchedByRegistration && isReservedLikeSourceStatus(sourceVehicle.sourceStatus)) {
      matchStatus = "reserved_still_listed";
    } else if (matchedByRegistration) {
      matchStatus = "listed";
    } else {
      matchStatus = "missing";
    }

    const baseRecord = existingRecord
      ? {
          id: existingRecord.id,
          workflow_status: existingRecord.workflowStatus,
          notes: existingRecord.notes || (matchStatus === "needs_review" ? "Cannot safely verify removal. Review manually." : null),
          first_seen_at: existingRecord.firstSeenAt,
        }
      : {
          workflow_status: "new",
          notes: matchStatus === "needs_review" ? "Cannot safely verify removal. Review manually." : null,
          first_seen_at: now,
        };

    nextRecords.push(
      mergeRecordData(baseRecord, {
        pipeline,
        vehicle_key: vehicleKey,
        title: sourceVehicle.title,
        registration: sourceVehicle.registration,
        image_url: sourceVehicle.imageUrl,
        stock_url: stockUrl,
        price: sourceVehicle.price,
        mileage: sourceVehicle.mileage,
        year: sourceVehicle.year,
        vehicle_category: sourceVehicle.vehicleCategory,
        source_status: sourceVehicle.sourceStatus,
        match_status: matchStatus,
        last_seen_at: now,
        last_checked_at: now,
      })
    );
  });

  if (parsedSourceVehicles.some((vehicle) => !normalizeRegistration(vehicle.registration))) {
    diagnostics.lowConfidenceWarning =
      "Some vehicles could not be matched confidently because registration was not found.";
  }

  if (diagnostics.partialScan) {
    diagnostics.lowConfidenceWarning =
      "Partial Vansco scan. Results are review-only and should not be used for stock decisions.";
  }

  if ((pipeline === "finance" || pipeline === "rent2buy") && diagnostics.crmValidRegistrationsFound === 0) {
    diagnostics.lowConfidenceWarning =
      "CRM registrations could not be read from the same stock data used by the Stock page. Review manually.";
  }

  localVehicles.forEach((localVehicle) => {
    if (matchedLocalKeys.has(localVehicle.vehicleKey)) return;

    const existingRecord = existingByKey.get(localVehicle.vehicleKey);
    const stockUrl = localVehicle.stockUrl || existingRecord?.stockUrl || VAN_SCO_SOURCE_URL;
    const localHasValidRegistration = hasValidRegistration(localVehicle);
    const hasTrustedRemovalSignal =
      registrationConfidence.highConfidence &&
      !diagnostics.partialScan &&
      localHasValidRegistration &&
      !parsedSourceVehicles.some(
        (vehicle) => normalizeRegistration(vehicle.registration) === normalizeRegistration(localVehicle.registration)
      );
    const matchStatus =
      diagnostics.partialScan || diagnostics.sourceFamily === "sitemap-fallback" || !localHasValidRegistration
        ? "needs_review"
        : hasTrustedRemovalSignal
          ? "no_longer_on_vansco"
          : "needs_review";
    const baseRecord = existingRecord
      ? {
          id: existingRecord.id,
          workflow_status: existingRecord.workflowStatus,
          notes: existingRecord.notes || (matchStatus === "needs_review" ? "Cannot safely verify removal. Review manually." : null),
          first_seen_at: existingRecord.firstSeenAt,
          last_seen_at: existingRecord.lastSeenAt,
        }
      : {
          workflow_status: "new",
          notes: matchStatus === "needs_review" ? "Cannot safely verify removal. Review manually." : null,
          first_seen_at: now,
        };

    nextRecords.push(
      mergeRecordData(baseRecord, {
        pipeline,
        vehicle_key: localVehicle.vehicleKey,
        title: localVehicle.title,
        registration: localVehicle.registration,
        image_url: localVehicle.imageUrl,
        stock_url: stockUrl,
        price: localVehicle.price,
        mileage: localVehicle.mileage,
        year: localVehicle.year,
        vehicle_category: localVehicle.vehicleCategory,
        source_status: existingRecord?.sourceStatus || "unknown",
        match_status: matchStatus,
        last_checked_at: now,
      })
    );
  });

  diagnostics.missingCountBasedOnValidRegistrationsOnly = nextRecords.filter(
    (record) => record.match_status === "missing"
  ).length;
  diagnostics.needsReviewCount = nextRecords.filter(
    (record) => record.match_status === "needs_review"
  ).length;

  if (nextRecords.length) {
    const nextStockUrlToVehicleKey = new Map(
      nextRecords
        .map((record) => [normalizeUrl(record.stock_url || ""), record.vehicle_key])
        .filter(([stockUrl]) => stockUrl)
    );
    const staleExistingIds = existingRecords
      .filter((record) => {
        const stockUrl = normalizeUrl(record.stockUrl || "");
        const nextVehicleKey = nextStockUrlToVehicleKey.get(stockUrl);
        return stockUrl && nextVehicleKey && nextVehicleKey !== record.vehicleKey;
      })
      .map((record) => record.id)
      .filter(Boolean);

    if (staleExistingIds.length) {
      diagnostics.staleRowsDeleted = staleExistingIds.length;
      const { error: deleteError } = await supabase
        .from(WATCH_TABLE)
        .delete()
        .in("id", staleExistingIds);

      if (deleteError) {
        const wrappedDeleteError = new Error(`Failed to clean stale Vansco Stock Watch rows: ${deleteError.message}`);
        wrappedDeleteError.debugInfo = diagnostics;
        throw wrappedDeleteError;
      }
    }

    const dedupedBatch = dedupeWatchRecords(nextRecords);
    diagnostics.upsertDuplicateKeysCollapsed = dedupedBatch.duplicateCount;
    const cleanedBatch = dedupedBatch.records.map(cleanWatchRecordPayload);
    diagnostics.recordsWithIdBeforeCleaning = dedupedBatch.records.filter((record) => "id" in record).length;
    diagnostics.recordsWithIdAfterCleaning = cleanedBatch.filter((record) => "id" in record).length;
    diagnostics.idsRemovedDuringCleaning =
      diagnostics.recordsWithIdBeforeCleaning - diagnostics.recordsWithIdAfterCleaning;
    const finalPayload = cleanedBatch.map(({ id, ...rest }) => rest);
    diagnostics.upsertPayloadCount = finalPayload.length;
    diagnostics.idsRemovedBeforeUpsert = cleanedBatch.filter((record) => "id" in record).length;
    diagnostics.finalPayloadContainsId = finalPayload.some((record) => "id" in record);

    if (diagnostics.finalPayloadContainsId) {
      const payloadError = new Error("Vansco Stock Watch payload still contains id before upsert");
      payloadError.debugInfo = diagnostics;
      throw payloadError;
    }

    const { error } = await supabase
      .from(WATCH_TABLE)
      .upsert(finalPayload, { onConflict: "pipeline,vehicle_key" });

    if (error) {
      const wrappedError = new Error(`Failed to save Vansco Stock Watch results: ${error.message}`);
      wrappedError.debugInfo = diagnostics;
      throw wrappedError;
    }
  }

  const refreshedRecords = await fetchVanscoWatchRecords(pipeline);

  return {
    records: refreshedRecords,
    sourceVehicleCount: parsedSourceVehicles.length,
    localVehicleCount: localVehicles.length,
    checkedAt: now,
    sourceTable,
    diagnostics,
  };
}

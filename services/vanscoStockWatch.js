import { supabase } from "./supabase.js";

const WATCH_TABLE = "vansco_stock_watch";
const VAN_SCO_SOURCE_URL = "https://www.vansco.co.uk/all-stock/";
const PRICE_PATTERN = /(?:\u00A3|&pound;)\s?[0-9][0-9,]*/i;
const YEAR_PATTERN = /\b(20\d{2}|19\d{2})\b/;
const MILEAGE_PATTERN = /\b([0-9][0-9,]{1,})\s*(?:miles|mile|mi)\b/i;
const REGISTRATION_PATTERN =
  /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/i;

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
  { value: "no_longer_on_vansco", label: "No longer on Vansco" },
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
    case "no_longer_on_vansco":
      return "No longer on Vansco";
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
  const match = text.match(REGISTRATION_PATTERN);
  return (match ? match[1] : text).replace(/\s+/g, "");
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
  const title = normalizeText(vehicle.title);
  const year = normalizeYear(vehicle.year);
  const mileage = normalizeMileage(vehicle.mileage);
  return [title, year, mileage].filter(Boolean);
}

function deriveVehicleKey(vehicle, fallbackSeed = "") {
  const registration = normalizeRegistration(vehicle.registration || vehicle.reg || vehicle.title);
  if (registration) return `reg:${registration}`;

  const stockUrl = normalizeUrl(vehicle.stockUrl || vehicle.weblink || vehicle.webLink || vehicle.link);
  if (stockUrl) return `url:${stockUrl}`;

  const metaParts = buildMetaKeyParts(vehicle);
  if (metaParts.length) return `meta:${metaParts.join("|")}`;

  const fallback = normalizeText(vehicle.title || fallbackSeed || "vehicle");
  return `fallback:${fallback || "vehicle"}`;
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
  const byKey = new Map();
  const byRegistration = new Map();
  const byUrl = new Map();
  const byMeta = new Map();

  vehicles.forEach((vehicle) => {
    byKey.set(vehicle.vehicleKey, vehicle);

    const registration = normalizeRegistration(vehicle.registration);
    if (registration) byRegistration.set(registration, vehicle);

    const stockUrl = normalizeUrl(vehicle.stockUrl);
    if (stockUrl) byUrl.set(stockUrl, vehicle);

    const metaKey = buildMetaKeyParts(vehicle).join("|");
    if (metaKey) byMeta.set(metaKey, vehicle);
  });

  return {
    byKey,
    byRegistration,
    byUrl,
    byMeta,
  };
}

function findMatchingLocalVehicle(sourceVehicle, lookup) {
  const registration = normalizeRegistration(sourceVehicle.registration);
  if (registration && lookup.byRegistration.has(registration)) {
    return lookup.byRegistration.get(registration);
  }

  const stockUrl = normalizeUrl(sourceVehicle.stockUrl);
  if (stockUrl && lookup.byUrl.has(stockUrl)) {
    return lookup.byUrl.get(stockUrl);
  }

  const metaKey = buildMetaKeyParts(sourceVehicle).join("|");
  if (metaKey && lookup.byMeta.has(metaKey)) {
    return lookup.byMeta.get(metaKey);
  }

  return null;
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
  const { data, error } = await supabase
    .from("facebook_adverts")
    .select("id, title, picture, price, weblink, is_active")
    .eq("is_active", true);

  if (error) {
    throw new Error(`Failed to load finance stock group: ${error.message}`);
  }

  return (data || []).map(mapFinanceVehicleRow);
}

async function fetchRent2BuyStockGroup() {
  const { data, error } = await supabase
    .from("rent_vehicles")
    .select("id, registration, picture, monthly, initialRental, webLink, is_active")
    .eq("is_active", true);

  if (error) {
    throw new Error(`Failed to load Rent2Buy stock group: ${error.message}`);
  }

  return (data || []).map(mapRentVehicleRow);
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
    };
  }

  if (pipeline === "rent2buy") {
    return {
      vehicles: await fetchRent2BuyStockGroup(),
      sourceTable: PIPELINE_CONFIG.rent2buy.localSource,
    };
  }

  return fetchCarsStockGroup().then((result) => ({
    vehicles: result.rows,
    sourceTable: result.sourceTable,
    warning: result.warning || "",
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

async function fetchVanscoSourceHtml(pipeline) {
  const response = await fetch(`/api/vansco-stock?pipeline=${encodeURIComponent(pipeline)}&_=${Date.now()}`, {
    headers: {
      accept: "application/json",
    },
  });

  const text = await response.text();
  let payload = {};

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { message: text };
  }

  if (!response.ok) {
    throw new Error(payload.message || "Vansco source fetch failed.");
  }

  return payload;
}

function normalizeApiVehicle(vehicle, fallbackCategory = "unknown") {
  return {
    vehicleKey: deriveVehicleKey(
      {
        title: vehicle.title,
        registration: vehicle.registration,
        stockUrl: vehicle.stockUrl,
        year: vehicle.year,
        mileage: vehicle.mileage,
      },
      vehicle.stockUrl || vehicle.title
    ),
    title: compactWhitespace(vehicle.title || ""),
    registration: normalizeRegistration(vehicle.registration || ""),
    imageUrl: normalizeUrl(vehicle.imageUrl || ""),
    stockUrl: normalizeUrl(vehicle.stockUrl || ""),
    price: compactWhitespace(vehicle.price || ""),
    mileage: compactWhitespace(vehicle.mileage || ""),
    year: normalizeYear(vehicle.year || ""),
    sourceStatus: vehicle.sourceStatus || "unknown",
    vehicleCategory: vehicle.vehicleCategory || fallbackCategory,
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

export async function runVanscoStockCheck(pipeline) {
  const [{ vehicles: localVehicles, sourceTable, warning: localWarning = "" }, existingRecords, sourcePayload] = await Promise.all([
    fetchLocalStockGroup(pipeline),
    fetchVanscoWatchRecords(pipeline),
    fetchVanscoSourceHtml(pipeline),
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
    endpointUsed: sourcePayload.endpointUsed || VAN_SCO_SOURCE_URL,
    pagesFetched: sourcePayload.pagesFetched || 1,
    candidateLinksFound: sourcePayload.diagnostics?.candidateLinksFound || 0,
    sampleTitles: sourcePayload.diagnostics?.sampleTitles || parsedSourceVehicles.slice(0, 3).map((vehicle) => vehicle.title),
  };

  if (!parsedSourceVehicles.length) {
    const error = new Error("No vehicles found in Vansco HTML. Site may require JS-rendered scraping or a feed.");
    error.debugInfo = diagnostics;
    throw error;
  }

  parsedSourceVehicles.forEach((sourceVehicle) => {
    const matchedLocalVehicle = findMatchingLocalVehicle(sourceVehicle, localLookup);
    if (matchedLocalVehicle) {
      matchedLocalKeys.add(matchedLocalVehicle.vehicleKey);
    }

    const vehicleKey = matchedLocalVehicle?.vehicleKey || sourceVehicle.vehicleKey;
    const existingRecord = existingByKey.get(vehicleKey) || existingByKey.get(sourceVehicle.vehicleKey);
    const stockUrl =
      sourceVehicle.stockUrl ||
      matchedLocalVehicle?.stockUrl ||
      existingRecord?.stockUrl ||
      VAN_SCO_SOURCE_URL;
    const matchStatus =
      matchedLocalVehicle && isReservedLikeSourceStatus(sourceVehicle.sourceStatus)
        ? "reserved_still_listed"
        : matchedLocalVehicle
          ? "listed"
          : "missing";

    const baseRecord = existingRecord
      ? {
          id: existingRecord.id,
          workflow_status: existingRecord.workflowStatus,
          notes: existingRecord.notes,
          first_seen_at: existingRecord.firstSeenAt,
        }
      : {
          workflow_status: "new",
          notes: null,
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

  localVehicles.forEach((localVehicle) => {
    if (matchedLocalKeys.has(localVehicle.vehicleKey)) return;

    const existingRecord = existingByKey.get(localVehicle.vehicleKey);
    const stockUrl = localVehicle.stockUrl || existingRecord?.stockUrl || VAN_SCO_SOURCE_URL;
    const baseRecord = existingRecord
      ? {
          id: existingRecord.id,
          workflow_status: existingRecord.workflowStatus,
          notes: existingRecord.notes,
          first_seen_at: existingRecord.firstSeenAt,
          last_seen_at: existingRecord.lastSeenAt,
        }
      : {
          workflow_status: "new",
          notes: null,
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
        match_status: "no_longer_on_vansco",
        last_checked_at: now,
      })
    );
  });

  if (nextRecords.length) {
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

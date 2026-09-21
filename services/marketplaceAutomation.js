import {
  buildMarketingAccessHeaders,
  parseMarketingJsonResponse,
} from "./marketingAccess.js";
import {
  findYoutubeCmsMatch,
  loadYouTubeCmsUploadsAsync,
} from "../utils/youtubeImageResolution.js";

export const MARKETPLACE_CREATE_URL = "https://www.facebook.com/marketplace/create/vehicle";
export const MARKETPLACE_JOB_MESSAGE_TYPE = "VFC_MARKETPLACE_JOB";
export const MARKETPLACE_JOB_ACK_TYPE = "VFC_MARKETPLACE_JOB_STORED";
export const MARKETPLACE_PUBLISHED_MESSAGE_TYPE = "VFC_MARKETPLACE_PUBLISHED";

const LOCATION_STORAGE_KEYS = Object.freeze({
  rent2buy: "rent2buyMarketplaceLocationRotationV1",
  finance: "vanFinanceMarketplaceLocationRotationV1",
});
const MARKETPLACE_MAX_IMAGES = 20;
const MARKETPLACE_EXTENSION_ACK_TIMEOUT_MS = 6000;
const MARKETPLACE_EXTENSION_ACK_ATTEMPTS = 2;
const MARKETPLACE_EXTENSION_RETRY_DELAY_MS = 300;

export const RENT2BUY_MARKETPLACE_LOCATIONS = Object.freeze([
  "Southampton",
  "Portsmouth",
  "Bournemouth",
  "Basingstoke",
  "Winchester",
  "Salisbury",
  "Reading",
  "Guildford",
  "Chichester",
  "Andover",
  "Farnborough",
  "Woking",
  "Worthing",
]);

export const VAN_FINANCE_MARKETPLACE_LOCATIONS = Object.freeze([
  "London",
  "Birmingham",
  "Manchester",
  "Leeds",
  "Liverpool",
  "Sheffield",
  "Bristol",
  "Leicester",
  "Nottingham",
  "Newcastle upon Tyne",
  "Coventry",
  "Bradford",
  "Stoke-on-Trent",
  "Hull",
  "Plymouth",
  "Wolverhampton",
  "Derby",
  "Southampton",
  "Portsmouth",
  "Brighton",
  "Reading",
  "Northampton",
  "Luton",
  "Milton Keynes",
  "Norwich",
  "Bournemouth",
  "Swindon",
  "Peterborough",
  "Cambridge",
  "Oxford",
]);

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeRegistration(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function numericValue(value) {
  const match = clean(value).replace(/,/g, "").match(/[0-9]+(?:\.[0-9]+)?/);
  return match ? match[0] : "";
}

function parseSpecValue(vehicle, label) {
  const source = [
    vehicle?.vanSpec,
    vehicle?.spec,
    vehicle?.description,
    vehicle?.vanDescription,
  ].filter(Boolean).join("\n");
  if (label === "year") return source.match(/\bYEAR\s*:?\s*(20\d{2}|19\d{2})/i)?.[1] || "";
  if (label === "mileage") return numericValue(source.match(/\bMILEAGE\s*:?\s*([0-9,.]+)/i)?.[1] || "");
  return "";
}

function fallbackModel(vehicle) {
  const text = clean(vehicle?.vanDescription || vehicle?.description || vehicle?.name || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
  const make = clean(vehicle?.make);
  return make && text.toLowerCase().startsWith(make.toLowerCase())
    ? text.slice(make.length).trim().split(/\s{2,}| - /)[0]
    : text.split(/\s{2,}| - /)[0];
}

function normalizeTransmission(value) {
  const text = clean(value).toLowerCase();
  if (text.includes("auto")) return "Automatic transmission";
  if (text.includes("manual")) return "Manual transmission";
  return "";
}

function normalizeFuel(value) {
  const text = clean(value).toLowerCase();
  if (!text) return "";
  if (text.includes("electric")) return "Electric";
  if (text.includes("diesel")) return "Diesel";
  if (text.includes("petrol") || text.includes("gasoline")) return "Petrol";
  if (text.includes("hybrid")) return "Hybrid";
  return clean(value);
}

function normalizeExteriorColour(value) {
  const text = clean(value).toLowerCase();
  const colours = [
    ["white", "White"],
    ["black", "Black"],
    ["silver", "Silver"],
    ["grey", "Grey"],
    ["gray", "Grey"],
    ["blue", "Blue"],
    ["red", "Red"],
    ["green", "Green"],
    ["yellow", "Yellow"],
    ["orange", "Orange"],
    ["brown", "Brown"],
    ["beige", "Beige"],
    ["gold", "Gold"],
    ["purple", "Purple"],
  ];
  return colours.find(([needle]) => text.includes(needle))?.[1] || "";
}

function shuffled(values) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function marketplaceLocationConfig(productKey) {
  if (productKey === "finance") {
    return {
      storageKey: LOCATION_STORAGE_KEYS.finance,
      locations: VAN_FINANCE_MARKETPLACE_LOCATIONS,
    };
  }
  return {
    storageKey: LOCATION_STORAGE_KEYS.rent2buy,
    locations: RENT2BUY_MARKETPLACE_LOCATIONS,
  };
}

export function nextMarketplaceLocation(productKey = "rent2buy") {
  const { storageKey, locations } = marketplaceLocationConfig(productKey);
  if (typeof window === "undefined") return locations[0];

  let state = { remaining: [], last: "" };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "{}");
    state = {
      remaining: Array.isArray(parsed.remaining)
        ? parsed.remaining.filter((value) => locations.includes(value))
        : [],
      last: clean(parsed.last),
    };
  } catch {}

  if (!state.remaining.length) {
    state.remaining = shuffled(locations);
    if (state.last && state.remaining.length > 1 && state.remaining[0] === state.last) {
      [state.remaining[0], state.remaining[1]] = [state.remaining[1], state.remaining[0]];
    }
  }

  const location = state.remaining.shift() || locations[0];
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ remaining: state.remaining, last: location }),
    );
  } catch {}
  return location;
}

async function fetchDealerKitVehicle(registration, productKey = "rent2buy") {
  const product = productKey === "finance" ? "finance" : "rent2buy";
  const response = await fetch(
    `/api/dealerkit-stock-detail?registration=${encodeURIComponent(registration)}&product=${product}`,
    {
      method: "GET",
      cache: "no-store",
      headers: buildMarketingAccessHeaders({ Accept: "application/json" }),
    },
  );
  const result = await parseMarketingJsonResponse(
    response,
    "Could not load DealerKit vehicle details for Marketplace.",
  );
  return result?.vehicle || null;
}

function orderedCmsImages(cmsUploads, vehicle, productKey = "rent2buy") {
  const cmsKey = productKey === "finance" ? "vanFinance" : "rent2buy";
  const rows = cmsUploads?.[cmsKey]?.rows || [];
  const match = findYoutubeCmsMatch(rows, vehicle);
  const records = Array.isArray(match?.imageRecords) ? match.imageRecords : [];
  const seen = new Set();
  const images = [];
  for (const record of records) {
    const url = clean(record?.url || record);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    images.push(url);
    if (images.length >= MARKETPLACE_MAX_IMAGES) break;
  }
  return { match, images };
}

function ensureVisitLine(caption) {
  const text = clean(caption);
  if (!text) return "Visit us at Rent2BuyVans.co.uk";
  if (/visit us at rent2buyvans\.co\.uk/i.test(text)) return text;
  const lines = text.split(/\r?\n/);
  const insertionIndex = Math.min(1, lines.length);
  lines.splice(insertionIndex, 0, "", "Visit us at Rent2BuyVans.co.uk");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function jobId(productKey = "rent2buy") {
  const product = productKey === "finance" ? "finance" : "rent2buy";
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `marketplace-${product}-${crypto.randomUUID()}`;
  }
  return `marketplace-${product}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildFinanceMarketplaceModel(dealerKitVehicle, financeVehicle) {
  const model = clean(dealerKitVehicle?.model) || fallbackModel(financeVehicle);
  const derivative = clean(dealerKitVehicle?.derivative || dealerKitVehicle?.trim);
  let detail = model;

  if (derivative && !model.toLowerCase().includes(derivative.toLowerCase())) {
    detail = `${model} ${derivative}`.trim();
  }

  return `${detail} - VANFINANCECOMPANY.co.uk | Deposit from £99`;
}

export async function buildRent2BuyMarketplaceJob(vehicle, caption) {
  const rentVehicle = vehicle?.rent2buyData || vehicle || {};
  const registration = normalizeRegistration(
    rentVehicle.registration || rentVehicle.reg || vehicle?.registration || vehicle?.reg || vehicle?.title,
  );
  if (!registration) throw new Error("Marketplace preflight failed: registration is missing.");

  const monthlyPrice = numericValue(rentVehicle.monthly || rentVehicle.salePrice || "");
  if (!monthlyPrice) throw new Error("Marketplace preflight failed: monthly Rent2Buy price is missing.");

  const [dealerKitVehicle, cmsUploads] = await Promise.all([
    fetchDealerKitVehicle(registration, "rent2buy"),
    loadYouTubeCmsUploadsAsync(),
  ]);

  if (!dealerKitVehicle) throw new Error("Marketplace preflight failed: DealerKit vehicle details were not found.");

  const { match: cmsMatch, images } = orderedCmsImages(cmsUploads, rentVehicle, "rent2buy");
  if (!cmsMatch || !images.length) {
    throw new Error("Marketplace preflight failed: the ordered Rent2Buy CMS image gallery was not found.");
  }

  const make = clean(dealerKitVehicle.make);
  const model = clean(dealerKitVehicle.model) || fallbackModel(rentVehicle);
  const year = clean(dealerKitVehicle.year || parseSpecValue(rentVehicle, "year"));
  const mileage = numericValue(dealerKitVehicle.mileage || parseSpecValue(rentVehicle, "mileage"));
  if (!make || !model || !year || !mileage) {
    throw new Error("Marketplace preflight failed: make, model, year or mileage is missing.");
  }

  return {
    version: 1,
    id: jobId("rent2buy"),
    createdAt: new Date().toISOString(),
    destination: "Facebook Marketplace",
    postingDestination: "Rent2Buy Marketplace",
    pipeline: "rent2buy",
    registration,
    vehicleId: String(vehicle?.id || rentVehicle?.id || ""),
    location: nextMarketplaceLocation("rent2buy"),
    vehicleType: "Car/Truck",
    year,
    make,
    model: `${model} - Visit us at Rent2BuyVans.co.uk`,
    mileage,
    price: monthlyPrice,
    bodyStyle: "Other",
    exteriorColor: normalizeExteriorColour(dealerKitVehicle.colour),
    interiorColor: "",
    vehicleCondition: "Very good",
    fuelType: normalizeFuel(dealerKitVehicle.fuel),
    transmission: normalizeTransmission(dealerKitVehicle.transmission),
    description: ensureVisitLine(caption),
    images,
    imageCount: images.length,
    leadImage: images[0],
    source: {
      cms: cmsUploads?.rent2buy?.source || "cms",
      cmsMatchRegistration: clean(cmsMatch.registration),
      dealerKitStockId: clean(dealerKitVehicle.supplierStockId),
    },
  };
}

function sendMarketplaceJobAttempt(job, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      reject(new Error("Marketplace helper extension did not acknowledge the job in time."));
    }, timeoutMs);

    function onMessage(event) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const message = event.data || {};
      if (message.type !== MARKETPLACE_JOB_ACK_TYPE || message.jobId !== job.id) return;
      settled = true;
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      resolve(message);
    }

    window.addEventListener("message", onMessage);
    window.postMessage({
      source: "vfc-marketing-crm",
      type: MARKETPLACE_JOB_MESSAGE_TYPE,
      job,
    }, window.location.origin);
  });
}

export async function buildVanFinanceMarketplaceJob(vehicle, caption) {
  const financeVehicle = vehicle || {};
  const registration = normalizeRegistration(
    financeVehicle.registration || financeVehicle.reg || financeVehicle.title || financeVehicle.name,
  );
  if (!registration) throw new Error("Marketplace preflight failed: registration is missing.");

  const [dealerKitVehicle, cmsUploads] = await Promise.all([
    fetchDealerKitVehicle(registration, "finance"),
    loadYouTubeCmsUploadsAsync(),
  ]);

  if (!dealerKitVehicle) throw new Error("Marketplace preflight failed: DealerKit vehicle details were not found.");

  const cashPrice = numericValue(financeVehicle.price || dealerKitVehicle.retailPrice || "");
  if (!cashPrice) throw new Error("Marketplace preflight failed: Van Finance cash price is missing.");

  const { match: cmsMatch, images } = orderedCmsImages(cmsUploads, financeVehicle, "finance");
  if (!cmsMatch || !images.length) {
    throw new Error("Marketplace preflight failed: the ordered Van Finance CMS image gallery was not found.");
  }

  const make = clean(dealerKitVehicle.make);
  const model = buildFinanceMarketplaceModel(dealerKitVehicle, financeVehicle);
  const year = clean(dealerKitVehicle.year || parseSpecValue(financeVehicle, "year"));
  const mileage = numericValue(dealerKitVehicle.mileage || parseSpecValue(financeVehicle, "mileage"));
  if (!make || !model || !year || !mileage) {
    throw new Error("Marketplace preflight failed: make, model, year or mileage is missing.");
  }

  return {
    version: 1,
    id: jobId("finance"),
    createdAt: new Date().toISOString(),
    destination: "Facebook Marketplace",
    postingDestination: "Van Finance Marketplace",
    pipeline: "finance",
    registration,
    vehicleId: String(financeVehicle.id || ""),
    location: nextMarketplaceLocation("finance"),
    vehicleType: "Car/Truck",
    year,
    make,
    model,
    mileage,
    price: cashPrice,
    monthlyPrice: numericValue(financeVehicle.salePrice || financeVehicle.monthly || ""),
    priceContext: "cash",
    bodyStyle: "Other",
    exteriorColor: normalizeExteriorColour(dealerKitVehicle.colour),
    interiorColor: "",
    vehicleCondition: "Very good",
    fuelType: normalizeFuel(dealerKitVehicle.fuel),
    transmission: normalizeTransmission(dealerKitVehicle.transmission),
    description: clean(caption) || "Visit us at VANFINANCECOMPANY.co.uk",
    images,
    imageCount: images.length,
    leadImage: images[0],
    source: {
      cms: cmsUploads?.vanFinance?.source || "cms",
      cmsMatchRegistration: clean(cmsMatch.registration),
      dealerKitStockId: clean(dealerKitVehicle.supplierStockId),
    },
  };
}

export async function sendMarketplaceJobToExtension(
  job,
  timeoutMs = MARKETPLACE_EXTENSION_ACK_TIMEOUT_MS,
) {
  if (typeof window === "undefined") {
    throw new Error("Marketplace helper requires a browser.");
  }

  let lastTimeoutError = null;
  for (let attempt = 1; attempt <= MARKETPLACE_EXTENSION_ACK_ATTEMPTS; attempt += 1) {
    try {
      return await sendMarketplaceJobAttempt(job, timeoutMs);
    } catch (error) {
      lastTimeoutError = error;
      if (attempt >= MARKETPLACE_EXTENSION_ACK_ATTEMPTS) break;
      await new Promise((resolve) => window.setTimeout(resolve, MARKETPLACE_EXTENSION_RETRY_DELAY_MS));
    }
  }

  throw new Error(
    `${lastTimeoutError?.message || "Marketplace helper extension did not acknowledge the job."} ` +
    "Check that VFC Marketplace Helper is installed and enabled in this Chrome profile, then try again.",
  );
}

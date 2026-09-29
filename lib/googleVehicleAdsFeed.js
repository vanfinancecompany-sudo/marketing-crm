import { isEligibleVanscoVehicle } from "./vanscoFacebookAutomation.js";
import { classifyDealerKitVehicle } from "./dealerKitVehicleSegmentation.js";

export const GOOGLE_VEHICLE_ADS_STORE_CODES = Object.freeze({
  vansco333: "VANSCO-333",
  southamptonAirport: "VANSCO-AIRPORT",
  newForest: "VANSCO-NEWFOREST",
  flexibuyCadnam: "FLEXIBUY-CADNAM",
});

export const GOOGLE_VEHICLE_ADS_PILOT_LIMIT = 12;


function clean(value, limit = 5000) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function stripEmoji(value) {
  return String(value ?? "")
    .replace(/[\p{Extended_Pictographic}\u2600-\u27BF\uFE0F\u200D]/gu, " ");
}

function stripMarkup(value, limit = 5000) {
  return clean(
    stripEmoji(
      String(value ?? "")
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&pound;/gi, "£")
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&quot;/gi, '"'),
    ),
    limit,
  );
}

function normalizeRegistration(value) {
  return clean(value, 50).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function parsePositiveNumber(value) {
  const match = clean(value, 100).replace(/,/g, "").match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return null;
  const number = Number(match[1]);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function googlePrice(value) {
  const amount = parsePositiveNumber(value);
  if (amount === null || amount <= 0) return "";
  return `${amount.toFixed(2)} GBP`;
}

function googleMileage(value, unit = "miles") {
  const amount = parsePositiveNumber(value);
  if (amount === null) return "";
  const normalizedUnit = clean(unit, 20).toLowerCase();
  const suffix = /km|kilomet/.test(normalizedUnit) ? "km" : "miles";
  return `${Math.round(amount)} ${suffix}`;
}

function googleCondition(value) {
  const state = clean(value, 100).toLowerCase().replace(/[\s_-]+/g, " ");
  if (/\bnew\b/.test(state) && !/used|pre owned|preowned|second hand/.test(state)) return "new";
  if (/used|pre owned|preowned|second hand/.test(state)) return "used";
  return "";
}

function googleYear(value) {
  const year = Number.parseInt(clean(value, 20), 10);
  return Number.isFinite(year) && year >= 1900 && year <= 2100 ? String(year) : "";
}

export function isGoogleVehicleAdsTargetVehicle(vehicle = {}) {
  return classifyDealerKitVehicle({
    ...vehicle,
    bodyType: [vehicle?.bodyType, vehicle?.bodyStyle]
      .map((value) => clean(value, 300))
      .filter(Boolean)
      .join(" "),
  }).segment === "commercial";
}

function googleBodyStyle(vehicle = {}) {
  const text = [
    vehicle?.bodyStyle,
    vehicle?.bodyType,
    vehicle?.model,
    vehicle?.title,
  ].map((value) => clean(value, 300)).filter(Boolean).join(" ");

  if (/\b(?:pick[- ]?up|ranger|hilux|d[- ]?max|l200|amarok|navara|musso|x[- ]?class)\b/i.test(text)) {
    return "truck";
  }
  if (/\b(?:van|transit|vivaro|trafic|traffic|sprinter|crafter|ducato|boxer|relay|master|movano|expert|dispatch|partner|berlingo|caddy|transporter|maxus|vito|kangoo|doblo|proace|primastar|townstar)\b/i.test(text)) {
    return "full_size_van";
  }
  return "";
}

function googleLinkTemplate(value) {
  const link = clean(value, 2000);
  if (!link) return "";
  const hashIndex = link.indexOf("#");
  const base = hashIndex >= 0 ? link.slice(0, hashIndex) : link;
  const hash = hashIndex >= 0 ? link.slice(hashIndex) : "";
  return `${base}${base.includes("?") ? "&" : "?"}store={store_code}${hash}`;
}

function vehicleTitle(vehicle = {}) {
  const raw = clean(vehicle?.title, 150);
  const year = googleYear(vehicle?.year);
  if (!raw) return "";
  return year && !raw.startsWith(year) ? clean(`${year} ${raw}`, 150) : raw;
}

function requiredGoogleVehicleFields(vehicle = {}) {
  return {
    id: normalizeRegistration(vehicle?.registration),
    title: vehicleTitle(vehicle),
    description: stripMarkup(vehicle?.description || vehicle?.title, 5000),
    link: clean(vehicle?.vehicleUrl, 2000),
    link_template: googleLinkTemplate(vehicle?.vehicleUrl),
    image_link: clean(vehicle?.imageUrl, 2000),
    availability: "in_stock",
    price: googlePrice(vehicle?.price),
    condition: googleCondition(vehicle?.stateOfVehicle),
    brand: clean(vehicle?.make, 70),
    model: clean(vehicle?.model, 150),
    color: clean(vehicle?.colour || vehicle?.color, 100),
    year: googleYear(vehicle?.year),
    mileage: googleMileage(vehicle?.mileage, vehicle?.mileageUnit),
    VIN: clean(vehicle?.vin, 17).toUpperCase(),
    body_style: googleBodyStyle(vehicle),
    store_code: GOOGLE_VEHICLE_ADS_STORE_CODES[vehicle?.branchKey] || "",
    google_product_category: "916",
  };
}

export function googleVehicleAdsEligibility(vehicle = {}) {
  const baseEligible = isEligibleVanscoVehicle(vehicle);
  if (!baseEligible) return { eligible: false, reason: "source_ineligible" };
  if (!isGoogleVehicleAdsTargetVehicle(vehicle)) {
    return { eligible: false, reason: "not_vansco_commercial_stock" };
  }
  if (vehicle?.branchConflict) return { eligible: false, reason: "branch_conflict" };

  const fields = requiredGoogleVehicleFields(vehicle);
  const optionalFields = new Set(["VIN", "body_style", "google_product_category"]);
  const missing = Object.entries(fields)
    .filter(([key, value]) => !optionalFields.has(key) && !clean(value))
    .map(([key]) => key);

  if (missing.length) {
    return { eligible: false, reason: "missing_required_fields", missing };
  }
  return { eligible: true, reason: "eligible", fields };
}

function tsvCell(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\t/g, " ")
    .trim();
}

export function buildGoogleVehicleAdsRows(vehicles = [], { mode = "pilot" } = {}) {
  const eligible = [];
  const skipped = [];

  for (const vehicle of Array.isArray(vehicles) ? vehicles : []) {
    const result = googleVehicleAdsEligibility(vehicle);
    if (result.eligible) {
      eligible.push(result.fields);
    } else {
      skipped.push({
        vehicleKey: clean(vehicle?.vehicleKey || vehicle?.vehicleId || vehicle?.vehicleUrl, 300),
        registration: normalizeRegistration(vehicle?.registration),
        reason: result.reason,
        missing: result.missing || [],
      });
    }
  }

  eligible.sort((first, second) =>
    first.store_code.localeCompare(second.store_code)
    || first.id.localeCompare(second.id)
  );

  const rows = mode === "full"
    ? eligible
    : eligible.slice(0, GOOGLE_VEHICLE_ADS_PILOT_LIMIT);

  return { rows, eligibleCount: eligible.length, skipped };
}

export function buildGoogleVehicleAdsTsv(vehicles = [], options = {}) {
  const result = buildGoogleVehicleAdsRows(vehicles, options);
  const headers = [
    "id",
    "title",
    "description",
    "link",
    "link_template",
    "image_link",
    "availability",
    "price",
    "condition",
    "brand",
    "model",
    "color",
    "year",
    "mileage",
    "VIN",
    "body_style",
    "store_code",
    "google_product_category",
  ];

  const lines = [
    headers.join("\t"),
    ...result.rows.map((row) => headers.map((header) => tsvCell(row[header])).join("\t")),
  ];

  return {
    ...result,
    tsv: `${lines.join("\n")}\n`,
  };
}

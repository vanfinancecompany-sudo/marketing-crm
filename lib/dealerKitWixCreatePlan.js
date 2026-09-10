import {
  calculateFivePercentFlatMonthly,
  formatRetailPrice,
  normalizeFinanceRegistration,
  parseRetailPrice,
} from "./vanscoWixPrice.js";

export const VFC_WIX_CREATE_SCHEMA_VERIFIED_AT = "2026-09-10";

export const VFC_FIXED_VEHICLE_REASSURANCE = Object.freeze([
  "Over 200 vans in stock",
  "No admin fees",
  "All vehicles HPI checked",
  "Free nationwide delivery",
  "Click & Collect",
  "6 month / 6,000 mile warranty",
  "1 year AA breakdown cover",
  "Live market price check",
  "Service & PDI",
  "Minimum 8 months MOT",
  "Fully valeted",
]);

const LISTING_COLLECTIONS = Object.freeze({
  "VANFINANCE-ALLVANS": { buttonField: "buttonText", buttonText: "VIEW VAN", syncToCrm: true },
  "VANFINANCE-SMALLVANS": { buttonField: "buttonName", buttonText: "VIEW VAN" },
  "VANFINANCE-MWB": { buttonField: "buttonText", buttonText: "VIEW VAN" },
  "VANFINANCE-LWBVANS": { buttonField: "buttonText", buttonText: "VIEW VAN" },
  "FINANCE-CREWVANS": { buttonField: "buttonText", buttonText: "VIEW CREW VAN" },
  "VANFINANCE-PICKUPS": { buttonField: "buttonText", buttonText: "VIEW PICKUP" },
  "VANFINANCE-TIPPERSDROPSIDEL": { buttonField: "buttonText", buttonText: "VIEW VAN" },
  "VANFINANCE-ELECTRIC": { buttonField: "buttonText", buttonText: "VIEW VAN" },
  "AUTOMATIC": { buttonField: "buttonText", buttonText: "VIEW VAN" },
});

export const VFC_WIX_CREATE_SCHEMA = Object.freeze({
  "VANFINANCE-ALLVANS": Object.freeze({ kind: "listing", fields: Object.freeze({
    title: "TEXT", picture: "IMAGE", price: "TEXT", salePrice: "TEXT", vat: "TEXT",
    vanDescription: "TEXT", vanSpec: "TEXT", webLink: "URL", applyLink: "URL",
    buttonText: "TEXT", syncToCrm: "TEXT",
  }) }),
  "VANFINANCE-SMALLVANS": Object.freeze({ kind: "listing", fields: Object.freeze({
    title: "TEXT", picture: "IMAGE", price: "TEXT", salePrice: "TEXT", vat: "TEXT",
    vanDescription: "TEXT", vanSpec: "TEXT", webLink: "URL", applyLink: "URL", buttonName: "TEXT",
  }) }),
  "VANFINANCE-MWB": Object.freeze({ kind: "listing", fields: Object.freeze({
    title: "TEXT", picture: "IMAGE", price: "TEXT", salePrice: "TEXT", vat: "TEXT",
    vanDescription: "TEXT", vanSpec: "TEXT", webLink: "URL", applyLink: "URL", buttonText: "TEXT",
  }) }),
  "VANFINANCE-LWBVANS": Object.freeze({ kind: "listing", fields: Object.freeze({
    title: "TEXT", picture: "IMAGE", price: "TEXT", salePrice: "TEXT", vat: "TEXT",
    vanDescription: "TEXT", vanSpec: "TEXT", webLink: "URL", applyLink: "URL", buttonText: "TEXT",
  }) }),
  "FINANCE-CREWVANS": Object.freeze({ kind: "listing", fields: Object.freeze({
    title: "TEXT", picture: "IMAGE", price: "TEXT", salePrice: "TEXT", vat: "TEXT",
    vanDescription: "TEXT", vanSpec: "TEXT", webLink: "URL", applyLink: "URL", buttonText: "TEXT",
  }) }),
  "VANFINANCE-PICKUPS": Object.freeze({ kind: "listing", fields: Object.freeze({
    title: "TEXT", picture: "IMAGE", price: "TEXT", salePrice: "TEXT", vat: "TEXT",
    vanDescription: "TEXT", vanSpec: "TEXT", webLink: "URL", applyLink: "URL", buttonText: "TEXT",
  }) }),
  "VANFINANCE-TIPPERSDROPSIDEL": Object.freeze({ kind: "listing", fields: Object.freeze({
    title: "TEXT", picture: "IMAGE", price: "TEXT", salePrice: "TEXT", vat: "TEXT",
    vanDescription: "TEXT", vanSpec: "TEXT", webLink: "URL", applyLink: "URL", buttonText: "TEXT",
  }) }),
  "VANFINANCE-ELECTRIC": Object.freeze({ kind: "listing", fields: Object.freeze({
    title: "TEXT", picture: "IMAGE", price: "TEXT", salePrice: "TEXT", vat: "TEXT",
    vanDescription: "TEXT", vanSpec: "TEXT", webLink: "URL", applyLink: "URL", buttonText: "TEXT",
  }) }),
  AUTOMATIC: Object.freeze({ kind: "listing", fields: Object.freeze({
    title: "TEXT", picture: "IMAGE", price: "TEXT", salePrice: "TEXT", vat: "TEXT",
    vanDescription: "TEXT", vanSpec: "TEXT", webLink: "URL", applyLink: "URL", buttonText: "TEXT",
  }) }),
  VANFINANCEPAGES: Object.freeze({ kind: "detail", fields: Object.freeze({
    title: "TEXT", titleText: "TEXT", priceVat: "TEXT", year: "TEXT", mileage: "TEXT",
    mainImages: "MEDIA_GALLERY", descriptionLine: "TEXT", vehicleDescriptionTextClick: "TEXT",
    vehicleSpecificationText: "TEXT", applyLink: "URL", mthPrice: "TEXT", imageCount: "TEXT",
    addToRent2Buy: "BOOLEAN", isPickupOr4X4: "BOOLEAN",
    audioAndCommunications: "TEXT", driversAssistance: "TEXT", exterior: "TEXT",
    illumination: "TEXT", interior: "TEXT", performance: "TEXT", safetyAndSecurity: "TEXT",
  }) }),
});

const FEATURE_PATTERNS = Object.freeze([
  ["Air conditioning", /\b(?:air\s*con(?:ditioning)?|a\/c)\b/i],
  ["Cruise control", /\bcruise control\b/i],
  ["Parking sensors", /\bparking (?:sensor|aid)s?\b/i],
  ["Reversing camera", /\b(?:reverse|reversing|rear) (?:parking )?camera\b/i],
  ["Bluetooth", /\bbluetooth\b/i],
  ["DAB radio", /\bdab\b/i],
  ["Apple CarPlay", /\bapple car\s*play\b/i],
  ["Android Auto", /\bandroid auto\b/i],
  ["Heated seats", /\bheated seats?\b/i],
  ["Heated windscreen", /\b(?:heated windscreen|quickclear heated windscreen|windshield defroster)\b/i],
  ["Alloy wheels", /\balloy wheels?\b/i],
  ["Satellite navigation", /\b(?:sat(?:ellite)? nav(?:igation)?|navigation system)\b/i],
  ["Power-fold mirrors", /\b(?:power fold|power-fold|folding) .*mirrors?\b/i],
]);

function clean(value, limit = 5000) {
  return String(value ?? "").trim().slice(0, limit);
}

function optionalNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatMileage(value) {
  const number = optionalNumber(value);
  return number !== null && number >= 0 ? Math.round(number).toLocaleString("en-GB") : "";
}

function formatRegistration(registration) {
  const value = normalizeFinanceRegistration(registration);
  if (!value) return "";
  if (/^[A-Z]{2}\d{2}[A-Z]{3}$/.test(value)) return `${value.slice(0, 4)} ${value.slice(4)}`;
  if (/^[A-Z]{3}\d{4}$/.test(value)) return `${value.slice(0, 3)} ${value.slice(3)}`;
  return value;
}

function yearDisplay(vehicle = {}, registration = "") {
  const year = optionalNumber(vehicle.year);
  if (year === null || year < 1900 || year > 2100) return "";
  const normalized = normalizeFinanceRegistration(registration);
  const match = normalized.match(/^[A-Z]{2}(\d{2})[A-Z]{3}$/);
  if (!match) return String(Math.trunc(year));
  const age = Number(match[1]);
  const plateYear = age >= 50 ? 2000 + age - 50 : 2000 + age;
  return plateYear === Math.trunc(year) ? `${Math.trunc(year)}/${match[1]}` : String(Math.trunc(year));
}

function sourceVatText(vehicle = {}) {
  if (vehicle.vatStatus === "plus_vat") return "+VAT";
  if (vehicle.vatStatus === "no_vat") return "N/A";
  return "";
}

function listingDescription(vehicle = {}) {
  const lineOne = [clean(vehicle.make, 80), clean(vehicle.model, 100)].filter(Boolean).join(" ").trim();
  const lineTwo = clean(vehicle.trim || vehicle.derivative, 120);
  return [lineOne || clean(vehicle.title, 160), lineTwo].filter(Boolean).join("\n");
}

function specificationItemText(item) {
  if (typeof item === "string" || typeof item === "number") return clean(item, 500);
  if (!item || typeof item !== "object") return "";
  for (const key of ["name", "label", "description", "title", "value"]) {
    const value = item[key];
    if (typeof value === "string" || typeof value === "number") {
      const text = clean(value, 500);
      if (text) return text;
    }
  }
  return "";
}

function specificationTexts(vehicle = {}) {
  const specs = vehicle.specifications || {};
  const values = [];
  for (const group of [specs.standard, specs.options]) {
    for (const item of Array.isArray(group) ? group : []) {
      const text = specificationItemText(item);
      if (text) values.push(text);
    }
  }
  return Array.from(new Set(values));
}

export function dealerKitDescriptionFacts(vehicle = {}) {
  const registration = normalizeFinanceRegistration(vehicle.registration || "");
  const rawFeatures = specificationTexts(vehicle);
  const features = [];
  for (const [label, pattern] of FEATURE_PATTERNS) {
    if (rawFeatures.some((feature) => pattern.test(feature))) features.push(label);
  }
  const year = optionalNumber(vehicle.year);
  const mileage = optionalNumber(vehicle.mileage);
  const bhp = optionalNumber(vehicle.bhp);
  return {
    registration,
    title: clean(vehicle.title, 600),
    make: clean(vehicle.make, 160),
    model: clean(vehicle.model, 200),
    derivative: clean(vehicle.derivative, 500),
    trim: clean(vehicle.trim, 240),
    bodyType: clean(vehicle.bodyType, 240),
    year: year !== null && year >= 1900 && year <= 2100 ? year : null,
    mileage: mileage !== null && mileage >= 0 ? mileage : null,
    fuel: clean(vehicle.fuel, 100),
    transmission: clean(vehicle.transmission, 100),
    colour: clean(vehicle.colour, 120),
    bhp: bhp !== null && bhp > 0 ? bhp : null,
    features,
    sourceUpdatedAt: clean(vehicle.sourceUpdatedAt, 100) || null,
  };
}

export function buildDealerKitVehicleSpecText(vehicle = {}) {
  const registration = normalizeFinanceRegistration(vehicle.registration || "");
  const bhp = optionalNumber(vehicle.bhp);
  const rows = [
    ["REGISTRATION", formatRegistration(registration)],
    ["YEAR", yearDisplay(vehicle, registration)],
    ["MILEAGE", formatMileage(vehicle.mileage)],
    ["FUEL TYPE", clean(vehicle.fuel, 100).toUpperCase()],
    ["COLOUR", clean(vehicle.colour, 120).toUpperCase()],
    ["TRANSMISSION", clean(vehicle.transmission, 100).toUpperCase()],
    ["BHP", bhp !== null && bhp > 0 ? String(Math.round(bhp)) : ""],
  ].filter(([, value]) => value);
  return rows.map(([label, value]) => `${label}: ${value}`).join("\n");
}

function buttonFields(collectionId) {
  const configuration = LISTING_COLLECTIONS[collectionId];
  if (!configuration) return {};
  return { [configuration.buttonField]: configuration.buttonText };
}

function buildListingFields(collectionId, vehicle, registration, retailPrice, monthlyPrice, vatText) {
  const fields = {
    title: registration,
    price: formatRetailPrice(retailPrice),
    salePrice: `FROM £${monthlyPrice} P/M`,
    vat: vatText,
    vanDescription: listingDescription(vehicle),
    vanSpec: buildDealerKitVehicleSpecText(vehicle),
    webLink: `https://www.vanfinancecompany.co.uk/van-finance/${registration}`,
    applyLink: `https://www.vanfinancecompany.co.uk/apply-by-reg-finance/${registration}`,
    ...buttonFields(collectionId),
  };
  if (LISTING_COLLECTIONS[collectionId]?.syncToCrm) fields.syncToCrm = "Yes";
  return fields;
}

function buildDetailFields(vehicle, decision, registration, retailPrice, monthlyPrice, vatText, imageCount) {
  return {
    title: registration,
    titleText: clean(vehicle.title, 700) || listingDescription(vehicle).replace(/\n/g, " "),
    priceVat: `${formatRetailPrice(retailPrice)} ${vatText}`.trim(),
    year: yearDisplay(vehicle, registration),
    mileage: formatMileage(vehicle.mileage),
    vehicleSpecificationText: buildDealerKitVehicleSpecText(vehicle),
    applyLink: `https://www.vanfinancecompany.co.uk/apply-by-reg-finance/${registration}`,
    mthPrice: `£${monthlyPrice}`,
    imageCount: String(imageCount),
    addToRent2Buy: Boolean(decision?.rent2buyEnabled),
    isPickupOr4X4: Array.isArray(decision?.financeCategories) && decision.financeCategories.includes("pickup_4x4"),
  };
}

export function buildDealerKitWixCreatePlan({ collection = {}, vehicle = {}, decision = {}, selectedImages = {} } = {}) {
  const collectionId = clean(collection.id || collection.collectionId, 300);
  const schema = VFC_WIX_CREATE_SCHEMA[collectionId];
  const registration = normalizeFinanceRegistration(vehicle.registration || decision.registration || "");
  const retailPrice = parseRetailPrice(vehicle.retailPrice);
  const monthlyPrice = calculateFivePercentFlatMonthly(retailPrice);
  const vatText = sourceVatText(vehicle);
  const imageCount = Array.isArray(selectedImages.ids) ? selectedImages.ids.length : Number(selectedImages.count || 0);
  const blockers = [];

  if (!schema) blockers.push({ code: "schema_not_verified", message: `No verified create schema is recorded for ${collectionId || "this Wix collection"}.` });
  if (!registration) blockers.push({ code: "missing_registration", message: "A valid registration is required for a Wix create preview." });
  if (retailPrice === null || monthlyPrice === null) blockers.push({ code: "invalid_retail", message: "A valid DealerKit retail price is required for a Wix create preview." });
  if (!vatText) blockers.push({ code: "vat_display_unverified", message: "DealerKit VAT status is not yet mapped to a verified Van Finance Wix display value." });

  let proposedFields = {};
  let pendingFields = [];
  if (schema && registration && retailPrice !== null && monthlyPrice !== null && vatText) {
    if (schema.kind === "detail") {
      proposedFields = buildDetailFields(vehicle, decision, registration, retailPrice, monthlyPrice, vatText, imageCount);
      pendingFields = [
        "mainImages: reviewed images must be imported to Wix Media first",
        "descriptionLine: original AI vehicle summary requires generation and human review",
        "vehicleDescriptionTextClick: original AI vehicle description requires generation and human review",
        "equipment groups: DealerKit specifications need a verified category mapping before writing",
      ];
    } else {
      proposedFields = buildListingFields(collectionId, vehicle, registration, retailPrice, monthlyPrice, vatText);
      pendingFields = ["picture: reviewed primary image must be imported to Wix Media first"];
    }
  }

  return {
    readOnly: true,
    liveCreateLocked: true,
    schemaVerified: Boolean(schema),
    schemaVerifiedAt: schema ? VFC_WIX_CREATE_SCHEMA_VERIFIED_AT : null,
    collectionId,
    kind: schema?.kind || collection.kind || null,
    proposedFields,
    pendingFields,
    blockers,
    canCreateLater: Boolean(schema && !blockers.length),
    descriptionDraft: schema?.kind === "detail" ? {
      status: "pending_ai_generation_and_review",
      editable: true,
      sourcePolicy: "Generate original Van Finance Company copy from verified DealerKit facts only; never copy supplier advertising text and never invent equipment.",
      sourceFacts: dealerKitDescriptionFacts(vehicle),
      fixedReassurance: VFC_FIXED_VEHICLE_REASSURANCE,
    } : null,
  };
}

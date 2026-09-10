import { normalizeFinanceRegistration } from "./vanscoWixPrice.js";
import { buildDealerKitVehicleSpecText } from "./dealerKitWixCreatePlan.js";
import {
  RENT2BUY_CATEGORY_COLLECTIONS,
  calculateRent2BuyPricing,
  normalizeRent2BuyCategories,
} from "./dealerKitRent2BuyPlan.js";

const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);

export const VAN_FINANCE_RENT2BUY_WIX_SITE_ID = "85f11c52-ee54-495d-aaec-a351831709b5";
export const STANDALONE_RENT2BUY_WIX_SITE_ID = "548f025b-673c-47f7-9bb6-383ab5d946e4";

const COLLECTION_FIELDS = Object.freeze({
  ALLRENT2BUYVANS: { image: "picture", initial: "initialRental2250Vat", spec: "vanSpec", headline: "mitsubishiL200Barbarian", link: "webLink", button: "buttonText", buttonText: "VIEW VEHICLE" },
  SmallVans: { image: "picture", initial: "initialRental2250Vat", spec: "vanSpec", headline: "mitsubishiL200Barbarian", link: "webLink", button: "buttonText", buttonText: "VIEW VEHICLE" },
  MEDIUMVANS: { image: "picture", initial: "initialRental2250Vat", spec: "vanSpec", headline: "mitsubishiL200Barbarian", link: "websiteLink", button: "buttonTex", buttonText: "VIEW VEHICLE" },
  LWBVANS: { image: "picture", initial: "initialRental2385Vat", spec: "specText", headline: "fordTransit46017Seats", link: "webLink", button: "button", buttonText: "VIEW VEHICLE" },
  CREWVANS: { image: "image", initial: "initialRental2385Vat", spec: "vanSpec", headline: "fordTransit46017SeatBus", link: "webLink", button: "buttonText", buttonText: "VIEW VEHICLE" },
  AUTOMATICVANS: { image: "picture", initial: "initialRental2250Vat", spec: "vanSpec", headline: "mitsubishiL200Barbarian", link: "webLink", button: "buttonText", buttonText: "VIEW VEHICLE" },
  ELECTRICVANS: { image: "picture", initial: "initialRental2250Vat", spec: "vanSpec", headline: "mitsubishiL200Barbarian", link: "webLink", button: "buttonText", buttonText: "VIEW VEHICLE" },
  PICKUPS: { image: "picture", initial: "initialRental2085Vat", spec: "vanDetails", headline: "description", link: "pickupLink", button: "buttonName", buttonText: "VIEW VEHICLE" },
  "TIPPERS-LUTONS-DROPSDIES": { image: "picture", initial: "initialRental2250Vat", spec: "vanSpec", headline: "mitsubishiL200Barbarian", link: "webLink", button: "buttonText", buttonText: "VIEW VEHICLE" },
});

function yearDisplay(vehicle = {}, registration = "") {
  const year = Number(vehicle.year);
  if (!Number.isFinite(year)) return "";
  const reg = normalizeFinanceRegistration(registration);
  const match = reg.match(/^[A-Z]{2}(\d{2})[A-Z]{3}$/);
  return match ? `${Math.trunc(year)}/${match[1]}` : String(Math.trunc(year));
}

function specText(vehicle = {}) {
  return buildDealerKitVehicleSpecText(vehicle)
    .split(/\r?\n/)
    .filter((line) => !/^COMBINED MPG:/i.test(line))
    .map((line) => line.replace(/^FUEL:/i, "FUEL TYPE:").replace(/^EURO STATUS:/i, "EURO:"))
    .join("\n");
}

function titleText(vehicle = {}) {
  return clean(vehicle.title, 700) || [vehicle.make, vehicle.model, vehicle.derivative].map((v) => clean(v, 250)).filter(Boolean).join(" ");
}

function listingHeadline(vehicle = {}) {
  const make = clean(vehicle.make, 80);
  const model = clean(vehicle.model, 100);
  const identity = [make, model].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const lead = clean(vehicle.description, 1200).split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  if (lead && lead.length <= 140 && identity && lead.toLowerCase().startsWith(identity.toLowerCase()) && !/[.!?]$/.test(lead)) return lead;
  const derivative = clean(vehicle.derivative, 240).replace(/\s+/g, " ").trim();
  return clean([identity, derivative].filter(Boolean).join(" ") || titleText(vehicle), 140);
}

export function rent2BuyDetailUrl(registration, siteId = VAN_FINANCE_RENT2BUY_WIX_SITE_ID) {
  const reg = normalizeFinanceRegistration(registration).toLowerCase();
  return siteId === STANDALONE_RENT2BUY_WIX_SITE_ID
    ? `https://www.rent2buyvans.co.uk/van-pages/${reg}`
    : `https://www.vanfinancecompany.co.uk/guaranteed-rent2buy-vans/${reg}`;
}

function applicationUrl(registration) {
  return `https://vanfinance.co/rent2buy/apply?registration=${normalizeFinanceRegistration(registration)}&source=r2b-wix`;
}

function initialListingText(pricing) {
  return pricing.vatStatus === "plus_vat" ? `INITIAL RENTAL £${pricing.upfront} +VAT` : `INITIAL RENTAL £${pricing.upfront}`;
}

function monthlyDetailText(pricing) {
  return pricing.vatStatus === "plus_vat"
    ? `£${pricing.monthly} +Vat (£${pricing.monthlyIncVat} INC VAT)`
    : `£${pricing.monthly}`;
}

function upfrontDetailText(pricing) {
  return pricing.vatStatus === "plus_vat"
    ? `£${pricing.upfront} +Vat (£${pricing.upfrontIncVat} INC VAT)`
    : `£${pricing.upfront}`;
}

function buildListingData(collectionId, vehicle, pricing, imageUrl) {
  const config = COLLECTION_FIELDS[collectionId];
  if (!config) throw new Error(`Rent2Buy collection ${collectionId} is not mapped.`);
  const registration = normalizeFinanceRegistration(vehicle.registration || "");
  const data = {
    title: registration,
    mth: `£${pricing.monthly} PM`,
    weekly: `x${pricing.followingPayments}`,
    [config.image]: imageUrl,
    [config.initial]: initialListingText(pricing),
    [config.headline]: listingHeadline(vehicle),
    [config.spec]: specText(vehicle),
    [config.link]: rent2BuyDetailUrl(registration),
    [config.button]: config.buttonText,
  };
  if (pricing.vatStatus === "plus_vat" && collectionId === "PICKUPS") data.vat = "+VAT";
  return data;
}

function buildDetailData(vehicle, pricing, galleryUrls) {
  const registration = normalizeFinanceRegistration(vehicle.registration || "");
  const description = clean(vehicle.description, 10000) || titleText(vehicle);
  return {
    title: registration,
    titleText: titleText(vehicle),
    year: yearDisplay(vehicle, registration),
    mediaGallery: galleryUrls,
    descriptionText: description,
    vehcleTickDescription: description,
    specText: specText(vehicle),
    intialRentalCharge: upfrontDetailText(pricing),
    numberOfMonths: `${pricing.followingPayments}X MONTHLY PAYMENTS`,
    monthlyPayments: monthlyDetailText(pricing),
    weeklyPrice: `£${pricing.monthly} P/M`,
    applyLink: applicationUrl(registration),
    numberOfImages: String(galleryUrls.length),
    rent2BuyVansTitle: rent2BuyDetailUrl(registration),
  };
}

export function rent2BuyTargetForSite(target = {}, site = {}, pricing = null) {
  const siteId = clean(site.siteId || site.id, 500);
  const collectionId = clean(target.collectionId, 300);
  const data = { ...(target.data || {}) };
  const registration = normalizeFinanceRegistration(data.title || "");
  const config = COLLECTION_FIELDS[collectionId];
  if (target.kind === "listing" && config?.link && registration) data[config.link] = rent2BuyDetailUrl(registration, siteId);
  if (target.kind === "detail" && registration) data.rent2BuyVansTitle = rent2BuyDetailUrl(registration, siteId);
  if (siteId === STANDALONE_RENT2BUY_WIX_SITE_ID && collectionId === "ALLRENT2BUYVANS") {
    data.weeklyPrice1 = data.weekly;
    data.syncToCRM = "Yes";
    if (pricing?.monthly) data.monthlyPriceNumeric = pricing.monthly;
  }
  return {
    ...target,
    siteId: siteId || null,
    siteLabel: clean(site.siteLabel || site.label, 200) || null,
    siteRole: clean(site.siteRole || site.role, 80) || null,
    data,
  };
}

export function buildDealerKitRent2BuyWixPlan({ vehicle = {}, decision = {}, imageSets = {} } = {}) {
  const blockers = [];
  const registration = normalizeFinanceRegistration(vehicle.registration || decision.registration || "");
  const categorySource = Array.isArray(decision.rent2buyCategories) && decision.rent2buyCategories.length
    ? decision.rent2buyCategories
    : decision.financeCategories;
  const categories = normalizeRent2BuyCategories(categorySource || []);
  const pricing = calculateRent2BuyPricing({
    retailPrice: vehicle.retailPrice,
    mileage: vehicle.mileage,
    categories,
    vatStatus: vehicle.vatStatus,
  });
  const rent2buyImages = imageSets.rent2buy || {};

  if (!decision.rent2buyEnabled) return { enabled: false, registration, blockers: [], targets: [] };
  if (!registration) blockers.push({ code: "missing_registration", message: "A valid registration is required for Rent2Buy publishing." });
  if (!pricing) blockers.push({ code: "invalid_rent2buy_pricing", message: "Rent2Buy pricing could not be derived from retail price and mileage." });
  if (!rent2buyImages.ready || !rent2buyImages.mainUrl) blockers.push({ code: "rent2buy_template_not_ready", message: "Select a live-verified READY Rent2Buy template image first." });
  if (!Array.isArray(rent2buyImages.galleryUrls) || !rent2buyImages.galleryUrls.length) blockers.push({ code: "rent2buy_gallery_not_ready", message: "Rent2Buy gallery images are not ready in Wix Media." });

  const selectedCollections = categories.map((key) => RENT2BUY_CATEGORY_COLLECTIONS[key]).filter(Boolean);
  const targets = pricing && rent2buyImages.mainUrl
    ? selectedCollections.map((collectionId) => ({ collectionId, kind: "listing", data: buildListingData(collectionId, vehicle, pricing, rent2buyImages.mainUrl) }))
    : [];
  if (pricing && rent2buyImages.galleryUrls?.length) {
    targets.push({ collectionId: "VANPAGES", kind: "detail", data: buildDetailData(vehicle, pricing, rent2buyImages.galleryUrls) });
  }

  return {
    enabled: true,
    registration,
    categories,
    pricing,
    targets,
    blockers,
    canPublish: blockers.length === 0 && targets.length >= 2,
  };
}

import { normalizeFinanceRegistration } from "./vanscoWixPrice.js";
import {
  RENT2BUY_CATEGORY_COLLECTIONS,
  calculateRent2BuyPricing,
  normalizeRent2BuyCategories,
} from "./dealerKitRent2BuyPlan.js";

const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);

const COLLECTION_FIELDS = Object.freeze({
  ALLRENT2BUYVANS: { image: "picture", initial: "initialRental2250Vat", spec: "vanSpec", link: "webLink", button: "buttonText", buttonText: "VIEW VEHICLE" },
  SmallVans: { image: "picture", initial: "initialRental2250Vat", spec: "vanSpec", link: "webLink", button: "buttonText", buttonText: "VIEW VEHICLE" },
  MEDIUMVANS: { image: "picture", initial: "initialRental2250Vat", spec: "vanSpec", link: "websiteLink", button: "buttonTex", buttonText: "VIEW VEHICLE" },
  LWBVANS: { image: "picture", initial: "initialRental2385Vat", spec: "specText", link: "webLink", button: "button", buttonText: "VIEW VEHICLE" },
  CREWVANS: { image: "image", initial: "initialRental2385Vat", spec: "vanSpec", link: "webLink", button: "buttonText", buttonText: "VIEW VEHICLE" },
  AUTOMATICVANS: { image: "picture", initial: "initialRental2250Vat", spec: "vanSpec", link: "webLink", button: "buttonText", buttonText: "VIEW VEHICLE" },
  ELECTRICVANS: { image: "picture", initial: "initialRental2250Vat", spec: "vanSpec", link: "webLink", button: "buttonText", buttonText: "VIEW VEHICLE" },
  PICKUPS: { image: "picture", initial: "initialRental2085Vat", spec: "vanDetails", link: "pickupLink", button: "buttonName", buttonText: "VIEW VEHICLE" },
  "TIPPERS-LUTONS-DROPSDIES": { image: "picture", initial: "initialRental2250Vat", spec: "vanSpec", link: "webLink", button: "buttonText", buttonText: "VIEW VEHICLE" },
});

function formatRegistration(registration) {
  const value = normalizeFinanceRegistration(registration);
  if (/^[A-Z]{2}\d{2}[A-Z]{3}$/.test(value)) return `${value.slice(0, 4)} ${value.slice(4)}`;
  if (/^[A-Z]{3}\d{4}$/.test(value)) return `${value.slice(0, 3)} ${value.slice(3)}`;
  return value;
}

function yearDisplay(vehicle = {}, registration = "") {
  const year = Number(vehicle.year);
  if (!Number.isFinite(year)) return "";
  const reg = normalizeFinanceRegistration(registration);
  const match = reg.match(/^[A-Z]{2}(\d{2})[A-Z]{3}$/);
  return match ? `${Math.trunc(year)}/${match[1]}` : String(Math.trunc(year));
}

function specText(vehicle = {}, registration = "") {
  return [
    `REGISTRATION: ${formatRegistration(registration)}`,
    yearDisplay(vehicle, registration) && `YEAR: ${yearDisplay(vehicle, registration)}`,
    Number.isFinite(Number(vehicle.mileage)) && `MILEAGE: ${Math.round(Number(vehicle.mileage)).toLocaleString("en-GB")}`,
    clean(vehicle.fuel, 100) && `FUEL TYPE: ${clean(vehicle.fuel, 100).toUpperCase()}`,
    clean(vehicle.colour, 120) && `COLOUR: ${clean(vehicle.colour, 120).toUpperCase()}`,
    clean(vehicle.transmission, 100) && `TRANSMISSION: ${clean(vehicle.transmission, 100).toUpperCase()}`,
    Number(vehicle.bhp) > 0 && `BHP: ${Math.round(Number(vehicle.bhp))}`,
  ].filter(Boolean).join("\n");
}

function titleText(vehicle = {}) {
  return clean(vehicle.title, 700) || [vehicle.make, vehicle.model, vehicle.derivative].map((v) => clean(v, 250)).filter(Boolean).join(" ");
}

function detailUrl(registration) {
  return `https://www.vanfinancecompany.co.uk/guaranteed-rent2buy-vans/${normalizeFinanceRegistration(registration).toLowerCase()}`;
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
    [config.spec]: specText(vehicle, registration),
    [config.link]: detailUrl(registration),
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
    specText: specText(vehicle, registration),
    intialRentalCharge: upfrontDetailText(pricing),
    numberOfMonths: `${pricing.followingPayments}X MONTHLY PAYMENTS`,
    monthlyPayments: monthlyDetailText(pricing),
    weeklyPrice: `£${pricing.monthly} P/M`,
    applyLink: applicationUrl(registration),
    numberOfImages: String(galleryUrls.length),
    rent2BuyVansTitle: detailUrl(registration),
  };
}

export function buildDealerKitRent2BuyWixPlan({ vehicle = {}, decision = {}, imageSets = {} } = {}) {
  const blockers = [];
  const registration = normalizeFinanceRegistration(vehicle.registration || decision.registration || "");
  const categories = normalizeRent2BuyCategories(decision.financeCategories || []);
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

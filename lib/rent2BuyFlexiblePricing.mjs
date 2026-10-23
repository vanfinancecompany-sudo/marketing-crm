/**
 * Rent2Buy configurable pricing (Felix Reeves matrix, 30 September 2026).
 * Pure calculation module. NOT connected to live Wix publishing.
 * All money returned here is GBP ex VAT unless explicitly marked inc VAT.
 * Keep DealerKit/Wix stock status and finance pricing out of this module.
 */

export const RENT2BUY_MATRIX_TERMS = Object.freeze([12, 18, 24, 30, 36, 42, 48]);
export const RENT2BUY_MATRIX_MILEAGE_BANDS = Object.freeze([1000, 1500, 2000, 2500, 3000, 3500, 4000]);
export const RENT2BUY_MIN_INITIAL_EX_VAT = 1000;
export const RENT2BUY_VAT_RATE = 0.20;

const finitePositive = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const amount = typeof value === "number"
    ? value : Number(String(value).replace(/[£,\s]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
};
const roundToTen = (value) => Math.round(value / 10) * 10;
const roundUpFive = (value) => Math.ceil((value - 1e-9) / 5) * 5;
const incVat = (value) => Math.round((value * (1 + RENT2BUY_VAT_RATE) + Number.EPSILON) * 100) / 100;
const invalid = (reason) => ({ status: "unavailable", reason });

function registrationYear(value) {
  const match = String(value ?? "").trim().match(/^(\d{4})/);
  const year = match ? Number(match[1]) : null;
  return year && year >= 1900 ? year : null;
}

export function rent2BuyMaximumTerm({ registrationYear: registered, vehicleMileage, milesPerMonth = 1000, currentYear = new Date().getUTCFullYear() } = {}) {
  const year = registrationYear(registered);
  const mileageText = String(vehicleMileage ?? "").trim().replace(/,/g, "").replace(/\s*miles?$/i, "");
  const mileage = mileageText === "" ? NaN : Number(mileageText);
  if (!year || !Number.isFinite(mileage) || mileage < 0 ||
      !Number.isInteger(currentYear) || year > currentYear ||
      !RENT2BUY_MATRIX_MILEAGE_BANDS.includes(Number(milesPerMonth))) return null;

  const vehicleCap = currentYear - year <= 4 && mileage <= 50000 ? 48 : 36;
  const requestedMiles = Number(milesPerMonth);
  const mileageCap = requestedMiles <= 2000 ? 48
    : requestedMiles <= 3000 ? 36
    : requestedMiles === 3500 ? 30 : 24;
  return Math.min(vehicleCap, mileageCap);
}

export function rent2BuyInitialRentalLadder(retailPrice) {
  const retail = finitePositive(retailPrice);
  if (!retail) return null;
  // Minimum is always computed from 36 months / 3,000 miles,
  // regardless of the selected term or mileage allowance.
  const base36 = retail / 36 + (retail * 0.25) / 12;
  const minimum = Math.max(RENT2BUY_MIN_INITIAL_EX_VAT, roundToTen(base36 * 3));
  return [1, 1.5, 2, 2.5].map((factor) => roundToTen(minimum * factor));
}

function validatedSpecialDeal(deal) {
  if (!deal || deal.enabled !== true) return null;
  const monthly = finitePositive(deal.monthlyExVat);
  const upfront = finitePositive(deal.initialExVat);
  const term = Number(deal.termMonths);
  const miles = Number(deal.milesPerMonth);
  if (!monthly || !upfront || upfront < RENT2BUY_MIN_INITIAL_EX_VAT ||
      !RENT2BUY_MATRIX_TERMS.includes(term) ||
      !RENT2BUY_MATRIX_MILEAGE_BANDS.includes(miles)) return null;
  return { monthly, upfront, term, miles };
}

export function quoteRent2BuyMatrix({
  retailPrice,
  registrationYear: registered,
  vehicleMileage,
  currentYear = new Date().getUTCFullYear(),
  termMonths,
  milesPerMonth,
  initialRentalExVat,
  specialDeal,
} = {}) {
  const retail = finitePositive(retailPrice);
  const ladder = rent2BuyInitialRentalLadder(retail);
  if (!retail || !ladder) return invalid("missing_retail_price");
  const special = validatedSpecialDeal(specialDeal);
  if (specialDeal?.enabled === true && !special) return invalid("invalid_special_deal");

  const miles = milesPerMonth === undefined ? (special?.miles ?? 1000) : Number(milesPerMonth);
  const allowedTerm = rent2BuyMaximumTerm({
    registrationYear: registered, vehicleMileage, milesPerMonth: miles, currentYear,
  });
  if (!allowedTerm) return invalid("missing_or_invalid_vehicle_details");
  const term = termMonths === undefined ? (special?.term ?? allowedTerm) : Number(termMonths);
  if (!RENT2BUY_MATRIX_TERMS.includes(term) || term > allowedTerm)
    return invalid("term_not_allowed");

  const upfront = initialRentalExVat === undefined
    ? (special?.upfront ?? ladder[0]) : finitePositive(initialRentalExVat);
  if (!upfront || upfront < RENT2BUY_MIN_INITIAL_EX_VAT)
    return invalid("initial_rental_below_minimum");

  // A special deal is a fixed agreed configuration, not a blanket discount.
  const isSpecial = special && term === special.term && miles === special.miles && upfront === special.upfront;
  if (!isSpecial && !ladder.includes(upfront))
    return invalid("initial_rental_not_on_matrix_ladder");

  const mileageAdjustment = (miles - 3000) * 0.05;
  const extraInitialDiscount = (upfront - ladder[0]) * 1.5 / term;
  const calculated = retail / term + (retail * 0.25) / 12 +
    mileageAdjustment - extraInitialDiscount;
  if (!isSpecial && calculated <= 0) return invalid("price_on_application");

  const monthlyExVat = isSpecial ? special.monthly : roundUpFive(calculated);
  return {
    status: "ok",
    pricingMode: isSpecial ? "special" : "matrix",
    monthlyExVat,
    monthlyIncVat: incVat(monthlyExVat),
    initialExVat: upfront,
    initialIncVat: incVat(upfront),
    termMonths: term,
    milesPerMonth: miles,
    minimumInitialExVat: ladder[0],
    initialRentalOptionsExVat: ladder,
    maximumTermMonths: allowedTerm,
    // Used to show the special-offer restriction and preserve quote provenance.
    specialDealApplied: Boolean(isSpecial),
  };
}

export function availableRent2BuyTerms(options = {}) {
  const max = rent2BuyMaximumTerm(options);
  if (!max) return [];
  return RENT2BUY_MATRIX_TERMS.filter((term) => term <= max);
}

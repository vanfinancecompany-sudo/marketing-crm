import { normalizeFinanceRegistration, parseRetailPrice } from "./vanscoWixPrice.js";
import { rent2BuyRentalVatPolicy } from "./dealerKitVatPolicy.js";
import { applyRent2BuyInitialRentalFloor, formatRent2BuyAmount } from "./rent2BuyInitialRental.js";

export const DEALERKIT_RENT2BUY_SETTINGS_TABLE = "dealerkit_rent2buy_settings";
export const DEALERKIT_RENT2BUY_SCHEMA_VERIFIED_AT = "2026-09-10";
export const RENT2BUY_MILEAGE_THRESHOLD = 42000;

export const RENT2BUY_TERM_RULES = Object.freeze({
  36: Object.freeze({ termMonths: 36, upliftPercent: 75, grossFactor: 1.75 }),
  48: Object.freeze({ termMonths: 48, upliftPercent: 90, grossFactor: 1.90 }),
});

export const RENT2BUY_CATEGORY_COLLECTIONS = Object.freeze({
  all_vans: "ALLRENT2BUYVANS",
  small: "SmallVans",
  medium_mwb: "MEDIUMVANS",
  lwb_large: "LWBVANS",
  crew: "CREWVANS",
  automatic: "AUTOMATICVANS",
  electric: "ELECTRICVANS",
  pickup_4x4: "PICKUPS",
  tipper_dropside_luton: "TIPPERS-LUTONS-DROPSDIES",
});

export const RENT2BUY_CATEGORY_KEYS = Object.freeze(Object.keys(RENT2BUY_CATEGORY_COLLECTIONS));

const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);

function optionalNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && !value.trim()) return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function currencyNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

export function normalizeRent2BuyTerm(value) {
  const number = Number(value);
  return RENT2BUY_TERM_RULES[number] ? number : null;
}

export function deriveRent2BuyTermFromMileage(value) {
  const mileage = optionalNumber(value);
  if (mileage === null || mileage < 0) {
    return { termMonths: null, mileage: null, blocker: "DealerKit mileage is required to determine the Rent2Buy term." };
  }
  if (mileage === RENT2BUY_MILEAGE_THRESHOLD) {
    return {
      termMonths: null,
      mileage,
      blocker: "Mileage is exactly 42,000. The Rent2Buy rule defines under and over 42,000 only, so publishing is held for manual review.",
    };
  }
  return {
    termMonths: mileage < RENT2BUY_MILEAGE_THRESHOLD ? 48 : 36,
    mileage,
    blocker: null,
  };
}

export function normalizeRent2BuyCategories(values = []) {
  const allowed = new Set(RENT2BUY_CATEGORY_KEYS);
  const categories = Array.from(new Set((Array.isArray(values) ? values : [])
    .map((value) => clean(value, 80))
    .filter((value) => allowed.has(value))));
  if (!categories.includes("all_vans")) categories.unshift("all_vans");
  return categories;
}

export function rent2BuyPaymentStructure({ termMonths, categories = [] } = {}) {
  const term = normalizeRent2BuyTerm(termMonths);
  if (!term) return null;
  const normalizedCategories = normalizeRent2BuyCategories(categories);
  const pickup = normalizedCategories.includes("pickup_4x4");

  // Current live Rent2Buy structure plus Stuart's pickup rule, confirmed 10 Sep 2026:
  // ordinary vans calculate 3 rentals upfront and display 36X / 48X monthly payments.
  // pickup/4x4 stock calculates 4 rentals upfront followed by 35X / 47X monthly payments.
  // The advertised initial-rental floor is applied centrally after this structure is calculated.
  return {
    termMonths: term,
    pickup,
    upfrontMonths: pickup ? 4 : 3,
    followingPayments: pickup ? term - 1 : term,
    paymentCountLabel: `${pickup ? term - 1 : term}X MONTHLY PAYMENTS`,
  };
}

export function calculateRent2BuyPricing({ retailPrice, mileage, termMonths, categories = [], vatStatus = "unknown" } = {}) {
  const retail = parseRetailPrice(retailPrice);
  const derived = termMonths ? { termMonths: normalizeRent2BuyTerm(termMonths), mileage: optionalNumber(mileage), blocker: null } : deriveRent2BuyTermFromMileage(mileage);
  const term = derived.termMonths;
  const structure = rent2BuyPaymentStructure({ termMonths: term, categories });
  const rule = term ? RENT2BUY_TERM_RULES[term] : null;
  if (retail === null || retail < 1000 || retail > 100000 || !rule || !structure || derived.blocker) return null;

  const monthly = currencyNumber((retail * rule.grossFactor) / rule.termMonths);
  if (!monthly || monthly <= 0) return null;
  const calculatedUpfront = monthly * structure.upfrontMonths;
  const upfront = applyRent2BuyInitialRentalFloor(calculatedUpfront);
  if (!upfront) return null;
  // DEALERKIT_RENT2BUY_VAT_POLICY: Rent2Buy rental payments are always advertised + VAT.
  // The donor vehicle VAT state is retained separately for audit only.
  const rentalVatPolicy = rent2BuyRentalVatPolicy(vatStatus);

  return {
    retailPrice: retail,
    mileage: derived.mileage,
    termMonths: rule.termMonths,
    upliftPercent: rule.upliftPercent,
    grossFactor: rule.grossFactor,
    monthly,
    upfront,
    ...structure,
    sourceVatStatus: rentalVatPolicy.sourceVatStatus,
    vatStatus: rentalVatPolicy.vatStatus,
    vatKnown: rentalVatPolicy.vatKnown,
    monthlyIncVat: currencyNumber(monthly * rentalVatPolicy.vatMultiplier),
    upfrontIncVat: currencyNumber(upfront * rentalVatPolicy.vatMultiplier),
    monthlyDisplay: `£${monthly} +VAT (£${currencyNumber(monthly * rentalVatPolicy.vatMultiplier)} INC VAT)`,
    upfrontDisplay: `£${formatRent2BuyAmount(upfront)} +VAT (£${formatRent2BuyAmount(currencyNumber(upfront * rentalVatPolicy.vatMultiplier))} INC VAT)`,
    listingMonthlyDisplay: `£${monthly} PM`,
    listingInitialDisplay: `INITIAL RENTAL £${formatRent2BuyAmount(upfront)} +VAT`,
  };
}

export function buildRent2BuySettingsRow({ vehicle = {}, settings = {} } = {}) {
  const supplierStockId = clean(vehicle.supplierStockId || settings.supplierStockId, 300);
  const registration = normalizeFinanceRegistration(vehicle.registration || settings.registration || "");
  const derived = deriveRent2BuyTermFromMileage(vehicle.mileage);
  const categories = normalizeRent2BuyCategories(settings.categories);
  if (!supplierStockId) throw new Error("DealerKit stock ID is required for Rent2Buy settings.");
  if (!registration) throw new Error("A valid vehicle registration is required for Rent2Buy settings.");
  if (derived.blocker || !derived.termMonths) throw new Error(derived.blocker || "DealerKit mileage could not determine the Rent2Buy term.");

  return {
    supplier_stock_id: supplierStockId,
    registration,
    term_months: derived.termMonths,
    categories,
    reviewed_source_updated_at: clean(vehicle.sourceUpdatedAt || settings.reviewedSourceUpdatedAt, 100) || null,
    updated_at: new Date().toISOString(),
  };
}

export function rowToRent2BuySettings(row = {}) {
  if (!row || typeof row !== "object") return null;
  return {
    persisted: true,
    supplierStockId: clean(row.supplier_stock_id, 300),
    registration: normalizeFinanceRegistration(row.registration || ""),
    termMonths: normalizeRent2BuyTerm(row.term_months),
    categories: normalizeRent2BuyCategories(row.categories),
    reviewedSourceUpdatedAt: row.reviewed_source_updated_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

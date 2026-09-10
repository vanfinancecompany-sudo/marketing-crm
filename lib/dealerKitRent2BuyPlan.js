import { normalizeFinanceRegistration, parseRetailPrice } from "./vanscoWixPrice.js";

export const DEALERKIT_RENT2BUY_SETTINGS_TABLE = "dealerkit_rent2buy_settings";
export const DEALERKIT_RENT2BUY_SCHEMA_VERIFIED_AT = "2026-09-10";

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

function currencyNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

export function normalizeRent2BuyTerm(value) {
  const number = Number(value);
  return RENT2BUY_TERM_RULES[number] ? number : null;
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

  // Current live Rent2Buy structure verified 10 Sep 2026:
  // ordinary vans use a 3-rental initial payment and show 36X / 48X monthly payments.
  // pickup/4x4 stock uses 4 rentals upfront and then 35X / 47X monthly payments.
  return {
    termMonths: term,
    pickup,
    upfrontMonths: pickup ? 4 : 3,
    followingPayments: pickup ? term - 1 : term,
    paymentCountLabel: `${pickup ? term - 1 : term}X MONTHLY PAYMENTS`,
  };
}

export function calculateRent2BuyPricing({ retailPrice, termMonths, categories = [], vatStatus = "unknown" } = {}) {
  const retail = parseRetailPrice(retailPrice);
  const term = normalizeRent2BuyTerm(termMonths);
  const structure = rent2BuyPaymentStructure({ termMonths: term, categories });
  const rule = term ? RENT2BUY_TERM_RULES[term] : null;
  if (retail === null || retail < 1000 || retail > 100000 || !rule || !structure) return null;

  const monthly = currencyNumber((retail * rule.grossFactor) / rule.termMonths);
  if (!monthly || monthly <= 0) return null;
  const upfront = monthly * structure.upfrontMonths;
  const plusVat = clean(vatStatus, 80) === "plus_vat";
  const noVat = clean(vatStatus, 80) === "no_vat";
  const vatKnown = plusVat || noVat;

  return {
    retailPrice: retail,
    termMonths: rule.termMonths,
    upliftPercent: rule.upliftPercent,
    grossFactor: rule.grossFactor,
    monthly,
    upfront,
    ...structure,
    vatStatus: clean(vatStatus, 80) || "unknown",
    vatKnown,
    monthlyIncVat: plusVat ? currencyNumber(monthly * 1.2) : monthly,
    upfrontIncVat: plusVat ? currencyNumber(upfront * 1.2) : upfront,
    monthlyDisplay: plusVat
      ? `£${monthly} +VAT (£${currencyNumber(monthly * 1.2)} INC VAT)`
      : `£${monthly}`,
    upfrontDisplay: plusVat
      ? `£${upfront} +VAT (£${currencyNumber(upfront * 1.2)} INC VAT)`
      : `£${upfront}`,
    listingMonthlyDisplay: `£${monthly} PM`,
    listingInitialDisplay: plusVat ? `INITIAL RENTAL £${upfront} +VAT` : `INITIAL RENTAL £${upfront}`,
  };
}

export function buildRent2BuySettingsRow({ vehicle = {}, settings = {} } = {}) {
  const supplierStockId = clean(vehicle.supplierStockId || settings.supplierStockId, 300);
  const registration = normalizeFinanceRegistration(vehicle.registration || settings.registration || "");
  const termMonths = normalizeRent2BuyTerm(settings.termMonths);
  const categories = normalizeRent2BuyCategories(settings.categories);
  if (!supplierStockId) throw new Error("DealerKit stock ID is required for Rent2Buy settings.");
  if (!registration) throw new Error("A valid vehicle registration is required for Rent2Buy settings.");
  if (!termMonths) throw new Error("Choose either 36 or 48 months for Rent2Buy.");

  return {
    supplier_stock_id: supplierStockId,
    registration,
    term_months: termMonths,
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

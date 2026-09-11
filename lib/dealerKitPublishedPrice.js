import {
  VANFINANCE_CO_WAS_PRICE_FIELD,
  calculateFivePercentFlatMonthly,
  formatRetailPrice,
  parseRetailPrice,
  retailPriceWithReduction,
  separateWasPriceForReduction,
} from "./vanscoWixPrice.js";
import { calculateRent2BuyPricing } from "./dealerKitRent2BuyPlan.js";

const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);

export const CAR_WIX_PRICE_COLLECTIONS = Object.freeze([
  { id: "CARFINANCE", label: "Car Finance - All Cars", kind: "listing" },
  { id: "CARPAGES", label: "Car Finance Pages", kind: "detail" },
]);

export const RENT2BUY_PRICE_COLLECTIONS = Object.freeze([
  { id: "ALLRENT2BUYVANS", label: "Rent2Buy - All Vans", kind: "listing", initialField: "initialRental2250Vat" },
  { id: "SmallVans", label: "Rent2Buy - Small Vans", kind: "listing", initialField: "initialRental2250Vat" },
  { id: "MEDIUMVANS", label: "Rent2Buy - Medium Vans", kind: "listing", initialField: "initialRental2250Vat" },
  { id: "LWBVANS", label: "Rent2Buy - LWB Vans", kind: "listing", initialField: "initialRental2385Vat" },
  { id: "CREWVANS", label: "Rent2Buy - Crew Vans", kind: "listing", initialField: "initialRental2385Vat" },
  { id: "AUTOMATICVANS", label: "Rent2Buy - Automatic Vans", kind: "listing", initialField: "initialRental2250Vat" },
  { id: "ELECTRICVANS", label: "Rent2Buy - Electric Vans", kind: "listing", initialField: "initialRental2250Vat" },
  { id: "PICKUPS", label: "Rent2Buy - Pickups", kind: "listing", initialField: "initialRental2085Vat" },
  { id: "TIPPERS-LUTONS-DROPSDIES", label: "Rent2Buy - Tippers / Dropsides / Lutons", kind: "listing", initialField: "initialRental2250Vat" },
  { id: "VANPAGES", label: "Rent2Buy Pages", kind: "detail" },
]);

function hasWasField(item) {
  return Object.prototype.hasOwnProperty.call(item?.data || {}, VANFINANCE_CO_WAS_PRICE_FIELD);
}

export function buildCarWixPricePatch(collection, item, retailPrice) {
  const retail = parseRetailPrice(retailPrice);
  const monthly = calculateFivePercentFlatMonthly(retail);
  if (!collection || !item?.id || retail === null || monthly === null) return null;

  if (collection.kind === "detail") {
    const currentDisplay = clean(item?.data?.priceVat, 500);
    const fields = {
      priceVat: retailPriceWithReduction(currentDisplay, retail, { preserveAffixes: true }),
      salePrice: `£${monthly}`,
    };
    if (hasWasField(item)) {
      fields[VANFINANCE_CO_WAS_PRICE_FIELD] = separateWasPriceForReduction(currentDisplay, item?.data?.[VANFINANCE_CO_WAS_PRICE_FIELD], retail);
    }
    return { dataItemId: item.id, fields };
  }

  const currentDisplay = clean(item?.data?.price, 500);
  const fields = {
    price: formatRetailPrice(retail),
    salePrice: `FROM £${monthly} P/M`,
  };
  if (hasWasField(item)) {
    fields[VANFINANCE_CO_WAS_PRICE_FIELD] = separateWasPriceForReduction(currentDisplay, item?.data?.[VANFINANCE_CO_WAS_PRICE_FIELD], retail);
  }
  return { dataItemId: item.id, fields };
}

export function carWixCurrentFields(collection, item) {
  const fields = collection?.kind === "detail"
    ? { priceVat: clean(item?.data?.priceVat, 500), salePrice: clean(item?.data?.salePrice, 500) }
    : { price: clean(item?.data?.price, 500), salePrice: clean(item?.data?.salePrice, 500) };
  if (hasWasField(item)) fields[VANFINANCE_CO_WAS_PRICE_FIELD] = clean(item?.data?.[VANFINANCE_CO_WAS_PRICE_FIELD], 500);
  return fields;
}

function listingInitialText(pricing) {
  return pricing.vatStatus === "plus_vat" ? `INITIAL RENTAL £${pricing.upfront} +VAT` : `INITIAL RENTAL £${pricing.upfront}`;
}

function detailMonthlyText(pricing) {
  return pricing.vatStatus === "plus_vat"
    ? `£${pricing.monthly} +Vat (£${pricing.monthlyIncVat} INC VAT)`
    : `£${pricing.monthly}`;
}

function detailUpfrontText(pricing) {
  return pricing.vatStatus === "plus_vat"
    ? `£${pricing.upfront} +Vat (£${pricing.upfrontIncVat} INC VAT)`
    : `£${pricing.upfront}`;
}

export function calculatePublishedRent2BuyPricing({ retailPrice, mileage, vatStatus, pickup = false } = {}) {
  return calculateRent2BuyPricing({
    retailPrice,
    mileage,
    categories: pickup ? ["all_vans", "pickup_4x4"] : ["all_vans"],
    vatStatus,
  });
}

export function buildRent2BuyWixPricePatch(collection, item, pricing, { standalone = false } = {}) {
  if (!collection || !item?.id || !pricing) return null;
  if (collection.kind === "detail") {
    return {
      dataItemId: item.id,
      fields: {
        intialRentalCharge: detailUpfrontText(pricing),
        numberOfMonths: `${pricing.followingPayments}X MONTHLY PAYMENTS`,
        monthlyPayments: detailMonthlyText(pricing),
        weeklyPrice: `£${pricing.monthly} P/M`,
      },
    };
  }

  const fields = {
    mth: `£${pricing.monthly} PM`,
    weekly: `x${pricing.followingPayments}`,
    [collection.initialField]: listingInitialText(pricing),
  };
  if (standalone && collection.id === "ALLRENT2BUYVANS") {
    fields.weeklyPrice1 = fields.weekly;
    fields.monthlyPriceNumeric = pricing.monthly;
  }
  return { dataItemId: item.id, fields };
}

export function rent2BuyWixCurrentFields(collection, item, { standalone = false } = {}) {
  if (collection?.kind === "detail") {
    return {
      intialRentalCharge: clean(item?.data?.intialRentalCharge, 500),
      numberOfMonths: clean(item?.data?.numberOfMonths, 500),
      monthlyPayments: clean(item?.data?.monthlyPayments, 500),
      weeklyPrice: clean(item?.data?.weeklyPrice, 500),
    };
  }
  const fields = {
    mth: clean(item?.data?.mth, 500),
    weekly: clean(item?.data?.weekly, 500),
    [collection.initialField]: clean(item?.data?.[collection.initialField], 500),
  };
  if (standalone && collection?.id === "ALLRENT2BUYVANS") {
    fields.weeklyPrice1 = clean(item?.data?.weeklyPrice1, 500);
    fields.monthlyPriceNumeric = item?.data?.monthlyPriceNumeric ?? null;
  }
  return fields;
}

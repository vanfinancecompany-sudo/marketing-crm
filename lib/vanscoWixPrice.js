const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);

export const VAN_FINANCE_WIX_COLLECTIONS = Object.freeze([
  { id: "VANFINANCE-ALLVANS", label: "Van Finance - All Vans", kind: "listing" },
  { id: "VANFINANCE-SMALLVANS", label: "Van Finance - Small Vans", kind: "listing" },
  { id: "VANFINANCE-MWB", label: "Van Finance - MWB", kind: "listing" },
  { id: "VANFINANCE-LWBVANS", label: "Van Finance - LWB Vans", kind: "listing" },
  { id: "FINANCE-CREWVANS", label: "Van Finance - Crew Vans", kind: "listing" },
  { id: "VANFINANCE-PICKUPS", label: "Van Finance - Pickups", kind: "listing" },
  { id: "VANFINANCE-TIPPERSDROPSIDEL", label: "Van Finance - Tippers / Dropsides / Lutons", kind: "listing" },
  { id: "VANFINANCE-ELECTRIC", label: "Van Finance - Electric", kind: "listing" },
  { id: "AUTOMATIC", label: "Van Finance - Automatic", kind: "listing" },
  { id: "VANFINANCEPAGES", label: "Van Finance Pages", kind: "detail" },
]);

export const VANFINANCE_CO_WAS_PRICE_FIELD = "wasPriceVat";
const CANONICAL_WAS_PRICE_COLLECTIONS = new Set(["VANFINANCE-ALLVANS", "VANFINANCEPAGES"]);
const WAS_PRICE_PATTERN = /\s*\[\s*Was\s+£\s*([0-9][0-9,]*(?:\.\d+)?)\s*\]\s*/i;

export function normalizeFinanceRegistration(value) {
  const registration = clean(value, 30).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (registration.length < 5 || registration.length > 8) return "";
  if (!/[A-Z]/.test(registration) || !/[0-9]/.test(registration)) return "";
  return registration;
}

export function parseRetailPrice(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function stripWasPriceMarker(value) {
  return clean(value, 500).replace(WAS_PRICE_PATTERN, " ").replace(/\s+/g, " ").trim();
}

function existingMarkerWasPrice(value) {
  const match = clean(value, 500).match(WAS_PRICE_PATTERN);
  return match ? parseRetailPrice(match[1]) : null;
}

function firstDisplayedRetailPrice(value) {
  const withoutMarker = stripWasPriceMarker(value);
  const match = withoutMarker.match(/£\s*([0-9][0-9,]*(?:\.\d+)?)/i);
  if (match) return parseRetailPrice(match[1]);
  return parseRetailPrice(withoutMarker);
}

function canonicalWasPriceCollection(collection) {
  return CANONICAL_WAS_PRICE_COLLECTIONS.has(String(collection?.id || ""));
}

function listingPriceVat(item) {
  return [clean(item?.data?.price, 500), clean(item?.data?.vat, 100)].filter(Boolean).join(" ");
}

export function calculateFivePercentFlatMonthly(retailPrice) {
  const retail = parseRetailPrice(retailPrice);
  if (retail === null) return null;
  const annualFlatRate = 0.05;
  const termMonths = 60;
  const termYears = termMonths / 12;
  const totalRepayable = retail * (1 + (annualFlatRate * termYears));
  return Math.ceil(totalRepayable / termMonths);
}

export function formatRetailPrice(retailPrice) {
  const retail = parseRetailPrice(retailPrice);
  if (retail === null) return "";
  return `£${retail.toLocaleString("en-GB", {
    minimumFractionDigits: Number.isInteger(retail) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function preserveRetailPriceAffixes(existingValue, retailPrice) {
  const formatted = formatRetailPrice(retailPrice);
  if (!formatted) return clean(existingValue, 500);
  const existing = stripWasPriceMarker(existingValue);
  const match = existing.match(/^(.*?)(£\s*)[0-9][0-9,]*(?:\.\d+)?(.*)$/i);
  if (!match) return formatted;
  return `${match[1]}${formatted}${match[3]}`.replace(/££/g, "£");
}

// Public Wix price fields must contain only the current retail price. The legacy
// inline [Was £...] token is stripped here so Van Finance Company never renders it.
export function retailPriceWithReduction(existingValue, retailPrice, { preserveAffixes = false } = {}) {
  const next = parseRetailPrice(retailPrice);
  if (next === null) return stripWasPriceMarker(existingValue);
  return preserveAffixes
    ? preserveRetailPriceAffixes(existingValue, next)
    : formatRetailPrice(next);
}

export function separateWasPriceForReduction(existingDisplayValue, existingWasValue, retailPrice) {
  const next = parseRetailPrice(retailPrice);
  if (next === null) return clean(existingWasValue, 500);

  const current = firstDisplayedRetailPrice(existingDisplayValue);
  const hiddenWas = parseRetailPrice(existingWasValue);
  const markerWas = existingMarkerWasPrice(existingDisplayValue);
  const storedWas = Math.max(hiddenWas || 0, markerWas || 0) || null;

  let original = null;
  if (current !== null && next < current) {
    original = Math.max(current, storedWas || 0);
  } else if (current !== null && next === current && storedWas && storedWas > next) {
    original = storedWas;
  }

  if (!original) return "";
  return preserveRetailPriceAffixes(existingDisplayValue, original);
}

export function buildFinanceWixPricePatch(collection, item, retailPrice) {
  const monthly = calculateFivePercentFlatMonthly(retailPrice);
  if (!collection || !item?.id || monthly === null) return null;

  if (collection.kind === "detail") {
    const displayValue = clean(item?.data?.priceVat, 500);
    const fields = {
      priceVat: retailPriceWithReduction(displayValue, retailPrice, { preserveAffixes: true }),
      mthPrice: `£${monthly}`,
    };
    if (canonicalWasPriceCollection(collection)) {
      fields[VANFINANCE_CO_WAS_PRICE_FIELD] = separateWasPriceForReduction(
        displayValue,
        item?.data?.[VANFINANCE_CO_WAS_PRICE_FIELD],
        retailPrice,
      );
    }
    return { dataItemId: item.id, fields };
  }

  const fields = {
    price: retailPriceWithReduction(item?.data?.price, retailPrice),
    salePrice: `FROM £${monthly} P/M`,
  };
  if (canonicalWasPriceCollection(collection)) {
    fields[VANFINANCE_CO_WAS_PRICE_FIELD] = separateWasPriceForReduction(
      listingPriceVat(item),
      item?.data?.[VANFINANCE_CO_WAS_PRICE_FIELD],
      retailPrice,
    );
  }
  return { dataItemId: item.id, fields };
}

export function financeWixCurrentFields(collection, item) {
  if (collection?.kind === "detail") {
    const fields = {
      priceVat: clean(item?.data?.priceVat, 500),
      mthPrice: clean(item?.data?.mthPrice, 500),
    };
    if (canonicalWasPriceCollection(collection)) {
      fields[VANFINANCE_CO_WAS_PRICE_FIELD] = clean(item?.data?.[VANFINANCE_CO_WAS_PRICE_FIELD], 500);
    }
    return fields;
  }

  const fields = {
    price: clean(item?.data?.price, 500),
    salePrice: clean(item?.data?.salePrice, 500),
  };
  if (canonicalWasPriceCollection(collection)) {
    fields[VANFINANCE_CO_WAS_PRICE_FIELD] = clean(item?.data?.[VANFINANCE_CO_WAS_PRICE_FIELD], 500);
  }
  return fields;
}

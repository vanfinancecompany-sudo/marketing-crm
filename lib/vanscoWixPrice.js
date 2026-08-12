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
  const existing = clean(existingValue, 500);
  const match = existing.match(/^(.*?)(£\s*)[0-9][0-9,]*(?:\.\d+)?(.*)$/i);
  if (!match) return formatted;
  return `${match[1]}${formatted}${match[3]}`.replace(/££/g, "£");
}

export function buildFinanceWixPricePatch(collection, item, retailPrice) {
  const monthly = calculateFivePercentFlatMonthly(retailPrice);
  if (!collection || !item?.id || monthly === null) return null;
  if (collection.kind === "detail") {
    return {
      dataItemId: item.id,
      fields: {
        priceVat: preserveRetailPriceAffixes(item?.data?.priceVat, retailPrice),
        mthPrice: `£${monthly}`,
      },
    };
  }
  return {
    dataItemId: item.id,
    fields: {
      price: formatRetailPrice(retailPrice),
      salePrice: `FROM £${monthly} P/M`,
    },
  };
}

export function financeWixCurrentFields(collection, item) {
  if (collection?.kind === "detail") {
    return {
      priceVat: clean(item?.data?.priceVat, 500),
      mthPrice: clean(item?.data?.mthPrice, 500),
    };
  }
  return {
    price: clean(item?.data?.price, 500),
    salePrice: clean(item?.data?.salePrice, 500),
  };
}

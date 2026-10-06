export const RENT2BUY_MINIMUM_INITIAL_RENTAL_EX_VAT = 1000;
export const RENT2BUY_MINIMUM_INITIAL_RENTAL_INC_VAT = 1200;

const clean = (value, limit = 500) => String(value ?? "").trim().slice(0, limit);

export function rent2BuyInitialRentalAmount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = clean(value).replace(/,/g, "");
  if (!text) return null;
  const poundMatch = text.match(/£\s*(\d{1,6}(?:\.\d{1,2})?)/);
  const plainMatch = poundMatch || text.match(/\b(\d{1,6}(?:\.\d{1,2})?)\b/);
  if (!plainMatch) return null;
  const amount = Number(plainMatch[1]);
  return Number.isFinite(amount) ? amount : null;
}

export function applyRent2BuyInitialRentalFloor(value) {
  const amount = rent2BuyInitialRentalAmount(value);
  if (amount === null || amount <= 0) return null;
  return Math.max(RENT2BUY_MINIMUM_INITIAL_RENTAL_EX_VAT, Math.round(amount));
}

export function formatRent2BuyAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  return amount.toLocaleString("en-GB", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function normalizeAdvertisedRent2BuyInitialRental(value, { vatStatus = "" } = {}) {
  const raw = clean(value);
  if (!raw) return "";

  const amount = rent2BuyInitialRentalAmount(raw);
  if (amount === null || amount >= RENT2BUY_MINIMUM_INITIAL_RENTAL_EX_VAT) return raw;

  const plusVat = clean(vatStatus, 80).toLowerCase() === "plus_vat" || /\+\s*vat/i.test(raw);
  const includeIncVat = plusVat && /\binc\s*vat\b/i.test(raw);
  const hasLabel = /\binitial\s+rental\b/i.test(raw);

  return `${hasLabel ? "INITIAL RENTAL " : ""}£${formatRent2BuyAmount(RENT2BUY_MINIMUM_INITIAL_RENTAL_EX_VAT)}${plusVat ? " +VAT" : ""}${includeIncVat ? ` (£${formatRent2BuyAmount(RENT2BUY_MINIMUM_INITIAL_RENTAL_INC_VAT)} INC VAT)` : ""}`;
}

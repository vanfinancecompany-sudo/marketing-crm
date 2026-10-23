/**
 * Independent Rent2Buy special-deal storage policy. It MUST NOT be put in the
 * DealerKit review/settings upsert: that recalculates terms on stock refresh.
 * These rows are not Wix publishing instructions. New records start as DRAFT.
 */
import { RENT2BUY_MATRIX_TERMS, RENT2BUY_MATRIX_MILEAGE_BANDS, rent2BuyMaximumTerm } from "./rent2BuyFlexiblePricing.mjs";
import { pendingRent2BuySpecialDeal } from "./rent2BuyProtectedSpecialDeals.mjs";

export const RENT2BUY_SPECIAL_DEALS_TABLE = "dealerkit_rent2buy_special_deals";
export const RENT2BUY_SPECIAL_AUDIT_TABLE = "dealerkit_rent2buy_special_deal_audit";
export const RENT2BUY_SPECIAL_VALID_TERMS = RENT2BUY_MATRIX_TERMS;
const validTerms = new Set(RENT2BUY_MATRIX_TERMS);
const validMiles = new Set(RENT2BUY_MATRIX_MILEAGE_BANDS);
const clean = (value, limit = 500) => String(value ?? "").trim().slice(0, limit);
export const canonicalRent2BuyRegistration = value => clean(value, 30).toUpperCase().replace(/[^A-Z0-9]/g, "");

export function normaliseRent2BuySpecialDraft(input = {}, sourceVehicle = {}) {
  const registration = canonicalRent2BuyRegistration(input.registration);
  const stockId = clean(input.supplierStockId, 300);
  const sourceStockId = clean(sourceVehicle.supplierStockId, 300);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z]{3}$/.test(registration)) throw new Error("Valid vehicle registration required.");
  if (!stockId || stockId !== sourceStockId || canonicalRent2BuyRegistration(sourceVehicle.registration) !== registration)
    throw new Error("DealerKit stock ID or registration does not match the current vehicle.");
  if (!sourceVehicle.retailPrice || !Number.isFinite(Number(sourceVehicle.retailPrice)) || Number(sourceVehicle.retailPrice) <= 0)
    throw new Error("Verified source retail price is required.");
  if (input.confirmRegistration !== registration) throw new Error("Type the exact registration to confirm this special.");
  const termMonths = Number(input.termMonths);
  const milesPerMonth = Number(input.milesPerMonth);
  if (!validTerms.has(termMonths)) throw new Error("Contract term is not in the approved matrix.");
  if (!validMiles.has(milesPerMonth)) throw new Error("Monthly mileage allowance is not in the approved matrix.");
  const maxTerm=rent2BuyMaximumTerm({
    registrationYear:sourceVehicle.year,
    vehicleMileage:sourceVehicle.mileage,
    milesPerMonth,
  });
  if (!maxTerm || termMonths > maxTerm)
    throw new Error("Selected contract term is not eligible for this vehicle's age, mileage or monthly allowance.");
  const monthlyExVat = Number(input.monthlyExVat);
  const initialExVat = Number(input.initialExVat);
  if (!Number.isFinite(monthlyExVat) || monthlyExVat <= 0 || monthlyExVat > 10000 ||
      !Number.isFinite(initialExVat) || initialExVat < 1000 || initialExVat > 100000 ||
      Math.round(monthlyExVat * 100) !== monthlyExVat * 100 ||
      Math.round(initialExVat * 100) !== initialExVat * 100)
    throw new Error("A valid monthly rental and minimum £1,000 + VAT initial rental are required.");
  const notes = clean(input.reason, 1000);
  if (notes.length < 10) throw new Error("Give a reason for the special deal (at least 10 characters).");
  const expires = clean(input.expiresAt, 40);
  if (expires && (!/^\d{4}-\d{2}-\d{2}$/.test(expires) || Number.isNaN(new Date(expires + "T23:59:59Z").valueOf())))
    throw new Error("Expiry must be a valid YYYY-MM-DD date.");
  const now = new Date();
  if (expires && new Date(expires + "T23:59:59Z").valueOf() < now.valueOf()) throw new Error("An expired special cannot be created.");
  return {
    supplier_stock_id: stockId,
    registration,
    monthly_ex_vat: monthlyExVat,
    initial_ex_vat: initialExVat,
    term_months: termMonths,
    miles_per_month: milesPerMonth,
    source_retail_amount: Number(sourceVehicle.retailPrice),
    source_vat_status: clean(sourceVehicle.vatStatus, 40) || 'unknown',
    source_updated_at: clean(sourceVehicle.sourceUpdatedAt, 80) || null,
    reason: notes,
    expires_at: expires ? expires + "T23:59:59.000Z" : null,
    status: "draft", // No automatic activation or price publication on draft save
  };
}

export function specialDealToClient(row = {}, registration = "") {
  const reg = canonicalRent2BuyRegistration(row.registration || registration);
  const hold = pendingRent2BuySpecialDeal(reg);
  if (!row.id && !hold) return null;
  return {
    registration: reg,
    protectedLegacy: Boolean(hold),
    legacyMonthlyExVat: hold?.publishedMonthlyExVat ?? null,
    persisted: Boolean(row.id),
    supplierStockId: clean(row.supplier_stock_id, 300) || null,
    status: clean(row.status, 30) || (hold ? "migration_hold" : "none"),
    monthlyExVat: row.monthly_ex_vat ?? null,
    initialExVat: row.initial_ex_vat ?? null,
    termMonths: row.term_months ?? null,
    milesPerMonth: row.miles_per_month ?? null,
    sourceRetailAmount: row.source_retail_amount ?? null,
    sourceVatStatus: row.source_vat_status ?? 'unknown',
    sourceUpdatedAt: row.source_updated_at ?? null,
    reason: row.reason ?? "",
    expiresAt: row.expires_at ?? null,
    revision: Number(row.revision) || 0,
    updatedAt: row.updated_at || null,
  };
}

export function allowedSpecialDraftWrite(environment = process.env) {
  return environment.RENT2BUY_SPECIAL_DRAFTS_ENABLED === "true";
}

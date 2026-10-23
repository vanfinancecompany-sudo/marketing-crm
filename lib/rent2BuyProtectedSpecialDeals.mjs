/**
 * User-confirmed fixed Rent2Buy specials, 23 Oct 2026.
 *
 * These four registrations stay OFF the Felix customisable matrix.
 * They retain one fixed monthly rental, £2,000 + VAT initial rental and
 * 48-month term. No contractual mileage allowance is stored or inferred.
 *
 * The existing public application remains available, but the Customise your
 * rental selector must not appear for these four registrations.
 */
export const RENT2BUY_PENDING_SPECIAL_DEAL_IMPORTS = Object.freeze({
  BT25LVK: Object.freeze({ monthlyExVat: 595, initialExVat: 2000, termMonths: 48 }),
  FV74BBJ: Object.freeze({ monthlyExVat: 545, initialExVat: 2000, termMonths: 48 }),
  FV74BEO: Object.freeze({ monthlyExVat: 595, initialExVat: 2000, termMonths: 48 }),
  BJ74HTL: Object.freeze({ monthlyExVat: 595, initialExVat: 2000, termMonths: 48 }),
});

const normalize = (registration) => String(registration ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function pendingRent2BuySpecialDeal(registration) {
  const key = normalize(registration);
  const deal = RENT2BUY_PENDING_SPECIAL_DEAL_IMPORTS[key];
  if (!deal) return null;
  return {
    registration: key,
    publishedMonthlyExVat: deal.monthlyExVat,
    monthlyExVat: deal.monthlyExVat,
    initialExVat: deal.initialExVat,
    termMonths: deal.termMonths,
    milesPerMonth: null,
    customisable: false,
    fixedSpecial: true,
    overrideImported: false,
    publisherMustHold: true,
  };
}

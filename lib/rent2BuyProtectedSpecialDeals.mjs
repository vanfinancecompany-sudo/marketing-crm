/**
 * Migration safety hold for user-confirmed manual Rent2Buy special deals.
 * Source: Marketing CRM Price differences screenshot, 23 Oct 2026.
 *
 * This is NOT the durable special-deal configuration. Only the currently
 * published monthly +VAT amount is confirmed. Do not invent initial rental,
 * mileage, term or an expiry date from these values.
 *
 * Once a durable audited price override is stored and verified for a vehicle,
 * replace this temporary hold with the active special-deal publisher resolver.
 */
export const RENT2BUY_PENDING_SPECIAL_DEAL_IMPORTS = Object.freeze({
  BT25LVK: 595,
  FV74BBJ: 545,
  FV74BEO: 595,
  BJ74HTL: 595,
});

// Confirmed separately by the commercial owner; NOT standard matrix terms.
export const RENT2BUY_CONFIRMED_SPECIAL_PAYMENT_COUNTS = Object.freeze({
  BJ74HTL: 40,
});

const normalize = (registration) => String(registration ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function pendingRent2BuySpecialDeal(registration) {
  const key = normalize(registration);
  if (!Object.hasOwn(RENT2BUY_PENDING_SPECIAL_DEAL_IMPORTS, key)) return null;
  return {
    registration: key,
    publishedMonthlyExVat: RENT2BUY_PENDING_SPECIAL_DEAL_IMPORTS[key],
    confirmedSpecialMonthlyPaymentCount: RENT2BUY_CONFIRMED_SPECIAL_PAYMENT_COUNTS[key] ?? null,
    overrideImported: false,
    publisherMustHold: true,
  };
}

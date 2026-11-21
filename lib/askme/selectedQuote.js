// Resolves the Rent2Buy quote a customer has currently selected in the on-page
// calculator, for Ask Me.
//
// The website passes only the opaque token the CRM issued with that quote. This
// module never trusts figures from the browser: it runs the existing quote
// verifier (HMAC signature, expiry, registration match, and recalculation against
// the current authorised pricing source). Figures come only from the verified
// result; nothing is reconstructed or substituted.

const reg = (value) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const money = (value) => `£${Number(value).toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export const NO_SELECTED_QUOTE = Object.freeze({ status: "none" });

/**
 * @param {object} input
 * @param {string|null} input.token   Opaque CRM-signed quote token from the page, if any.
 * @param {string|null} input.registration  Vehicle on the page.
 * @param {string} input.product      "rent2buy" or "finance".
 * @param {Function} check            checkIncomingRent2BuyQuote(input, options).
 * @param {object} options            Passed through to `check` (env, loadSource, now).
 */
export async function resolveSelectedQuote({ token, registration, product }, check, options = {}) {
  if (product !== "rent2buy" || !token) return NO_SELECTED_QUOTE;
  const identity = reg(registration);
  if (!identity) return { status: "unverified", reason: "no_vehicle_on_page" };
  if (typeof check !== "function") return { status: "unverified", reason: "verifier_unavailable" };
  let result;
  try {
    result = await check({ token, registration: identity }, options);
  } catch {
    return { status: "unverified", reason: "verifier_error" };
  }
  if (!result?.ok || !result.quote) return { status: "unverified", reason: String(result?.reason || "quote_not_verified").slice(0, 80) };
  const quote = result.quote;
  return {
    status: "verified",
    registration: identity,
    quote_id: String(quote.quoteId || result.quoteId || "").slice(0, 100),
    vehicle_title: String(quote.vehicleTitle || "").slice(0, 200) || null,
    term_months: Number(quote.termMonths),
    miles_per_month: Number(quote.milesPerMonth),
    initial_ex_vat: Number(quote.initialExVat),
    initial_inc_vat: Number(quote.initialIncVat),
    monthly_ex_vat: Number(quote.monthlyExVat),
    monthly_inc_vat: Number(quote.monthlyIncVat),
    expires_at: Number(quote.expiresAt) || null,
  };
}

export function selectedQuoteText(selected = NO_SELECTED_QUOTE) {
  if (selected.status === "verified") {
    return [
      `The customer's currently selected and verified Rent2Buy quote${selected.vehicle_title ? ` for the ${selected.vehicle_title}` : ""}:`,
      `${selected.term_months}-month term, ${Number(selected.miles_per_month).toLocaleString("en-GB")} miles per month,`,
      `initial rental ${money(selected.initial_ex_vat)} plus VAT (${money(selected.initial_inc_vat)} including VAT),`,
      `then ${money(selected.monthly_ex_vat)} plus VAT per month (${money(selected.monthly_inc_vat)} including VAT).`,
      "Quote these figures exactly; do not adjust them.",
    ].join(" ");
  }
  if (selected.status === "unverified") {
    return "The customer's calculator selection could not be verified (it may have expired or changed). Do not quote figures for it; ask them to re-check their selection in the calculator on the vehicle page.";
  }
  return "";
}

export function selectedQuoteSource(selected = NO_SELECTED_QUOTE) {
  const passage = selectedQuoteText(selected);
  if (!passage) return null;
  return {
    source_id: selected.status === "verified" ? `askme-selected-quote-${selected.quote_id || selected.registration}` : "askme-selected-quote-unverified",
    type: "business_brain",
    product: "Rent2Buy",
    title: selected.status === "verified" ? "Customer's verified selected Rent2Buy quote" : "Customer's calculator selection (not verified)",
    heading: "Live calculator quote",
    passage,
  };
}

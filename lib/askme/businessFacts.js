// Ask Me verified business facts.
//
// One small, versioned, owner-approved source of the policies customers ask
// about most. It is included in full for every relevant customer question
// (never "retrieved"), so the assistant can answer eligibility, deposit and
// Rent2Buy policy questions directly. The Knowledge Hub stays available for
// longer-tail detail.
//
// Authority for each fact is recorded in `source`. Where a fact differs from an
// older CRM rule, it is listed in ASKME_FACT_REVIEW_FLAGS for owner review
// rather than silently chosen. Change a fact only with owner approval, and bump
// the version so transcripts can be traced to the wording in force.

import { RENT2BUY_COLLECTION_SENTENCE, RENT2BUY_SEPARATION_SENTENCE } from "../rent2BuyRules.js";
import {
  RENT2BUY_MINIMUM_INITIAL_RENTAL_EX_VAT,
  RENT2BUY_MINIMUM_INITIAL_RENTAL_INC_VAT,
} from "../rent2BuyInitialRental.js";

export const ASKME_BUSINESS_FACTS_VERSION = "2026-11-21.3";

const money = (value) => `£${Number(value).toLocaleString("en-GB")}`;

export const FINANCE_FACTS = Object.freeze([
  {
    id: "finance.company",
    text: "Van Finance Company (established 2001) supplies vans from its own stock and arranges finance on those vehicles through a panel of lenders. Van Finance Company is not a lender.",
    source: "Owner brief 21 Nov 2026; existing company profile.",
  },
  {
    id: "finance.poor_credit",
    text: "Customers with poor or bad credit can apply for finance, including people with past missed payments, defaults, CCJs or a previous refusal elsewhere. Approval is never guaranteed: it depends on affordability, status and lender criteria.",
    source: "Owner-approved wording, 21 Nov 2026. Includes CCJs and previous refusals, subject to status, affordability and lender criteria.",
  },
  {
    id: "finance.circumstances",
    text: "A wide range of circumstances is considered, including new-start businesses, subject to status and lender criteria.",
    source: "Owner-approved wording, 21 Nov 2026, retaining published Van Finance Company wording on new-start businesses.",
  },
  {
    id: "finance.figures",
    text: "Deposits and monthly payments depend on the vehicle and its finance illustration. Advertised figures such as a deposit from £99 or a monthly payment shown as 'From £X/mo' are starting illustrations, not a particular customer's confirmed deposit, payment or approval. The lender confirms the actual figures after an application.",
    source: "Owner brief 21 Nov 2026; existing CRM deposit wording (salesConversationEngine).",
  },
  {
    id: "finance.apply",
    text: "The best way to apply is from the vehicle the customer wants, using that vehicle's Apply link, so the application carries the chosen van. A general finance application is also available.",
    source: "Existing VFC application routes (/apply?vehicle=REG and /apply).",
  },
]);

export const RENT2BUY_FACTS = Object.freeze([
  {
    id: "rent2buy.product",
    text: `${RENT2BUY_SEPARATION_SENTENCE} ${RENT2BUY_COLLECTION_SENTENCE}`,
    source: "Existing permanent Rent2Buy rule (lib/rent2BuyRules.js).",
  },
  {
    id: "rent2buy.self_employed",
    text: "Self-employed customers can apply for Rent2Buy, as can employed customers. Applicants need their own income from employment or self-employment. Guarantors are not accepted.",
    source: "Owner brief 21 Nov 2026; existing guarantor rule (lib/publicApplicationGuidance.js).",
  },
  {
    id: "rent2buy.checks",
    text: "There is no traditional credit check under the Rent2Buy arrangement. Affordability, identity, supporting documents and eligibility are assessed instead. Acceptance is not guaranteed.",
    source: "Owner brief 21 Nov 2026; existing restricted-claims rule (lib/assistantProductBrains.js).",
  },
  {
    id: "rent2buy.coverage",
    text: "Rent2Buy is normally available to applicants within 100 driving miles of Southampton. Ask for a postcode or town to check a specific area.",
    source: "Owner brief 21 Nov 2026; existing deterministic coverage rule.",
  },
  {
    id: "rent2buy.initial_rental",
    text: `The minimum initial rental is ${money(RENT2BUY_MINIMUM_INITIAL_RENTAL_EX_VAT)} plus VAT (${money(RENT2BUY_MINIMUM_INITIAL_RENTAL_INC_VAT)} including VAT), subject to the current agreement rules.`,
    source: "Owner brief 21 Nov 2026; lib/rent2BuyInitialRental.js minimum.",
  },
  {
    id: "rent2buy.reservation",
    text: "A £200 vehicle reservation payment (holding deposit) secures an approved vehicle when it is reserved. It is separate from the initial rental.",
    source: "Owner-approved wording, 21 Nov 2026. The reservation payment is separate from the initial rental.",
  },
  {
    id: "rent2buy.pricing",
    text: "Monthly rental and initial rental vary with the selected term, mileage allowance and upfront amount. A vehicle's listing shows an advertised illustration; a customer's own figures come from the calculator on that vehicle's page.",
    source: "Owner brief 21 Nov 2026; Rent2Buy quote calculator.",
  },
  {
    id: "rent2buy.early_return",
    text: "A Rent2Buy customer may return the vehicle at any time during the agreement with no early-termination penalty, provided the account is fully up to date and the customer gives at least 14 days' notice. The initial rental is non-refundable and forms part of the agreement. Outstanding amounts and agreed vehicle-condition or excess-mileage charges, if any, are still payable under the agreement.",
    source: "Owner-confirmed Rent2Buy early-return policy, November 2026: 14 days' notice, account fully up to date, no early-termination penalties, non-refundable initial rental. Other outstanding contractual amounts are not waived.",
  },
  {
    id: "rent2buy.final_purchase",
    text: "At the end of the agreement there is a final purchase option of £99 plus VAT to take ownership of the van.",
    source: "Existing website and CRM context (final_purchase_option).",
  },
  {
    id: "rent2buy.no_promises",
    text: "Never promise acceptance or that a particular van is available without verification.",
    source: "Owner brief 21 Nov 2026.",
  },
]);

// Compatibility note for the existing legacy evidence guardrail.
export const ASKME_FACT_REVIEW_FLAGS = Object.freeze([
  {
    fact: "rent2buy.reservation / rent2buy.initial_rental",
    issue: "RENT2BUY_EVIDENCE_GUARDRAIL (lib/rent2BuyRules.js) tells the legacy engine not to state any fixed reservation or deposit amount unless it is in approved Business Knowledge. The owner brief of 21 Nov 2026 approves £200 and £1,000 + VAT. These facts are supplied as approved Business Knowledge, which satisfies the guardrail's own condition; the guardrail text itself is unchanged.",
  },
]);

export function businessFactsFor(product) {
  if (product === "finance") return FINANCE_FACTS;
  if (product === "rent2buy") return RENT2BUY_FACTS;
  return [];
}

export function businessFactsText(product) {
  return businessFactsFor(product).map((fact) => `- ${fact.text}`).join("\n");
}

// Shape compatible with the legacy engine's retrieval sources, so verified
// facts can be cited (and therefore survive its grounding check).
export function businessFactsSource(product) {
  const facts = businessFactsFor(product);
  if (!facts.length) return null;
  return {
    source_id: `askme-business-facts-${product}-${ASKME_BUSINESS_FACTS_VERSION}`,
    type: "business_brain",
    product: product === "rent2buy" ? "Rent2Buy" : "Finance",
    title: `Verified ${product === "rent2buy" ? "Rent2Buy" : "Van Finance"} business facts (v${ASKME_BUSINESS_FACTS_VERSION})`,
    heading: "Owner-approved policy",
    passage: businessFactsText(product),
  };
}

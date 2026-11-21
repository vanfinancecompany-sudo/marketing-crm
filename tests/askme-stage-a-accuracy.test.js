import test from "node:test";
import assert from "node:assert/strict";
import { normalisePageContext } from "../lib/publicAssistantFoundation.js";
import { publicVehiclePricingReply } from "../lib/publicVehiclePricing.js";
import { resolveSelectedQuote, selectedQuoteText } from "../lib/askme/selectedQuote.js";
import { businessFactsSource, businessFactsText, ASKME_BUSINESS_FACTS_VERSION, ASKME_FACT_REVIEW_FLAGS } from "../lib/askme/businessFacts.js";
import { vehicleContextText } from "../lib/askme/vehicleContext.js";
import { normalizeBusinessKnowledgeSections } from "../lib/businessIntelligence.js";
import { simulateCustomerConversation } from "../api/marketing-ai-assistant-competence.js";

// The exact shape the live VFC site sends today (vanfinance-co/app/api/jasmine-vehicle).
const vfcLegacyVehicle = {
  registration: "LS73XFA",
  title: "Ford Transit Custom 320 Limited",
  year: "2023/73",
  description: "LOW MILEAGE",
  specification: "MILEAGE: 21,000\nFUEL TYPE: DIESEL\nTRANSMISSION: MANUAL",
  apply_link: "/apply?vehicle=LS73XFA",
  pricing: { monthly: "£641", retail: "£30,495 N/A" },
};

test("VFC monthly/retail keys reach the CRM as finance pricing, with VAT N/A kept as status", () => {
  const context = normalisePageContext({ page_type: "finance_vehicle", vehicle: vfcLegacyVehicle });
  assert.equal(context.vehicle.pricing.finance_monthly, "£641");
  assert.equal(context.vehicle.pricing.finance_retail_vat, "£30,495");
  assert.equal(context.vehicle.vat_status, "No VAT applicable");
  assert.equal(context.vehicle.pricing.rent2buy_monthly, null);
});

test("generic keys never cross products: a Rent2Buy page's monthly stays Rent2Buy", () => {
  const context = normalisePageContext({ page_type: "rent2buy_general", vehicle: { registration: "LR72PJU", title: "Van", pricing: { monthly: "£525" } } });
  assert.equal(context.vehicle.pricing.rent2buy_monthly, "£525");
  assert.equal(context.vehicle.pricing.finance_monthly, null);
  assert.equal(context.vehicle.pricing.finance_retail_vat, null);
});

test("VFC vehicle page: 'What would I pay upfront and per month?' now uses the page figures", () => {
  const context = normalisePageContext({ page_type: "finance_vehicle", vehicle: vfcLegacyVehicle });
  const reply = publicVehiclePricingReply({ message: "What would I pay upfront and per month?", pageType: "finance_vehicle", productLock: "finance", vehicleContext: context.vehicle });
  assert.match(reply, /£641/);
  assert.match(reply, /£30,495/);
  assert.doesNotMatch(reply, /won.t guess/i);
});

const listingVehicle = { registration: "LR72PJU", title: "MAXUS eDeliver 9", pricing: { rent2buy_initial: "£2,190", rent2buy_monthly: "£525" }, term_months: 48 };
const verifiedQuote = {
  status: "verified", registration: "LR72PJU", quote_id: "q-12345678", vehicle_title: "MAXUS eDeliver 9",
  term_months: 36, miles_per_month: 2000, initial_ex_vat: 3000, initial_inc_vat: 3600, monthly_ex_vat: 610, monthly_inc_vat: 732,
};

test("Rent2Buy 'what's due upfront and per month' gives both listing figures, labelled, with the calculator", () => {
  const vehicle = normalisePageContext({ page_type: "rent2buy_general", vehicle: listingVehicle }).vehicle;
  const reply = publicVehiclePricingReply({ message: "What's due upfront and per month?", pageType: "rent2buy_general", productLock: "rent2buy", vehicleContext: vehicle });
  assert.match(reply, /advertised illustration/i);
  assert.match(reply, /£2,190 \+ VAT initial rental/);
  assert.match(reply, /£525 \+ VAT per month/);
  assert.match(reply, /calculator/i);
});

test("a verified selected quote is quoted exactly and replaces the listing illustration", () => {
  const vehicle = normalisePageContext({ page_type: "rent2buy_general", vehicle: listingVehicle }).vehicle;
  const reply = publicVehiclePricingReply({ message: "How much is this one a month?", pageType: "rent2buy_general", productLock: "rent2buy", vehicleContext: vehicle, selectedQuote: verifiedQuote });
  assert.match(reply, /Your selected Rent2Buy quote/);
  assert.match(reply, /36-month term/);
  assert.match(reply, /£3,000 plus VAT/);
  assert.match(reply, /£610 plus VAT per month/);
  assert.doesNotMatch(reply, /£525|£2,190/);
});

test("a reservation payment question goes to business knowledge even with a selected quote", () => {
  const vehicle = normalisePageContext({ page_type: "rent2buy_general", vehicle: listingVehicle }).vehicle;
  const reply = (message) => publicVehiclePricingReply({
    message, pageType: "rent2buy_general", productLock: "rent2buy", vehicleContext: vehicle, selectedQuote: verifiedQuote,
  });
  assert.equal(reply("Is the £200 vehicle reservation payment the same as the initial rental?"), null);
  assert.equal(reply("Is the holding deposit included in what I pay upfront?"), null);
});

test("a term question uses the selected term when it differs from the listing", () => {
  const vehicle = normalisePageContext({ page_type: "rent2buy_general", vehicle: listingVehicle }).vehicle;
  const reply = publicVehiclePricingReply({
    message: "What term is this van?", pageType: "rent2buy_general", productLock: "rent2buy", vehicleContext: vehicle, selectedQuote: verifiedQuote,
  });
  assert.match(reply, /selected Rent2Buy quote.*36-month term/);
  assert.doesNotMatch(reply, /48-month/);
});

test("an unverifiable selection is never quoted; the customer is sent back to the calculator", () => {
  const vehicle = normalisePageContext({ page_type: "rent2buy_general", vehicle: listingVehicle }).vehicle;
  const reply = publicVehiclePricingReply({ message: "How much per month?", pageType: "rent2buy_general", productLock: "rent2buy", vehicleContext: vehicle, selectedQuote: { status: "unverified", reason: "invalid_or_expired_signature" } });
  assert.match(reply, /couldn.t verify the selection/i);
  assert.match(selectedQuoteText({ status: "unverified" }), /Do not quote figures/);
});

test("resolveSelectedQuote trusts only the CRM verifier and copies its figures", async () => {
  assert.deepEqual(await resolveSelectedQuote({ token: null, registration: "LR72PJU", product: "rent2buy" }, async () => assert.fail("not called")), { status: "none" });
  assert.deepEqual(await resolveSelectedQuote({ token: "t".repeat(40), registration: "LR72PJU", product: "finance" }, async () => assert.fail("not called")), { status: "none" });
  const failed = await resolveSelectedQuote({ token: "t".repeat(40), registration: "LR72PJU", product: "rent2buy" }, async () => ({ ok: false, reason: "quote_not_current" }));
  assert.deepEqual(failed, { status: "unverified", reason: "quote_not_current" });
  const thrown = await resolveSelectedQuote({ token: "t".repeat(40), registration: "LR72PJU", product: "rent2buy" }, async () => { throw new Error("down"); });
  assert.equal(thrown.status, "unverified");
  let seen;
  const ok = await resolveSelectedQuote({ token: "t".repeat(40), registration: "lr72 pju", product: "rent2buy" }, async (input) => {
    seen = input;
    return { ok: true, quote: { quoteId: "q-12345678", vehicleTitle: "MAXUS", termMonths: 36, milesPerMonth: 2000, initialExVat: 3000, initialIncVat: 3600, monthlyExVat: 610, monthlyIncVat: 732, expiresAt: 1 } };
  });
  assert.equal(seen.registration, "LR72PJU");
  assert.equal(ok.status, "verified");
  assert.equal(ok.monthly_ex_vat, 610);
  assert.equal(ok.initial_inc_vat, 3600);
});

test("selected quote tokens are accepted only on Rent2Buy pages and only in token shape", () => {
  const token = "v1.abcDEF123_-.sig456_-";
  assert.equal(normalisePageContext({ page_type: "rent2buy_general", selected_quote_token: token + "x".repeat(10) }).selected_quote_token, token + "x".repeat(10));
  assert.equal(normalisePageContext({ page_type: "finance_vehicle", selected_quote_token: token + "x".repeat(10) }).selected_quote_token, null);
  assert.equal(normalisePageContext({ page_type: "rent2buy_general", selected_quote_token: "<script>" }).selected_quote_token, null);
});

test("verified business facts carry the approved policies, versioned, with review flags", () => {
  const finance = businessFactsText("finance");
  const rent2buy = businessFactsText("rent2buy");
  assert.match(finance, /poor or bad credit can apply/i);
  assert.match(finance, /never guaranteed/i);
  assert.match(finance, /not a lender/i);
  assert.match(finance, /own stock/i);
  assert.match(rent2buy, /Self-employed customers can apply/i);
  assert.match(rent2buy, /no traditional credit check/i);
  assert.match(rent2buy, /100 driving miles of Southampton/i);
  assert.match(rent2buy, /£1,000 plus VAT/);
  assert.match(rent2buy, /£200 vehicle reservation payment \(holding deposit\)/);
  assert.doesNotMatch(finance, /Rent2Buy/i, "finance facts never mention Rent2Buy");
  assert.doesNotMatch(rent2buy, /lender|APR|hire purchase/i, "Rent2Buy facts never use finance terms");
  assert.match(businessFactsSource("finance").title, new RegExp(ASKME_BUSINESS_FACTS_VERSION.replace(/\./g, "\\.")));
  assert.deepEqual(ASKME_FACT_REVIEW_FLAGS.map(({ fact }) => fact), ["rent2buy.reservation / rent2buy.initial_rental"]);
});

test("vehicle context text lists only present fields and labels listing figures as illustrations", () => {
  const vehicle = normalisePageContext({ page_type: "finance_vehicle", vehicle: { ...vfcLegacyVehicle, stock_status: "reserved" } }).vehicle;
  const text = vehicleContextText(vehicle, "finance");
  assert.match(text, /Specification \(as listed\): MILEAGE: 21,000; FUEL TYPE: DIESEL/);
  assert.match(text, /currently reserved/);
  assert.match(text, /an illustration, not a confirmed payment/);
  assert.doesNotMatch(text, /Engine size|Payload/);
});

const knowledge = { sections: normalizeBusinessKnowledgeSections([], {}), articles: [], settings: {} };

async function runLegacy({ message, productContext, vehicle = {}, selectedQuote, reply }) {
  let prompt = "";
  const result = await simulateCustomerConversation(null, {
    message,
    product_context: productContext,
    messages: [],
    vehicle_context: vehicle,
    selected_quote: selectedQuote,
  }, {
    knowledge,
    persist: false,
    captureLearning: false,
    requestConversationReply: async (text, route) => {
      prompt = text;
      return { payload: { output_text: JSON.stringify(reply(text)) }, model: route.model, route };
    },
  });
  return { result: result.result, prompt };
}

test("legacy engine: verified facts are in the prompt and a reply citing them survives grounding", async () => {
  const { result, prompt } = await runLegacy({
    message: "Can I apply with poor credit?",
    productContext: "finance",
    reply: (text) => {
      const index = [...text.matchAll(/\[S(\d)\] Business Brain — Verified Van Finance business facts/g)].map((m) => m[1])[0];
      return { reply: "Yes, you can apply with poor credit. Approval isn't guaranteed and depends on affordability, status and lender criteria.", insufficient_knowledge: false, human_handoff_recommended: false, recommended_action: "continue", confidence: 90, confidence_reason: "Verified facts.", source_ids: index ? [`S${index}`] : [] };
    },
  });
  assert.match(prompt, /Verified Van Finance business facts/);
  assert.match(prompt, /poor or bad credit can apply/i);
  assert.match(result.reply || "", /you can apply with poor credit/i);
});

test("legacy engine: a spec answer from the live vehicle can cite the vehicle and is kept", async () => {
  const vehicle = normalisePageContext({ page_type: "finance_vehicle", vehicle: vfcLegacyVehicle }).vehicle;
  const { result, prompt } = await runLegacy({
    message: "What are this van's key specs?",
    productContext: "finance",
    vehicle,
    reply: (text) => {
      const index = [...text.matchAll(/\[S(\d)\] Business Brain — Vehicle on the customer's current page/g)].map((m) => m[1])[0];
      return { reply: "It's a 2023 Ford Transit Custom 320 Limited with 21,000 miles, diesel, manual.", insufficient_knowledge: false, human_handoff_recommended: false, recommended_action: "continue", confidence: 90, confidence_reason: "Vehicle page.", source_ids: index ? [`S${index}`] : [] };
    },
  });
  assert.match(prompt, /MILEAGE: 21,000/);
  assert.match(result.reply || "", /21,000 miles/);
});

test("spec answers name a car as a car and use the right article", () => {
  const vehicle = normalisePageContext({ page_type: "finance_vehicle", vehicle: { registration: "TE57CAR", vehicle_kind: "car", title: "Toyota Land Cruiser", transmission: "Automatic" } }).vehicle;
  const reply = publicVehiclePricingReply({ message: "Is this car automatic?", pageType: "finance_vehicle", productLock: "finance", vehicleContext: vehicle });
  assert.match(reply, /this car/i);
  assert.match(reply, /an automatic gearbox/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalConversationInput } from "../lib/canonicalPublicAssistantSession.js";
import { normalisePageContext } from "../lib/publicAssistantFoundation.js";
import { conversationPrompt, requestOpenAIConversationReply, simulateCustomerConversation } from "../api/marketing-ai-assistant-competence.js";
import { LIVE_JASMINE_PERSONA, validateControlledCompositionReply } from "../lib/liveJasmineComposition.js";
import { controlledBusinessRuntimeReply } from "../lib/salesConversationEngine.js";
import { publicVehiclePricingReply } from "../lib/publicVehiclePricing.js";

const pageContext = normalisePageContext({
  page_type: "rent2buy_general",
  page_path: "/van-pages/AB12CDE",
  page_title: "Ford Transit Custom Rent2Buy",
  category: "vehicle",
  available_customer_action: "apply",
  context_source: "rent2buy_server_stock",
  vehicle: {
    registration: "AB12 CDE",
    vehicle_id: "public-vehicle-12",
    title: "Ford Transit Custom Limited",
    make: "Ford",
    model: "Transit Custom",
    derivative: "Limited",
    year: "2022",
    mileage: "42,000",
    transmission: "Manual",
    fuel: "Diesel",
    body_type: "Panel van",
    colour: "White",
    stock_status: "available",
    description: "A clean practical panel van.",
    features: ["Air conditioning", "Cruise control"],
    public_specifications: { engine_size: "2.0", power: "128 BHP", private_note: "never expose" },
    pricing: { rent2buy_initial: "£2,400 inc VAT", rent2buy_monthly: "£598.80 inc VAT" },
    term_months: 48,
    apply_link: "/apply?registration=AB12CDE",
    vehicle_link: "/van-pages/AB12CDE",
    enquiry_link: "/contact",
    vin: "SECRET-VIN",
    supplier_id: "PRIVATE-SUPPLIER",
    internal_notes: "PRIVATE NOTES",
  },
});

test("live context is allowlisted, length-bounded and preserves the verified Rent2Buy term", () => {
  assert.equal(pageContext.product, "rent2buy");
  assert.equal(pageContext.page_path, "/van-pages/AB12CDE");
  assert.equal(pageContext.vehicle.term_months, 48);
  assert.equal(pageContext.vehicle.final_purchase_option, "£99 + VAT");
  assert.equal(pageContext.vehicle.transmission, "Manual");
  assert.equal(pageContext.vehicle.public_specifications.engine_size, "2.0");
  assert.equal("private_note" in pageContext.vehicle.public_specifications, false);
  assert.equal("vin" in pageContext.vehicle, false);
  assert.equal("supplier_id" in pageContext.vehicle, false);
  assert.equal("internal_notes" in pageContext.vehicle, false);
});

test("canonical live input carries full page and verified vehicle context without altering conversation state", () => {
  const session = {
    id: "session-1",
    page_type: pageContext.page_type,
    product_lock: "rent2buy",
    vehicle_context: pageContext.vehicle,
    remembered_facts: { product_context: "rent2buy", vehicle_interest: pageContext.vehicle.title },
    journey_state: { journey_stage: "Research" },
  };
  const history = [
    { role: "user", content: "What gearbox has this van got?" },
    { role: "assistant", content: "It has a manual gearbox." },
  ];
  const input = buildCanonicalConversationInput({ session, message: "And what's the mileage?", requestId: "request-1", history, pageContext, runtimeNow: new Date("2026-09-13T10:00:00Z") });
  assert.deepEqual(input.messages, history);
  assert.equal(input.page_context.context_source, "rent2buy_server_stock");
  assert.equal(input.vehicle_context.registration, "AB12 CDE");
  assert.equal(input.vehicle_context.mileage, "42,000");
  assert.equal(input.vehicle_context.term_months, 48);
  assert.deepEqual(input.runtime_context, { current_date: "2026-09-13", current_day: "Sunday", timezone: "Europe/London" });
});

const financeKnowledge = {
  settings: {},
  sections: [{
    id: "phase-1b-finance",
    section_key: "finance",
    title: "Finance guidance",
    active: true,
    content: "Customers with poor credit and self-employed customers can apply. Approval is subject to status and the lender's assessment. Deposits depend on the customer, lender and vehicle, so a precise deposit cannot be promised before assessment. After an application, the team reviews it and submits suitable cases to a lender; timing varies and approval is not guaranteed.",
    entries: [],
  }],
  articles: [],
};

function carryJourney(result = {}) {
  return {
    buying_intent_level: result.buying_intent_level,
    buying_intent_score: result.buying_intent_score,
    buying_intent_confidence: result.buying_intent_confidence,
    buying_intent_reasons: result.buying_intent_reasons,
    conversation_goal: result.conversation_goal,
    journey_stage: result.journey_stage,
    application_readiness: result.application_readiness,
    application_mode_active: result.application_mode_active,
    application_state: result.application_state,
    application_cta: result.application_cta,
    recommended_cta: result.recommended_cta,
    next_best_question: result.journey_next_best_question,
  };
}

test("Phase 1B regression: every current customer question wins over the application journey", async () => {
  const state = { messages: [], facts: {}, journey: {} };
  const turns = [
    ["My credit isn't great, can you still help me get a van?", "Yes, you can still apply. A lender will assess the application, so approval can’t be guaranteed.", /apply.*lender/i],
    ["How much deposit would I need?", "The deposit depends on the customer, lender and van, so it’s confirmed after assessment rather than guessed.", /deposit.*lender/i],
    ["I'm self employed if that makes any difference.", "Thanks — I’ve noted that.", /noted/i],
    ["What happens after I apply?", "The team reviews the application and submits suitable cases to a lender. Timing varies and approval isn’t guaranteed.", /application.*lender/i],
    ["Can you deliver to Plymouth?", null, /free delivery.*Plymouth|Plymouth.*free delivery/i],
    ["And how long does it normally take?", "Do you mean how long application approval normally takes, or how long delivery takes?", /application approval.*delivery|delivery.*application approval/i],
  ];
  for (const [message, modelReply, expected] of turns) {
    const generated = await simulateCustomerConversation(null, {
      message,
      product_context: "finance",
      messages: state.messages,
      remembered_facts: state.facts,
      journey_state: state.journey,
      runtime_context: { current_date: "2026-09-13", current_day: "Sunday", timezone: "Europe/London" },
    }, {
      persist: false,
      knowledge: financeKnowledge,
      requestConversationReply: async () => ({ payload: {}, model: "phase-1b-test-model", route: { model: "phase-1b-test-model", tier: "test" } }),
      parseConversationReply: async () => ({
        model: "phase-1b-test-model",
        reply: {
          reply: modelReply,
          insufficient_knowledge: false,
          human_handoff_recommended: false,
          recommended_action: "continue",
          confidence: 90,
          confidence_reason: "Phase 1B regression fixture.",
          source_ids: ["S1"],
        },
      }),
    });
    const result = generated.result;
    assert.match(result.reply, expected, message);
    assert.doesNotMatch(result.reply, /what would you like help with/i, message);
    state.messages.push({ role: "user", content: message }, { role: "assistant", content: result.reply });
    state.facts = result.remembered_facts;
    state.journey = carryJourney(result);
  }
});

test("Phase 1B vehicle-page conversation uses direct trusted facts, pricing, location and runtime date", () => {
  const vehicleContext = {
    registration: "LX23AYD",
    title: "VW Caddy 2.0 TDI C20 Commerce Pro",
    year: "2023/23",
    mileage: "68,000",
    transmission: "MANUAL",
    fuel: "DIESEL",
    pricing: { finance_monthly: "£313", finance_retail_vat: "£14,995 +VAT" },
  };
  const reply = (message) => publicVehiclePricingReply({ message, pageType: "finance_vehicle", productLock: "finance", vehicleContext, rememberedFacts: {} });
  assert.match(reply("What gearbox has it got?"), /manual gearbox/i);
  assert.match(reply("And what's the mileage?"), /68,000 miles/i);
  assert.match(reply("How much is it a month?"), /£313/i);
  assert.equal(reply("What deposit do I need on this one?"), null);
  assert.match(controlledBusinessRuntimeReply({ message: "Where are you located?", productContext: "finance" }), /Southampton.*nationwide.*free delivery/i);
  assert.equal(controlledBusinessRuntimeReply({ message: "What day is today?", productContext: "finance", runtimeContext: { current_date: "2026-09-13", current_day: "Sunday" } }), "Today is Sunday, 13 September 2026.");
});

test("Phase 1B does not invent absent opening hours and keeps Rent2Buy collection-only", () => {
  assert.match(controlledBusinessRuntimeReply({ message: "What time are you open?", productContext: "finance" }), /don’t have verified opening hours/i);
  assert.match(controlledBusinessRuntimeReply({ message: "Where are you located?", productContext: "rent2buy" }), /collected from Southampton.*100 miles of SO40 2NN/i);
  assert.doesNotMatch(controlledBusinessRuntimeReply({ message: "Can you deliver to Plymouth?", productContext: "rent2buy" }), /free delivery/i);
});

test("the live conversation prompt uses Jasmine's customer persona and a controlled fallback packet", () => {
  const prompt = conversationPrompt({
    question: "What gearbox has this van got?",
    messages: [],
    sources: [],
    sections: [],
    settings: {},
    productContext: "rent2buy",
    comparison: false,
    intent: { primary_intent: "vehicle_question", secondary_intents: [] },
    memory: { remembered_facts: {}, corrections: [] },
    human: { message_type: "question", confidence: 100, emotion: {}, objection: {} },
    journey: { next_best_question: "Would you like to apply for this van?" },
    pageContext,
    vehicleContext: pageContext.vehicle,
    fallbackResponse: { reply: "This van has a manual gearbox.", recommended_action: "continue" },
  });
  assert.match(prompt, /Controlled live composition/);
  assert.match(prompt, /manual gearbox/);
  assert.match(prompt, /42,000/);
  assert.doesNotMatch(prompt, /Module: ai_assistant_competence_test/);
  assert.doesNotMatch(prompt, /future website assistant/);
  assert.match(LIVE_JASMINE_PERSONA, /customer-facing sales assistant/);
});

test("live OpenAI requests receive the Jasmine persona, not the internal simulation persona", async () => {
  let requestBody;
  const fetchImplementation = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return { ok: true, status: 200, statusText: "OK", async json() { return { output_text: "{}" }; } };
  };
  await requestOpenAIConversationReply("prompt", { model: "gpt-5.6-terra", reasoning_effort: "low" }, { OPENAI_API_KEY: "test" }, fetchImplementation);
  assert.equal(requestBody.input[0].content, LIVE_JASMINE_PERSONA);
  assert.doesNotMatch(requestBody.input[0].content, /internal simulation|competence-test|future website/i);
});

test("controlled validation accepts natural wording and rejects invented facts, figures and product leakage", () => {
  const controls = { fallbackReply: "This van has a manual gearbox and 42,000 miles.", productContext: "finance", pageContext: { product: "finance" }, vehicleContext: pageContext.vehicle };
  assert.equal(validateControlledCompositionReply("It’s the manual model, with 42,000 miles on the clock.", controls).valid, true);
  assert.equal(validateControlledCompositionReply("It’s automatic, with 42,000 miles on the clock.", { ...controls, vehicleContext: {} }).reason, "unsupported_vehicle_claim");
  assert.equal(validateControlledCompositionReply("It has 38,000 miles.", controls).reason, "unsupported_numeric_claim");
  assert.equal(validateControlledCompositionReply("It’s on Rent2Buy with 42,000 miles.", controls).reason, "product_leakage");
  assert.equal(validateControlledCompositionReply("It has a manual gearbox.", controls).reason, "omitted_controlled_numeric_fact");
});

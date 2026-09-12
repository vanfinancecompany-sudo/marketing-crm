import test from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalConversationInput } from "../lib/canonicalPublicAssistantSession.js";
import { normalisePageContext } from "../lib/publicAssistantFoundation.js";
import { conversationPrompt, requestOpenAIConversationReply } from "../api/marketing-ai-assistant-competence.js";
import { LIVE_JASMINE_PERSONA, validateControlledCompositionReply } from "../lib/liveJasmineComposition.js";

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
  const input = buildCanonicalConversationInput({ session, message: "And what's the mileage?", requestId: "request-1", history, pageContext });
  assert.deepEqual(input.messages, history);
  assert.equal(input.page_context.context_source, "rent2buy_server_stock");
  assert.equal(input.vehicle_context.registration, "AB12 CDE");
  assert.equal(input.vehicle_context.mileage, "42,000");
  assert.equal(input.vehicle_context.term_months, 48);
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

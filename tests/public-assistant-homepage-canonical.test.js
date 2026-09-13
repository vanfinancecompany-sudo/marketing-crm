import test from "node:test";
import assert from "node:assert/strict";
import { handleCustomerAssistantRequest } from "../api/ai-assistant-customer.js";

const environment = {
  AI_ASSISTANT_SESSION_SECRET: "test-session-secret-that-is-long-enough",
  AI_ASSISTANT_ALLOWED_ORIGINS: "https://www.vanfinancecompany.co.uk",
};

function responseRecorder() {
  return {
    headers: {},
    statusCode: null,
    payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    end() { return this; },
  };
}

function statefulSupabase(initialSession) {
  const state = { session: structuredClone(initialSession), updates: [] };
  const client = {
    async rpc() { return { data: true, error: null }; },
    from(table) {
      assert.equal(table, "ai_customer_sessions");
      return {
        select() {
          const chain = {
            eq() { return chain; },
            async maybeSingle() { return { data: structuredClone(state.session), error: null }; },
          };
          return chain;
        },
        update(payload) {
          state.updates.push(structuredClone(payload));
          state.session = { ...state.session, ...structuredClone(payload) };
          const chain = {
            eq() { return chain; },
            select() {
              return { async single() { return { data: structuredClone(state.session), error: null }; } };
            },
          };
          return chain;
        },
      };
    },
  };
  return { client, state };
}

function homepageSession() {
  return {
    id: "homepage-session-id",
    page_type: "homepage",
    product_lock: null,
    vehicle_context: {},
    conversation_history: [],
    remembered_facts: {},
    journey_state: {},
    message_count: 0,
    status: "active",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  };
}

function financeVehicleSession() {
  return {
    ...homepageSession(),
    id: "finance-vehicle-session-id",
    page_type: "finance_vehicle",
    product_lock: "finance",
    vehicle_context: {
      registration: "LX23AYD",
      title: "VW Caddy 2.0 TDI C20 Commerce Pro",
      mileage: "94,539",
      transmission: "MANUAL",
    },
    remembered_facts: { product_context: "finance", vehicle_interest: "VW Caddy 2.0 TDI C20 Commerce Pro" },
  };
}

function request(message, productChoice) {
  return {
    method: "POST",
    headers: {
      origin: "https://www.vanfinancecompany.co.uk",
      "x-forwarded-for": "192.0.2.50",
    },
    body: {
      action: "message",
      conversation_id: "opaque-public-conversation-id",
      page_context: { pageType: "homepage" },
      message,
      ...(productChoice ? { product_choice: productChoice } : {}),
    },
  };
}

test("homepage comparison is answered by the canonical assistant without selecting a product", async () => {
  const { client, state } = statefulSupabase(homepageSession());
  const simulateConversation = async () => { throw new Error("Verified product comparisons must not depend on retrieval."); };

  const response = responseRecorder();
  await handleCustomerAssistantRequest(
    request("What is the difference between Finance and Rent2Buy?"),
    response,
    { environment, supabase: client, simulateConversation },
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.status, "needs_product");
  assert.match(response.payload.reply, /Finance is lender-based/i);
  assert.match(response.payload.reply, /Rent2Buy is a separate product with no credit check/i);
  assert.match(response.payload.reply, /£99 \+ VAT final purchase option/i);
  assert.doesNotMatch(response.payload.reply, /guarantee(?:d)? (?:approval|eligibility)/i);
  assert.equal(state.session.product_lock, null);
});

test("homepage comparison qualifies which route may be worth exploring without recommending or guaranteeing it", async () => {
  const { client } = statefulSupabase(homepageSession());
  const response = responseRecorder();
  await handleCustomerAssistantRequest(
    request("My credit is poor and I’m self-employed. I need a van but I’m not sure whether finance or Rent2Buy is better for me. What’s the difference?"),
    response,
    { environment, supabase: client, simulateConversation: async () => { throw new Error("Comparison must be deterministic."); } },
  );

  assert.equal(response.statusCode, 200);
  assert.match(response.payload.reply, /Rent2Buy may be worth exploring/i);
  assert.match(response.payload.reply, /affordability, documents.*eligibility rules still apply/i);
  assert.match(response.payload.reply, /can’t guarantee eligibility/i);
  assert.match(response.payload.reply, /can’t.*personal financial recommendation/i);
  assert.match(response.payload.reply, /Rent2Buy vans are collected from Southampton/i);
  assert.doesNotMatch(response.payload.reply, /Rent2Buy vans? (?:include|receive).*free delivery/i);
});

test("vehicle-page compound questions retain every verified vehicle, delivery and timing answer", async () => {
  const { client } = statefulSupabase(financeVehicleSession());
  const response = responseRecorder();
  await handleCustomerAssistantRequest({
    method: "POST",
    headers: { origin: "https://www.vanfinancecompany.co.uk", "x-forwarded-for": "192.0.2.51" },
    body: {
      action: "message",
      conversation_id: "opaque-finance-vehicle-conversation",
      page_context: { page_type: "finance_vehicle", vehicle: { registration: "LX23AYD" } },
      message: "Can you confirm the mileage and gearbox on this van, and if I’m accepted could you deliver it to Plymouth before next Friday?",
    },
  }, response, {
    environment,
    supabase: client,
    simulateConversation: async () => { throw new Error("A fully verified compound answer must not require model generation."); },
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.payload.reply, /94,539 miles and a manual gearbox/i);
  assert.match(response.payload.reply, /free delivery.*Plymouth|Plymouth.*free delivery/i);
  assert.match(response.payload.reply, /7–10 working days/i);
  assert.match(response.payload.reply, /cannot be guaranteed/i);
});

test("vehicle price plus next-step questions keep both the exact page figure and verified Finance journey", async () => {
  const session = financeVehicleSession();
  session.vehicle_context.pricing = { finance_monthly: "£313" };
  const { client } = statefulSupabase(session);
  const response = responseRecorder();
  await handleCustomerAssistantRequest({
    method: "POST",
    headers: { origin: "https://www.vanfinancecompany.co.uk", "x-forwarded-for": "192.0.2.52" },
    body: {
      action: "message",
      conversation_id: "opaque-finance-price-conversation",
      page_context: { page_type: "finance_vehicle", vehicle: { registration: "LX23AYD" } },
      message: "How much is this van per month, and what happens next?",
    },
  }, response, { environment, supabase: client, simulateConversation: async () => { throw new Error("Verified price and next-step facts must not require generation."); } });

  assert.equal(response.statusCode, 200);
  assert.match(response.payload.reply, /£313/i);
  assert.match(response.payload.reply, /personalised Finance quote/i);
  assert.match(response.payload.reply, /£100 reservation deposit/i);
  assert.match(response.payload.reply, /preparation process/i);
});

test("choosing a product after comparison resets pre-selection state before the canonical product conversation", async () => {
  const initial = homepageSession();
  initial.conversation_history = [
    { role: "user", content: "What is the difference between Finance and Rent2Buy?" },
    { role: "assistant", content: "Here is the comparison." },
  ];
  initial.journey_state = { product_context: "finance", retrieval_performed: true };
  initial.remembered_facts = { product_context: "finance" };
  const { client, state } = statefulSupabase(initial);
  let canonicalCalls = 0;
  const simulateConversation = async () => { canonicalCalls += 1; return { result: {} }; };

  const response = responseRecorder();
  await handleCustomerAssistantRequest(
    request("Rent2Buy", "rent2buy"),
    response,
    { environment, supabase: client, simulateConversation },
  );

  assert.equal(response.statusCode, 200);
  assert.equal(state.session.product_lock, "rent2buy");
  assert.deepEqual(state.session.remembered_facts, { product_context: "rent2buy" });
  assert.deepEqual(state.session.journey_state, {});
  assert.deepEqual(state.session.conversation_history, []);
  assert.equal(canonicalCalls, 0);
});

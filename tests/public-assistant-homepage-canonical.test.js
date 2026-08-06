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
  const inputs = [];
  const simulateConversation = async (_supabase, input) => {
    inputs.push(structuredClone(input));
    return { result: {
      id: "comparison-result",
      reply: "Finance is lender-based, while Rent2Buy is affordability-based. Which suits you best?",
      remembered_facts: { product_context: "finance" },
      retrieval_performed: true,
      knowledge_source_ids: ["finance-source", "rent2buy-source"],
      confidence: 94,
    } };
  };

  const response = responseRecorder();
  await handleCustomerAssistantRequest(
    request("What is the difference between Finance and Rent2Buy?"),
    response,
    { environment, supabase: client, simulateConversation },
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.status, "needs_product");
  assert.equal(response.payload.reply, "Finance is lender-based, while Rent2Buy is affordability-based. Which suits you best?");
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].message, "What is the difference between Finance and Rent2Buy?");
  assert.equal(inputs[0].product_context, "finance");
  assert.equal(state.session.product_lock, null);
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

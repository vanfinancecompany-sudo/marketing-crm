import test from "node:test";
import assert from "node:assert/strict";
import { handleCustomerAssistantRequest } from "../api/ai-assistant-customer.js";

const environment = {
  AI_ASSISTANT_SESSION_SECRET: "test-session-secret-that-is-long-enough",
  AI_ASSISTANT_ALLOWED_ORIGINS: "https://www.vanfinancecompany.co.uk",
};

function responseRecorder() {
  return {
    statusCode: null,
    payload: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    end() { return this; },
  };
}

function statefulSupabase() {
  const state = {
    session: {
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
    },
  };
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
          state.session = { ...state.session, ...structuredClone(payload) };
          const chain = {
            eq() { return chain; },
            select() { return { async single() { return { data: structuredClone(state.session), error: null }; } }; },
          };
          return chain;
        },
      };
    },
  };
  return { client, state };
}

function request(message, productChoice) {
  return {
    method: "POST",
    headers: { origin: "https://www.vanfinancecompany.co.uk", "x-forwarded-for": "192.0.2.60" },
    body: {
      action: "message",
      conversation_id: "opaque-public-conversation-id",
      page_context: { pageType: "homepage" },
      message,
      ...(productChoice ? { product_choice: productChoice } : {}),
    },
  };
}

for (const scenario of [
  { product: "finance", selection: "finance", followUp: "tax included?" },
  { product: "rent2buy", selection: "Rent2Buy", followUp: "is VAT included?" },
]) {
  test(`homepage ${scenario.product} selection feeds the untouched follow-up into the canonical runner`, async () => {
    const { client, state } = statefulSupabase();
    const inputs = [];
    const simulateConversation = async (_supabase, input) => {
      inputs.push(structuredClone(input));
      return { result: {
        id: `${scenario.product}-result`,
        reply: "Canonical product answer",
        remembered_facts: { product_context: scenario.product },
        journey_stage: "Research",
        retrieval_performed: true,
        confidence: 90,
      } };
    };

    const selected = responseRecorder();
    await handleCustomerAssistantRequest(
      request(scenario.selection, scenario.product),
      selected,
      { environment, supabase: client, simulateConversation },
    );
    assert.equal(selected.statusCode, 200);
    assert.equal(state.session.product_lock, scenario.product);
    assert.equal(inputs.length, 0);

    const answered = responseRecorder();
    await handleCustomerAssistantRequest(
      request(scenario.followUp),
      answered,
      { environment, supabase: client, simulateConversation },
    );
    assert.equal(answered.statusCode, 200);
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].message, scenario.followUp);
    assert.equal(inputs[0].product_context, scenario.product);
    assert.deepEqual(inputs[0].remembered_facts, { product_context: scenario.product });
    assert.deepEqual(inputs[0].messages, []);
  });
}

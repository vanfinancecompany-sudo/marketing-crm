import test from "node:test";
import assert from "node:assert/strict";
import { handleCustomerAssistantRequest } from "../api/ai-assistant-customer.js";

const environment = {
  AI_ASSISTANT_SESSION_SECRET: "preview-test-only-session-secret",
  AI_ASSISTANT_ALLOWED_ORIGINS: "https://www.rent2buyvans.co.uk",
};

function makeHarness(allowed = true) {
  const state = { rpcResolvers: [], sessionRead: 0, modelCalls: 0, updated: 0, telemetry: 0 };
  const session = {
    id: "test-session", page_type: "rent2buy_general", product_lock: "rent2buy",
    vehicle_context: {}, remembered_facts: { product_context: "rent2buy" },
    journey_state: {}, conversation_history: [], message_count: 0, status: "active",
    expires_at: new Date(Date.now() + 60000).toISOString(),
  };
  const client = {
    rpc() {
      return new Promise(resolve => { state.rpcResolvers.push(resolve); });
    },
    from(table) {
      if (table === "ai_assistant_events") {
        return { insert() { state.telemetry++; return { select: async () => ({ data: [], error: null }) }; } };
      }
      assert.equal(table, "ai_customer_sessions");
      return {
        select() {
          const query = {
            eq() { return query; },
            async maybeSingle() { state.sessionRead++; return { data: session, error: null }; },
          };
          return query;
        },
        update(payload) {
          state.updated++;
          return { eq() { return { select() { return { async single() { return { data: { ...session, ...payload }, error: null }; } }; } }; } };
        },
      };
    },
  };
  const response = {
    code: null, payload: null,
    setHeader() {},
    status(n) { this.code = n; return this; },
    json(d) { this.payload = d; return this; },
  };
  const request = {
    method: "POST",
    headers: { origin: "https://www.rent2buyvans.co.uk", "x-forwarded-for": "192.0.2.44" },
    body: {
      action: "message", conversation_id: "synthetic-chat-id",
      page_context: { pageType: "rent2buy_general" }, message: "Can I get a van?",
    },
  };
  const simulateConversation = async () => {
    state.modelCalls++;
    return { result: { reply: "You can check Rent2Buy eligibility by applying online. Approval is not guaranteed.", remembered_facts: { product_context: "rent2buy" } } };
  };
  function release() {
    assert.equal(state.rpcResolvers.length, 2);
    state.rpcResolvers.forEach((resolve, i) => resolve({ data: allowed || i !== 0, error: null }));
  }
  return { state, client, response, request, simulateConversation, release };
}

test("message session read and both independent rate-limit checks start together", async () => {
  const h = makeHarness();
  const work = handleCustomerAssistantRequest(h.request, h.response, {
    environment, supabase: h.client, simulateConversation: h.simulateConversation,
  });
  assert.equal(h.state.rpcResolvers.length, 2);
  assert.equal(h.state.sessionRead, 1, "session read starts before rate-limit response");
  assert.equal(h.state.modelCalls, 0, "no model call before limits allow the turn");
  h.release();
  await work;
  assert.equal(h.response.code, 200);
  assert.equal(h.state.modelCalls, 1);
  assert.equal(h.state.updated, 1);
  assert.equal(h.state.telemetry, 1);
});

test("rate limit rejection still blocks generation and chat persistence", async () => {
  const h = makeHarness(false);
  const work = handleCustomerAssistantRequest(h.request, h.response, {
    environment, supabase: h.client, simulateConversation: h.simulateConversation,
  });
  assert.equal(h.state.rpcResolvers.length, 2);
  assert.equal(h.state.sessionRead, 1);
  h.release();
  await work;
  assert.equal(h.response.code, 429);
  assert.equal(h.state.modelCalls, 0);
  assert.equal(h.state.updated, 0);
  assert.equal(h.state.telemetry, 0);
});

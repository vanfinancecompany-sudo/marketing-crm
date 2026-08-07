import test from "node:test";
import assert from "node:assert/strict";
import { handleCustomerAssistantRequest } from "../api/ai-assistant-customer.js";
import { classifyUniversalMessage } from "../lib/humanConversationRecovery.js";

const environment = {
  AI_ASSISTANT_SESSION_SECRET: "test-session-secret-that-is-long-enough",
  AI_ASSISTANT_ALLOWED_ORIGINS: "https://www.vanfinancecompany.co.uk",
};

function responseRecorder() {
  return {
    headers: {}, statusCode: null, payload: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    end() { return this; },
  };
}

function mockSupabase(session) {
  const state = { updated: null, rpcCalls: [] };
  return {
    state,
    client: {
      async rpc(name, args) { state.rpcCalls.push({ name, args }); return { data: true, error: null }; },
      from(table) {
        assert.equal(table, "ai_customer_sessions");
        return {
          select() {
            const chain = { eq() { return chain; }, async maybeSingle() { return { data: session, error: null }; } };
            return chain;
          },
          update(payload) {
            state.updated = payload;
            const chain = {
              eq() { return chain; },
              select() { return { async single() { return { data: { ...session, ...payload }, error: null }; } }; },
            };
            return chain;
          },
        };
      },
    },
  };
}

test("an explicit homepage product click remains deterministic when a restored session is already locked", async () => {
  const conversationId = "restored-homepage-session";
  const session = {
    id: "session-internal-id",
    page_type: "homepage",
    product_lock: "finance",
    vehicle_context: {},
    conversation_history: [{ role: "user", content: "Do you offer finance for bad credit?" }, { role: "assistant", content: "Yes, subject to lender criteria." }],
    remembered_facts: { product_context: "finance", credit_concern: true },
    journey_state: { journey_stage: "Exploring" },
    message_count: 2,
    status: "active",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  };
  const { client, state } = mockSupabase(session);
  let canonicalCalled = false;
  const response = responseRecorder();
  await handleCustomerAssistantRequest({
    method: "POST",
    headers: { origin: "https://www.vanfinancecompany.co.uk", "x-forwarded-for": "192.0.2.20" },
    body: {
      action: "message",
      conversation_id: conversationId,
      page_context: { pageType: "homepage" },
      message: "finance",
      product_choice: "finance",
    },
  }, response, {
    environment,
    supabase: client,
    simulateConversation: async () => { canonicalCalled = true; throw new Error("Canonical assistant must not classify an explicit product button click."); },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.status, "ready");
  assert.match(response.payload.reply, /focused on Van Finance/i);
  assert.equal(canonicalCalled, false);
  assert.equal(state.updated.message_count, 3);
  assert.equal(state.updated.product_lock, undefined);
  assert.equal(state.updated.conversation_history, undefined);
});

test("a normal question in an active conversation is not diverted to generic recovery just because its current wording lacks a known keyword", () => {
  const messages = [
    { role: "assistant", content: "The next step is to start your Finance application below." },
    { role: "user", content: "Can I apply here?" },
    { role: "assistant", content: "Yes. Complete the application below and ask if you need help while applying." },
  ];
  const classification = classifyUniversalMessage({
    message: "It says it needs my bank details — is this correct, and why?",
    messages,
    journey: { application_mode_active: true },
  });

  assert.equal(classification.message_type, "follow_up_question");
  assert.equal(classification.recovery_required, false);
  assert.equal(classification.low_confidence, false);
  assert.match(classification.reason, /recent context|active conversation/i);
});

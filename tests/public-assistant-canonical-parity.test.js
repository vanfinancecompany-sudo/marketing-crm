import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { handleCustomerAssistantRequest } from "../api/ai-assistant-customer.js";
import {
  buildCanonicalConversationInput,
  canonicalSessionState,
} from "../lib/canonicalPublicAssistantSession.js";

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
  const state = {
    session: structuredClone(initialSession),
    updates: [],
    rpcCalls: [],
  };
  const client = {
    async rpc(name, args) {
      state.rpcCalls.push({ name, args });
      return { data: true, error: null };
    },
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
              return {
                async single() { return { data: structuredClone(state.session), error: null }; },
              };
            },
          };
          return chain;
        },
      };
    },
  };
  return { client, state };
}

function activeFinanceSession() {
  return {
    id: "session-internal-id",
    page_type: "finance_general",
    product_lock: "finance",
    vehicle_context: {},
    conversation_history: [
      { role: "assistant", content: "How can I help with Van Finance?" },
      { role: "user", content: "I am self employed" },
      { role: "assistant", content: "Thanks — what would you like to know?" },
    ],
    remembered_facts: {
      product_context: "finance",
      employment_status: "self-employed",
    },
    journey_state: {
      journey_stage: "Exploring",
      conversation_goal: "Understand finance",
    },
    message_count: 1,
    status: "active",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  };
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

function messageRequest(message, { pageType = "finance_general", productChoice } = {}) {
  return {
    method: "POST",
    headers: {
      origin: "https://www.vanfinancecompany.co.uk",
      "x-forwarded-for": "192.0.2.20",
    },
    body: {
      action: "message",
      conversation_id: "opaque-public-conversation-id",
      page_context: { pageType },
      message,
      ...(productChoice ? { product_choice: productChoice } : {}),
    },
  };
}

test("canonical adapter passes the original customer wording and complete existing state unchanged", () => {
  const session = activeFinanceSession();
  const input = buildCanonicalConversationInput({
    session,
    message: "tax included?",
    requestId: "public-test",
    history: session.conversation_history,
  });

  assert.equal(input.message, "tax included?");
  assert.equal(input.product_context, "finance");
  assert.deepEqual(input.messages, session.conversation_history);
  assert.deepEqual(input.remembered_facts, session.remembered_facts);
  assert.deepEqual(input.journey_state, session.journey_state);
});

test("canonical session state persists the runner result rather than a reduced public approximation", () => {
  const session = activeFinanceSession();
  const result = {
    id: "result-1",
    reply: "Finance prices are shown plus VAT.",
    remembered_facts: {
      product_context: "finance",
      employment_status: "self-employed",
      budget_monthly_gbp: 350,
    },
    journey_stage: "Research",
    application_mode_active: false,
    retrieval_performed: true,
    knowledge_source_ids: ["S1"],
    confidence: 94,
    confidence_reason: "Approved Finance evidence was retrieved.",
    nested_diagnostics: { priority_path_taken: "knowledge" },
  };

  const state = canonicalSessionState({ session, result, productLock: "finance" });
  assert.deepEqual(state.journey_state, result);
  assert.deepEqual(state.remembered_facts, result.remembered_facts);
  assert.equal(state.budget, "350");
  assert.equal(state.last_competence_result_id, "result-1");
});

test("homepage product selection sets transport state without polluting canonical history", async () => {
  const { client, state } = statefulSupabase(homepageSession());
  const canonicalInputs = [];
  const simulateConversation = async (_supabase, input) => {
    canonicalInputs.push(structuredClone(input));
    return { result: {
      id: "result-homepage-1",
      reply: "Finance prices are shown plus VAT.",
      remembered_facts: { product_context: "finance" },
      journey_stage: "Research",
      retrieval_performed: true,
      confidence: 94,
    } };
  };

  const selectionResponse = responseRecorder();
  await handleCustomerAssistantRequest(
    messageRequest("finance", { pageType: "homepage", productChoice: "finance" }),
    selectionResponse,
    { environment, supabase: client, simulateConversation },
  );

  assert.equal(selectionResponse.statusCode, 200);
  assert.equal(state.session.product_lock, "finance");
  assert.deepEqual(state.session.conversation_history, []);
  assert.equal(canonicalInputs.length, 0);

  const factualResponse = responseRecorder();
  await handleCustomerAssistantRequest(
    messageRequest("tax included?", { pageType: "homepage" }),
    factualResponse,
    { environment, supabase: client, simulateConversation },
  );

  assert.equal(factualResponse.statusCode, 200);
  assert.equal(canonicalInputs.length, 1);
  assert.equal(canonicalInputs[0].message, "tax included?");
  assert.equal(canonicalInputs[0].product_context, "finance");
  assert.deepEqual(canonicalInputs[0].messages, []);
  assert.deepEqual(canonicalInputs[0].remembered_facts, { product_context: "finance" });
});

test("public endpoint carries canonical remembered facts and journey state into the following turn", async () => {
  const { client, state } = statefulSupabase(activeFinanceSession());
  const canonicalInputs = [];
  const firstResult = {
    id: "result-1",
    reply: "Finance prices are shown plus VAT.",
    remembered_facts: {
      product_context: "finance",
      employment_status: "self-employed",
      budget_monthly_gbp: 350,
    },
    journey_stage: "Research",
    retrieval_performed: true,
    knowledge_source_ids: ["finance-vat-source"],
    confidence: 95,
    confidence_reason: "Approved Finance pricing evidence was retrieved.",
  };
  const secondResult = {
    id: "result-2",
    reply: "Delivery depends on the vehicle and location, so I’ll use the approved Finance delivery information.",
    remembered_facts: firstResult.remembered_facts,
    journey_stage: "Research",
    retrieval_performed: true,
    knowledge_source_ids: ["finance-delivery-source"],
    confidence: 92,
    confidence_reason: "Approved Finance delivery evidence was retrieved.",
  };
  let call = 0;
  const simulateConversation = async (_supabase, input) => {
    canonicalInputs.push(structuredClone(input));
    call += 1;
    return { result: call === 1 ? firstResult : secondResult };
  };

  const firstResponse = responseRecorder();
  await handleCustomerAssistantRequest(
    messageRequest("tax included?"),
    firstResponse,
    { environment, supabase: client, simulateConversation },
  );
  assert.equal(firstResponse.statusCode, 200);
  assert.equal(canonicalInputs[0].message, "tax included?");
  assert.deepEqual(state.session.journey_state, firstResult);
  assert.deepEqual(state.session.remembered_facts, firstResult.remembered_facts);

  const secondResponse = responseRecorder();
  await handleCustomerAssistantRequest(
    messageRequest("what about delivery?"),
    secondResponse,
    { environment, supabase: client, simulateConversation },
  );
  assert.equal(secondResponse.statusCode, 200);
  assert.equal(canonicalInputs[1].message, "what about delivery?");
  assert.deepEqual(canonicalInputs[1].journey_state, firstResult);
  assert.deepEqual(canonicalInputs[1].remembered_facts, firstResult.remembered_facts);
  assert.equal(canonicalInputs[1].product_context, "finance");
});

test("public route contains no short-question rewriting or reduced canonical-state filters", async () => {
  const route = await readFile(new URL("../api/ai-assistant-customer.js", import.meta.url), "utf8");
  assert.doesNotMatch(route, /contextualiseShortFactualMessage/);
  assert.doesNotMatch(route, /publicRememberedFacts|publicJourneyState/);
  assert.match(route, /buildCanonicalConversationInput/);
  assert.match(route, /canonicalSessionState/);
});

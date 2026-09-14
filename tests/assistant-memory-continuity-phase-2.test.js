import test from "node:test";
import assert from "node:assert/strict";
import { handleCustomerAssistantRequest } from "../api/ai-assistant-customer.js";
import { simulateCustomerConversation } from "../api/marketing-ai-assistant-competence.js";
import { canonicalSessionState } from "../lib/canonicalPublicAssistantSession.js";
import {
  buildConversationMemory,
  controlledAlternativeRecallReply,
  controlledMemoryRecallReply,
  extractConversationFacts,
  mergeRememberedFacts,
} from "../lib/conversationIntelligence.js";
import { extractUkLocation } from "../lib/productCoverageRules.js";
import { controlledBusinessRuntimeReply, controlledVehicleNextStepReply } from "../lib/salesConversationEngine.js";
import { validateRememberedFactConsistency } from "../lib/liveJasmineComposition.js";

const explicit = (source = "user-1") => ({ provenance: "customer_explicit", confidence: 0.95, source_message_id: source });

test("self-employed persists across turns and a weaker unprovenanced value cannot replace it", () => {
  const first = buildConversationMemory([{ id: "u1", role: "user", content: "I'm self-employed" }]);
  const later = buildConversationMemory(
    [{ role: "user", content: "What deposit would I probably need?" }],
    first.remembered_facts,
    first.fact_metadata,
  );
  assert.equal(later.remembered_facts.employment_status, "self-employed");

  const merged = mergeRememberedFacts({
    previousFacts: later.remembered_facts,
    previousMetadata: later.fact_metadata,
    updates: { employment_status: "employed" },
  });
  assert.equal(merged.remembered_facts.employment_status, "self-employed");
});

test("an explicit employment correction replaces the previous value", () => {
  const memory = buildConversationMemory(
    [{ id: "u2", role: "user", content: "Actually, I'm employed now, not self-employed" }],
    { employment_status: "self-employed" },
    { employment_status: explicit("u1") },
  );
  assert.equal(memory.remembered_facts.employment_status, "employed");
  assert.equal(memory.corrections.some((item) => item.field === "employment_status"), true);
});

test("Plymouth persists and reference-only pronouns never become locations", () => {
  const first = buildConversationMemory([{ id: "u1", role: "user", content: "I live in Plymouth" }]);
  const second = buildConversationMemory(
    [{ id: "u2", role: "user", content: "Can you deliver it to me?" }],
    first.remembered_facts,
    first.fact_metadata,
  );
  assert.equal(first.remembered_facts.location, "Plymouth");
  assert.equal(second.remembered_facts.location, "Plymouth");
  assert.equal(extractUkLocation("Can you deliver it to me?"), null);
  assert.equal(extractUkLocation("Can you deliver it here?"), null);
});

test("a monthly budget persists and a deposit figure cannot overwrite it", () => {
  const first = buildConversationMemory([{ id: "u1", role: "user", content: "I'd like to keep the payments around £350 a month" }]);
  const second = buildConversationMemory(
    [{ id: "u2", role: "user", content: "Do deposits start from £99?" }],
    first.remembered_facts,
    first.fact_metadata,
  );
  assert.equal(first.remembered_facts.budget_monthly_gbp, 350);
  assert.equal(second.remembered_facts.budget_monthly_gbp, 350);
  assert.equal(second.remembered_facts.deposit_budget_gbp, undefined);
});

test("direct budget and circumstances recall use only trusted state and current vehicle context", () => {
  const facts = {
    employment_status: "self-employed",
    credit_concern: "credit history",
    location: "Plymouth",
    budget_monthly_gbp: 350,
    delivery_interest: true,
  };
  const factMetadata = {
    employment_status: explicit("u1"),
    credit_concern: explicit("u1"),
    location: explicit("u1"),
    budget_monthly_gbp: explicit("u2"),
    delivery_interest: { provenance: "inferred", confidence: 0.7, source_message_id: "u3" },
  };
  assert.equal(controlledMemoryRecallReply({ message: "What budget did I tell you?", facts, factMetadata }), "Around £350 a month.");
  const reply = controlledMemoryRecallReply({
    message: "What do you remember about my circumstances?",
    facts,
    factMetadata,
    vehicleContext: { title: "VW Caddy 2.0 TDI C20 Commerce Pro" },
  });
  assert.match(reply, /self-employed.*credit isn’t great.*live in Plymouth.*£350 a month/i);
  assert.match(reply, /currently looking at this VW Caddy/i);
  assert.doesNotMatch(reply, /delivery interest/i);
});

test("unknown recall facts are not invented", () => {
  assert.equal(controlledMemoryRecallReply({ message: "What budget did I tell you?" }), "You haven’t told me a monthly budget yet.");
  assert.equal(controlledMemoryRecallReply({ message: "What do you remember about me?" }), "You haven’t told me much about your circumstances yet.");
});

test("explicit previous-refusal shorthand is remembered without treating a question as a fact", () => {
  const stated = buildConversationMemory([{ role: "user", content: "turned down yesterday" }]);
  assert.equal(stated.remembered_facts.credit_concern, "previous refusal");
  assert.equal(stated.fact_metadata.credit_concern.provenance, "customer_explicit");
  const questioned = buildConversationMemory([{ role: "user", content: "Could I be turned down?" }]);
  assert.equal(questioned.remembered_facts.credit_concern, undefined);
});

test("an explicitly discussed alternative is recalled but an absent one is not invented", () => {
  const discussed = buildConversationMemory([{ role: "user", content: "How does Rent2Buy compare with Finance?" }]);
  assert.equal(controlledAlternativeRecallReply({ message: "What was the other option you mentioned?", facts: discussed.remembered_facts, productContext: "finance" }), "The other option we discussed was Rent2Buy.");
  assert.equal(controlledAlternativeRecallReply({ message: "What was the other option you mentioned?", facts: {}, productContext: "finance" }), "We haven’t discussed another option in this conversation.");
});

test("current vehicle and locked product survive a conflicting runner result", () => {
  const session = {
    product_lock: "finance",
    remembered_facts: { product_context: "finance", employment_status: "self-employed", vehicle_interest: "VW Caddy" },
    vehicle_context: { title: "VW Caddy" },
    journey_state: { remembered_fact_metadata: { employment_status: explicit("u1"), vehicle_interest: { provenance: "system_context", confidence: 1 } } },
  };
  const result = {
    remembered_facts: { product_context: "rent2buy", employment_status: "employed", vehicle_interest: "Transit" },
    remembered_fact_metadata: {
      product_context: { provenance: "inferred", confidence: 0.5 },
      employment_status: { provenance: "inferred", confidence: 0.5 },
      vehicle_interest: { provenance: "inferred", confidence: 0.5 },
    },
  };
  const state = canonicalSessionState({ session, result, productLock: "finance" });
  assert.equal(state.remembered_facts.product_context, "finance");
  assert.equal(state.remembered_facts.employment_status, "self-employed");
  assert.equal(state.remembered_facts.vehicle_interest, "VW Caddy");
});

test("generated wording cannot degrade employment or substitute a pronoun for location", () => {
  assert.equal(validateRememberedFactConsistency("You're employed, and we deliver including Plymouth.", { rememberedFacts: { employment_status: "self-employed", location: "Plymouth" } }).reason, "employment_fact_conflict");
  assert.equal(validateRememberedFactConsistency("Yes, we deliver including me.", { rememberedFacts: { location: "Plymouth" } }).reason, "location_pronoun_substitution");
  assert.equal(validateRememberedFactConsistency("You're self-employed and we deliver including Plymouth.", { rememberedFacts: { employment_status: "self-employed", location: "Plymouth" } }).valid, true);
});

test("delivery to me resolves the remembered customer location and Finance next steps remain ordered", () => {
  const delivery = controlledBusinessRuntimeReply({ message: "Can you deliver it to me?", productContext: "finance", rememberedFacts: { location: "Plymouth" } });
  assert.match(delivery, /including Plymouth/i);
  assert.doesNotMatch(delivery, /including me/i);
  const next = controlledVehicleNextStepReply("What should I do next?", "finance");
  assert.match(next, /complete the Finance application.*lender will assess.*personalised Finance quote.*choose whether to proceed.*reservation deposit.*preparation.*delivery or collection/i);
  assert.doesNotMatch(next, /guaranteed|tomorrow|same day/i);
});

test("realistic Finance vehicle conversation preserves facts through deposit, delivery, recall and next step", async () => {
  const vehicle = { registration: "AB12CDE", title: "VW Caddy 2.0 TDI C20 Commerce Pro", transmission: "Manual", mileage: 42000, pricing: { retail_price: 14995, displayed_monthly_finance: 350 } };
  const state = {
    session: {
      id: "phase-2-session",
      page_type: "finance_vehicle",
      product_lock: "finance",
      vehicle_context: vehicle,
      conversation_history: [],
      remembered_facts: { product_context: "finance", vehicle_interest: vehicle.title },
      journey_state: {},
      message_count: 0,
      status: "active",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
  };
  const supabase = {
    async rpc() { return { data: true, error: null }; },
    from(table) {
      if (table === "ai_assistant_events") return { insert() { return { async select() { return { data: [], error: null }; } }; } };
      assert.equal(table, "ai_customer_sessions");
      return {
        select() { const chain = { eq() { return chain; }, async maybeSingle() { return { data: structuredClone(state.session), error: null }; } }; return chain; },
        update(payload) { state.session = { ...state.session, ...structuredClone(payload) }; const chain = { eq() { return chain; }, select() { return { async single() { return { data: structuredClone(state.session), error: null }; } }; } }; return chain; },
      };
    },
  };
  const knowledge = {
    settings: {},
    sections: [],
    articles: [{ id: "finance-memory-fixture", title: "Finance applications, deposits and vehicles", category: "Van Finance", status: "approved", is_active: true, content_markdown: "Customers can apply for a personalised Finance quote. Deposits can start from £99 on qualifying applications, but the actual deposit depends on lender assessment. Poor credit and self-employment can be considered subject to assessment. Vehicle questions use the verified current page context.", faq_json: [] }],
  };
  const simulateConversation = (client, input) => simulateCustomerConversation(client, input, { generationMode: "deterministic", persist: false, knowledge });
  const environment = { AI_ASSISTANT_SESSION_SECRET: "phase-2-test-secret", AI_ASSISTANT_ALLOWED_ORIGINS: "https://www.vanfinancecompany.co.uk" };
  const send = async (message) => {
    const response = { headers: {}, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; }, end() { return this; } };
    await handleCustomerAssistantRequest({ method: "POST", headers: { origin: "https://www.vanfinancecompany.co.uk", "x-forwarded-for": "192.0.2.44" }, body: { action: "message", conversation_id: "opaque", page_context: { pageType: "finance_vehicle", vehicle }, message } }, response, { environment, supabase, simulateConversation });
    assert.equal(response.statusCode, 200, message);
    return response.payload.reply;
  };

  await send("I'm self-employed, my credit isn't great and I live in Plymouth");
  await send("I'd like to keep the payments around £350 a month");
  assert.match(await send("What gearbox has this van got?"), /manual/i);
  await send("What deposit would I probably need?");
  assert.match(await send("Can you deliver it to me?"), /including Plymouth/i);
  assert.equal(await send("What did you say my budget was?"), "Around £350 a month.");
  const circumstances = await send("What do you remember about my circumstances?");
  assert.match(circumstances, /self-employed.*credit isn’t great.*Plymouth.*£350.*VW Caddy/i);
  assert.match(await send("What should I do next?"), /application.*assess.*personalised Finance quote.*choose whether to proceed.*preparation/i);
  assert.equal(state.session.remembered_facts.employment_status, "self-employed");
  assert.equal(state.session.remembered_facts.location, "Plymouth");
  assert.equal(state.session.remembered_facts.budget_monthly_gbp, 350);
  assert.equal(state.session.remembered_facts.vehicle_interest, vehicle.title);
  assert.equal(state.session.remembered_facts.product_context, "finance");
});

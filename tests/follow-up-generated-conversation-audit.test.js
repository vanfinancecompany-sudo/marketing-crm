import test from "node:test";
import assert from "node:assert/strict";
import { simulateCustomerConversation } from "../api/marketing-ai-assistant-competence.js";

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

async function turn(state, message) {
  const generated = await simulateCustomerConversation(null, {
    message,
    product_context: state.product,
    messages: state.messages,
    remembered_facts: state.facts,
    journey_state: state.journey,
  }, { persist: false, generationMode: "deterministic" });
  const result = generated.result;
  state.messages.push({ role: "user", content: message }, { role: "assistant", content: result.reply });
  state.facts = result.remembered_facts;
  state.journey = carryJourney(result);
  return result;
}

for (const product of ["finance", "rent2buy"]) {
  test(`generated ${product} conversation consumes each answer to Jasmine's own next question`, async () => {
    const state = { product, messages: [], facts: {}, journey: {} };

    const opening = await turn(state, "I need a van");
    assert.match(opening.reply, /found a van|help choosing/i);

    const choosing = await turn(state, "need help choosing");
    assert.match(choosing.reply, /what type of van are you looking for/i);
    assert.doesNotMatch(choosing.reply, /what would you like to know about.*need help choosing|not quite sure/i);

    const vehicle = await turn(state, "medium");
    assert.equal(vehicle.remembered_facts.vehicle_interest, "Medium");
    assert.match(vehicle.reply, /monthly budget/i);

    const budget = await turn(state, "400");
    assert.equal(budget.remembered_facts.budget_monthly_gbp, 400);
    assert.match(budget.reply, /employed or self-employed/i);
    assert.doesNotMatch(budget.reply, /what would you like to know about.*400|not quite sure/i);

    const employment = await turn(state, "self employed");
    assert.equal(employment.remembered_facts.employment_status, "self-employed");
    assert.match(employment.reply, /how long have you been trading/i);

    const trading = await turn(state, "2 years");
    assert.equal(trading.remembered_facts.trading_history, "2 years");
    assert.doesNotMatch(trading.reply, /what would you like to know about.*2 years|not quite sure|didn.t understand/i);

    for (const result of [opening, choosing, vehicle, budget, employment, trading]) {
      assert.equal(result.one_question_at_a_time, true);
      assert.equal(result.repeated_assistant_wording, false);
    }
  });
}

test("generated Finance high-intent conversation consumes Jasmine's location question without losing the postcode", async () => {
  const state = {
    product: "finance",
    messages: [{ role: "user", content: "I urgently need a Transit" }, { role: "assistant", content: "Which town or postcode are you based in?" }],
    facts: { vehicle_interest: "Transit", vehicle_type: "Transit", urgency: "high" },
    journey: { buying_intent_level: "High Intent", journey_stage: "Decision Support", conversation_goal: "Choose vehicle" },
  };
  const result = await turn(state, "SO40 2NN");
  assert.equal(result.remembered_facts.location, "SO40 2NN");
  assert.doesNotMatch(result.reply, /what would you like to know about.*SO40|not quite sure|didn.t understand/i);
});

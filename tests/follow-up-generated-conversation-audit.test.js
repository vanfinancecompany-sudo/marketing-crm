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

async function turn(state, message, options = {}) {
  const generated = await simulateCustomerConversation(null, {
    message,
    product_context: state.product,
    messages: state.messages,
    remembered_facts: state.facts,
    journey_state: state.journey,
  }, { persist: false, generationMode: "deterministic", ...options });
  const result = generated.result;
  state.messages.push({ role: "user", content: message }, { role: "assistant", content: result.reply });
  state.facts = result.remembered_facts;
  state.journey = carryJourney(result);
  return result;
}

function rent2BuyLocationOptions() {
  return {
    knowledge: { settings: {}, sections: [], articles: [] },
    coverageResolver: async () => ({
      source: {
        type: "coverage_rule",
        source_id: "coverage:rent2buy",
        title: "Approved Rent2Buy coverage",
        heading: "SO40 2NN",
        passage: "Approved Rent2Buy coverage rule: the supplied postcode is within the normal area. Collection is from Southampton only. Do not mention Finance.",
        public_url: "",
        score: 1000,
        product: "rent2buy",
      },
      diagnostics: {
        detected_location: "SO40 2NN",
        resolved_postcode: "SO40 2NN",
        resolved_coordinates: null,
        distance_miles: 0,
        calculation_type: "test_fixture",
        base_postcode: "SO40 2NN",
        coverage_result: "within_normal_area",
        certainty: "confirmed",
        conflicting_sources: [],
      },
    }),
  };
}

for (const product of ["finance", "rent2buy"]) {
  test(`generated ${product} conversation consumes each answer to Jasmine's own next question`, async () => {
    const state = { product, messages: [], facts: {}, journey: {} };

    const opening = await turn(state, "I need a van");
    assert.match(opening.reply, /size or type of van/i);
    assert.doesNotMatch(opening.reply, /what would you like help with/i);

    const vehicle = await turn(state, "medium");
    assert.equal(vehicle.remembered_facts.vehicle_interest, "Medium");
    assert.match(vehicle.reply, /monthly budget/i);
    assert.doesNotMatch(vehicle.reply, /what would you like to know about.*medium|not quite sure/i);

    const budget = await turn(state, "400");
    assert.equal(budget.remembered_facts.budget_monthly_gbp, 400);
    assert.match(budget.reply, /town or postcode/i);
    assert.doesNotMatch(budget.reply, /what would you like to know about.*400|not quite sure/i);

    const location = await turn(state, "SO40 2NN", product === "rent2buy" ? rent2BuyLocationOptions() : {});
    assert.equal(location.remembered_facts.location, "SO40 2NN");
    assert.doesNotMatch(location.reply, /what would you like to know about.*SO40|not quite sure|didn.t understand/i);

    for (const result of [opening, vehicle, budget, location]) {
      assert.equal(result.one_question_at_a_time, true);
      assert.equal(result.repeated_assistant_wording, false);
    }
  });
}

test("generated employment follow-up consumes self-employed and asks the relevant trading-history question", async () => {
  for (const product of ["finance", "rent2buy"]) {
    const state = {
      product,
      messages: [{ role: "assistant", content: "Are you employed or self-employed?" }],
      facts: {},
      journey: {},
    };
    const employment = await turn(state, "self employed");
    assert.equal(employment.remembered_facts.employment_status, "self-employed");
    assert.match(employment.reply, /how long have you been trading/i);
    assert.doesNotMatch(employment.reply, /are you employed or self-employed|what would you like to know about|not quite sure/i);

    const trading = await turn(state, "2 years");
    assert.equal(trading.remembered_facts.trading_history, "2 years");
    assert.doesNotMatch(trading.reply, /what would you like to know about.*2 years|not quite sure|didn.t understand/i);
  }
});

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

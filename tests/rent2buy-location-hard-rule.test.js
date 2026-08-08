import assert from "node:assert/strict";
import test from "node:test";
import { orchestrateConversationTurn } from "../lib/conversationKnowledgeOrchestrator.js";

function route(message, previousAssistant = "", overrides = {}) {
  const intent = {
    product_context: "rent2buy",
    primary_intent: "incomplete_business_question",
    retrieval_required: false,
    clarification_required: true,
    suggested_clarification_question: "What do you mean?",
    secondary_intents: [],
    ...overrides.intent,
  };
  const human = {
    message_type: "unknown_intent",
    recovery_required: true,
    previous_assistant_message: previousAssistant,
    ...overrides.human,
  };
  const orchestration = orchestrateConversationTurn({ message, intent, human, journey: {}, priorJourney: {}, buyingSignals: {} });
  return { intent, orchestration };
}

test("a full UK postcode in Rent2Buy always routes to deterministic coverage before recovery", () => {
  const { intent, orchestration } = route("BH23 1QH");
  assert.equal(orchestration.retrieval_required, true);
  assert.equal(orchestration.recovery_required, false);
  assert.equal(orchestration.rent2buy_location_turn, true);
  assert.ok(intent.secondary_intents.includes("coverage"));
  assert.ok(orchestration.detected_intents.includes("rent2buy_location"));
  assert.ok(orchestration.priority_path_taken.includes("verified_business_knowledge"));
});

test("a bare town or city answers the assistant's explicit Rent2Buy location request", () => {
  const previous = "Please tell me your full home postcode, town or city and I’ll check whether you are within 100 miles of SO40 2NN.";
  for (const place of ["Bournemouth", "New Forest", "Christchurch"]) {
    const { intent, orchestration } = route(place, previous);
    assert.equal(orchestration.retrieval_required, true, place);
    assert.equal(orchestration.recovery_required, false, place);
    assert.ok(intent.secondary_intents.includes("coverage"), place);
    assert.ok(orchestration.detected_intents.includes("rent2buy_location"), place);
  }
});

test("ordinary short Rent2Buy messages are not guessed to be places", () => {
  for (const message of ["hello there", "help pls", "bye", "call me", "I need a human", "just looking", "yes please", "maybe"]) {
    const { orchestration } = route(message);
    assert.equal(orchestration.rent2buy_location_turn, false, message);
  }
});

test("a bare place without a preceding location request is not guessed by the hard rule", () => {
  const { orchestration } = route("Bournemouth");
  assert.equal(orchestration.rent2buy_location_turn, false);
});

test("the same postcode hard rule is not applied in Finance context", () => {
  const { orchestration } = route("BH23 1QH", "", { intent: { product_context: "finance" } });
  assert.equal(orchestration.rent2buy_location_turn, false);
});

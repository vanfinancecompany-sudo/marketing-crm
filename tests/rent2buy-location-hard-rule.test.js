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

test("full, compact and hyphenated UK postcodes route to Rent2Buy coverage before recovery", () => {
  for (const postcode of ["BH23 1QH", "bh231qh", "BH23-1QH", "  BH23   1QH  "]) {
    const { intent, orchestration } = route(postcode);
    assert.equal(orchestration.retrieval_required, true, postcode);
    assert.equal(orchestration.recovery_required, false, postcode);
    assert.equal(orchestration.rent2buy_location_turn, true, postcode);
    assert.equal(intent.secondary_intents.includes("coverage"), false, postcode);
    assert.ok(orchestration.detected_intents.includes("coverage"), postcode);
    assert.ok(orchestration.detected_intents.includes("rent2buy_location"), postcode);
  }
});

test("postcode-looking input with a formatting error is routed using the current message rather than stale location context", () => {
  const { intent, orchestration } = route("BH23 1Q", "", { intent: { secondary_intents: ["coverage"] } });
  assert.equal(orchestration.retrieval_required, true);
  assert.equal(orchestration.recovery_required, false);
  assert.equal(orchestration.rent2buy_location_turn, true);
  assert.equal(intent.secondary_intents.includes("coverage"), false);
  assert.ok(orchestration.detected_intents.includes("coverage"));
});

test("a bare town or city routes to Rent2Buy coverage even without a preceding location prompt", () => {
  for (const place of ["Bournemouth", "New Forest", "Christchurch", "Milton Keynes", "St Albans", "Salisbury"]) {
    const { intent, orchestration } = route(place, "", { intent: { secondary_intents: ["coverage"] } });
    assert.equal(orchestration.retrieval_required, true, place);
    assert.equal(orchestration.recovery_required, false, place);
    assert.equal(intent.secondary_intents.includes("coverage"), false, place);
    assert.ok(orchestration.detected_intents.includes("coverage"), place);
    assert.ok(orchestration.detected_intents.includes("rent2buy_location"), place);
  }
});

test("ordinary short Rent2Buy messages are not guessed to be places", () => {
  for (const message of ["hello there", "help pls", "bye", "call me", "I need a human", "just looking", "yes please", "maybe", "can you help", "need a van"]) {
    const { orchestration } = route(message);
    assert.equal(orchestration.rent2buy_location_turn, false, message);
  }
});

test("the same location hard rule is not applied in Finance context", () => {
  for (const message of ["BH23 1QH", "BH23-1QH", "Bournemouth"]) {
    const { orchestration } = route(message, "", { intent: { product_context: "finance" } });
    assert.equal(orchestration.rent2buy_location_turn, false, message);
  }
});

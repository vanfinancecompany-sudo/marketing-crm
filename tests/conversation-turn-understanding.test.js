import test from "node:test";
import assert from "node:assert/strict";
import { classifyConversationIntent } from "../lib/conversationIntelligence.js";
import { classifyUniversalMessage } from "../lib/humanConversationRecovery.js";
import { orchestrateConversationTurn } from "../lib/conversationKnowledgeOrchestrator.js";

function understand(message, messages, { product = "finance", priorJourney = {} } = {}) {
  const human = classifyUniversalMessage({ message, messages, journey: priorJourney });
  const intent = classifyConversationIntent({ message, history: messages, productContext: product });
  const orchestration = orchestrateConversationTurn({
    message,
    intent,
    human,
    journey: priorJourney,
    priorJourney,
    buyingSignals: { detected_buying_signal: "none" },
  });
  return { human, intent, orchestration };
}

test("yes please accepts the assistant's immediately preceding knowledge offer", () => {
  const messages = [{
    role: "assistant",
    content: "Rent2Buy is based on affordability. If you'd like, I can help explain the application process next.",
  }];
  const result = understand("yes please", messages, { product: "rent2buy" });
  assert.equal(result.human.message_type, "contextual_acceptance");
  assert.equal(result.human.contextual_requires_knowledge, true);
  assert.equal(result.human.recovery_required, false);
  assert.equal(result.orchestration.contextual_turn, true);
  assert.equal(result.orchestration.retrieval_required, true);
  assert.equal(result.orchestration.recovery_required, false);
  assert.match(result.intent.normalised_message, /explain the application process next/);
});

test("a short answer to the assistant's clarification question keeps that question as context", () => {
  const messages = [{
    role: "assistant",
    content: "Bank information can be requested for a finance application. Is it asking you to upload bank statements or enter account details on a form?",
  }];
  const result = understand("ON THE FORM", messages, { product: "finance" });
  assert.equal(result.human.message_type, "contextual_answer");
  assert.equal(result.human.contextual_requires_knowledge, true);
  assert.equal(result.human.recovery_required, false);
  assert.equal(result.orchestration.retrieval_required, true);
  assert.equal(result.orchestration.recovery_required, false);
  assert.match(result.intent.normalised_message, /account details on a form/);
  assert.match(result.intent.normalised_message, /on the form/);
});

test("an explicit conversational instruction is allowed through to knowledge reasoning", () => {
  const messages = [{ role: "assistant", content: "I can explain the Rent2Buy application process next." }];
  const result = understand("explain the application process next.", messages, { product: "rent2buy" });
  assert.equal(result.human.recovery_required, false);
  assert.equal(result.intent.retrieval_required, true);
  assert.equal(result.orchestration.retrieval_required, true);
  assert.equal(result.orchestration.recovery_required, false);
});

test("a plain yes to an active application prompt remains application continuation, not factual retrieval", () => {
  const priorJourney = {
    buying_intent_level: "Ready To Apply",
    journey_stage: "Application ready",
    application_mode_active: true,
    application_state: "ready",
  };
  const messages = [{ role: "assistant", content: "Would you like to start your Finance application?" }];
  const result = understand("yes please", messages, { product: "finance", priorJourney });
  assert.equal(result.human.message_type, "agreement");
  assert.equal(result.orchestration.retrieval_required, false);
  assert.equal(result.orchestration.application_continuation, true);
  assert.equal(result.orchestration.recovery_required, false);
});

test("context-first routing does not weaken genuine nonsense recovery", () => {
  const messages = [{ role: "assistant", content: "Would you like me to explain the application process?" }];
  const result = understand("asdfghjkl", messages, { product: "finance" });
  assert.equal(result.human.message_type, "nonsense_input");
  assert.equal(result.orchestration.retrieval_required, false);
  assert.equal(result.orchestration.recovery_required, true);
});

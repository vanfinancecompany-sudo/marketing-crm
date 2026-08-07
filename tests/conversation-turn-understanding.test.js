import test from "node:test";
import assert from "node:assert/strict";
import { classifyConversationIntent } from "../lib/conversationIntelligence.js";
import { classifyUniversalMessage, contextualRecoveryQuestion } from "../lib/humanConversationRecovery.js";
import { orchestrateConversationTurn } from "../lib/conversationKnowledgeOrchestrator.js";
import { polishConversationPresentation } from "../lib/conversationPolish.js";

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
  assert.equal(result.human.message_type, "agreement");
  assert.equal(result.human.contextual_requires_knowledge, true);
  assert.match(result.human.contextual_anchor, /explain the application process next/i);
  assert.equal(result.human.recovery_required, false);
  assert.equal(result.orchestration.contextual_turn, true);
  assert.equal(result.orchestration.retrieval_required, true);
  assert.equal(result.orchestration.recovery_required, false);
  assert.match(result.intent.normalised_message, /explain the application process next/);
});

test("a short answer to an explicit assistant clarification choice keeps that question as context", () => {
  const messages = [{
    role: "assistant",
    content: "Bank information can be requested for a finance application. Is it asking you to upload bank statements or enter account details on a form?",
  }];
  const result = understand("ON THE FORM", messages, { product: "finance" });
  assert.equal(result.human.message_type, "follow_up_question");
  assert.equal(result.human.contextual_requires_knowledge, true);
  assert.match(result.human.contextual_anchor, /account details on a form/i);
  assert.equal(result.human.recovery_required, false);
  assert.equal(result.orchestration.contextual_turn, true);
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

test("please explain uses the previous factual answer as the subject instead of generic recovery", () => {
  const messages = [{
    role: "assistant",
    content: "Finance delivery is free across England, Wales and Scotland once the vehicle is ready.",
  }];
  const result = understand("please explain", messages, { product: "finance" });
  assert.equal(result.human.message_type, "follow_up_question");
  assert.equal(result.human.recovery_required, false);
  assert.equal(result.human.contextual_requires_knowledge, true);
  assert.match(result.human.contextual_anchor, /delivery is free/i);
  assert.equal(result.orchestration.contextual_turn, true);
  assert.equal(result.orchestration.retrieval_required, true);
  assert.equal(result.orchestration.recovery_required, false);
  assert.match(result.intent.normalised_message, /delivery is free/i);
});

test("a direct answer to an assistant question is treated as conversational context", () => {
  const messages = [{ role: "assistant", content: "Are you already looking at a specific van?" }];
  const result = understand("yes a Ford Transit", messages, { product: "finance" });
  assert.equal(result.human.message_type, "clarification");
  assert.equal(result.human.recovery_required, false);
  assert.match(result.human.contextual_anchor, /specific van/i);
  assert.equal(result.orchestration.contextual_turn, true);
  assert.equal(result.orchestration.recovery_required, false);
  assert.equal(result.orchestration.retrieval_required, false);
  assert.match(result.intent.normalised_message, /ford transit/i);
});

test("factual answers stop after answering instead of adding a sales-discovery question", () => {
  const polished = polishConversationPresentation({
    reply: "An initial decision can sometimes be available quickly, but timing depends on the lender and checks. Are you already looking at a specific van?",
    question: "How long does the application take?",
    messages: [],
    productContext: "finance",
    intent: { retrieval_required: true, clarification_required: false },
    orchestration: { recovery_required: false, product_boundary_blocked: false, application_mode_resumed: false },
    journey: { buying_intent_level: "High Intent", next_best_question: "Are you already looking at a specific van?" },
    ctaTiming: { generated_early: true },
  });
  assert.match(polished.reply, /timing depends on the lender and checks\.$/i);
  assert.doesNotMatch(polished.reply, /specific van/i);
  assert.doesNotMatch(polished.reply, /application below/i);
  assert.equal(polished.transition_type, "answer_only");
});

test("a polite yes to an active application prompt remains application continuation, not factual retrieval", () => {
  const priorJourney = {
    buying_intent_level: "Ready To Apply",
    journey_stage: "Application ready",
    application_mode_active: true,
    application_state: "ready",
  };
  const messages = [{ role: "assistant", content: "Would you like to start your Finance application?" }];
  const result = understand("yes please", messages, { product: "finance", priorJourney });
  assert.equal(result.human.message_type, "agreement");
  assert.equal(result.human.contextual_anchor, "");
  assert.equal(result.orchestration.retrieval_required, false);
  assert.equal(result.orchestration.application_continuation, true);
  assert.equal(result.orchestration.recovery_required, false);
});

test("existing short-duration recovery is preserved and is not swallowed by generic context anchoring", () => {
  const messages = [
    { role: "user", content: "I am self employed" },
    { role: "assistant", content: "How long have you been trading?" },
  ];
  const human = classifyUniversalMessage({ message: "Two weeks", messages });
  assert.equal(human.contextual_anchor, "");
  assert.match(contextualRecoveryQuestion("Two weeks", messages, { employment_status: "self-employed" }, "finance"), /how long you.ve been trading/i);
});

test("a bare application-status statement still does not force knowledge retrieval", () => {
  const result = understand("Halfway through applying", [], { product: "finance" });
  assert.equal(result.orchestration.retrieval_required, false);
});

test("context-first routing does not weaken genuine nonsense recovery", () => {
  const messages = [{ role: "assistant", content: "Would you like me to explain the application process?" }];
  const result = understand("asdfghjkl", messages, { product: "finance" });
  assert.equal(result.human.message_type, "nonsense_input");
  assert.equal(result.orchestration.retrieval_required, false);
  assert.equal(result.orchestration.recovery_required, true);
});

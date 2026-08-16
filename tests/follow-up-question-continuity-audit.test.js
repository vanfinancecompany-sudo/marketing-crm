import test from "node:test";
import assert from "node:assert/strict";
import { classifyUniversalMessage } from "../lib/humanConversationRecovery.js";
import { classifyConversationIntent, buildConversationMemory } from "../lib/conversationIntelligence.js";
import { buildJourneyState } from "../lib/applicationJourneyEngine.js";
import { orchestrateConversationTurn } from "../lib/conversationKnowledgeOrchestrator.js";

function auditTurn({ message, priorAssistant, product = "finance", priorFacts = {}, priorJourney = {} }) {
  const messages = priorAssistant ? [{ role: "assistant", content: priorAssistant }] : [];
  const human = classifyUniversalMessage({ message, messages, journey: priorJourney });
  const intent = classifyConversationIntent({ message, history: messages, productContext: product });
  const memory = buildConversationMemory([...messages, { role: "user", content: message }], priorFacts);
  const updatedFacts = Object.fromEntries(Object.entries(memory.remembered_facts).filter(([key, value]) => String(priorFacts[key] ?? "") !== String(value ?? "")));
  const journey = buildJourneyState({ message, messages, intent, facts: memory.remembered_facts, factMetadata: memory.fact_metadata, productContext: product, priorJourney, updatedFacts });
  const orchestration = orchestrateConversationTurn({ message, intent, human, journey, priorJourney, buyingSignals: { detected_buying_signal: "none" } });
  return { human, intent, memory, journey, orchestration };
}

const directAnswerCases = [
  {
    name: "bare monthly budget answer",
    assistant: "Do you have a monthly budget in mind?",
    answer: "£400",
    expectedFact: ["budget_monthly_gbp", 400],
  },
  {
    name: "self-employed answer",
    assistant: "Are you employed or self-employed?",
    answer: "self employed",
    expectedFact: ["employment_status", "self-employed"],
  },
  {
    name: "trading-history answer",
    assistant: "How long have you been trading?",
    answer: "2 years",
    priorFacts: { employment_status: "self-employed" },
    expectedFact: ["trading_history", "2 years"],
  },
  {
    name: "postcode answer",
    assistant: "Which town or postcode are you based in?",
    answer: "SO40 2NN",
    expectedFact: ["location", "SO40 2NN"],
  },
];

for (const scenario of directAnswerCases) {
  test(`follow-up audit: ${scenario.name} is treated as the answer to Jasmine's question`, () => {
    const result = auditTurn({
      message: scenario.answer,
      priorAssistant: scenario.assistant,
      priorFacts: scenario.priorFacts || {},
    });
    const [key, expected] = scenario.expectedFact;
    assert.equal(result.memory.remembered_facts[key], expected);
    assert.equal(result.human.recovery_required, false);
    assert.equal(result.intent.clarification_required, false);
  });
}

test("follow-up audit: accepting an explanation offer keeps the offered subject as retrieval context", () => {
  const result = auditTurn({
    message: "yes please",
    priorAssistant: "Would you like me to explain what documents are normally needed?",
  });
  assert.match(result.human.contextual_anchor, /documents are normally needed/i);
  assert.equal(result.orchestration.retrieval_required, true);
  assert.match(result.intent.normalised_message, /documents are normally needed/i);
});

test("follow-up audit: a short clarification choice remains tied to the exact question asked", () => {
  const result = auditTurn({
    message: "on the form",
    priorAssistant: "Is it asking you to upload bank statements or enter account details on a form?",
  });
  assert.match(result.human.contextual_anchor, /account details on a form/i);
  assert.equal(result.orchestration.retrieval_required, true);
});

test("follow-up audit: nonsense is not falsely accepted merely because the assistant asked a question", () => {
  const result = auditTurn({
    message: "asdfghjkl",
    priorAssistant: "Do you have a monthly budget in mind?",
  });
  assert.equal(result.human.message_type, "nonsense_input");
  assert.equal(result.human.recovery_required, true);
});

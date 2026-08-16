import test from "node:test";
import assert from "node:assert/strict";
import { simulateCustomerConversation } from "../api/marketing-ai-assistant-competence.js";
import { classifyUniversalMessage, humanRecoveryReply } from "../lib/humanConversationRecovery.js";
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
  return { human, intent, memory, journey, orchestration, messages };
}

const directAnswerCases = [
  ["monthly budget with currency", "Do you have a monthly budget in mind?", "£400", {}, ["budget_monthly_gbp", 400]],
  ["monthly budget as bare number", "Do you have a monthly budget in mind?", "400", {}, ["budget_monthly_gbp", 400]],
  ["employed answer", "Are you employed or self-employed?", "employed", {}, ["employment_status", "employed"]],
  ["self-employed answer", "Are you employed or self-employed?", "self employed", {}, ["employment_status", "self-employed"]],
  ["trading history months", "How long have you been trading?", "6 months", { employment_status: "self-employed" }, ["trading_history", "6 months"]],
  ["trading history years", "How long have you been trading?", "2 years", { employment_status: "self-employed" }, ["trading_history", "2 years"]],
  ["postcode answer", "Which town or postcode are you based in?", "SO40 2NN", {}, ["location", "SO40 2NN"]],
  ["town answer", "Which town or postcode are you based in?", "Southampton", {}, ["location", "Southampton"]],
  ["named van answer", "What type of van are you looking for?", "Transit Custom", {}, ["vehicle_interest", "Transit Custom"]],
  ["body type answer", "What type of van are you looking for?", "tipper", {}, ["vehicle_interest", "Tipper"]],
  ["size answer", "What size van are you looking for?", "medium", {}, ["vehicle_interest", "Medium"]],
  ["wheelbase shorthand", "What size van are you looking for?", "LWB", {}, ["vehicle_interest", "Lwb"]],
  ["crew shorthand", "What type of van are you looking for?", "crew van", {}, ["vehicle_interest", "Crew Van"]],
];

for (const product of ["finance", "rent2buy"]) {
  for (const [name, assistant, answer, priorFacts, expectedFact] of directAnswerCases) {
    test(`follow-up audit ${product}: ${name} is consumed as Jasmine's answer`, () => {
      const result = auditTurn({ message: answer, priorAssistant: assistant, product, priorFacts });
      const [key, expected] = expectedFact;
      assert.equal(result.memory.remembered_facts[key], expected);
      assert.equal(result.human.message_type, "clarification");
      assert.equal(result.human.recovery_required, false);
      assert.equal(result.human.short_answer_to_question, true);
      assert.equal(result.orchestration.answered_assistant_question, true);
      assert.equal(result.orchestration.recovery_required || result.orchestration.retrieval_required, true);
      const reply = humanRecoveryReply(result.human, {
        messages: result.messages,
        facts: result.memory.remembered_facts,
        productContext: product,
        journey: result.journey,
      }).reply;
      assert.doesNotMatch(reply, /not quite sure|what would you like to know about|didn.t understand|explain that another way/i);
    });
  }
}

for (const product of ["finance", "rent2buy"]) {
  test(`end-to-end ${product}: budget answer advances to the next useful question`, async () => {
    const generated = await simulateCustomerConversation(null, {
      message: "£400",
      product_context: product,
      messages: [{ role: "assistant", content: "Do you have a monthly budget in mind?" }],
      remembered_facts: {},
      journey_state: {},
    }, { persist: false });
    assert.equal(generated.result.remembered_facts.budget_monthly_gbp, 400);
    assert.match(generated.result.reply, /what type of van are you looking for/i);
    assert.doesNotMatch(generated.result.reply, /what would you like to know about|not quite sure|didn.t understand/i);
  });

  test(`end-to-end ${product}: bare numeric budget is understood because Jasmine asked for a monthly budget`, async () => {
    const generated = await simulateCustomerConversation(null, {
      message: "400",
      product_context: product,
      messages: [{ role: "assistant", content: "Do you have a monthly budget in mind?" }],
      remembered_facts: {},
      journey_state: {},
    }, { persist: false });
    assert.equal(generated.result.remembered_facts.budget_monthly_gbp, 400);
    assert.match(generated.result.reply, /what type of van are you looking for/i);
  });

  test(`end-to-end ${product}: employment answer advances rather than re-asking the answer`, async () => {
    const generated = await simulateCustomerConversation(null, {
      message: "self employed",
      product_context: product,
      messages: [{ role: "assistant", content: "Are you employed or self-employed?" }],
      remembered_facts: {},
      journey_state: {},
    }, { persist: false });
    assert.equal(generated.result.remembered_facts.employment_status, "self-employed");
    assert.match(generated.result.reply, /how long have you been trading/i);
    assert.doesNotMatch(generated.result.reply, /are you employed or self-employed|what would you like to know about/i);
  });
}

test("follow-up audit: accepting a factual explanation offer keeps the offered subject as retrieval context", () => {
  for (const [assistant, answer] of [
    ["Would you like me to explain what documents are normally needed?", "yes please"],
    ["If you'd like, I can talk you through how the application works.", "yes"],
    ["I can explain the deposit requirements if you'd like.", "please do"],
  ]) {
    const result = auditTurn({ message: answer, priorAssistant: assistant });
    assert.ok(result.human.contextual_anchor);
    assert.equal(result.orchestration.retrieval_required, true);
    assert.match(result.intent.normalised_message, /documents|application|deposit/i);
  }
});

test("follow-up audit: a short clarification choice remains tied to the exact question asked", () => {
  for (const [assistant, answer, anchor] of [
    ["Is it asking you to upload bank statements or enter account details on a form?", "on the form", /account details on a form/i],
    ["Do you mean the approval time or the delivery time?", "delivery", /delivery time/i],
  ]) {
    const result = auditTurn({ message: answer, priorAssistant: assistant });
    assert.match(result.human.contextual_anchor, anchor);
    assert.equal(result.orchestration.retrieval_required, true);
  }
});

test("follow-up audit: negative answers move naturally instead of creating a fake knowledge question", () => {
  const result = auditTurn({
    message: "no",
    priorAssistant: "Do you have a monthly budget in mind?",
  });
  const reply = humanRecoveryReply(result.human, {
    messages: result.messages,
    facts: result.memory.remembered_facts,
    productContext: "finance",
    journey: result.journey,
  }).reply;
  assert.doesNotMatch(reply, /what would you like to know about.*no|didn.t understand/i);
  assert.match(reply, /what type|vehicle|van/i);
});

test("follow-up audit: nonsense is not falsely accepted merely because the assistant asked a question", () => {
  const result = auditTurn({
    message: "asdfghjkl",
    priorAssistant: "Do you have a monthly budget in mind?",
  });
  assert.equal(result.human.message_type, "nonsense_input");
  assert.equal(result.human.recovery_required, true);
  const reply = humanRecoveryReply(result.human, { messages: result.messages, productContext: "finance", journey: result.journey }).reply;
  assert.match(reply, /didn.t understand|another way/i);
});

test("follow-up audit: unrelated off-topic answer is not silently converted into a customer fact", () => {
  const result = auditTurn({
    message: "football",
    priorAssistant: "Do you have a monthly budget in mind?",
  });
  assert.equal(result.human.message_type, "off_topic");
  assert.equal(result.memory.remembered_facts.budget_monthly_gbp, undefined);
});

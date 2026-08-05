import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildConversationMemory,
  classifyConversationIntent,
  enforceGroundedConversationReply,
  insufficientKnowledgeReply,
  naturalConversationReply,
  normaliseCustomerMessage,
} from "../lib/conversationIntelligence.js";
import { REAL_CUSTOMER_SCENARIOS, scenarioLibrarySummary } from "../lib/customerSimulationScenarios.js";
import { assessKnowledgeGapCandidate, diagnoseExistingKnowledge } from "../lib/knowledgeLearningEngine.js";
import { parseOpenAIConversationReply } from "../api/marketing-ai-assistant-competence.js";
import { createCompetenceRequestId, requestAssistantCompetence } from "../services/aiAssistantCompetence.js";

const classify = (message, productContext = "finance", history = []) => classifyConversationIntent({ message, productContext, history });

test("real-customer normalisation improves interpretation without replacing original text", () => {
  const cases = {
    "Can u help": "can you help",
    "need van asap": "need van quickly",
    "rent 2 biy": "rent2buy",
    finace: "finance",
    "self emp": "self employed",
    "how much down": "how much deposit",
    "own it end": "own it at the end",
    "eu licence ok": "is an eu licence accepted",
  };
  for (const [original, normalised] of Object.entries(cases)) {
    assert.equal(normaliseCustomerMessage(original), normalised);
    assert.equal(classify(original).original_message, original);
  }
});

test("greetings, help, thanks and goodbye do not trigger retrieval", () => {
  for (const message of ["Hi", "Can u help", "Thanks", "Bye", "need van asap"]) assert.equal(classify(message).retrieval_required, false, message);
  assert.match(naturalConversationReply(classify("Can u help"), "finance").reply, /van finance/i);
  assert.doesNotMatch(naturalConversationReply(classify("Can u help", "rent2buy"), "rent2buy").reply, /finance/i);
});

test("ambiguous phrases clarify once while clear phrases retrieve", () => {
  const transit = classify("Transit");
  assert.equal(transit.clarification_required, true);
  assert.match(transit.suggested_clarification_question, /financing a Transit, vehicle availability, or something else/);
  assert.equal(classify("deposit?").clarification_required, false);
  assert.equal(classify("deposit?").retrieval_required, true);
  assert.equal(classify("Manchester", "rent2buy").secondary_intents.includes("coverage"), true);
  const contextualMonthly = classify("Monthly?", "finance", [{ role: "user", content: "How much deposit do I need?" }, { role: "assistant", content: "It depends." }]);
  assert.equal(contextualMonthly.clarification_required, false);
  assert.equal(contextualMonthly.retrieval_required, true);
});

test("locked product cannot be overridden by classifier or customer wording", () => {
  const finance = classify("tell me about rent 2 biy", "finance");
  assert.equal(finance.product_context, "finance");
  assert.equal(finance.detected_product, "rent2buy");
  assert.equal(finance.primary_intent, "product_clarification_required");
  assert.match(finance.suggested_clarification_question, /locked to van finance/i);
});

test("multi-part messages retain every detected business sub-intent", () => {
  const result = classify("I’m self employed, only been going six months and live in Portsmouth. Can I apply?", "rent2buy");
  assert.equal(result.primary_intent, "multi_part_question");
  for (const expected of ["self_employed", "trading_history", "coverage", "application"]) assert.equal(result.secondary_intents.includes(expected), true, expected);
});

test("multi-turn facts retain context and interpret six months as trading history", () => {
  const messages = [
    { role: "user", content: "need van" }, { role: "assistant", content: "What do you need?" },
    { role: "user", content: "self emp" }, { role: "assistant", content: "Okay." },
    { role: "user", content: "6 months" }, { role: "user", content: "Portsmouth" },
  ];
  const memory = buildConversationMemory(messages);
  assert.deepEqual(memory.remembered_facts, { employment_status: "self-employed", trading_history: "6 months", location: "Portsmouth", main_concern: "location coverage" });
});

test("customer corrections override current facts and retain correction trace", () => {
  const memory = buildConversationMemory([
    { role: "user", content: "I live in Manchester" },
    { role: "assistant", content: "Okay." },
    { role: "user", content: "Actually moving to Southampton next month" },
  ]);
  assert.equal(memory.remembered_facts.location, "Southampton");
  assert.deepEqual(memory.corrections[0], { field: "location", previous_value: "Manchester", corrected_value: "Southampton", message: "Actually moving to Southampton next month" });
});

test("memory is session-scoped and does not leak between conversations", () => {
  const first = buildConversationMemory([{ role: "user", content: "I live in Manchester" }]);
  const second = buildConversationMemory([{ role: "user", content: "self emp" }]);
  assert.equal(first.remembered_facts.location, "Manchester");
  assert.equal(second.remembered_facts.location, undefined);
});

test("human handoff, frustration and application intent use deterministic actions", () => {
  assert.equal(naturalConversationReply(classify("Can I speak to someone?"), "finance").recommended_action, "human_handoff");
  assert.equal(naturalConversationReply(classify("this hasnt helped"), "rent2buy").human_handoff_recommended, true);
  assert.equal(naturalConversationReply(classify("I’m ready"), "finance").recommended_action, "apply_finance");
  assert.equal(naturalConversationReply(classify("I’m ready", "rent2buy"), "rent2buy").recommended_action, "apply_rent2buy");
  assert.doesNotMatch(naturalConversationReply(classify("I’m ready"), "finance").reply, /guarantee acceptance/i);
});

test("insufficient knowledge fallback refuses to invent business facts", () => {
  const result = insufficientKnowledgeReply("finance");
  assert.equal(result.insufficient_knowledge, true);
  assert.match(result.reply, /don’t want to guess/i);
  assert.match(result.reply, /verified van finance information/i);
  const unsupportedGeneratedReply = enforceGroundedConversationReply({ reply: "Invented fact", insufficient_knowledge: false, source_ids: [] }, { productContext: "finance" });
  assert.equal(unsupportedGeneratedReply.insufficient_knowledge, true);
  assert.doesNotMatch(unsupportedGeneratedReply.reply, /Invented fact/);
});

test("structured model conversation output is validated and source IDs are de-duplicated", () => {
  const valid = { reply: "A grounded answer.", insufficient_knowledge: false, human_handoff_recommended: false, recommended_action: "continue", confidence: 90, confidence_reason: "Approved evidence.", source_ids: ["S1", "S1", "bad"] };
  assert.deepEqual(parseOpenAIConversationReply({ output_text: JSON.stringify(valid) }, "test").reply.source_ids, ["S1"]);
  assert.throws(() => parseOpenAIConversationReply({ output_text: JSON.stringify({ reply: "missing fields" }) }, "test"), /missing required fields/);
});

test("scenario library has at least 150 balanced realistic scenarios", () => {
  const summary = scenarioLibrarySummary();
  assert.ok(REAL_CUSTOMER_SCENARIOS.length >= 150);
  assert.equal(summary.finance, summary.rent2buy);
  for (const category of ["greetings", "misspellings", "one_word", "multi_part", "corrections", "frustration", "human_handoff", "ready_to_apply", "unsupported"]) assert.equal(summary.categories.includes(category), true);
  assert.ok(summary.multi_turn >= 10);
});

test("learning engine excludes social conversation and successful deterministic rules", () => {
  assert.equal(assessKnowledgeGapCandidate({ conversation_intent: "greeting", question: "Hi", answer: "Hello", confidence: 100 }, { outcome: "incorrect" }).qualifies, false);
  assert.equal(assessKnowledgeGapCandidate({ conversation_intent: "knowledge_question", learning_diagnosis: "Deterministic rule handled successfully", question: "Manchester", answer: "Calculated", confidence: 100 }, {}).qualifies, false);
  const diagnosis = diagnoseExistingKnowledge({ candidate_reasons: ["context_memory_failure"], title: "Trading history", conflict_count: 0 }, { articles: [], sections: [] });
  assert.equal(diagnosis.diagnosis, "Context-memory failure");
});

test("protected simulation reuses the no-store internal competence endpoint and unique request IDs", async () => {
  const seen = [];
  const fetchImplementation = async (_url, options) => { seen.push(JSON.parse(options.body)); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  await requestAssistantCompetence("simulateConversation", { request_id: "session-one", message: "Hi", product_context: "finance" }, fetchImplementation);
  await requestAssistantCompetence("simulateConversation", { request_id: "session-two", message: "deposit", product_context: "finance" }, fetchImplementation);
  assert.deepEqual(seen.map((item) => item.request_id), ["session-one", "session-two"]);
  assert.notEqual(createCompetenceRequestId(), createCompetenceRequestId());
});

test("V2.5 remains internal and adds no Wix or public assistant route", () => {
  const api = readFileSync(new URL("../api/marketing-ai-assistant-competence.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../pages/RealCustomerSimulationPage.jsx", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/035_ai_conversation_intelligence_v2_5.sql", import.meta.url), "utf8");
  assert.match(api, /competenceAuthorize/);
  assert.match(page, /validateMarketingAccessKey/);
  assert.doesNotMatch(api, /WIX_API_KEY|WIX_SITE_ID|publishToWix/);
  assert.doesNotMatch(migration, /create extension[^;]*vector|create table[^;]*customer/i);
});

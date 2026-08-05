import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildConversationMemory, classifyConversationIntent, naturalConversationReply } from "../lib/conversationIntelligence.js";
import { buildFinanceCoverageEvidence, buildRent2BuyDeliveryEvidence, detectCoverageConflicts } from "../lib/productCoverageRules.js";
import { REAL_CUSTOMER_SCENARIOS, V3_SALES_SCENARIOS, scenarioLibrarySummary } from "../lib/customerSimulationScenarios.js";
import {
  applicationReadiness, buildConversationSummary, contextualClarification, conversationQualityDiagnostics,
  detectBuyingSignals, deterministicDeliveryReply, disclaimerControl, responseLengthTarget, stripRepeatedDisclaimer,
  naturalSalesReply,
} from "../lib/salesConversationEngine.js";
import { assessKnowledgeGapCandidate } from "../lib/knowledgeLearningEngine.js";
import { conversationPrompt } from "../api/marketing-ai-assistant-competence.js";

const intent = (message, productContext = "finance", history = []) => classifyConversationIntent({ message, productContext, history });

test("short and complex messages receive adaptive length bands", () => {
  assert.equal(responseLengthTarget("bad credit", intent("bad credit")).maximum_words, 45);
  const complex = intent("self employed six months poor credit need two vans and delivery");
  assert.equal(responseLengthTarget("self employed six months poor credit need two vans and delivery", complex).maximum_words, 130);
});

test("quality diagnostics enforce one useful follow-up question only", () => {
  const result = conversationQualityDiagnostics({ message: "bad credit", reply: "We may still be able to help. Are you employed or self-employed?", intent: intent("bad credit"), followUpAppropriate: true });
  assert.equal(result.one_question_at_a_time, true);
  assert.equal(result.question_count, 1);
  assert.equal(result.sounded_article_like, false);
  assert.equal(conversationQualityDiagnostics({ message: "deposit?", reply: "The approved deposit answer.", intent: intent("deposit?") }).follow_up_question_appropriate, false);
});

test("urgent broad need gets a short conversation-first reply", () => {
  const classified = intent("need van asap");
  const reply = naturalSalesReply(classified, "finance", detectBuyingSignals("need van asap")).reply;
  assert.ok(reply.split(/\s+/).length <= 45);
  assert.equal((reply.match(/\?/g) || []).length, 1);
  assert.match(reply, /seen a van|what size/i);
});

test("context resolves how long and previous-refusal shorthand", () => {
  assert.equal(contextualClarification("how long?", [{ role: "user", content: "Do you deliver to Glasgow?" }]), "Do you mean how long delivery normally takes?");
  assert.equal(contextualClarification("how long?", [{ role: "user", content: "How do I apply?" }]), "Do you mean how long the application and approval process normally takes?");
  assert.match(contextualClarification("still worth applying?", [{ role: "user", content: "been refused elsewhere" }], { credit_concern: "previous refusal" }), /previous refusal/);
});

test("buying signals detect urgency, application, vehicle, budget and multiple vehicles", () => {
  assert.equal(detectBuyingSignals("need a van urgently").detected_buying_signal, "urgent_need");
  assert.equal(detectBuyingSignals("ready to apply").signal_strength, "high");
  assert.equal(detectBuyingSignals("seen a Transit Custom").detected_buying_signal, "specific_vehicle");
  assert.equal(detectBuyingSignals("budget is £350 monthly").detected_buying_signal, "monthly_budget");
  assert.equal(detectBuyingSignals("looking for two vans").detected_buying_signal, "multiple_vehicles");
});

test("structured memory stores commercial facts, confidence and source message id", () => {
  const memory = buildConversationMemory([{ id: "m1", role: "user", content: "self employed, need two Transit Customs, budget £700 monthly and delivery" }]);
  assert.equal(memory.remembered_facts.quantity_required, 2);
  assert.equal(memory.remembered_facts.vehicle_interest, "Transit Custom");
  assert.equal(memory.remembered_facts.budget_monthly_gbp, 700);
  assert.equal(memory.remembered_facts.delivery_interest, true);
  assert.deepEqual(memory.fact_metadata.quantity_required, { confidence: 0.95, source_message_id: "m1" });
  assert.equal(memory.remembered_facts.prior_answer, undefined);
});

test("correction updates current fact and preserves trace", () => {
  const memory = buildConversationMemory([{ role: "user", content: "need one van" }, { role: "user", content: "make that two vans" }]);
  assert.equal(memory.remembered_facts.quantity_required, 2);
  assert.equal(memory.corrections.some((item) => item.field === "quantity_required"), false); // one is not stored as a quantity; no contradictory invented fact
  const location = buildConversationMemory([{ role: "user", content: "I live in Manchester" }, { role: "user", content: "actually moving to Southampton" }]);
  assert.equal(location.remembered_facts.location, "Southampton");
  assert.equal(location.corrections[0].previous_value, "Manchester");
});

test("Finance delivery is deterministic across England, Wales and Scotland", () => {
  for (const nation of ["England", "Wales", "Scotland"]) {
    const evidence = buildFinanceCoverageEvidence(`Do you deliver to ${nation}?`);
    assert.equal(evidence.source.source_id, "delivery:finance");
    assert.match(evidence.source.passage, /free delivery/i);
    assert.match(deterministicDeliveryReply("finance", `deliver to ${nation}`, evidence), /free delivery/i);
  }
  const glasgow = buildFinanceCoverageEvidence("Do you deliver to Glasgow?");
  assert.equal(glasgow.diagnostics.coverage_result, "covered");
  assert.match(deterministicDeliveryReply("finance", "Do you deliver to Glasgow?", glasgow), /including Glasgow/i);
});

test("Finance does not promise Northern Ireland coverage or a delivery date", () => {
  const evidence = buildFinanceCoverageEvidence("Do you deliver to Northern Ireland?");
  assert.equal(evidence.diagnostics.coverage_result, "not_covered");
  const reply = deterministicDeliveryReply("finance", "Do you deliver to Northern Ireland?", evidence);
  assert.match(reply, /isn’t currently included/i);
  assert.doesNotMatch(reply, /Friday|guaranteed|guarantee/i);
});

test("Rent2Buy remains deterministic Southampton collection only", () => {
  const evidence = buildRent2BuyDeliveryEvidence("Do you deliver to Glasgow?");
  assert.equal(evidence.diagnostics.coverage_result, "collection_only");
  assert.match(evidence.source.passage, /collected from Southampton/i);
  const reply = deterministicDeliveryReply("rent2buy", "Do you deliver to Glasgow?", evidence);
  assert.match(reply, /collected from Southampton/i);
  assert.doesNotMatch(reply, /free delivery|Finance/i);
});

test("conflicting delivery knowledge is flagged but cannot outrank the rule", () => {
  const finance = buildFinanceCoverageEvidence("Do you deliver to Scotland?");
  assert.equal(detectCoverageConflicts(finance, [{ source_id: "old-finance", title: "Delivery", passage: "A delivery charge may apply." }]).length, 1);
  const rent2buy = buildRent2BuyDeliveryEvidence("Do you deliver?");
  assert.equal(detectCoverageConflicts(rent2buy, [{ source_id: "old-r2b", title: "Delivery", passage: "Free delivery is available nationwide." }]).length, 1);
});

test("repeated full disclaimer is detected and shortened", () => {
  const messages = [{ role: "assistant", content: "Applications are subject to lender criteria and affordability checks." }];
  const proposed = "Applications are subject to lender criteria and affordability checks. We can explain the next step.";
  assert.equal(disclaimerControl(messages, proposed).repeated_disclaimer, true);
  assert.match(stripRepeatedDisclaimer(proposed, messages), /lender’s assessment/i);
});

test("frustration uses known facts and does not ask for them again", () => {
  const classified = intent("I already told you");
  const reply = naturalConversationReply(classified, "finance", { employment_status: "self-employed" }).reply;
  assert.equal(classified.primary_intent, "frustration");
  assert.match(reply, /already told me|already told|already provided|what you’ve already told/i);
  assert.doesNotMatch(reply, /are you employed/i);
});

test("readiness is transparent and never an approval score", () => {
  assert.equal(applicationReadiness({ intent: intent("ready to apply"), buyingSignals: detectBuyingSignals("ready to apply"), facts: { vehicle_interest: "Transit Custom" } }), "Ready for application CTA");
  assert.equal(applicationReadiness({ intent: intent("deposit?") , buyingSignals: detectBuyingSignals("deposit?") }), "Exploring");
  const summary = buildConversationSummary({ productContext: "finance", facts: { vehicle_interest: "Transit Custom" }, buyingSignals: detectBuyingSignals("ready to apply"), intent: intent("ready to apply") });
  assert.equal(summary.application_readiness, "Ready for application CTA");
  assert.equal("approval_probability" in summary, false);
  const budgetSummary = buildConversationSummary({ productContext: "finance", facts: { budget_monthly_gbp: 350 }, buyingSignals: detectBuyingSignals("budget £350 monthly"), intent: intent("budget £350 monthly") });
  assert.match(budgetSummary.next_best_question, /size or type/i);
});

test("prompt preserves grounding, product lock and invention prohibitions", () => {
  const classified = intent("what rate and is it in stock?");
  const prompt = conversationPrompt({ question: "what rate and is it in stock?", messages: [], sources: [], sections: [], settings: {}, productContext: "finance", comparison: false, intent: classified, memory: { remembered_facts: {}, corrections: [] }, buyingSignals: detectBuyingSignals("what rate and is it in stock?"), lengthTarget: responseLengthTarget("what rate and is it in stock?", classified) });
  assert.match(prompt, /must never be cross-sold/i);
  assert.match(prompt, /Never invent approval likelihood, stock, rates, payment figures, affordability outcomes or a delivery date/i);
  assert.match(prompt, /Deterministic evidence is the highest-priority fact/i);
});

test("product separation remains strict", () => {
  assert.equal(intent("tell me about Rent2Buy", "finance").primary_intent, "product_clarification_required");
  assert.equal(intent("tell me about Finance", "rent2buy").primary_intent, "product_clarification_required");
  assert.doesNotMatch(deterministicDeliveryReply("rent2buy", "do you deliver?", buildRent2BuyDeliveryEvidence("do you deliver?")), /Finance/i);
});

test("unsupported questions still qualify for the Learning Engine", () => {
  const assessment = assessKnowledgeGapCandidate({ conversation_intent: "knowledge_question", question: "Can you guarantee the exact rate?", answer: "I do not have verified information.", confidence: 20, knowledge_gap: true, sources_used: [], conversation_diagnostics: {} }, {});
  assert.equal(assessment.qualifies, true);
  assert.equal(assessment.reasons.includes("insufficient_knowledge"), true);
});

test("V3 adds at least 100 balanced multi-turn scenarios", () => {
  assert.ok(V3_SALES_SCENARIOS.length >= 100);
  assert.equal(V3_SALES_SCENARIOS.filter((item) => item.product_context === "finance").length, V3_SALES_SCENARIOS.filter((item) => item.product_context === "rent2buy").length);
  assert.equal(V3_SALES_SCENARIOS.every((item) => item.messages.length > 1), true);
  assert.equal(REAL_CUSTOMER_SCENARIOS.length, scenarioLibrarySummary().total);
});

test("V3 remains internal with no Wix or public endpoint", () => {
  const api = readFileSync(new URL("../api/marketing-ai-assistant-competence.js", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/036_ai_sales_conversation_engine_v3.sql", import.meta.url), "utf8");
  assert.match(api, /competenceAuthorize/);
  assert.doesNotMatch(api, /WIX_API_KEY|publishToWix|createPublicAssistant/);
  assert.doesNotMatch(migration, /create extension[^;]*vector|create table[^;]*customer/i);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildJourneyState } from "../lib/applicationJourneyEngine.js";
import { classifyConversationIntent } from "../lib/conversationIntelligence.js";
import {
  appendJourneyResume,
  completeKnowledgeOrchestration,
  orchestrateConversationTurn,
  preserveJourneyAcrossOrchestration,
} from "../lib/conversationKnowledgeOrchestrator.js";
import { classifyUniversalMessage, contextualRecoveryQuestion, humanRecoveryReply } from "../lib/humanConversationRecovery.js";
import { V6_ORCHESTRATION_SCENARIOS } from "../lib/customerSimulationScenarios.js";

const readyJourney = (product = "finance") => ({
  buying_intent_level: "Ready To Apply",
  buying_intent_score: 5,
  buying_intent_confidence: 95,
  buying_intent_reasons: ["Customer explicitly asked to proceed or apply."],
  conversation_goal: "Proceed to application",
  journey_stage: "Application ready",
  application_readiness: "Ready for application CTA",
  application_mode_active: true,
  application_state: "ready",
  application_cta: { product, label: `Start ${product === "finance" ? "Finance" : "Rent2Buy"} Application` },
  recommended_cta: "Show application button",
});

function decision(message, { product = "finance", priorJourney = readyJourney(product), human = null, buyingSignal = "none" } = {}) {
  const intent = classifyConversationIntent({ message, productContext: product });
  const classification = human || classifyUniversalMessage({ message, journey: priorJourney });
  const journey = buildJourneyState({ message, intent, productContext: product, priorJourney, facts: { product_context: product } });
  const orchestration = orchestrateConversationTurn({
    message,
    intent,
    human: classification,
    journey,
    priorJourney,
    buyingSignals: { detected_buying_signal: buyingSignal },
  });
  return { intent, human: classification, journey, orchestration };
}

test("multi-intent application question retrieves verified insurance knowledge first", () => {
  const result = decision("I'm ready to apply but do you include insurance?", { buyingSignal: "application" });
  assert.equal(result.orchestration.retrieval_required, true);
  assert.equal(result.orchestration.application_mode_paused, true);
  assert.deepEqual(result.orchestration.priority_path_taken, ["safety", "product_separation", "verified_business_knowledge", "application_guidance"]);
  assert.ok(result.orchestration.detected_intents.includes("insurance"));
  assert.ok(result.orchestration.detected_intents.includes("business_knowledge"));
  assert.ok(result.orchestration.detected_intents.includes("buying_signal"));
  assert.ok(result.orchestration.detected_intents.includes("application_ready"));
});

test("verified taxation knowledge outranks a competing recovery classification", () => {
  const human = { message_type: "unknown_intent", recovery_required: true };
  const result = decision("Is the van taxed?", { human });
  assert.equal(result.orchestration.retrieval_required, true);
  assert.equal(result.orchestration.recovery_required, false);
  assert.ok(result.orchestration.detected_intents.includes("taxation"));
  assert.ok(!result.orchestration.priority_path_taken.includes("conversation_recovery"));
});

test("product separation blocks retrieval before every lower priority", () => {
  const orchestration = orchestrateConversationTurn({
    message: "Tell me about Rent2Buy insurance",
    intent: { primary_intent: "product_clarification_required", retrieval_required: false, secondary_intents: [] },
    human: { message_type: "question", recovery_required: false },
    journey: readyJourney(),
    priorJourney: readyJourney(),
  });
  assert.equal(orchestration.product_boundary_blocked, true);
  assert.equal(orchestration.retrieval_required, false);
  assert.deepEqual(orchestration.priority_path_taken.slice(0, 2), ["safety", "product_separation"]);
  assert.ok(!orchestration.priority_path_taken.includes("verified_business_knowledge"));
});

test("knowledge turn preserves and resumes the exact application journey", () => {
  const prior = readyJourney("rent2buy");
  const { journey, orchestration } = decision("Do you include insurance?", { product: "rent2buy", priorJourney: prior });
  const preserved = preserveJourneyAcrossOrchestration(journey, prior, orchestration);
  const complete = completeKnowledgeOrchestration(orchestration, { retrievalPerformed: true, journey: preserved, sourceIds: ["article-insurance"] });
  const reply = appendJourneyResume("Insurance is included under the approved Rent2Buy terms.", "rent2buy", complete);
  assert.equal(preserved.journey_stage, "Application ready");
  assert.equal(preserved.application_mode_active, true);
  assert.equal(preserved.application_cta.product, "rent2buy");
  assert.equal(complete.conversation_resumed, true);
  assert.equal(complete.application_mode_resumed, true);
  assert.deepEqual(complete.knowledge_source_ids, ["article-insurance"]);
  assert.match(reply, /continue with your Rent2Buy application below/);
  assert.doesNotMatch(reply, /Finance application/);
});

test("missing approved knowledge uses a gap result and still resumes without inventing", () => {
  const { orchestration, journey } = decision("Do you include insurance?");
  const preserved = preserveJourneyAcrossOrchestration(journey, readyJourney(), orchestration);
  const complete = completeKnowledgeOrchestration(orchestration, { retrievalPerformed: false, journey: preserved, sourceIds: [] });
  assert.equal(complete.retrieval_performed, false);
  assert.equal(complete.conversation_resumed, true);
  assert.match(complete.resume_reason, /No approved answer was found/);
});

test("short agreement continues the existing application instead of restarting discovery", () => {
  const result = decision("OK", { product: "rent2buy" });
  assert.equal(result.orchestration.application_continuation, true);
  assert.equal(result.orchestration.retrieval_required, false);
  assert.equal(result.orchestration.recovery_required, false);
  const preserved = preserveJourneyAcrossOrchestration(result.journey, readyJourney("rent2buy"), result.orchestration);
  assert.equal(preserved.application_mode_active, true);
  assert.equal(preserved.journey_stage, "Application ready");
});

test("recovery and product clarification retain application state without suppressing their reply", () => {
  const recovery = decision("?", { product: "finance" });
  const recoveredJourney = preserveJourneyAcrossOrchestration(recovery.journey, readyJourney(), recovery.orchestration);
  assert.equal(recovery.orchestration.recovery_required, true);
  assert.equal(recoveredJourney.application_mode_active, true);
  assert.equal(recoveredJourney.journey_stage, "Application ready");

  const boundary = decision("Tell me about Rent2Buy", { product: "finance" });
  const boundaryJourney = preserveJourneyAcrossOrchestration(boundary.journey, readyJourney(), boundary.orchestration);
  assert.equal(boundary.orchestration.product_boundary_blocked, true);
  assert.equal(boundaryJourney.application_mode_active, true);
});

test("V5 contextual recovery remains intact for two weeks, confusion and unknown names", () => {
  const tradingMessages = [{ role: "user", content: "I am self employed" }, { role: "assistant", content: "How long have you been trading?" }];
  const tradingReply = contextualRecoveryQuestion("Two weeks", tradingMessages, { employment_status: "self-employed" }, "finance");
  assert.match(tradingReply, /how long you.ve been trading/i);
  assert.doesNotMatch(tradingReply, /Finance and/);

  const confusion = humanRecoveryReply(classifyUniversalMessage({ message: "?", messages: tradingMessages }), { messages: tradingMessages, productContext: "finance" });
  assert.match(confusion.reply, /explain that another way|explain more simply/i);

  const name = humanRecoveryReply(classifyUniversalMessage({ message: "What's my name?", messages: tradingMessages }), { messages: tradingMessages, productContext: "finance" });
  assert.match(name.reply, /don.t actually know your name/i);
});

test("acceptance scenario library contains both product knowledge interruptions", () => {
  const finance = V6_ORCHESTRATION_SCENARIOS.find((scenario) => scenario.product_context === "finance");
  const rent2buy = V6_ORCHESTRATION_SCENARIOS.find((scenario) => scenario.product_context === "rent2buy" && scenario.messages.includes("Do you include insurance?"));
  assert.deepEqual(finance.messages.slice(-3), ["Do you include insurance?", "Is the van taxed?", "OK let's apply"]);
  assert.deepEqual(rent2buy.messages.slice(-3), ["Do you include insurance?", "Is the van taxed?", "OK"]);
});

test("API integrates one orchestrator before retrieval and never overwrites a retrieved answer with Application Mode", async () => {
  const api = await readFile(new URL("../api/marketing-ai-assistant-competence.js", import.meta.url), "utf8");
  const orchestratorPosition = api.indexOf("orchestrateConversationTurn({");
  const retrievalPosition = api.indexOf("if (!intent.retrieval_required)", orchestratorPosition);
  assert.ok(orchestratorPosition > 0 && retrievalPosition > orchestratorPosition);
  assert.match(api, /journey\.application_mode_active && !intent\.retrieval_required/);
  assert.doesNotMatch(api, /journey\.application_mode_active\) \{ intent\.retrieval_required = false/);
  assert.match(api, /Conversation and knowledge orchestration/);
});

test("internal diagnostics expose every V6 orchestration decision", async () => {
  const page = await readFile(new URL("../pages/RealCustomerSimulationPage.jsx", import.meta.url), "utf8");
  for (const field of [
    "detected_intents", "retrieval_required", "retrieval_performed", "conversation_paused",
    "conversation_resumed", "resume_reason", "knowledge_source_ids", "journey_stage_before_retrieval",
    "journey_stage_after_retrieval", "application_mode_paused", "application_mode_resumed", "priority_path_taken",
  ]) assert.match(page, new RegExp(field));
});

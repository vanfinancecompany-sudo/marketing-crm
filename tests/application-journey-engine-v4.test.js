import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildConversationMemory, classifyConversationIntent, CONVERSATION_REVIEW_OUTCOMES } from "../lib/conversationIntelligence.js";
import { REAL_CUSTOMER_SCENARIOS, V4_APPLICATION_SCENARIOS } from "../lib/customerSimulationScenarios.js";
import {
  APPLICATION_REVIEW_OUTCOMES,
  applicationModeReply,
  assessBuyingIntent,
  assessLeadCompleteness,
  buildApplicationCta,
  buildJourneyState,
  chooseNextJourneyQuestion,
  detectConversationProgress,
  detectRepetitiveAssistantWording,
  determineConversationGoal,
} from "../lib/applicationJourneyEngine.js";

const classify = (message, productContext = "finance", history = []) => classifyConversationIntent({ message, productContext, history });

test("buying intent progresses independently from message intent", () => {
  assert.equal(assessBuyingIntent({ message: "Hi" }).level, "Research");
  assert.equal(assessBuyingIntent({ message: "compare the options" }).level, "Comparing");
  assert.equal(assessBuyingIntent({ message: "need a Transit", facts: { vehicle_interest: "Transit" } }).level, "Interested");
  assert.equal(assessBuyingIntent({ message: "need it urgently", facts: { vehicle_interest: "Transit", budget_monthly_gbp: 350, employment_status: "self-employed", location: "Glasgow", urgency: "high" } }).level, "High Intent");
  assert.equal(assessBuyingIntent({ message: "ready to apply" }).level, "Ready To Apply");
});

test("application readiness triggers are recognised", () => {
  for (const message of ["Ready to apply", "Let's apply", "Apply now", "Can I apply?", "What's next?", "Let's do it", "Go ahead", "Send me the application", "I want this van", "Proceed", "Begin"]) {
    assert.equal(assessBuyingIntent({ message }).explicit_application_trigger, true, message);
  }
});

test("short yes or start only proceeds in application context", () => {
  assert.equal(assessBuyingIntent({ message: "yes" }).explicit_application_trigger, false);
  assert.equal(assessBuyingIntent({ message: "yes", priorLevel: "High Intent" }).explicit_application_trigger, true);
  assert.equal(assessBuyingIntent({ message: "start", messages: [{ role: "assistant", content: "You can start the application." }] }).explicit_application_trigger, true);
});

test("application started and complete remain distinct future-safe states", () => {
  assert.equal(assessBuyingIntent({ message: "I already started my application" }).level, "Application Started");
  assert.equal(assessBuyingIntent({ message: "I have submitted my application" }).level, "Application Complete");
});

test("conversation goal follows the customer journey", () => {
  assert.equal(determineConversationGoal({ intent: classify("compare options"), buyingIntent: assessBuyingIntent({ message: "compare options" }) }), "Compare options");
  assert.equal(determineConversationGoal({ intent: classify("what documents"), buyingIntent: assessBuyingIntent({ message: "what documents" }) }), "Understand documents");
  assert.equal(determineConversationGoal({ intent: classify("ready to apply"), buyingIntent: assessBuyingIntent({ message: "ready to apply" }) }), "Proceed to application");
  assert.equal(determineConversationGoal({ intent: classify("what next"), buyingIntent: assessBuyingIntent({ message: "application submitted" }) }), "After application");
});

test("lead completeness exposes known, unknown and confidence without personal data", () => {
  const lead = assessLeadCompleteness({ vehicle_interest: "Transit Custom", budget_monthly_gbp: 350, vat_registered: false }, { vehicle_interest: { confidence: 0.95 }, budget_monthly_gbp: { confidence: 0.9 }, vat_registered: { confidence: 0.95 } }, "finance");
  assert.equal(lead.fields.vehicle.known, true);
  assert.equal(lead.fields.vehicle.confidence, 0.95);
  assert.equal(lead.fields.location.known, false);
  assert.equal(lead.fields.vat_status.known, true);
  assert.equal(lead.fields.product.value, "finance");
  assert.equal("name" in lead.fields, false);
  assert.equal("email" in lead.fields, false);
});

test("structured memory extracts deposit and business facts", () => {
  const memory = buildConversationMemory([{ role: "user", content: "limited company, VAT registered and £500 deposit" }]);
  assert.equal(memory.remembered_facts.business_type, "limited company");
  assert.equal(memory.remembered_facts.vat_registered, true);
  assert.equal(memory.remembered_facts.deposit_budget_gbp, 500);
});

test("next question is the single most useful unknown fact", () => {
  const lead = assessLeadCompleteness({ budget_monthly_gbp: 350 }, {}, "finance");
  const question = chooseNextJourneyQuestion({ buyingIntent: { level: "Interested" }, facts: { budget_monthly_gbp: 350 }, leadCompleteness: lead, goal: "Choose vehicle" });
  assert.equal(question, "What type of van are you looking for?");
  assert.equal((question.match(/\?/g) || []).length, 1);
});

test("no question is asked once Application Mode is ready", () => {
  const journey = buildJourneyState({ message: "ready to apply", intent: classify("ready to apply"), facts: {}, factMetadata: {}, productContext: "finance" });
  assert.equal(journey.application_mode_active, true);
  assert.equal(journey.next_best_question, "");
});

test("Finance CTA is abstract, correctly labelled and URL-free", () => {
  assert.deepEqual(buildApplicationCta("finance"), { type: "application", product: "finance", label: "Start Finance Application", action_key: "start_finance_application", url: null, configured: false });
});

test("Rent2Buy CTA is separate and URL-free", () => {
  assert.deepEqual(buildApplicationCta("rent2buy"), { type: "application", product: "rent2buy", label: "Start Rent2Buy Application", action_key: "start_rent2buy_application", url: null, configured: false });
});

test("other-product request cannot activate application mode", () => {
  const intent = classify("ready to apply for Rent2Buy", "finance");
  const journey = buildJourneyState({ message: "ready to apply for Rent2Buy", intent, productContext: "finance" });
  assert.equal(intent.primary_intent, "product_clarification_required");
  assert.equal(journey.application_mode_active, false);
  assert.equal(journey.application_cta, null);
});

test("Application Mode response confirms only the locked product", () => {
  assert.match(applicationModeReply("finance"), /Finance application/i);
  assert.doesNotMatch(applicationModeReply("finance"), /Rent2Buy/i);
  assert.match(applicationModeReply("rent2buy"), /Rent2Buy application/i);
  assert.doesNotMatch(applicationModeReply("rent2buy"), /Finance/i);
});

test("application response makes no approval or delivery promise", () => {
  for (const product of ["finance", "rent2buy"]) assert.doesNotMatch(applicationModeReply(product), /approved|guarantee|delivery date|tomorrow/i);
});

test("progress and stall states are transparent", () => {
  assert.equal(detectConversationProgress({ buyingIntent: { level: "Interested", explicit_application_trigger: false }, priorLevel: "Research", updatedFacts: { vehicle_interest: "Transit" }, message: "Transit", messages: [] }).conversation_progressing, true);
  const stalled = detectConversationProgress({ buyingIntent: { level: "Research", explicit_application_trigger: false }, priorLevel: "Research", updatedFacts: {}, message: "help", messages: [{ role: "user", content: "help" }] });
  assert.equal(stalled.conversation_stalled, true);
});

test("repetitive sales openings are detected", () => {
  const result = detectRepetitiveAssistantWording([{ role: "assistant", content: "Would you like to apply?" }], "Would you like more information?");
  assert.equal(result.repeated, true);
  assert.equal(result.phrase, "would you like");
});

test("reviewer exposes every approved V4 outcome", () => {
  for (const outcome of APPLICATION_REVIEW_OUTCOMES) assert.equal(CONVERSATION_REVIEW_OUTCOMES.includes(outcome), true, outcome);
});

test("V4 adds at least 100 balanced application-journey scenarios", () => {
  assert.ok(V4_APPLICATION_SCENARIOS.length >= 100);
  assert.equal(V4_APPLICATION_SCENARIOS.filter((item) => item.product_context === "finance").length, V4_APPLICATION_SCENARIOS.filter((item) => item.product_context === "rent2buy").length);
  assert.equal(V4_APPLICATION_SCENARIOS.every((item) => item.messages.length > 1), true);
  assert.ok(REAL_CUSTOMER_SCENARIOS.length >= V4_APPLICATION_SCENARIOS.length + 250);
});

test("V4 API passes journey state but adds no endpoint", () => {
  const api = readFileSync(new URL("../api/marketing-ai-assistant-competence.js", import.meta.url), "utf8");
  const service = readFileSync(new URL("../services/aiAssistantCompetence.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../pages/RealCustomerSimulationPage.jsx", import.meta.url), "utf8");
  assert.match(api, /body\.journey_state/);
  assert.match(page, /journey_state: journey/);
  assert.match(service, /marketing-ai-assistant-competence/);
  assert.doesNotMatch(service, /public-assistant|wix-chatbot/);
});

test("V4 migration preserves internal-only scope", () => {
  const migration = readFileSync(new URL("../supabase/migrations/037_ai_sales_assistant_v4.sql", import.meta.url), "utf8");
  assert.match(migration, /missed_application_opportunity/);
  assert.doesNotMatch(migration, /create table[^;]*(?:lead|customer|application)/i);
  assert.doesNotMatch(migration, /create extension[^;]*vector/i);
});

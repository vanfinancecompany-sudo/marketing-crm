import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import {
  CONVERSATION_POLISH_REVIEW_FIELDS,
  assessCtaTiming,
  communicatedFactKeys,
  conversationPolishDiagnostics,
  polishConversationPresentation,
  serialisePolishReviewRatings,
} from "../lib/conversationPolish.js";
import { CONVERSATION_POLISH_SCENARIOS } from "../lib/customerSimulationScenarios.js";

const leadFields = ({ location = true } = {}) => ({
  vehicle: { known: true }, budget: { known: true }, employment: { known: true },
  product: { known: true }, location: { known: location }, trading_history: { known: true },
});

const highIntentJourney = (options = {}) => ({
  buying_intent_level: "High Intent",
  application_readiness: "Potentially ready to apply",
  lead_completeness: { known_count: options.knownCount ?? 6, fields: leadFields(options) },
  application_cta: null,
});

test("approved factual wording is preserved while article-style framing is removed", () => {
  const result = polishConversationPresentation({
    reply: "According to the approved Knowledge Hub, Insurance is not included with Rent2Buy.",
    question: "Is insurance included?",
    productContext: "rent2buy",
    intent: { retrieval_required: true },
    journey: {},
  });
  assert.equal(result.reply, "Insurance is not included with Rent2Buy.");
  assert.equal(result.factual_reply_preserved, true);
  assert.doesNotMatch(result.reply, /Knowledge Hub|article/i);
});

test("knowledge interruption bridges naturally back to the exact locked application", () => {
  const result = polishConversationPresentation({
    reply: "Insurance is not included.\n\nWhen you’re ready, you can continue with your Rent2Buy application below.",
    question: "Does insurance come with it?",
    productContext: "rent2buy",
    orchestration: { application_mode_resumed: true },
    intent: { retrieval_required: true },
    journey: { buying_intent_level: "Ready To Apply" },
  });
  assert.match(result.reply, /^Insurance is not included\./);
  assert.match(result.reply, /Rent2Buy application/);
  assert.doesNotMatch(result.reply, /Finance application/);
  assert.equal(result.transition_type, "resume_application");
  assert.equal(result.response_sentence_count, 2);
});

test("Finance application transitions never introduce Rent2Buy", () => {
  const result = polishConversationPresentation({
    reply: "The vehicle tax position is explained in the approved evidence.\n\nWhen you’re ready, you can continue with your Finance application below.",
    question: "Is it taxed?",
    productContext: "finance",
    orchestration: { application_mode_resumed: true },
    intent: { retrieval_required: true },
  });
  assert.match(result.reply, /Finance application/);
  assert.doesNotMatch(result.reply, /Rent2Buy/);
});

test("missing knowledge stays natural and never exposes the Learning Engine", () => {
  const result = polishConversationPresentation({
    reply: "I don’t have enough approved information to confirm that.\n\nWhen you’re ready, you can continue with your Finance application below.",
    question: "Is a specialist accessory included?",
    productContext: "finance",
    orchestration: { application_mode_resumed: true },
    intent: { retrieval_required: true },
    insufficientKnowledge: true,
  });
  assert.match(result.reply, /team can confirm|needs confirming|need the team/i);
  assert.match(result.reply, /Finance application/);
  assert.doesNotMatch(result.reply, /Learning|opportunity|internal|retrieval/i);
});

test("high intent, high readiness and sufficient facts expose the existing Finance CTA abstraction", () => {
  const result = assessCtaTiming({ journey: highIntentJourney(), productContext: "finance" });
  assert.equal(result.generated_early, true);
  assert.equal(result.cta.label, "Start Finance Application");
  assert.equal(result.cta.url, null);
});

test("Rent2Buy proactive CTA additionally requires a known location", () => {
  const held = assessCtaTiming({ journey: highIntentJourney({ location: false }), productContext: "rent2buy" });
  assert.equal(held.generated_early, false);
  assert.ok(held.missing_required_facts.includes("location"));
  const shown = assessCtaTiming({ journey: highIntentJourney(), productContext: "rent2buy" });
  assert.equal(shown.cta.label, "Start Rent2Buy Application");
});

test("CTA is held back for lower intent, incomplete facts, conflicts and missing knowledge", () => {
  const lower = assessCtaTiming({ journey: { ...highIntentJourney(), buying_intent_level: "Interested" }, productContext: "finance" });
  const incomplete = assessCtaTiming({ journey: highIntentJourney({ knownCount: 3 }), productContext: "finance" });
  const conflict = assessCtaTiming({ journey: highIntentJourney(), productContext: "finance", conflictDetected: true });
  const missing = assessCtaTiming({ journey: highIntentJourney(), productContext: "finance", insufficientKnowledge: true });
  for (const result of [lower, incomplete, conflict, missing]) assert.equal(result.generated_early, false);
});

test("proactive CTA transition is concise and non-binding", () => {
  const result = polishConversationPresentation({
    reply: "Your document list is covered by the approved guidance.",
    question: "What documents do I need?",
    productContext: "finance",
    intent: { retrieval_required: true },
    journey: highIntentJourney(),
    ctaTiming: { generated_early: true },
  });
  assert.match(result.reply, /start your Finance application|application is ready to start|start your Finance application/i);
  assert.doesNotMatch(result.reply, /guaranteed|accepted/i);
  assert.ok(result.response_sentence_count <= 5);
});

test("repeated-fact diagnostics exclude facts the customer explicitly asked to revisit", () => {
  const messages = [{ role: "assistant", content: "You told me you are self employed and your budget is £350." }];
  const requested = conversationPolishDiagnostics({ reply: "Your £350 budget is noted.", question: "Is my £350 budget enough?", messages });
  assert.equal(requested.repeated_fact_score, 0);
  const unnecessary = conversationPolishDiagnostics({ reply: "You are self employed and the vehicle is taxed.", question: "Is it taxed?", messages });
  assert.ok(unnecessary.repeated_fact_keys.includes("self_employed"));
  assert.ok(unnecessary.repeated_fact_score > 0);
});

test("phrase similarity lowers variety and contributes to redundancy", () => {
  const repeated = conversationPolishDiagnostics({
    reply: "Based on what you’ve told me, you can continue with your application.",
    question: "OK",
    messages: [{ role: "assistant", content: "Based on what you’ve told me, you can continue with your application." }],
  });
  assert.equal(repeated.recent_phrase_similarity, 100);
  assert.ok(repeated.conversation_variety_score < 20);
  assert.ok(repeated.redundancy_score > 0);
});

test("duplicate sentences are removed without rewriting the remaining fact", () => {
  const result = polishConversationPresentation({
    reply: "You need fully comprehensive insurance. You need fully comprehensive insurance.",
    question: "What insurance do I need?",
    intent: { retrieval_required: true },
  });
  assert.equal(result.reply, "You need fully comprehensive insurance.");
});

test("awkward echo clarification becomes one concise conversational question", () => {
  const result = polishConversationPresentation({
    reply: "What would you like to know about Finance and “Two Weeks”?",
    question: "Two Weeks",
    intent: { retrieval_required: false, clarification_required: true },
  });
  assert.equal(result.reply, "Could you tell me a little more about what you mean?");
  assert.equal((result.reply.match(/\?/g) || []).length, 1);
});

test("polish reviewer fields serialize into the existing notes field", () => {
  assert.deepEqual(CONVERSATION_POLISH_REVIEW_FIELDS, [
    "sales_flow_quality", "transition_quality", "knowledge_integration", "conversation_smoothness",
    "cta_timing", "conversation_confidence", "redundancy_score", "human_feel_rating",
  ]);
  const stored = serialisePolishReviewRatings("Useful review", { sales_flow_quality: 5, transition_quality: 4 });
  assert.match(stored, /Useful review/);
  assert.match(stored, /sales_flow_quality: 5\/5/);
  assert.match(stored, /transition_quality: 4\/5/);
});

test("polish library adds at least 100 balanced scenarios and includes the acceptance journey", () => {
  assert.ok(CONVERSATION_POLISH_SCENARIOS.length >= 100);
  assert.equal(CONVERSATION_POLISH_SCENARIOS.filter((item) => item.product_context === "finance").length, CONVERSATION_POLISH_SCENARIOS.filter((item) => item.product_context === "rent2buy").length);
  const acceptance = CONVERSATION_POLISH_SCENARIOS.find((item) => item.product_context === "finance" && item.messages.includes("Does insurance come with it?"));
  assert.deepEqual(acceptance.messages.slice(-4), ["Does insurance come with it?", "Is it taxed?", "Can you deliver to Glasgow?", "OK let's apply"]);
});

test("polish is downstream of V6 and factual retrieval prompts remain unchanged", async () => {
  const api = await readFile(new URL("../api/marketing-ai-assistant-competence.js", import.meta.url), "utf8");
  const orchestrator = api.indexOf("orchestrateConversationTurn({");
  const retrieval = api.indexOf("Conversation lexical ranking", orchestrator);
  const polish = api.indexOf("polishConversationPresentation({", retrieval);
  assert.ok(orchestrator > 0 && retrieval > orchestrator && polish > retrieval);
  const promptBody = api.slice(api.indexOf("export function conversationPrompt"), api.indexOf("export async function simulateCustomerConversation"));
  assert.doesNotMatch(promptBody, /conversation polish|salesperson polish|polishConversation/i);
});

test("release adds no migration, public route, model selection or Wix integration", async () => {
  const migrations = await readdir(new URL("../supabase/migrations/", import.meta.url));
  assert.equal(migrations.some((file) => /polish|ux.*conversation/i.test(file)), false);
  const module = await readFile(new URL("../lib/conversationPolish.js", import.meta.url), "utf8");
  assert.doesNotMatch(module, /OPENAI_MODEL|OPENAI_API_KEY|pgvector|embedding|wix/i);
});

test("reviewer and diagnostics expose every requested polish measure", async () => {
  const page = await readFile(new URL("../pages/RealCustomerSimulationPage.jsx", import.meta.url), "utf8");
  for (const label of [
    "Conversation Naturalness", "Sales Flow Quality", "Transition Quality", "Knowledge Integration",
    "Conversation Smoothness", "CTA Timing", "Conversation Confidence", "Redundancy Score", "Human Feel Rating",
    "Repeated Fact Score", "Recent Phrase Similarity", "Conversation Variety Score",
  ]) assert.match(page, new RegExp(label));
});

test("fact vocabulary covers every interruption type required for application continuation", () => {
  const keys = communicatedFactKeys("Insurance, tax, documents, delivery, collection, warranty and mileage.");
  for (const key of ["insurance", "taxation", "documents", "delivery", "collection", "warranty", "mileage"]) assert.ok(keys.includes(key), key);
});

import assert from "node:assert/strict";
import test from "node:test";
import { rankKnowledge } from "../lib/aiAssistantCompetence.js";
import { buildJourneyState } from "../lib/applicationJourneyEngine.js";
import { classifyConversationIntent } from "../lib/conversationIntelligence.js";
import { orchestrateConversationTurn } from "../lib/conversationKnowledgeOrchestrator.js";
import { classifyUniversalMessage, humanRecoveryReply } from "../lib/humanConversationRecovery.js";

const activeApplication = (product = "rent2buy") => ({
  buying_intent_level: "Application Started",
  journey_stage: "Application started",
  application_mode_active: true,
  application_state: "started",
  application_cta: { product },
});

function orchestrate(message, { product = "finance", messages = [], priorJourney = {}, journey = priorJourney } = {}) {
  const intent = classifyConversationIntent({ message, history: messages, productContext: product });
  const human = classifyUniversalMessage({ message, messages, journey: priorJourney });
  const result = orchestrateConversationTurn({ message, intent, human, journey, priorJourney, buyingSignals: { detected_buying_signal: "none" } });
  return { intent, human, result };
}

test("authority bonus cannot rank evidence with zero lexical match", () => {
  const ranked = rankKnowledge("That's useful", [
    { type: "business_faq", source_id: "deposit", title: "FAQs", heading: "Is the deposit always £99?", passage: "The deposit varies by application and vehicle." },
  ]);
  assert.deepEqual(ranked, []);
});

test("current taxation terms outrank stale finance application history", () => {
  const messages = [
    { role: "user", content: "Need a van" },
    { role: "assistant", content: "What size or type of van do you need?" },
    { role: "user", content: "Transit Custom" },
    { role: "assistant", content: "Can I get finance for any type or size of van?" },
    { role: "user", content: "Budget £350" },
    { role: "assistant", content: "A lender will assess the application." },
    { role: "user", content: "Ready to apply" },
  ];
  const query = "Need a van Transit Custom Budget £350 Ready to apply Is the van taxed? vehicle interest Transit Custom budget monthly gbp 350";
  const ranked = rankKnowledge(query, [
    { type: "business_faq", source_id: "generic", title: "Finance FAQ", heading: "Can I get finance for any type or size of van?", passage: "Lender criteria and vehicle suitability affect a finance application." },
    { type: "business_faq", source_id: "tax", title: "Vehicle FAQ", heading: "Is road tax included?", passage: "Vehicle tax status must be confirmed from approved vehicle information." },
  ], { messages });
  assert.equal(ranked[0]?.source_id, "tax");
  assert.ok(ranked[0]?.matched_terms.includes("tax"));
  assert.equal(ranked.some((source) => source.source_id === "generic"), false);
});

test("taxed matches approved text written as vehicle tax", () => {
  const ranked = rankKnowledge("Is the van taxed?", [
    { type: "article", source_id: "tax", title: "Vehicle guidance", heading: "Vehicle status", passage: "Insurance, vehicle tax, warranty and mileage must be confirmed." },
  ]);
  assert.equal(ranked[0]?.source_id, "tax");
  assert.ok(ranked[0]?.matched_terms.includes("taxed") || ranked[0]?.matched_terms.includes("tax"));
});

test("licence matches approved text written in plural", () => {
  const ranked = rankKnowledge("do I need my licence", [
    { type: "article", source_id: "docs", title: "Application documents", heading: "Documents", passage: "Applications may require bank statements, documents and licences." },
  ]);
  assert.equal(ranked[0]?.source_id, "docs");
  assert.ok(ranked[0]?.matched_terms.includes("licence"));
});

test("application question confusion asks for the actual wording instead of retrieving unrelated knowledge", () => {
  const messages = [
    { role: "user", content: "halfway through the application" },
    { role: "assistant", content: "Your Rent2Buy application is already underway. Ask here if you need help understanding a question." },
  ];
  const { human, result } = orchestrate("what does this question mean", { product: "rent2buy", messages, priorJourney: activeApplication() });
  assert.equal(human.message_type, "confusion");
  assert.equal(result.retrieval_required, false);
  assert.equal(result.recovery_required, true);
  const reply = humanRecoveryReply(human, { messages, productContext: "rent2buy", journey: activeApplication() });
  assert.match(reply.reply, /exact wording/i);
  assert.match(reply.reply, /without guessing/i);
});

test("unfinished application is recognised as Application Started", () => {
  const intent = classifyConversationIntent({ message: "didnt finish applying", productContext: "rent2buy" });
  const journey = buildJourneyState({ message: "didnt finish applying", intent, productContext: "rent2buy", priorJourney: {}, facts: {} });
  assert.equal(journey.buying_intent_level, "Application Started");
  assert.equal(journey.application_mode_active, true);
  assert.equal(journey.application_state, "started");
});

test("can I continue resumes an active application without knowledge retrieval", () => {
  const priorJourney = activeApplication();
  const { human, result } = orchestrate("can I continue", { product: "rent2buy", priorJourney });
  assert.equal(human.message_type, "agreement");
  assert.equal(result.application_continuation, true);
  assert.equal(result.retrieval_required, false);
  assert.equal(result.recovery_required, false);
});

test("OK continue is also an application continuation rather than an unknown query", () => {
  const priorJourney = activeApplication();
  const { human, result } = orchestrate("OK continue", { product: "rent2buy", priorJourney });
  assert.equal(human.message_type, "agreement");
  assert.equal(result.application_continuation, true);
  assert.equal(result.retrieval_required, false);
});

test("can you switch is handled as a product-lock clarification without retrieval", () => {
  const { intent, result } = orchestrate("can you switch", { product: "finance" });
  assert.equal(intent.primary_intent, "product_clarification_required");
  assert.equal(intent.clarification_required, true);
  assert.equal(result.product_boundary_blocked, true);
  assert.equal(result.retrieval_required, false);
  assert.equal(result.conversation_control, "product_switch");
});

test("narrowing a vehicle choice stays conversational and does not retrieve unrelated facts", () => {
  const messages = [
    { role: "user", content: "My current van is unreliable" },
    { role: "assistant", content: "I can help you narrow down what you need." },
    { role: "user", content: "Need something soon" },
    { role: "assistant", content: "Have you chosen a van yet?" },
    { role: "user", content: "Haven't chosen one" },
  ];
  const { intent, result } = orchestrate("Can you help me narrow it down?", { product: "finance", messages });
  assert.equal(intent.primary_intent, "general_help_request");
  assert.equal(result.retrieval_required, false);
  assert.equal(result.conversation_control, "narrow_choice");
});

test("Fine is an acknowledgement and cannot be mistaken for Finedon coverage", () => {
  const messages = [
    { role: "user", content: "do you want to proceed" },
    { role: "assistant", content: "You can continue when you're ready." },
    { role: "user", content: "OK" },
  ];
  const { human, result } = orchestrate("Fine", { product: "rent2buy", messages, priorJourney: activeApplication() });
  assert.equal(human.message_type, "agreement");
  assert.equal(result.rent2buy_location_turn, false);
  assert.equal(result.retrieval_required, false);
});

test("positive feedback cannot inherit a previous assistant topic and trigger retrieval", () => {
  const messages = [
    { role: "user", content: "Can you help?" },
    { role: "assistant", content: "I can help with finance, applications, deposits, documents or available vans. What would you like to know?" },
  ];
  const { human, result } = orchestrate("That's useful", { product: "finance", messages });
  assert.equal(human.message_type, "positive_feedback");
  assert.equal(human.contextual_anchor, "");
  assert.equal(result.retrieval_required, false);
  assert.equal(result.recovery_required, true);
});

test("ready to apply does not inherit an unrelated clarification-choice anchor", () => {
  const messages = [
    { role: "assistant", content: "Have you already found a van you’d like, or do you need help choosing one?" },
  ];
  const { human, result } = orchestrate("Ready to apply", { product: "finance", messages });
  assert.equal(human.message_type, "ready_to_apply");
  assert.equal(human.contextual_anchor, "");
  assert.equal(result.contextual_turn, false);
  assert.equal(result.retrieval_required, false);
});

test("Speak soon is a natural closing rather than failed recovery", () => {
  const { human, result } = orchestrate("Speak soon", { product: "finance" });
  assert.equal(human.message_type, "goodbye");
  assert.equal(result.retrieval_required, false);
  assert.equal(result.recovery_required, true);
  const reply = humanRecoveryReply(human, { productContext: "finance" });
  assert.match(reply.reply, /speak soon/i);
});

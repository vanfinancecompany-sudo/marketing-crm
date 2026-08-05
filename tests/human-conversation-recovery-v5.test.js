import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyConversationIntent } from "../lib/conversationIntelligence.js";
import { buildJourneyState } from "../lib/applicationJourneyEngine.js";
import { V5_RECOVERY_SCENARIOS } from "../lib/customerSimulationScenarios.js";
import {
  CUSTOMER_EMOTIONS,
  UNIVERSAL_MESSAGE_TYPES,
  classifyUniversalMessage,
  contextualRecoveryQuestion,
  detectCustomerEmotion,
  detectObjection,
  humanRecoveryReply,
  recentAssistantPhraseDiagnostics,
} from "../lib/humanConversationRecovery.js";

const classify = (message, messages = [], journey = {}) => classifyUniversalMessage({ message, messages, journey });

test("confusion variants share one human intent", () => {
  for (const message of ["What?", "Eh?", "Sorry?", "I don't get it", "?", "Explain", "Huh", "Not following"]) {
    assert.equal(classify(message).message_type, "confusion", message);
  }
});

test("greeting, questions and follow-ups are separated", () => {
  assert.equal(classify("Hi").message_type, "greeting");
  assert.equal(classify("How much deposit?").message_type, "question");
  assert.equal(classify("And what documents?", [{ role: "user", content: "How much deposit?" }]).message_type, "follow_up_question");
});

test("short human replies retain their distinct meaning", () => {
  for (const message of ["Yes", "Yep", "OK", "Correct", "Exactly", "Fine"]) assert.equal(classify(message).message_type, "agreement", message);
  for (const message of ["No", "Nope", "Not really"]) assert.equal(classify(message).message_type, "disagreement", message);
  for (const message of ["Maybe", "Possibly", "Not sure", "Whatever", "Don't know"]) assert.equal(classify(message).message_type, "clarification", message);
  assert.equal(classify("Thanks").message_type, "positive_feedback");
});

test("humour, random text, off-topic and nonsense are not business answers", () => {
  assert.equal(classify("haha only joking").message_type, "humour");
  assert.equal(classify("purple bananas dance very loudly").message_type, "random_text");
  assert.equal(classify("What's my name?").message_type, "off_topic");
  assert.equal(classify("asdfghjkl").message_type, "nonsense_input");
  for (const message of ["purple bananas dance very loudly", "What's my name?", "asdfghjkl"]) assert.equal(classify(message).recovery_required, true);
});

test("unknown low-confidence input stops guessing", () => {
  const result = classify("blorp");
  assert.equal(result.message_type, "unknown_intent");
  assert.equal(result.low_confidence, true);
  assert.equal(result.recovery_required, true);
});

test("nonsense receives natural recovery without echoing the nonsense", () => {
  const classification = classify("asdfghjkl");
  const reply = humanRecoveryReply(classification, { productContext: "finance" }).reply;
  assert.match(reply, /didn’t understand|another way/i);
  assert.doesNotMatch(reply, /asdfghjkl/i);
  assert.doesNotMatch(reply, /What would you like to know about/i);
});

test("prohibited awkward clarification is never generated", () => {
  for (const productContext of ["finance", "rent2buy"]) {
    const classification = classify("No");
    const reply = humanRecoveryReply(classification, { productContext, messages: [{ role: "assistant", content: "Do you have a monthly budget?" }] }).reply;
    assert.doesNotMatch(reply, /What would you like to know about/i);
    assert.doesNotMatch(reply, /and [“'\"]No/i);
  }
});

test("customer emotions cover every required state", () => {
  const cases = {
    confused: "I don't get it", frustrated: "this doesn't help", interested: "I like this van",
    excited: "great news I can't wait", ready: "ready to apply", uncertain: "not sure",
    price_concern: "too expensive", credit_concern: "rejected elsewhere", urgency: "need it tomorrow",
    trust_concern: "I lost confidence",
  };
  for (const [expected, message] of Object.entries(cases)) assert.equal(detectCustomerEmotion(message).emotion, expected, message);
  for (const emotion of Object.keys(cases)) assert.equal(CUSTOMER_EMOTIONS.includes(emotion), true);
});

test("objections are classified into useful business concerns", () => {
  const cases = {
    price: "That costs too much", deposit: "I need no deposit", credit: "I was turned down elsewhere",
    urgency: "I need a vehicle tomorrow", accounts: "I don't have accounts", business_status: "I am self employed",
    uncertainty: "I need to think", trust: "Is this genuine?",
  };
  for (const [expected, message] of Object.entries(cases)) assert.equal(detectObjection(message).objection, expected, message);
});

test("objection intent is recognised from paraphrased concepts, not exact phrases alone", () => {
  const cases = {
    price: "The repayments are beyond what I can comfortably manage",
    accounts: "I haven't kept formal books or financial records",
    trust: "I'm worried this might not be legitimate",
  };
  for (const [expected, message] of Object.entries(cases)) {
    const result = detectObjection(message);
    assert.equal(result.objection, expected, message);
    assert.match(result.reason, /overall wording/i);
  }
});

test("objection is acknowledged without replacing grounded retrieval", () => {
  const result = classify("I was rejected elsewhere");
  assert.equal(result.message_type, "objection");
  assert.equal(result.recovery_required, false);
  assert.equal(result.objection.objection, "credit");
});

test("two weeks is clarified from self-employed context", () => {
  const reply = contextualRecoveryQuestion("Two weeks", [{ role: "user", content: "I am self employed" }], { employment_status: "self-employed" }, "finance");
  assert.equal(reply, "When you said “Two weeks”, were you referring to how long you’ve been trading?");
});

test("time clarification uses delivery context instead of echo-only wording", () => {
  const reply = contextualRecoveryQuestion("Two weeks", [{ role: "user", content: "How long is delivery?" }], {}, "finance");
  assert.match(reply, /delivery time/i);
  assert.doesNotMatch(reply, /Finance and/i);
});

test("off-topic name question repairs and returns to the locked enquiry", () => {
  const finance = humanRecoveryReply(classify("What's my name?"), { productContext: "finance" }).reply;
  assert.match(finance, /don’t actually know your name/i);
  assert.match(finance, /finance enquiry/i);
  assert.doesNotMatch(finance, /Rent2Buy/i);
  const rent2buy = humanRecoveryReply(classify("What's my name?"), { productContext: "rent2buy" }).reply;
  assert.match(rent2buy, /Rent2Buy enquiry/i);
  assert.doesNotMatch(rent2buy, /finance enquiry/i);
});

test("frustration uses known facts without over-apologising", () => {
  const reply = humanRecoveryReply(classify("I already told you"), { productContext: "finance", facts: { employment_status: "self-employed" } }).reply;
  assert.match(reply, /already told me|already told|what you’ve already told/i);
  assert.doesNotMatch(reply, /sorry.*sorry/i);
  assert.doesNotMatch(reply, /are you employed/i);
});

test("agreement can use the existing single next question", () => {
  const reply = humanRecoveryReply(classify("OK"), { productContext: "finance", journey: { next_best_question: "What type of van are you looking for?" } }).reply;
  assert.match(reply, /What type of van/i);
  assert.equal((reply.match(/\?/g) || []).length, 1);
});

test("short no responds to the previous question instead of treating No as a search query", () => {
  const messages = [{ role: "assistant", content: "Do you have a monthly budget in mind?" }];
  const classification = classify("No", messages);
  const reply = humanRecoveryReply(classification, { messages, productContext: "finance" }).reply;
  assert.match(reply, /That’s okay/i);
  assert.doesNotMatch(reply, /Finance and|about “No”|about 'No'/i);
  assert.equal((reply.match(/\?/g) || []).length, 1);
});

test("positive feedback closes naturally during Application Mode", () => {
  const reply = humanRecoveryReply(classify("Thanks"), { productContext: "finance", journey: { application_mode_active: true } }).reply;
  assert.match(reply, /during the application/i);
  assert.doesNotMatch(reply, /What would you like/i);
});

test("interrupted conversations pause and resume naturally", () => {
  const pause = humanRecoveryReply(classify("one sec"), { productContext: "finance" }).reply;
  assert.equal(pause, "No problem — take your time.");
  const resume = humanRecoveryReply(classify("back now"), { productContext: "finance", journey: { next_best_question: "What type of van do you need?" } }).reply;
  assert.match(resume, /Welcome back/i);
  assert.match(resume, /What type of van/i);
});

test("recent phrase diagnostics detect robotic reuse", () => {
  const result = recentAssistantPhraseDiagnostics([{ role: "assistant", content: "Approval depends on lender criteria and affordability." }], "Approval depends on lender criteria and affordability checks.");
  assert.equal(result.repeated_phrase_detected, true);
  assert.ok(result.recently_used_terms.includes("approval"));
});

test("V4 Application Mode still outranks a short agreement", () => {
  const intent = classifyConversationIntent({ message: "yes", productContext: "finance", history: [{ role: "assistant", content: "Would you like to start the application?" }] });
  const journey = buildJourneyState({ message: "yes", messages: [{ role: "assistant", content: "Would you like to start the application?" }], intent, productContext: "finance", priorJourney: { buying_intent_level: "High Intent" } });
  assert.equal(classify("yes", [], journey).message_type, "agreement");
  assert.equal(journey.application_mode_active, true);
  assert.equal(journey.application_cta.label, "Start Finance Application");
});

test("universal classification vocabulary is complete", () => {
  for (const expected of ["greeting", "question", "follow_up_question", "clarification", "agreement", "disagreement", "confusion", "frustration", "humour", "positive_feedback", "objection", "buying_signal", "ready_to_apply", "random_text", "unknown_intent", "off_topic", "nonsense_input"]) assert.equal(UNIVERSAL_MESSAGE_TYPES.includes(expected), true, expected);
});

test("V5 adds at least 120 balanced scenarios and hundreds of messages", () => {
  assert.ok(V5_RECOVERY_SCENARIOS.length >= 120);
  assert.equal(V5_RECOVERY_SCENARIOS.filter((item) => item.product_context === "finance").length, V5_RECOVERY_SCENARIOS.filter((item) => item.product_context === "rent2buy").length);
  assert.ok(V5_RECOVERY_SCENARIOS.reduce((sum, item) => sum + item.messages.length, 0) >= 300);
});

test("V5 remains inside the existing protected endpoint", () => {
  const api = readFileSync(new URL("../api/marketing-ai-assistant-competence.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../pages/RealCustomerSimulationPage.jsx", import.meta.url), "utf8");
  assert.match(api, /Universal message classification/);
  assert.match(api, /competenceAuthorize/);
  assert.match(page, /Human Conversation & Recovery Simulation/);
  assert.doesNotMatch(api, /public-chatbot|WIX_API_KEY|publishToWix/);
});

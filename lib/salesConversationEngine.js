import { normaliseCustomerMessage } from "./conversationIntelligence.js";

const clean = (value, limit = 5000) => String(value || "").trim().slice(0, limit);
const words = (value) => clean(value).split(/\s+/).filter(Boolean);
const questionCount = (value) => (clean(value).match(/\?/g) || []).length;

export const SALES_REVIEW_OUTCOMES = Object.freeze([
  "too_long", "too_formal", "too_salesy", "missed_buying_signal", "weak_next_question",
  "repeated_information", "failed_to_use_known_fact", "good_sales_conversation",
]);

const SIGNALS = [
  ["human_assistance", "high", /speak to (?:someone|the team|a person)|need (?:a human|someone)|call me/],
  ["ready_to_apply", "high", /ready to apply|apply now|start (?:an |the )?application|what happens next|what'?s next/],
  ["specific_vehicle", "high", /seen|found|want this|interested in (?:this|a)|transit custom|sprinter|crafter|vivaro|boxer|relay/],
  ["multiple_vehicles", "high", /(?:two|three|four|five|[2-9])\s+(?:vans?|vehicles?)|more than one|expanding (?:my|the) fleet|fleet/],
  ["quote_requested", "high", /quote|quotation|price this|cost for this/],
  ["documents_ready", "medium", /documents? ready|bank statements? ready|paperwork ready/],
  ["monthly_budget", "medium", /(?:budget|afford|spend).{0,20}£?\d+|£\s?\d+.{0,20}(?:month|monthly)/],
  ["urgent_need", "medium", /urgent|quickly|asap|straight away|need.{0,15}(?:today|soon|fast)/],
  ["previous_refusal", "medium", /refused|declined|turned down/],
  ["delivery_interest", "medium", /deliver|delivery/],
  ["collection_interest", "medium", /collect|collection/],
];

export function detectBuyingSignals(message, facts = {}) {
  const text = normaliseCustomerMessage(message);
  const detected = SIGNALS.filter(([, , pattern]) => pattern.test(text)).map(([signal, strength]) => ({ signal, strength }));
  if (Number(facts.quantity_required) >= 2 && !detected.some((item) => item.signal === "multiple_vehicles")) detected.push({ signal: "multiple_vehicles", strength: "high" });
  if (facts.budget_monthly_gbp && !detected.some((item) => item.signal === "monthly_budget")) detected.push({ signal: "monthly_budget", strength: "medium" });
  const order = { low: 1, medium: 2, high: 3 };
  const strongest = detected.sort((a, b) => order[b.strength] - order[a.strength])[0] || { signal: "none", strength: "low" };
  const actions = {
    human_assistance: "Offer a calm human handoff.", ready_to_apply: "Offer the locked product's application as the next step.",
    specific_vehicle: "Ask whether the customer has already applied or wants to start.", multiple_vehicles: "Ask whether the vehicles are for the same business and should be arranged together.",
    quote_requested: "Explain how to request a personalised quotation without inventing a figure.", monthly_budget: "Ask what size or type of van they need.",
    urgent_need: "Ask whether they have seen a van or still need help choosing.", previous_refusal: "Answer from approved credit guidance, then ask employment status if unknown.",
    documents_ready: "Guide them to the next application step.", delivery_interest: "Apply the deterministic delivery rule.", collection_interest: "Use approved collection knowledge or flag uncertainty.",
    none: "Answer the current question directly.",
  };
  return { detected_signals: detected, detected_buying_signal: strongest.signal, signal_strength: strongest.strength, recommended_next_action: actions[strongest.signal], reason: detected.length ? `Detected ${detected.map((item) => item.signal).join(", ")} from the current message or remembered facts.` : "No material buying signal was detected." };
}

export function responseLengthTarget(message, intent = {}) {
  const count = words(message).length;
  const complex = intent.primary_intent === "multi_part_question" || (intent.secondary_intents || []).length >= 3;
  if (complex) return { band: "complex", minimum_words: 80, maximum_words: 130, reason: "Several material points need a complete but concise answer." };
  if (count <= 5 || ["greeting", "general_help_request", "thanks", "goodbye", "frustration"].includes(intent.primary_intent)) return { band: "short", minimum_words: 1, maximum_words: 45, reason: "The customer used a short conversational message." };
  return { band: "normal", minimum_words: 20, maximum_words: 90, reason: "A normal knowledge question needs a direct explanation." };
}

const DISCLAIMER_PATTERN = /subject to (?:lender )?(?:criteria|checks)|affordability|approval (?:is|would be|depends)|applications? (?:are|is) assessed|cannot be guaranteed/i;
export function disclaimerControl(messages = [], proposedReply = "") {
  const previousAssistant = [...messages].reverse().find((item) => item?.role === "assistant")?.content || "";
  const repeated = DISCLAIMER_PATTERN.test(previousAssistant) && DISCLAIMER_PATTERN.test(proposedReply);
  return { repeated_disclaimer: repeated, prior_disclaimer_present: DISCLAIMER_PATTERN.test(previousAssistant), instruction: repeated ? "Use only a brief qualification if it remains material; do not repeat the full previous disclaimer." : "State one material qualification only where needed." };
}

export function contextualClarification(message, messages = [], facts = {}) {
  const text = normaliseCustomerMessage(message);
  const recent = normaliseCustomerMessage(messages.slice(-6).map((item) => item.content).join(" "));
  if (/^how long\??$/.test(text)) {
    if (/deliver|delivery/.test(recent)) return "Do you mean how long delivery normally takes?";
    if (/apply|application|approval/.test(recent)) return "Do you mean how long the application and approval process normally takes?";
    return "Do you mean the approval time or the delivery time?";
  }
  if (/^still worth (?:it|applying)\??$/.test(text) && (facts.credit_concern || /refused|declined/.test(recent))) return "The customer is asking whether applying remains worthwhile after a previous refusal.";
  if (/^(it|that|one|them|monthly|next|what about me|can i get one)\??$/.test(text)) return facts.vehicle_interest ? `Resolve the shorthand using the remembered vehicle: ${facts.vehicle_interest}.` : "Use the immediately preceding subject; clarify only if two meanings remain plausible.";
  return "";
}

export function applicationReadiness({ intent = {}, buyingSignals = {}, facts = {}, insufficientKnowledge = false, contradiction = false } = {}) {
  if (intent.primary_intent === "human_assistance_requested" || intent.primary_intent === "frustration") return "Human assistance recommended";
  if (insufficientKnowledge) return "Insufficient verified information";
  if (contradiction || intent.clarification_required) return "Needs clarification";
  if (buyingSignals.detected_buying_signal === "ready_to_apply") return "Ready for application CTA";
  if (["high", "medium"].includes(buyingSignals.signal_strength) && (facts.vehicle_interest || facts.vehicle_type || facts.main_concern)) return "Potentially ready to apply";
  return "Exploring";
}

export function buildConversationSummary({ productContext, facts = {}, buyingSignals = {}, intent = {}, insufficientKnowledge = false, humanHandoff = false } = {}) {
  const unanswered = intent.clarification_required ? [intent.suggested_clarification_question].filter(Boolean) : [];
  const readiness = applicationReadiness({ intent, buyingSignals, facts, insufficientKnowledge });
  const nextQuestions = {
    urgent_need: facts.vehicle_interest ? "Have you already submitted an application?" : "Have you already seen a van, or do you need help choosing a size?",
    specific_vehicle: "Have you already submitted an application, or would you like to start one?",
    multiple_vehicles: "Are the vehicles for the same business?",
    monthly_budget: facts.vehicle_interest ? "Would you like to request a personalised quotation for that van?" : "What size or type of van do you need?",
    previous_refusal: facts.employment_status ? "How long have you been employed or trading?" : "Are you employed or self-employed?",
    quote_requested: facts.vehicle_interest ? "Have you already submitted an application?" : "Which van would you like a quotation for?",
    documents_ready: "Have you already chosen a van?",
    ready_to_apply: "",
    human_assistance: "",
    delivery_interest: "",
    collection_interest: "",
    none: "",
  };
  const nextBestQuestion = unanswered[0] || nextQuestions[buyingSignals.detected_buying_signal] || "";
  return {
    product_context: productContext,
    customer_goal: buyingSignals.detected_buying_signal === "none" ? (intent.secondary_intents || []).join(", ") || intent.primary_intent : buyingSignals.detected_buying_signal,
    key_facts: facts,
    buying_signals: buyingSignals.detected_signals || [],
    unanswered_questions: unanswered,
    current_recommendation: buyingSignals.recommended_next_action,
    next_best_question: nextBestQuestion,
    application_readiness: readiness,
    handoff_need: Boolean(humanHandoff || readiness === "Human assistance recommended"),
  };
}

export function conversationQualityDiagnostics({ message, reply, intent, messages = [], followUpAppropriate = false } = {}) {
  const target = responseLengthTarget(message, intent);
  const actual = words(reply).length;
  const questions = questionCount(reply);
  const disclaimer = disclaimerControl(messages, reply);
  return {
    response_length_target: target,
    actual_word_count: actual,
    outside_length_target: actual > target.maximum_words,
    question_count: questions,
    one_question_at_a_time: questions <= 1,
    repeated_disclaimer: disclaimer.repeated_disclaimer,
    sounded_article_like: actual > target.maximum_words || (/\n[-*]\s/.test(reply) && target.band === "short"),
    follow_up_question_appropriate: Boolean(followUpAppropriate),
  };
}

export function stripRepeatedDisclaimer(reply, messages = []) {
  if (!disclaimerControl(messages, reply).repeated_disclaimer) return reply;
  return clean(reply).replace(/Applications? are subject to lender criteria and affordability checks\.?/i, "Approval would still depend on the lender’s assessment.");
}

export function deterministicDeliveryReply(productContext, question, coverage) {
  if (!/\b(deliver|delivery)\b/i.test(clean(question))) return null;
  if (productContext === "finance") {
    const place = coverage?.diagnostics?.detected_location;
    const excluded = coverage?.diagnostics?.coverage_result === "not_covered";
    return excluded
      ? "Our approved Finance delivery area covers England, Wales and Scotland. Northern Ireland isn’t currently included, so I don’t want to promise delivery there."
      : `Yes. We provide free delivery for qualifying Finance vehicle purchases across England, Wales and Scotland${place ? `, including ${place}` : ""}. Timing is confirmed once the finance is approved and the vehicle is ready.`;
  }
  return "Rent2Buy vans are collected from Southampton rather than delivered. Applicants must also normally live within 100 miles of SO40 2NN.";
}

export function naturalSalesReply(intent, productContext, buyingSignals, rememberedFacts = {}) {
  if (intent.primary_intent === "general_help_request" && buyingSignals.detected_buying_signal === "urgent_need") {
    return { reply: "We can help you look at the quickest suitable route. Have you already seen a van you like, or are you still deciding what size you need?", insufficient_knowledge: false, human_handoff_recommended: false, recommended_action: "continue", confidence: 100, confidence_reason: "Server-side conversational response to an urgent but broad vehicle need." };
  }
  if (intent.primary_intent === "general_help_request" && /need (?:a )?van/i.test(intent.normalised_message)) {
    return { reply: `I can help with ${productContext === "finance" ? "finding the right van finance route" : "understanding the right Rent2Buy route"}. What size or type of van do you need?`, insufficient_knowledge: false, human_handoff_recommended: false, recommended_action: "continue", confidence: 100, confidence_reason: "Server-side conversational response to a broad vehicle need." };
  }
  return null;
}

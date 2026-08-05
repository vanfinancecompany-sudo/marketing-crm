import { normaliseCustomerMessage } from "./conversationIntelligence.js";

const clean = (value, limit = 5000) => String(value || "").trim().slice(0, limit);

export const BUYING_INTENT_LEVELS = Object.freeze([
  "Research", "Comparing", "Interested", "High Intent", "Ready To Apply", "Application Started", "Application Complete",
]);

export const APPLICATION_REVIEW_OUTCOMES = Object.freeze([
  "missed_application_opportunity", "should_have_shown_application", "asked_unnecessary_question",
  "failed_to_recognise_buying_intent", "repeated_itself", "weak_sales_progression",
  "excellent_application_guidance", "natural_closing",
]);

const APPLICATION_READY = /\b(ready to apply|let\s*s apply|apply now|can i apply|start (?:the |an )?application|what\s*s next|let\s*s do it|go ahead|send me the application|i want this van|proceed|begin)\b/i;
const APPLICATION_STARTED = /\b(already (?:started|applying)|application (?:is )?started|halfway through|abandoned (?:my |the )?application|continue (?:my |the )?application)\b/i;
const APPLICATION_COMPLETE = /\b(application (?:is )?(?:complete|submitted)|i (?:have |'ve )?submitted|finished (?:the |my )?application)\b/i;
const COMPARISON = /\b(compare|comparison|versus|vs\.?|difference|which is better|options)\b/i;

const factMap = Object.freeze({
  vehicle: ["vehicle_interest", "vehicle_type"],
  budget: ["budget_monthly_gbp", "budget"],
  employment: ["employment_status"],
  trading_history: ["trading_history", "trading_history_months"],
  credit_concerns: ["credit_concern"],
  deposit: ["deposit", "deposit_budget_gbp"],
  location: ["location"],
  business_type: ["business_type", "employment_status"],
  vat_status: ["vat_registered"],
  urgency: ["urgency"],
  product: ["product_context"],
});

function knownValue(facts, candidates) {
  for (const key of candidates) if (facts[key] !== undefined && facts[key] !== null && facts[key] !== "") return { key, value: facts[key] };
  return null;
}

export function assessLeadCompleteness(facts = {}, factMetadata = {}, productContext = "finance") {
  const enriched = { ...facts, product_context: productContext };
  const fields = Object.fromEntries(Object.entries(factMap).map(([field, candidates]) => {
    const found = knownValue(enriched, candidates);
    const metadata = found ? factMetadata[found.key] : null;
    return [field, { known: Boolean(found), value: found?.value ?? null, confidence: found ? Number(metadata?.confidence ?? 1) : 0 }];
  }));
  const known = Object.values(fields).filter((field) => field.known).length;
  return { fields, known_count: known, total_count: Object.keys(fields).length, percentage: Math.round(known / Object.keys(fields).length * 100) };
}

export function assessBuyingIntent({ message, messages = [], facts = {}, priorLevel = "Research" } = {}) {
  const text = normaliseCustomerMessage(message);
  const combined = normaliseCustomerMessage([...messages.filter((item) => item?.role === "user").map((item) => item.content), message].join(" "));
  let level = "Research";
  let score = 0;
  const reasons = [];
  if (COMPARISON.test(text)) { level = "Comparing"; reasons.push("Customer is comparing options."); }
  const markers = [
    [facts.vehicle_interest || facts.vehicle_type, 2, "Vehicle interest is known."],
    [facts.budget_monthly_gbp || facts.budget, 1, "Budget is known."],
    [facts.employment_status, 1, "Employment is known."],
    [facts.location, 1, "Location is known."],
    [facts.urgency || /urgent|quickly|asap|tomorrow/.test(combined), 2, "Urgency is present."],
    [facts.credit_concern, 1, "A credit concern is known."],
    [facts.delivery_interest || facts.collection_interest, 1, "Delivery or collection interest is known."],
  ];
  for (const [present, points, reason] of markers) if (present) { score += points; reasons.push(reason); }
  if (/need (?:a |one )?(?:van|vehicle)|interested|want (?:a|this)|quote/.test(combined)) { score += 2; reasons.push("Customer has expressed vehicle or quotation interest."); }
  if (score >= 5) level = "High Intent";
  else if (score >= 2 && level !== "Comparing") level = "Interested";
  const previousAssistant = normaliseCustomerMessage([...messages].reverse().find((item) => item?.role === "assistant")?.content);
  const contextualShortProceed = /^(?:yes|start)$/.test(text) && (["Interested", "High Intent", "Ready To Apply"].includes(priorLevel) || /apply|application|proceed/.test(previousAssistant));
  const explicitApplicationTrigger = APPLICATION_READY.test(text) || contextualShortProceed;
  if (explicitApplicationTrigger) { level = "Ready To Apply"; reasons.push("Customer explicitly asked to proceed or apply."); }
  if (APPLICATION_STARTED.test(text)) { level = "Application Started"; reasons.push("Customer says an application has already started."); }
  if (APPLICATION_COMPLETE.test(text)) { level = "Application Complete"; reasons.push("Customer says an application was submitted or completed."); }
  const currentRank = BUYING_INTENT_LEVELS.indexOf(level);
  const priorRank = BUYING_INTENT_LEVELS.indexOf(priorLevel);
  if (priorRank > currentRank && !["Research", "Comparing"].includes(level)) level = priorLevel;
  return { level, score, confidence: level === "Research" ? 75 : 95, reasons, explicit_application_trigger: explicitApplicationTrigger, application_started_trigger: APPLICATION_STARTED.test(text), application_complete_trigger: APPLICATION_COMPLETE.test(text) };
}

export function determineConversationGoal({ intent = {}, buyingIntent = {}, facts = {} } = {}) {
  if (buyingIntent.level === "Application Complete") return "After application";
  if (buyingIntent.level === "Application Started") return "Complete application";
  if (["Ready To Apply", "High Intent"].includes(buyingIntent.level) && buyingIntent.explicit_application_trigger) return "Proceed to application";
  if (intent.primary_intent === "product_clarification_required" || buyingIntent.level === "Comparing") return "Compare options";
  if ((intent.secondary_intents || []).includes("documents")) return "Understand documents";
  if ((intent.secondary_intents || []).includes("delivery_collection")) return "Arrange delivery";
  if ((intent.secondary_intents || []).some((item) => ["poor_credit", "self_employed", "trading_history", "coverage"].includes(item))) return "Understand eligibility";
  if (facts.vehicle_interest || facts.vehicle_type) return "Choose vehicle";
  return "Research";
}

export function buildApplicationCta(productContext, mode = "start") {
  if (!["finance", "rent2buy"].includes(productContext)) return null;
  const productLabel = productContext === "finance" ? "Finance" : "Rent2Buy";
  return {
    type: "application",
    product: productContext,
    label: `${mode === "continue" ? "Continue" : "Start"} ${productLabel} Application`,
    action_key: `${mode}_${productContext}_application`,
    url: null,
    configured: false,
  };
}

export function chooseNextJourneyQuestion({ buyingIntent = {}, facts = {}, leadCompleteness = {}, goal = "Research" } = {}) {
  if (["Ready To Apply", "Application Started", "Application Complete"].includes(buyingIntent.level)) return "";
  if (goal === "Understand documents" || goal === "Arrange delivery") return "";
  const fields = leadCompleteness.fields || {};
  if ((facts.urgency || buyingIntent.level === "High Intent") && !fields.vehicle?.known) return "Have you already found a van you’d like, or do you need help choosing one?";
  if (fields.budget?.known && !fields.vehicle?.known) return "What type of van are you looking for?";
  if (fields.vehicle?.known && !fields.budget?.known) return "Do you have a monthly budget in mind?";
  if (!fields.employment?.known && (facts.credit_concern || buyingIntent.level === "Interested")) return "Are you employed or self-employed?";
  if (facts.employment_status === "self-employed" && !fields.trading_history?.known) return "How long have you been trading?";
  if (!fields.location?.known && buyingIntent.level === "High Intent") return "Which town or postcode are you based in?";
  return "";
}

export function recommendJourneyCta({ applicationMode = false, applicationState = "not_started", goal = "Research", intent = {}, facts = {} } = {}) {
  if (applicationMode) return applicationState === "started" ? "Show application button" : applicationState === "complete" ? "Continue conversation" : "Show application button";
  if (intent.primary_intent === "human_assistance_requested" || intent.primary_intent === "frustration") return "Escalate to team";
  if (intent.clarification_required) return "Ask one clarification";
  if (goal === "Arrange delivery") return "Show delivery information";
  if (goal === "Understand documents") return "Explain documents";
  if (!facts.vehicle_interest && !facts.vehicle_type && ["Interested", "High Intent"].includes(intent.buying_intent_level)) return "Suggest viewing vehicles";
  return "Continue conversation";
}

export function detectConversationProgress({ buyingIntent, priorLevel = "Research", updatedFacts = {}, message = "", messages = [] } = {}) {
  const currentRank = BUYING_INTENT_LEVELS.indexOf(buyingIntent.level);
  const priorRank = BUYING_INTENT_LEVELS.indexOf(priorLevel);
  const current = normaliseCustomerMessage(message);
  const previousUser = normaliseCustomerMessage([...messages].reverse().find((item) => item?.role === "user")?.content);
  const repeated = Boolean(current && previousUser && current === previousUser);
  const progressing = currentRank > priorRank || Object.keys(updatedFacts).length > 0 || buyingIntent.explicit_application_trigger || buyingIntent.application_started_trigger;
  return { conversation_progressing: progressing, conversation_stalled: repeated || (!progressing && messages.length >= 6), repeated_customer_message: repeated, reason: progressing ? "Intent advanced or a new structured fact was added." : repeated ? "The customer repeated the same message." : "No new journey evidence was added in this turn." };
}

export function detectRepetitiveAssistantWording(messages = [], reply = "") {
  const openings = ["would you like", "can i help", "does that help", "would you like more information"];
  const recent = messages.filter((item) => item?.role === "assistant").slice(-3).map((item) => normaliseCustomerMessage(item.content));
  const proposed = normaliseCustomerMessage(reply);
  const repeated = openings.find((opening) => proposed.startsWith(opening) && recent.some((item) => item.startsWith(opening))) || "";
  return { repeated: Boolean(repeated), phrase: repeated || null };
}

export function removeRepetitiveOpening(messages = [], reply = "") {
  const detected = detectRepetitiveAssistantWording(messages, reply);
  if (!detected.repeated) return { reply, repeated_opening_removed: false, phrase: null };
  const replacements = {
    "would you like": "You can",
    "can i help": "Tell me",
    "does that help": "I can clarify that if needed",
    "would you like more information": "I can give you the next relevant detail",
  };
  return { reply: clean(reply).replace(new RegExp(`^${detected.phrase}`, "i"), replacements[detected.phrase]), repeated_opening_removed: true, phrase: detected.phrase };
}

export function applicationModeReply(productContext, state = "ready") {
  const product = productContext === "finance" ? "Finance" : "Rent2Buy";
  if (state === "started") return `Your ${product} application is already underway. Use the continue application option when it is configured, and ask here if you need help understanding a question.`;
  return `Great. The next step is to start your ${product} application below. Complete it as accurately as you can, and ask if you need help while you’re applying.`;
}

export function buildJourneyState({ message, messages = [], intent = {}, facts = {}, factMetadata = {}, productContext, priorJourney = {}, updatedFacts = {} } = {}) {
  const buyingIntent = assessBuyingIntent({ message, messages, facts, priorLevel: priorJourney.buying_intent_level || "Research" });
  const leadCompleteness = assessLeadCompleteness(facts, factMetadata, productContext);
  const goal = determineConversationGoal({ intent, buyingIntent, facts });
  const applicationState = buyingIntent.level === "Application Complete" ? "complete" : buyingIntent.level === "Application Started" ? "started" : buyingIntent.level === "Ready To Apply" ? "ready" : "not_started";
  const applicationMode = ["ready", "started"].includes(applicationState) && intent.primary_intent !== "product_clarification_required";
  const nextQuestion = chooseNextJourneyQuestion({ buyingIntent, facts, leadCompleteness, goal });
  const progress = detectConversationProgress({ buyingIntent, priorLevel: priorJourney.buying_intent_level || "Research", updatedFacts, message, messages });
  const intentWithJourney = { ...intent, buying_intent_level: buyingIntent.level };
  const recommendedCta = recommendJourneyCta({ applicationMode, applicationState, goal, intent: intentWithJourney, facts });
  return {
    buying_intent_level: buyingIntent.level,
    buying_intent_score: buyingIntent.score,
    buying_intent_confidence: buyingIntent.confidence,
    buying_intent_reasons: buyingIntent.reasons,
    conversation_goal: goal,
    journey_stage: applicationState === "not_started" ? buyingIntent.level : applicationState === "ready" ? "Application ready" : applicationState === "started" ? "Application started" : "Application submitted",
    lead_completeness: leadCompleteness,
    application_readiness: applicationState === "ready" ? "Ready for application CTA" : applicationState === "started" ? "Application already started" : applicationState === "complete" ? "Application submitted" : buyingIntent.level === "High Intent" ? "Potentially ready to apply" : "Exploring",
    application_mode_active: applicationMode,
    application_state: applicationState,
    application_cta: applicationMode ? buildApplicationCta(productContext, applicationState === "started" ? "continue" : "start") : null,
    recommended_cta: recommendedCta,
    next_best_question: nextQuestion,
    ...progress,
  };
}

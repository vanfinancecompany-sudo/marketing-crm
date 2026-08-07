import { normaliseCustomerMessage } from "./conversationIntelligence.js";

const RECOVERY_TYPES = new Set([
  "confusion", "frustration", "humour", "positive_feedback", "agreement", "disagreement",
  "random_text", "unknown_intent", "off_topic", "nonsense_input",
]);

const FACTUAL_TOPICS = Object.freeze([
  ["insurance", /\b(insurance|insured|insure|cover(?:ed|ing)?)\b/],
  ["taxation", /\b(road tax|vehicle tax|taxed|taxation)\b/],
  ["vat_pricing", /(?:^|\b)vat(?:\s+(?:included|inclusive|excluded|exclusive|charged|added)|$)|(?:plus|including|inclusive of|excluding|exclusive of)\s+vat|prices?.{0,20}vat|payments?.{0,20}vat/],
]);

const UK_POSTCODE = /\b(GIR\s?0AA|(?:[A-PR-UWYZ][0-9][0-9A-HJKPSTUW]?|[A-PR-UWYZ][A-HK-Y][0-9][0-9ABEHMNPRV-Y]?)\s?[0-9][ABD-HJLNP-UW-Z]{2})\b/i;
const LOCATION_PROMPT = /\b(?:full home postcode|home postcode|postcode|town|city|where (?:are )?you based|where do you live|where you live|roughly where|cover (?:my|your) area|within \d{2,3} miles|\d{2,3} miles of)\b/i;
const NON_LOCATION_SHORT_REPLY = /^(?:yes(?: please)?|no|nope|ok(?:ay)?|thanks?|thank you|cheers|please|please explain|explain(?: that)?|tell me more|what|why|how|how long|not sure|don'?t know|dont know|hello|hi|finance|rent2buy|rent to buy|apply|application|bad credit|poor credit|credit|insurance|delivery|deliver|collection|collect|deposit|documents?|bank details?|bank statements?|monthly|payment|vat|tax|licen[cs]e|ownership|self employed|limited company|ford transit|transit|sprinter|crafter|van|vehicle)$/i;

const APPLICATION_LEVELS = new Set(["Ready To Apply", "Application Started"]);
const KNOWLEDGE_MESSAGE_TYPES = new Set(["question", "follow_up_question", "objection"]);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function factualTopics(message) {
  const text = normaliseCustomerMessage(message);
  return FACTUAL_TOPICS.filter(([, pattern]) => pattern.test(text)).map(([topic]) => topic);
}

function isBareBusinessStatusStatement(message, human = {}) {
  if (human.message_type !== "objection" || human.objection?.objection !== "business_status") return false;
  const text = normaliseCustomerMessage(message);
  const asksForKnowledge = /\?|\b(?:can|could|do|does|is|are|will|would|should|what|how|why|where|when|apply|eligible|accepted|chance|problem|issue)\b/.test(text);
  return !asksForKnowledge;
}

function clarificationRequestsKnowledge(message, intent = {}) {
  if (intent.retrieval_required !== true) return false;
  const text = normaliseCustomerMessage(message);
  return /\?|\b(?:what|why|how|can|could|do|does|is|are|will|would|should|explain|tell me|show me|describe|outline|go through|walk me through|help me understand)\b/.test(text);
}

function priorApplicationActive(priorJourney = {}) {
  return Boolean(priorJourney.application_mode_active || APPLICATION_LEVELS.has(priorJourney.buying_intent_level));
}

function applyContextualAnchor(intent = {}, human = {}, message = "") {
  if (!human.contextual_anchor) return false;
  intent.normalised_message = normaliseCustomerMessage(`${human.contextual_anchor} ${message}`);
  if (human.contextual_requires_knowledge) {
    intent.retrieval_required = true;
    intent.clarification_required = false;
    intent.suggested_clarification_question = "";
    if (["incomplete_business_question", "general_help_request"].includes(intent.primary_intent)) intent.primary_intent = "knowledge_question";
  }
  return true;
}

function isBarePlaceCandidate(message) {
  const text = String(message || "").trim().replace(/[.,;:!]+$/g, "");
  if (!text || text.includes("?") || NON_LOCATION_SHORT_REPLY.test(text)) return false;
  const parts = text.split(/\s+/).filter(Boolean);
  return parts.length >= 1 && parts.length <= 4 && parts.every((part) => /^[A-Za-z][A-Za-z'’-]*$/.test(part));
}

function applyRent2BuyLocationRule(intent = {}, human = {}, message = "") {
  if (intent.product_context !== "rent2buy") return false;
  const text = String(message || "").trim();
  const fullPostcode = UK_POSTCODE.test(text);
  const previousAssistant = String(human.previous_assistant_message || "");
  const assistantAskedForLocation = LOCATION_PROMPT.test(previousAssistant);
  const recoveryPlaceCandidate = Boolean(human.recovery_required)
    && ["unknown_intent", "random_text", "clarification"].includes(human.message_type)
    && isBarePlaceCandidate(text);
  const locationTurn = fullPostcode || (isBarePlaceCandidate(text) && assistantAskedForLocation) || recoveryPlaceCandidate;
  if (!locationTurn) return false;
  intent.retrieval_required = true;
  intent.clarification_required = false;
  intent.suggested_clarification_question = "";
  intent.secondary_intents = unique([...(intent.secondary_intents || []), "coverage"]);
  if (["incomplete_business_question", "general_help_request"].includes(intent.primary_intent)) intent.primary_intent = "knowledge_question";
  return true;
}

export function orchestrateConversationTurn({
  message,
  intent = {},
  human = {},
  journey = {},
  priorJourney = {},
  buyingSignals = {},
} = {}) {
  const contextualTurn = applyContextualAnchor(intent, human, message);
  const rent2BuyLocationTurn = applyRent2BuyLocationRule(intent, human, message);
  const topics = factualTopics(message);
  const productBoundaryBlocked = intent.primary_intent === "product_clarification_required";
  const recoveryCandidate = Boolean(human.recovery_required || RECOVERY_TYPES.has(human.message_type));
  const explicitKnowledgeTopic = topics.length > 0;
  const contextualKnowledge = Boolean(contextualTurn && human.contextual_requires_knowledge);
  const knowledgeMessage = (KNOWLEDGE_MESSAGE_TYPES.has(human.message_type) || (human.message_type === "clarification" && clarificationRequestsKnowledge(message, intent)))
    && !(human.message_type === "objection" && human.objection?.objection === "uncertainty")
    && !isBareBusinessStatusStatement(message, human);
  const businessKnowledgeIntent = !productBoundaryBlocked && (
    explicitKnowledgeTopic ||
    contextualKnowledge ||
    rent2BuyLocationTurn ||
    (Boolean(intent.retrieval_required) && knowledgeMessage && !recoveryCandidate)
  );
  const applicationReady = Boolean(
    journey.application_mode_active ||
    priorApplicationActive(priorJourney) ||
    APPLICATION_LEVELS.has(journey.buying_intent_level)
  );
  const applicationContinuation = priorApplicationActive(priorJourney) && human.message_type === "agreement" && !businessKnowledgeIntent;
  const detectedIntents = unique([
    ...(intent.secondary_intents || []),
    ...topics,
    contextualTurn ? "contextual_turn" : "",
    contextualKnowledge ? "contextual_knowledge_continuation" : "",
    rent2BuyLocationTurn ? "rent2buy_location" : "",
    businessKnowledgeIntent ? "business_knowledge" : "",
    buyingSignals.detected_buying_signal && buyingSignals.detected_buying_signal !== "none" ? "buying_signal" : "",
    applicationReady ? "application_ready" : "",
    recoveryCandidate && !businessKnowledgeIntent && !contextualTurn ? "conversation_recovery" : "",
  ]);
  const retrievalRequired = businessKnowledgeIntent;
  const recoveryRequired = recoveryCandidate && !retrievalRequired && !productBoundaryBlocked && !applicationContinuation && !contextualTurn;
  const conversationPaused = retrievalRequired && applicationReady;
  const priorityPath = [
    "safety",
    "product_separation",
    ...(retrievalRequired ? ["verified_business_knowledge"] : []),
    ...(recoveryRequired ? ["conversation_recovery"] : []),
    ...(!retrievalRequired && !recoveryRequired ? ["sales_progression"] : []),
    ...(applicationReady ? ["application_guidance"] : []),
  ];

  return {
    detected_intents: detectedIntents,
    factual_topics: topics,
    retrieval_required: retrievalRequired,
    recovery_required: recoveryRequired,
    product_boundary_blocked: productBoundaryBlocked,
    conversation_paused: conversationPaused,
    conversation_resumed: false,
    resume_reason: conversationPaused ? "Verified business knowledge temporarily paused the existing application journey." : "",
    journey_stage_before_retrieval: priorJourney.journey_stage || journey.journey_stage || "Research",
    journey_stage_after_retrieval: journey.journey_stage || priorJourney.journey_stage || "Research",
    application_mode_paused: conversationPaused,
    application_mode_resumed: false,
    application_continuation: applicationContinuation,
    contextual_turn: contextualTurn,
    contextual_anchor_used: contextualTurn ? human.contextual_anchor : "",
    rent2buy_location_turn: rent2BuyLocationTurn,
    priority_path_taken: priorityPath,
  };
}

export function preserveJourneyAcrossOrchestration(journey = {}, priorJourney = {}, orchestration = {}) {
  const preserveApplication = orchestration.conversation_paused || orchestration.application_continuation || orchestration.recovery_required || orchestration.product_boundary_blocked;
  if (!preserveApplication || !priorApplicationActive(priorJourney)) return journey;
  return {
    ...journey,
    buying_intent_level: priorJourney.buying_intent_level,
    buying_intent_score: Math.max(Number(journey.buying_intent_score) || 0, Number(priorJourney.buying_intent_score) || 0),
    buying_intent_confidence: priorJourney.buying_intent_confidence ?? journey.buying_intent_confidence,
    buying_intent_reasons: unique([...(priorJourney.buying_intent_reasons || []), ...(journey.buying_intent_reasons || [])]),
    conversation_goal: priorJourney.conversation_goal || journey.conversation_goal,
    journey_stage: priorJourney.journey_stage || journey.journey_stage,
    application_readiness: priorJourney.application_readiness || journey.application_readiness,
    application_mode_active: true,
    application_state: priorJourney.application_state || journey.application_state || "ready",
    application_cta: priorJourney.application_cta || journey.application_cta,
    recommended_cta: priorJourney.recommended_cta || journey.recommended_cta,
    next_best_question: "",
  };
}

export function completeKnowledgeOrchestration(orchestration = {}, { retrievalPerformed = false, journey = {}, sourceIds = [] } = {}) {
  const resumed = Boolean(orchestration.conversation_paused);
  return {
    ...orchestration,
    retrieval_performed: Boolean(retrievalPerformed),
    knowledge_source_ids: unique(sourceIds),
    conversation_resumed: resumed,
    application_mode_resumed: resumed && Boolean(journey.application_mode_active),
    journey_stage_after_retrieval: journey.journey_stage || orchestration.journey_stage_after_retrieval,
    resume_reason: resumed
      ? retrievalPerformed
        ? "The factual answer was completed and the paused application journey resumed without restarting discovery."
        : "No approved answer was found; the safe knowledge-gap response completed and the paused application journey resumed."
      : orchestration.resume_reason,
  };
}

export function appendJourneyResume(reply, productContext, orchestration = {}) {
  const text = String(reply || "").trim();
  if (!orchestration.application_mode_resumed) return text;
  const product = productContext === "rent2buy" ? "Rent2Buy" : "Finance";
  const suffix = `When you’re ready, you can continue with your ${product} application below.`;
  return text.toLowerCase().includes("continue with your") ? text : `${text}\n\n${suffix}`;
}

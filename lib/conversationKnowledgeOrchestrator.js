import { normaliseCustomerMessage } from "./conversationIntelligence.js";
import { detectRent2BuyLocationInput } from "./rent2buyLocationInput.js";

const RECOVERY_TYPES = new Set([
  "confusion", "frustration", "humour", "positive_feedback", "agreement", "disagreement", "goodbye",
  "random_text", "unknown_intent", "off_topic", "nonsense_input",
]);
const LOCATION_BLOCKED_MESSAGE_TYPES = new Set(["agreement", "positive_feedback", "goodbye", "humour", "confusion", "frustration", "disagreement"]);

const FACTUAL_TOPICS = Object.freeze([
  ["insurance", /\b(insurance|insured|insure|cover(?:ed|ing)?)\b/],
  ["taxation", /\b(road tax|vehicle tax|taxed|taxation)\b/],
  ["vat_pricing", /(?:^|\b)vat(?:\s+(?:included|inclusive|excluded|exclusive|charged|added)|$)|(?:plus|including|inclusive of|excluding|exclusive of)\s+vat|prices?.{0,20}vat|payments?.{0,20}vat/],
]);

const APPLICATION_LEVELS = new Set(["Ready To Apply", "Application Started"]);
const KNOWLEDGE_MESSAGE_TYPES = new Set(["question", "follow_up_question", "objection"]);
const CHOICE_WITHOUT_QUESTION = /\b(?:whether|either|choose|pick|select|tell me (?:which|whether)|let me know (?:which|whether))\b/i;
const SHORT_REPLY_QUESTION = /\b(?:what|when|where|why|who|how|can|could|do|does|did|is|are|will|would|should)\b/i;
const CONTEXTUAL_KNOWLEDGE = /\b(?:documents?|paperwork|bank statements?|proof|requirements?|application|finance|rent2buy|rent 2 buy|deposit|monthly|payment|credit|delivery|insurance|tax|vat|eligib|lender)\b/i;
const NON_CHOICE_PROGRESSION = /\b(?:ready|apply|application|continue|carry on|resume|proceed|start|go ahead|useful|helpful|thanks?|thank you|speak soon|goodbye|bye)\b/i;

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function wordCount(value) {
  return String(value || "").trim().split(/\s+/).filter(Boolean).length;
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

function inferredShortChoiceAnchor(human = {}, message = "") {
  const previous = String(human.previous_assistant_message || "").trim();
  const prior = normaliseCustomerMessage(previous);
  const current = normaliseCustomerMessage(message);
  if (!previous || !current || wordCount(current) > 5 || SHORT_REPLY_QUESTION.test(current) || NON_CHOICE_PROGRESSION.test(current) || !/[a-z0-9]/i.test(current)) return "";
  const explicitChoice = (previous.includes("?") && /\bor\b/i.test(prior))
    || (CHOICE_WITHOUT_QUESTION.test(prior) && /\bor\b/i.test(prior));
  return explicitChoice ? previous : "";
}

function applyConversationControl(intent = {}, message = "") {
  const text = normaliseCustomerMessage(message);
  if (/^(?:can you )?switch(?: products?)?$/.test(text)) {
    intent.primary_intent = "product_clarification_required";
    intent.retrieval_required = false;
    intent.clarification_required = true;
    intent.suggested_clarification_question = `This conversation stays with ${intent.product_context === "finance" ? "van finance" : "Rent2Buy"}. What would you like to know about that option?`;
    intent.reason = "The customer asked to switch products, but the active product context remains locked.";
    return "product_switch";
  }
  if (/^(?:can you )?help me narrow it down\??$/.test(text) || /^help me narrow it down\??$/.test(text)) {
    intent.primary_intent = "general_help_request";
    intent.retrieval_required = false;
    intent.clarification_required = false;
    intent.suggested_clarification_question = "";
    intent.reason = "The customer wants conversational help narrowing a vehicle choice, not a factual knowledge lookup.";
    return "narrow_choice";
  }
  return "";
}

function applyContextualAnchor(intent = {}, human = {}, message = "") {
  const current = normaliseCustomerMessage(message);
  if (intent.retrieval_required === false && /^(?:not\s+)?vat registered$/.test(current)) return false;
  const inferredAnchor = inferredShortChoiceAnchor(human, message);
  const anchor = String(human.contextual_anchor || inferredAnchor || "").trim();
  if (!anchor) return false;
  const requiresKnowledge = Boolean(
    human.contextual_requires_knowledge
      || (inferredAnchor && CONTEXTUAL_KNOWLEDGE.test(normaliseCustomerMessage(anchor))),
  );
  human.contextual_anchor = anchor;
  human.contextual_requires_knowledge = requiresKnowledge;
  intent.normalised_message = normaliseCustomerMessage(`${anchor} ${message}`);
  if (requiresKnowledge) {
    intent.retrieval_required = true;
    intent.clarification_required = false;
    intent.suggested_clarification_question = "";
    if (["incomplete_business_question", "general_help_request"].includes(intent.primary_intent)) intent.primary_intent = "knowledge_question";
  }
  return true;
}

function applyRent2BuyLocationRule(intent = {}, human = {}, message = "") {
  if (intent.product_context !== "rent2buy" || LOCATION_BLOCKED_MESSAGE_TYPES.has(human.message_type)) return false;
  const location = detectRent2BuyLocationInput(message, String(human.previous_assistant_message || ""));
  if (!location) return false;
  intent.retrieval_required = true;
  intent.clarification_required = false;
  intent.suggested_clarification_question = "";
  intent.secondary_intents = unique((intent.secondary_intents || []).filter((item) => item !== "coverage"));
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
  const conversationControl = applyConversationControl(intent, message);
  const contextualTurn = conversationControl ? false : applyContextualAnchor(intent, human, message);
  const rent2BuyLocationTurn = conversationControl ? false : applyRent2BuyLocationRule(intent, human, message);
  const topics = factualTopics(message);
  const productBoundaryBlocked = intent.primary_intent === "product_clarification_required";
  const explicitKnowledgeTopic = topics.length > 0;
  const contextualKnowledge = Boolean(contextualTurn && human.contextual_requires_knowledge);
  const answeredAssistantQuestion = Boolean(human.short_answer_to_question && !contextualKnowledge);
  const recoveryCandidate = Boolean(human.recovery_required || RECOVERY_TYPES.has(human.message_type) || answeredAssistantQuestion);
  const knowledgeMessage = (KNOWLEDGE_MESSAGE_TYPES.has(human.message_type) || (human.message_type === "clarification" && clarificationRequestsKnowledge(message, intent)))
    && !(human.message_type === "objection" && human.objection?.objection === "uncertainty")
    && !(contextualTurn && !contextualKnowledge)
    && !isBareBusinessStatusStatement(message, human);
  const businessKnowledgeIntent = !productBoundaryBlocked && !conversationControl && (
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
    conversationControl,
    contextualTurn ? "contextual_turn" : "",
    contextualKnowledge ? "contextual_knowledge_continuation" : "",
    answeredAssistantQuestion ? "answer_to_assistant_question" : "",
    rent2BuyLocationTurn ? "coverage" : "",
    rent2BuyLocationTurn ? "rent2buy_location" : "",
    businessKnowledgeIntent ? "business_knowledge" : "",
    buyingSignals.detected_buying_signal && buyingSignals.detected_buying_signal !== "none" ? "buying_signal" : "",
    applicationReady ? "application_ready" : "",
    recoveryCandidate && !businessKnowledgeIntent && (!contextualTurn || answeredAssistantQuestion) && !conversationControl ? "conversation_recovery" : "",
  ]);
  const retrievalRequired = businessKnowledgeIntent;
  const recoveryRequired = recoveryCandidate && !retrievalRequired && !productBoundaryBlocked && !applicationContinuation && (!contextualTurn || answeredAssistantQuestion) && !conversationControl;
  const conversationPaused = retrievalRequired && applicationReady;
  const priorityPath = [
    "safety",
    "product_separation",
    ...(conversationControl ? ["conversation_control"] : []),
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
    answered_assistant_question: answeredAssistantQuestion,
    rent2buy_location_turn: rent2BuyLocationTurn,
    conversation_control: conversationControl || null,
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
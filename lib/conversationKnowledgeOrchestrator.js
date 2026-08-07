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

const APPLICATION_LEVELS = new Set(["Ready To Apply", "Application Started"]);
const KNOWLEDGE_MESSAGE_TYPES = new Set(["question", "follow_up_question", "objection", "clarification", "contextual_acceptance", "contextual_answer"]);
const CONTEXTUAL_TYPES = new Set(["contextual_acceptance", "contextual_answer"]);

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

function priorApplicationActive(priorJourney = {}) {
  return Boolean(priorJourney.application_mode_active || APPLICATION_LEVELS.has(priorJourney.buying_intent_level));
}

function applyContextualAnchor(intent = {}, human = {}, message = "") {
  if (!CONTEXTUAL_TYPES.has(human.message_type) || !human.contextual_anchor) return false;
  intent.normalised_message = normaliseCustomerMessage(`${human.contextual_anchor} ${message}`);
  if (human.contextual_requires_knowledge) {
    intent.retrieval_required = true;
    intent.clarification_required = false;
    intent.suggested_clarification_question = "";
    if (["incomplete_business_question", "general_help_request"].includes(intent.primary_intent)) intent.primary_intent = "knowledge_question";
  }
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
  const topics = factualTopics(message);
  const productBoundaryBlocked = intent.primary_intent === "product_clarification_required";
  const recoveryCandidate = Boolean(human.recovery_required || RECOVERY_TYPES.has(human.message_type));
  const explicitKnowledgeTopic = topics.length > 0;
  const contextualKnowledge = Boolean(contextualTurn && human.contextual_requires_knowledge);
  const knowledgeMessage = KNOWLEDGE_MESSAGE_TYPES.has(human.message_type) && !(human.message_type === "objection" && human.objection?.objection === "uncertainty") && !isBareBusinessStatusStatement(message, human);
  const businessKnowledgeIntent = !productBoundaryBlocked && (
    explicitKnowledgeTopic ||
    contextualKnowledge ||
    (Boolean(intent.retrieval_required) && knowledgeMessage && (!recoveryCandidate || contextualTurn))
  );
  const applicationReady = Boolean(
    journey.application_mode_active ||
    priorApplicationActive(priorJourney) ||
    APPLICATION_LEVELS.has(journey.buying_intent_level)
  );
  const conversationalAgreement = ["agreement", "contextual_acceptance"].includes(human.message_type);
  const applicationContinuation = priorApplicationActive(priorJourney) && conversationalAgreement && !businessKnowledgeIntent;
  const detectedIntents = unique([
    ...(intent.secondary_intents || []),
    ...topics,
    contextualTurn ? "contextual_turn" : "",
    contextualKnowledge ? "contextual_knowledge_continuation" : "",
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

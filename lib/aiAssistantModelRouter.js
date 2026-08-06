const SIMPLE_CONVERSATION_INTENTS = new Set([
  "greeting",
  "thanks",
  "goodbye",
  "general_help_request",
]);

const HIGH_ACCURACY_INTENTS = new Set([
  "knowledge_question",
  "multi_part_question",
  "topic_change",
  "customer_correction",
  "incomplete_business_question",
  "product_clarification_required",
  "ready_to_apply",
  "human_assistance_requested",
]);

const IMPORTANT_SUB_INTENTS = new Set([
  "vat_pricing",
  "coverage",
  "deposit",
  "documents",
  "ownership",
  "monthly_cost",
  "poor_credit",
  "self_employed",
  "trading_history",
  "application",
  "delivery_collection",
  "business_use",
  "multiple_vehicles",
]);

export const ASSISTANT_MODEL_POLICY = Object.freeze({
  mini: "gpt-5-mini",
  full: "gpt-5.1",
  temperature: 0.2,
});

function clean(value) {
  return String(value || "").trim();
}

function includesImportantTopic(intent = {}, orchestration = {}) {
  return [
    ...(Array.isArray(intent.secondary_intents) ? intent.secondary_intents : []),
    ...(Array.isArray(orchestration.factual_topics) ? orchestration.factual_topics : []),
  ].some((topic) => IMPORTANT_SUB_INTENTS.has(topic));
}

function asksForExplanation(message) {
  return /\b(why|how|explain|compare|difference|what happens|what do i need|can you clarify|help me understand)\b/i.test(clean(message));
}

function looksMultiStep(message) {
  const text = clean(message);
  const questionMarks = (text.match(/\?/g) || []).length;
  return questionMarks > 1 || /\b(and|also|then|after that|as well as|step by step)\b/i.test(text);
}

export function chooseAssistantModel({
  message,
  intent = {},
  human = {},
  orchestration = {},
  sourceCount = 0,
} = {}) {
  const primaryIntent = clean(intent.primary_intent);
  const lowConfidence = Boolean(
    human.low_confidence ||
    human.confidence_below_threshold ||
    Number(human.confidence || 100) < 75 ||
    Number(intent.confidence || 100) < 75
  );
  const retrievalRequired = Boolean(intent.retrieval_required || orchestration.retrieval_required || sourceCount > 0);
  const ambiguous = Boolean(intent.clarification_required || orchestration.recovery_required || lowConfidence);
  const important = includesImportantTopic(intent, orchestration);
  const complex = HIGH_ACCURACY_INTENTS.has(primaryIntent) || asksForExplanation(message) || looksMultiStep(message);
  const simple = SIMPLE_CONVERSATION_INTENTS.has(primaryIntent)
    && !retrievalRequired
    && !ambiguous
    && !important
    && !complex;

  if (simple) {
    return {
      model: ASSISTANT_MODEL_POLICY.mini,
      tier: "mini",
      temperature: ASSISTANT_MODEL_POLICY.temperature,
      reasoning_effort: null,
      reason: "A greeting, acknowledgement or harmless simple turn does not require business-fact reasoning.",
    };
  }

  const reasoningEffort = ambiguous || looksMultiStep(message) || primaryIntent === "multi_part_question"
    ? "medium"
    : "low";

  return {
    model: ASSISTANT_MODEL_POLICY.full,
    tier: "full",
    temperature: ASSISTANT_MODEL_POLICY.temperature,
    reasoning_effort: reasoningEffort,
    reason: retrievalRequired
      ? "A factual or evidence-backed customer question requires the strongest configured assistant model."
      : ambiguous
        ? "Uncertain or ambiguous turns default to the stronger model."
        : important
          ? "The subject may materially affect a customer decision, so accuracy is prioritised."
          : complex
            ? "The turn needs contextual, explanatory or multi-step reasoning."
            : "The routing policy defaults to the stronger model whenever the simple-turn criteria are not fully satisfied.",
  };
}

export function buildAssistantResponseModelParameters(route = {}) {
  const model = clean(route.model) || ASSISTANT_MODEL_POLICY.full;
  const parameters = {
    model,
    temperature: Number.isFinite(Number(route.temperature))
      ? Number(route.temperature)
      : ASSISTANT_MODEL_POLICY.temperature,
  };
  if (model === ASSISTANT_MODEL_POLICY.full && route.reasoning_effort) {
    parameters.reasoning = { effort: route.reasoning_effort };
  }
  return parameters;
}

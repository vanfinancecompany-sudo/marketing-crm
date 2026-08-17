const SIMPLE_CONVERSATION_INTENTS = new Set([
  "greeting",
  "thanks",
  "goodbye",
  "general_help_request",
]);

const HIGH_ACCURACY_INTENTS = new Set([
  "multi_part_question",
  "topic_change",
  "customer_correction",
  "incomplete_business_question",
  "product_clarification_required",
  "ready_to_apply",
  "human_assistance_requested",
]);

const HIGH_ACCURACY_SUB_INTENTS = new Set([
  "coverage",
  "deposit",
  "monthly_cost",
  "poor_credit",
  "self_employed",
  "trading_history",
  "application",
  "multiple_vehicles",
]);

const SAFE_LOOKUP_SUB_INTENTS = new Set([
  "vat_pricing",
  "documents",
  "ownership",
  "delivery_collection",
  "business_use",
]);

export const ASSISTANT_MODEL_POLICY = Object.freeze({
  mini: "gpt-5-mini",
  full: "gpt-5.1",
  temperature: 0.2,
});

function clean(value) {
  return String(value || "").trim();
}

function topicLabels(intent = {}, orchestration = {}) {
  return [
    ...(Array.isArray(intent.secondary_intents) ? intent.secondary_intents : []),
    ...(Array.isArray(orchestration.factual_topics) ? orchestration.factual_topics : []),
  ].map(clean).filter(Boolean);
}

function includesHighAccuracyTopic(intent = {}, orchestration = {}) {
  return topicLabels(intent, orchestration).some((topic) => HIGH_ACCURACY_SUB_INTENTS.has(topic));
}

function includesSafeLookupTopic(intent = {}, orchestration = {}) {
  return topicLabels(intent, orchestration).some((topic) => SAFE_LOOKUP_SUB_INTENTS.has(topic));
}

function asksForExplanation(message) {
  return /\b(why|how|explain|compare|difference|what happens|what do i need|can you clarify|help me understand)\b/i.test(clean(message));
}

function looksMultiStep(message) {
  const text = clean(message);
  const questionMarks = (text.match(/\?/g) || []).length;
  return questionMarks > 1 || /\b(and|also|then|after that|as well as|step by step)\b/i.test(text);
}

function supportsTemperature(model) {
  // GPT-5 reasoning-family Responses API calls reject the temperature parameter.
  // Keep the accuracy-first model choice and use the model's supported defaults.
  return !/^gpt-5(?:[.\-]|$)/i.test(clean(model));
}

export function chooseAssistantModel({
  message,
  intent = {},
  human = {},
  orchestration = {},
  sourceCount = 0,
} = {}) {
  const primaryIntent = clean(intent.primary_intent);
  const humanConfidence = Number(human.confidence ?? 100);
  const intentConfidence = Number(intent.confidence ?? 100);
  const lowConfidence = Boolean(
    human.low_confidence ||
    human.confidence_below_threshold ||
    humanConfidence < 75 ||
    intentConfidence < 75
  );
  const highConfidence = !lowConfidence && humanConfidence >= 90 && intentConfidence >= 90;
  const retrievalRequired = Boolean(intent.retrieval_required || orchestration.retrieval_required || sourceCount > 0);
  const ambiguous = Boolean(intent.clarification_required || orchestration.recovery_required || lowConfidence);
  const highAccuracyTopic = includesHighAccuracyTopic(intent, orchestration);
  const safeLookupTopic = includesSafeLookupTopic(intent, orchestration);
  const explanatory = asksForExplanation(message);
  const multiStep = looksMultiStep(message);
  const complex = HIGH_ACCURACY_INTENTS.has(primaryIntent) || explanatory || multiStep;
  const simple = SIMPLE_CONVERSATION_INTENTS.has(primaryIntent)
    && !retrievalRequired
    && !ambiguous
    && !highAccuracyTopic
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

  const safeEvidenceLookup = primaryIntent === "knowledge_question"
    && retrievalRequired
    && sourceCount > 0
    && highConfidence
    && safeLookupTopic
    && !highAccuracyTopic
    && !ambiguous
    && !explanatory
    && !multiStep;

  if (safeEvidenceLookup) {
    return {
      model: ASSISTANT_MODEL_POLICY.mini,
      tier: "mini",
      temperature: ASSISTANT_MODEL_POLICY.temperature,
      reasoning_effort: null,
      reason: "A high-confidence single-fact lookup has approved retrieval evidence and is safe for the lower-cost model.",
    };
  }

  const reasoningEffort = ambiguous || multiStep || primaryIntent === "multi_part_question"
    ? "medium"
    : "low";

  return {
    model: ASSISTANT_MODEL_POLICY.full,
    tier: "full",
    temperature: ASSISTANT_MODEL_POLICY.temperature,
    reasoning_effort: reasoningEffort,
    reason: retrievalRequired
      ? highAccuracyTopic
        ? "The subject may materially affect a customer decision, so the stronger model is retained."
        : "This evidence-backed turn does not meet every safe-lookup criterion, so accuracy is prioritised."
      : ambiguous
        ? "Uncertain or ambiguous turns default to the stronger model."
        : complex
          ? "The turn needs contextual, explanatory or multi-step reasoning."
          : "The routing policy defaults to the stronger model whenever the lower-cost criteria are not fully satisfied.",
  };
}

export function buildAssistantResponseModelParameters(route = {}) {
  const model = clean(route.model) || ASSISTANT_MODEL_POLICY.full;
  const parameters = { model };

  if (supportsTemperature(model)) {
    parameters.temperature = Number.isFinite(Number(route.temperature))
      ? Number(route.temperature)
      : ASSISTANT_MODEL_POLICY.temperature;
  }

  if (model === ASSISTANT_MODEL_POLICY.full && route.reasoning_effort) {
    parameters.reasoning = { effort: route.reasoning_effort };
  }
  return parameters;
}

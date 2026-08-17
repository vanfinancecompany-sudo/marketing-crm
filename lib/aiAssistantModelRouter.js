const SIMPLE_CONVERSATION_INTENTS = new Set([
  "greeting",
  "thanks",
  "goodbye",
  "general_help_request",
]);

export const ASSISTANT_MODEL_POLICY = Object.freeze({
  mini: "gpt-5-mini",
  full: "gpt-5.1",
  temperature: 0.2,
});

function clean(value) {
  return String(value || "").trim();
}

function looksMultiStep(message) {
  const text = clean(message);
  const questionMarks = (text.match(/\?/g) || []).length;
  return questionMarks > 1 || /\b(and|also|then|after that|as well as|step by step)\b/i.test(text);
}

function supportsTemperature(model) {
  // GPT-5 reasoning-family Responses API calls reject the temperature parameter.
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
  const retrievalRequired = Boolean(intent.retrieval_required || orchestration.retrieval_required || sourceCount > 0);
  const ambiguous = Boolean(intent.clarification_required || orchestration.recovery_required || lowConfidence);
  const multiStep = looksMultiStep(message) || primaryIntent === "multi_part_question";
  const simple = SIMPLE_CONVERSATION_INTENTS.has(primaryIntent)
    && !retrievalRequired
    && !ambiguous
    && !multiStep;

  if (simple) {
    return {
      model: ASSISTANT_MODEL_POLICY.mini,
      tier: "mini",
      temperature: ASSISTANT_MODEL_POLICY.temperature,
      reasoning_effort: null,
      reason: "A greeting, acknowledgement or harmless simple turn does not require business-fact reasoning.",
    };
  }

  const reasoningEffort = ambiguous || multiStep ? "medium" : "low";

  return {
    model: ASSISTANT_MODEL_POLICY.full,
    tier: "full",
    temperature: ASSISTANT_MODEL_POLICY.temperature,
    reasoning_effort: reasoningEffort,
    reason: retrievalRequired
      ? "Quality-first routing keeps evidence-backed business questions on the strongest configured assistant model."
      : ambiguous
        ? "Uncertain or ambiguous turns use the stronger model."
        : multiStep
          ? "Multi-step turns use the stronger model with additional reasoning."
          : "The assistant defaults to the stronger model unless the turn is purely conversational and harmless.",
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

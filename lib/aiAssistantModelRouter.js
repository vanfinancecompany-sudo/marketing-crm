import { resolvePriorityAiModels } from "./priorityAiModelPolicy.js";

const SIMPLE_CONVERSATION_INTENTS = new Set([
  "greeting",
  "thanks",
  "goodbye",
  "general_help_request",
]);

const DEFAULT_MODELS = resolvePriorityAiModels({});

export const ASSISTANT_MODEL_POLICY = Object.freeze({
  mini: DEFAULT_MODELS.wix_fast,
  full: DEFAULT_MODELS.wix_main,
  escalation: DEFAULT_MODELS.wix_escalation,
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

function isGpt5Family(model) {
  return /^gpt-5(?:[.\-]|$)/i.test(clean(model));
}

function supportsTemperature(model) {
  return !isGpt5Family(model);
}

export function chooseAssistantModel({
  message,
  intent = {},
  human = {},
  orchestration = {},
  sourceCount = 0,
  environment = process.env,
} = {}) {
  const configuredModels = resolvePriorityAiModels(environment);
  const primaryIntent = clean(intent.primary_intent);
  const humanConfidence = Number(human.confidence ?? 100);
  const intentConfidence = Number(intent.confidence ?? 100);
  const lowConfidence = Boolean(
    human.low_confidence ||
    human.confidence_below_threshold ||
    humanConfidence < 75 ||
    intentConfidence < 75
  );
  const retrievalRequired = Boolean(
    intent.retrieval_required || orchestration.retrieval_required || sourceCount > 0
  );
  const ambiguous = Boolean(
    intent.clarification_required || orchestration.recovery_required || lowConfidence
  );
  const multiStep = looksMultiStep(message) || primaryIntent === "multi_part_question";
  const simple =
    SIMPLE_CONVERSATION_INTENTS.has(primaryIntent) &&
    !retrievalRequired &&
    !ambiguous &&
    !multiStep;

  if (simple) {
    return {
      model: configuredModels.wix_fast,
      tier: "mini",
      temperature: ASSISTANT_MODEL_POLICY.temperature,
      reasoning_effort: null,
      reason:
        "A greeting, acknowledgement or harmless simple turn does not require business-fact reasoning.",
    };
  }

  const reasoningEffort = ambiguous || multiStep ? "medium" : "low";
  const escalationRequired = ambiguous || multiStep;
  const model = escalationRequired
    ? configuredModels.wix_escalation
    : configuredModels.wix_main;

  return {
    model,
    tier: "full",
    temperature: ASSISTANT_MODEL_POLICY.temperature,
    reasoning_effort: reasoningEffort,
    reason: retrievalRequired
      ? "Evidence-backed business questions use the quality-first main model with grounded CRM knowledge."
      : ambiguous
        ? "Uncertain or ambiguous turns use the escalation model."
        : multiStep
          ? "Multi-step turns use the escalation model with additional reasoning."
          : "The assistant defaults to the quality-first main model unless the turn is purely conversational and harmless.",
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

  if (isGpt5Family(model) && route.reasoning_effort) {
    parameters.reasoning = { effort: route.reasoning_effort };
  }
  return parameters;
}

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
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const explicitSequence = /\b(step by step|first.+then|compare.+(?:and|with)|as well as|and also|after that)\b/i.test(text);
  return questionMarks > 1 || (wordCount >= 18 && explicitSequence);
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

  const hardAmbiguity = Boolean(
    ambiguous &&
    intent.clarification_required &&
    orchestration.recovery_required &&
    retrievalRequired &&
    lowConfidence
  );
  const escalationRequired = multiStep || hardAmbiguity;
  const reasoningEffort = escalationRequired || ambiguous ? "medium" : "low";
  const model = escalationRequired
    ? configuredModels.wix_escalation
    : configuredModels.wix_main;

  return {
    model,
    tier: "full",
    temperature: ASSISTANT_MODEL_POLICY.temperature,
    reasoning_effort: reasoningEffort,
    reason: escalationRequired
      ? multiStep
        ? "Genuinely multi-part turns use the escalation model with additional reasoning."
        : "A low-confidence grounded turn that also needs recovery and clarification uses the escalation model."
      : ambiguous
        ? "Ordinary ambiguity stays on the main model and asks for clarification instead of escalating automatically."
        : retrievalRequired
          ? "Evidence-backed business questions use the quality-first main model with grounded CRM knowledge."
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

const clean = (value, max = 200) => String(value || "").trim().slice(0, max);

export const PRIORITY_AI_MODEL_DEFAULTS = Object.freeze({
  wix_fast: "gpt-5.6-terra",
  wix_main: "gpt-5.6-sol",
  wix_escalation: "gpt-5.6-sol",
  knowledge: "gpt-5.6-sol",
  knowledge_review: "gpt-5.6-sol",
});

export function resolvePriorityAiModels(environment = process.env) {
  const knowledgeModel =
    clean(environment.OPENAI_KNOWLEDGE_MODEL) || PRIORITY_AI_MODEL_DEFAULTS.knowledge;

  return {
    wix_fast:
      clean(environment.OPENAI_WIX_FAST_MODEL) || PRIORITY_AI_MODEL_DEFAULTS.wix_fast,
    wix_main:
      clean(environment.OPENAI_WIX_MAIN_MODEL) || PRIORITY_AI_MODEL_DEFAULTS.wix_main,
    wix_escalation:
      clean(environment.OPENAI_WIX_ESCALATION_MODEL) ||
      PRIORITY_AI_MODEL_DEFAULTS.wix_escalation,
    knowledge: knowledgeModel,
    knowledge_review:
      clean(environment.OPENAI_KNOWLEDGE_REVIEW_MODEL) ||
      knowledgeModel ||
      PRIORITY_AI_MODEL_DEFAULTS.knowledge_review,
  };
}

export function applyKnowledgeModelOverride(environment = process.env, mode = "generation") {
  const models = resolvePriorityAiModels(environment);
  const model = mode === "review" ? models.knowledge_review : models.knowledge;
  environment.OPENAI_MODEL = model;
  return model;
}

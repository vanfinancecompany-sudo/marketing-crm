const clean = (value, max = 200) => String(value || "").trim().slice(0, max);

export const PRIORITY_AI_MODEL_DEFAULTS = Object.freeze({
  wix_fast: "gpt-5.6-luna",
  wix_main: "gpt-5.6-terra",
  wix_escalation: "gpt-5.6-sol",
  knowledge_topic: "gpt-5.6-luna",
  knowledge: "gpt-5.6-terra",
  knowledge_review: "gpt-5.6-sol",
  editorial: "gpt-5.6-terra",
  marketing_content: "gpt-5.6-terra",
  marketing_review: "gpt-5.6-terra",
  website_intelligence: "gpt-5.6-luna",
  editorial_automation: "gpt-5.6-terra",
  competence_bulk: "gpt-5.6-luna",
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
    knowledge_topic:
      clean(environment.OPENAI_KNOWLEDGE_TOPIC_MODEL) ||
      PRIORITY_AI_MODEL_DEFAULTS.knowledge_topic,
    knowledge: knowledgeModel,
    knowledge_review:
      clean(environment.OPENAI_KNOWLEDGE_REVIEW_MODEL) ||
      PRIORITY_AI_MODEL_DEFAULTS.knowledge_review,
    editorial:
      clean(environment.OPENAI_EDITORIAL_MODEL) || PRIORITY_AI_MODEL_DEFAULTS.editorial,
    marketing_content:
      clean(environment.OPENAI_MARKETING_CONTENT_MODEL) ||
      PRIORITY_AI_MODEL_DEFAULTS.marketing_content,
    marketing_review:
      clean(environment.OPENAI_MARKETING_REVIEW_MODEL) ||
      PRIORITY_AI_MODEL_DEFAULTS.marketing_review,
    website_intelligence:
      clean(environment.OPENAI_WEBSITE_INTELLIGENCE_MODEL) ||
      PRIORITY_AI_MODEL_DEFAULTS.website_intelligence,
    editorial_automation:
      clean(environment.OPENAI_EDITORIAL_AUTOMATION_MODEL) ||
      PRIORITY_AI_MODEL_DEFAULTS.editorial_automation,
    competence_bulk:
      clean(environment.OPENAI_COMPETENCE_MODEL) ||
      PRIORITY_AI_MODEL_DEFAULTS.competence_bulk,
  };
}

export function resolveAiOperationModel(environment = process.env, operation = "main") {
  const models = resolvePriorityAiModels(environment);
  const key = clean(operation, 80).toLowerCase();
  const byOperation = {
    wix_fast: models.wix_fast,
    wix_main: models.wix_main,
    wix_escalation: models.wix_escalation,
    knowledge_topic: models.knowledge_topic,
    knowledge_generation: models.knowledge,
    knowledge_review: models.knowledge_review,
    editorial: models.editorial,
    marketing_content: models.marketing_content,
    marketing_review: models.marketing_review,
    website_intelligence: models.website_intelligence,
    editorial_automation: models.editorial_automation,
    competence_bulk: models.competence_bulk,
  };
  return byOperation[key] || models.wix_main;
}

export function applyKnowledgeModelOverride(environment = process.env, mode = "generation") {
  const operation = mode === "review"
    ? "knowledge_review"
    : mode === "topic"
      ? "knowledge_topic"
      : "knowledge_generation";
  const model = resolveAiOperationModel(environment, operation);
  environment.OPENAI_MODEL = model;
  return model;
}

export function applyAiOperationModelOverride(environment = process.env, operation = "main") {
  const model = resolveAiOperationModel(environment, operation);
  environment.OPENAI_MODEL = model;
  return model;
}

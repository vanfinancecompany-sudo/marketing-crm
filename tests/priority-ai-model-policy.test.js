import test from "node:test";
import assert from "node:assert/strict";
import {
  PRIORITY_AI_MODEL_DEFAULTS,
  applyAiOperationModelOverride,
  applyKnowledgeModelOverride,
  resolveAiOperationModel,
  resolvePriorityAiModels,
} from "../lib/priorityAiModelPolicy.js";

test("priority AI defaults use Luna for cheap work, Terra for normal work and Sol for escalation/review", () => {
  assert.deepEqual(resolvePriorityAiModels({}), PRIORITY_AI_MODEL_DEFAULTS);
  assert.equal(PRIORITY_AI_MODEL_DEFAULTS.wix_fast, "gpt-5.6-luna");
  assert.equal(PRIORITY_AI_MODEL_DEFAULTS.wix_main, "gpt-5.6-terra");
  assert.equal(PRIORITY_AI_MODEL_DEFAULTS.wix_escalation, "gpt-5.6-sol");
  assert.equal(PRIORITY_AI_MODEL_DEFAULTS.knowledge_topic, "gpt-5.6-luna");
  assert.equal(PRIORITY_AI_MODEL_DEFAULTS.knowledge, "gpt-5.6-terra");
  assert.equal(PRIORITY_AI_MODEL_DEFAULTS.knowledge_review, "gpt-5.6-sol");
  assert.equal(PRIORITY_AI_MODEL_DEFAULTS.editorial, "gpt-5.6-terra");
  assert.equal(PRIORITY_AI_MODEL_DEFAULTS.marketing_content, "gpt-5.6-terra");
  assert.equal(PRIORITY_AI_MODEL_DEFAULTS.marketing_review, "gpt-5.6-terra");
  assert.equal(PRIORITY_AI_MODEL_DEFAULTS.website_intelligence, "gpt-5.6-luna");
  assert.equal(PRIORITY_AI_MODEL_DEFAULTS.editorial_automation, "gpt-5.6-terra");
  assert.equal(PRIORITY_AI_MODEL_DEFAULTS.competence_bulk, "gpt-5.6-luna");
});

test("priority AI model settings can be changed independently", () => {
  const models = resolvePriorityAiModels({
    OPENAI_MODEL: "legacy-generic-model",
    OPENAI_WIX_FAST_MODEL: "fast-model",
    OPENAI_WIX_MAIN_MODEL: "main-model",
    OPENAI_WIX_ESCALATION_MODEL: "escalation-model",
    OPENAI_KNOWLEDGE_TOPIC_MODEL: "topic-model",
    OPENAI_KNOWLEDGE_MODEL: "knowledge-model",
    OPENAI_KNOWLEDGE_REVIEW_MODEL: "review-model",
    OPENAI_EDITORIAL_MODEL: "editorial-model",
    OPENAI_MARKETING_CONTENT_MODEL: "content-model",
    OPENAI_MARKETING_REVIEW_MODEL: "marketing-review-model",
    OPENAI_WEBSITE_INTELLIGENCE_MODEL: "website-model",
    OPENAI_EDITORIAL_AUTOMATION_MODEL: "automation-model",
    OPENAI_COMPETENCE_MODEL: "competence-model",
  });

  assert.deepEqual(models, {
    wix_fast: "fast-model",
    wix_main: "main-model",
    wix_escalation: "escalation-model",
    knowledge_topic: "topic-model",
    knowledge: "knowledge-model",
    knowledge_review: "review-model",
    editorial: "editorial-model",
    marketing_content: "content-model",
    marketing_review: "marketing-review-model",
    website_intelligence: "website-model",
    editorial_automation: "automation-model",
    competence_bulk: "competence-model",
  });
});

test("operation routing ignores the generic OPENAI_MODEL", () => {
  const environment = { OPENAI_MODEL: "gpt-4.1-mini" };
  assert.equal(resolveAiOperationModel(environment, "wix_fast"), "gpt-5.6-luna");
  assert.equal(resolveAiOperationModel(environment, "wix_main"), "gpt-5.6-terra");
  assert.equal(resolveAiOperationModel(environment, "wix_escalation"), "gpt-5.6-sol");
  assert.equal(resolveAiOperationModel(environment, "knowledge_topic"), "gpt-5.6-luna");
  assert.equal(resolveAiOperationModel(environment, "knowledge_generation"), "gpt-5.6-terra");
  assert.equal(resolveAiOperationModel(environment, "knowledge_review"), "gpt-5.6-sol");
  assert.equal(resolveAiOperationModel(environment, "editorial"), "gpt-5.6-terra");
  assert.equal(resolveAiOperationModel(environment, "website_intelligence"), "gpt-5.6-luna");
});

test("knowledge endpoint overrides select topic, generation and review tiers", () => {
  const topicEnvironment = { OPENAI_MODEL: "gpt-4.1-mini" };
  const generationEnvironment = { OPENAI_MODEL: "gpt-4.1-mini" };
  const reviewEnvironment = {
    OPENAI_MODEL: "gpt-4.1-mini",
    OPENAI_KNOWLEDGE_REVIEW_MODEL: "review-model",
  };

  assert.equal(applyKnowledgeModelOverride(topicEnvironment, "topic"), "gpt-5.6-luna");
  assert.equal(topicEnvironment.OPENAI_MODEL, "gpt-5.6-luna");
  assert.equal(applyKnowledgeModelOverride(generationEnvironment), "gpt-5.6-terra");
  assert.equal(generationEnvironment.OPENAI_MODEL, "gpt-5.6-terra");
  assert.equal(applyKnowledgeModelOverride(reviewEnvironment, "review"), "review-model");
  assert.equal(reviewEnvironment.OPENAI_MODEL, "review-model");
});

test("generic operation override writes only the selected routed model", () => {
  const environment = { OPENAI_MODEL: "legacy-model" };
  assert.equal(applyAiOperationModelOverride(environment, "website_intelligence"), "gpt-5.6-luna");
  assert.equal(environment.OPENAI_MODEL, "gpt-5.6-luna");
  assert.equal(applyAiOperationModelOverride(environment, "editorial"), "gpt-5.6-terra");
  assert.equal(environment.OPENAI_MODEL, "gpt-5.6-terra");
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  PRIORITY_AI_MODEL_DEFAULTS,
  applyKnowledgeModelOverride,
  resolvePriorityAiModels,
} from "../lib/priorityAiModelPolicy.js";

test("priority AI defaults use Terra for normal work and Sol only for Wix escalation", () => {
  assert.deepEqual(resolvePriorityAiModels({}), PRIORITY_AI_MODEL_DEFAULTS);
  assert.equal(PRIORITY_AI_MODEL_DEFAULTS.wix_fast, "gpt-5.6-terra");
  assert.equal(PRIORITY_AI_MODEL_DEFAULTS.wix_main, "gpt-5.6-terra");
  assert.equal(PRIORITY_AI_MODEL_DEFAULTS.wix_escalation, "gpt-5.6-sol");
  assert.equal(PRIORITY_AI_MODEL_DEFAULTS.knowledge, "gpt-5.6-terra");
  assert.equal(PRIORITY_AI_MODEL_DEFAULTS.knowledge_review, "gpt-5.6-terra");
});

test("priority AI model settings can be changed independently", () => {
  const models = resolvePriorityAiModels({
    OPENAI_MODEL: "legacy-generic-model",
    OPENAI_WIX_FAST_MODEL: "fast-model",
    OPENAI_WIX_MAIN_MODEL: "main-model",
    OPENAI_WIX_ESCALATION_MODEL: "escalation-model",
    OPENAI_KNOWLEDGE_MODEL: "knowledge-model",
    OPENAI_KNOWLEDGE_REVIEW_MODEL: "review-model",
  });

  assert.deepEqual(models, {
    wix_fast: "fast-model",
    wix_main: "main-model",
    wix_escalation: "escalation-model",
    knowledge: "knowledge-model",
    knowledge_review: "review-model",
  });
});

test("knowledge endpoints ignore the generic OPENAI_MODEL and default to Terra", () => {
  const generationEnvironment = { OPENAI_MODEL: "gpt-4.1-mini" };
  const reviewEnvironment = {
    OPENAI_MODEL: "gpt-4.1-mini",
    OPENAI_KNOWLEDGE_MODEL: "knowledge-model",
    OPENAI_KNOWLEDGE_REVIEW_MODEL: "review-model",
  };

  assert.equal(applyKnowledgeModelOverride(generationEnvironment), "gpt-5.6-terra");
  assert.equal(generationEnvironment.OPENAI_MODEL, "gpt-5.6-terra");
  assert.equal(applyKnowledgeModelOverride(reviewEnvironment, "review"), "review-model");
  assert.equal(reviewEnvironment.OPENAI_MODEL, "review-model");
});

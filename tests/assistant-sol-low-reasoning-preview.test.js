import test from "node:test";
import assert from "node:assert/strict";
import { chooseAssistantModel } from "../lib/aiAssistantModelRouter.js";

const args = {
  message: "I am self-employed and have a CCJ. What documents are needed?",
  intent: { primary_intent: "knowledge_question", retrieval_required: true, confidence: 95 },
  human: { confidence: 95, low_confidence: false },
  orchestration: { retrieval_required: true, recovery_required: false },
  sourceCount: 3,
};
test("production and unrelated preview still require medium reasoning for complex questions", () => {
  for (const environment of [
    { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" },
    { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "other-branch" },
  ]) {
    const route = chooseAssistantModel({ ...args, environment });
    assert.equal(route.model, "gpt-6-sol");
    assert.equal(route.reasoning_effort, "medium");
  }
});
test("only targeted preview requests low reasoning without changing the model", () => {
  const route = chooseAssistantModel({
    ...args, environment: { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "test/askme-low-reasoning-20261028" },
  });
  assert.equal(route.model, "gpt-6-sol");
  assert.equal(route.reasoning_effort, "low");
});

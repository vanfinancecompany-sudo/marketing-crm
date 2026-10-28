import test from "node:test";
import assert from "node:assert/strict";
import { canUseInstantAcknowledgement } from "../lib/assistantImmediateReplyPolicy.js";
import { chooseAssistantModel, buildAssistantResponseModelParameters } from "../lib/aiAssistantModelRouter.js";

const base = () => ({
  intent: { primary_intent: "thanks", retrieval_required: false, clarification_required: false },
  orchestration: { retrieval_required: false, recovery_required: false, application_continuation: false },
  journey: { application_mode_active: false },
  latestQuestionRequiresAnswer: false,
  response: { reply: "You are welcome. Would you like anything else?" },
});

test("exact harmless acknowledgements can avoid a model call", () => {
  for (const primary_intent of ["greeting", "thanks", "goodbye"]) {
    const input = base(); input.intent.primary_intent = primary_intent;
    assert.equal(canUseInstantAcknowledgement(input), true, primary_intent);
  }
});

test("business facts, ambiguity, continuation and missing replies never bypass AI", () => {
  const cases = [
    x => { x.intent.primary_intent = "knowledge_question"; },
    x => { x.intent.primary_intent = "general_help_request"; },
    x => { x.intent.retrieval_required = true; },
    x => { x.intent.clarification_required = true; },
    x => { x.orchestration.retrieval_required = true; },
    x => { x.orchestration.recovery_required = true; },
    x => { x.orchestration.application_continuation = true; },
    x => { x.journey.application_mode_active = true; },
    x => { x.latestQuestionRequiresAnswer = true; },
    x => { x.response.reply = ""; },
  ];
  for (const change of cases) {
    const input = base(); change(input);
    assert.equal(canUseInstantAcknowledgement(input), false, change.toString());
  }
});

test("only customer-chat Sol 6.1 can request Fast or Ultrafast", () => {
  const selected = chooseAssistantModel({
    message: "Are prices including VAT?",
    intent: { primary_intent: "knowledge_question", retrieval_required: true, confidence: 95 },
    environment: { OPENAI_WIX_MAIN_MODEL: "gpt-6.1-sol", OPENAI_WIX_SERVICE_TIER: "fast" },
  });
  assert.equal(selected.model, "gpt-6.1-sol");
  assert.equal(selected.service_tier, "fast");
  assert.deepEqual(buildAssistantResponseModelParameters(selected), { model: "gpt-6.1-sol", service_tier: "fast", reasoning: { effort: "low" } });
  const escalation = chooseAssistantModel({ message: "And then?", intent: { primary_intent: "multi_part_question", clarification_required: true }, environment: { OPENAI_WIX_ESCALATION_MODEL: "gpt-6.1-sol", OPENAI_WIX_SERVICE_TIER: "ultrafast" } });
  assert.equal(escalation.service_tier, "ultrafast");
  assert.deepEqual(buildAssistantResponseModelParameters({ model: "gpt-6-sol", service_tier: "fast", reasoning_effort: "low" }), { model: "gpt-6-sol", reasoning: { effort: "low" } });
  assert.deepEqual(buildAssistantResponseModelParameters({ model: "gpt-6.1-sol", service_tier: "invalid" }), { model: "gpt-6.1-sol" });
});

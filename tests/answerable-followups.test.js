import test from "node:test";
import assert from "node:assert/strict";
import { enforceAnswerableFollowUp, polishConversationPresentation } from "../lib/conversationPolish.js";

test("unsupported capability offer is removed when there is no server-selected next question", () => {
  const result = enforceAnswerableFollowUp(
    "The deposit depends on the route you choose. Would you like me to check the available vans for you?",
    { intent: {}, journey: {}, orchestration: {} },
  );
  assert.equal(result.reply, "The deposit depends on the route you choose.");
  assert.equal(result.supported_question, "");
  assert.equal(result.unsupported_offer_removed, true);
});

test("invented offer is replaced by the exact server-selected question", () => {
  const supported = "What type of van are you looking for?";
  const result = enforceAnswerableFollowUp(
    "Your £350 monthly budget is noted. Would you like me to find a van for you?",
    { journey: { next_best_question: supported }, intent: {}, orchestration: {} },
  );
  assert.equal(result.reply, `Your £350 monthly budget is noted. ${supported}`);
  assert.equal(result.supported_question, supported);
  assert.equal((result.reply.match(/\?/g) || []).length, 1);
});

test("unsupported external action statement and dangling offer are both removed", () => {
  const result = enforceAnswerableFollowUp(
    "The exact monthly figure depends on the vehicle and finance assessment. I can calculate a personalised quote for you. Would you like me to?",
    { intent: {}, journey: {}, orchestration: {} },
  );
  assert.equal(result.reply, "The exact monthly figure depends on the vehicle and finance assessment.");
  assert.equal(result.unsupported_offer_removed, true);
  assert.doesNotMatch(result.reply, /calculate|would you like me/i);
});

test("genuine recovery questions remain untouched", () => {
  const reply = "Could you explain that another way?";
  const result = enforceAnswerableFollowUp(reply, {
    orchestration: { recovery_required: true },
    intent: {},
    journey: {},
  });
  assert.equal(result.reply, reply);
  assert.equal(result.guard_applied, false);
});

test("application mode does not invent an additional question", () => {
  const result = enforceAnswerableFollowUp(
    "You can use the application button on this page when you are ready. Would you like me to submit it for you?",
    { intent: {}, journey: { application_mode_active: true }, orchestration: {} },
  );
  assert.equal(result.reply, "You can use the application button on this page when you are ready.");
  assert.equal(result.supported_question, "");
});

test("conversation polish removes a made-up offer from a completed factual answer", () => {
  const result = polishConversationPresentation({
    reply: "Yes, self-employed applicants can apply subject to the normal assessment. Would you like me to check your eligibility?",
    question: "Can I apply if I am self employed?",
    productContext: "finance",
    intent: { retrieval_required: true, clarification_required: false },
    journey: { next_best_question: "How long have you been trading?" },
    orchestration: {},
  });
  assert.equal(result.reply, "Yes, self-employed applicants can apply subject to the normal assessment.");
  assert.doesNotMatch(result.reply, /would you like me|check your eligibility/i);
});

test("a clean answer is not forced to ask a question merely because one is available", () => {
  const result = enforceAnswerableFollowUp(
    "An initial decision can sometimes be available quickly, but timing depends on the lender and checks.",
    {
      intent: {},
      journey: { next_best_question: "Are you already looking at a specific van?" },
      orchestration: {},
    },
  );
  assert.equal(result.reply, "An initial decision can sometimes be available quickly, but timing depends on the lender and checks.");
  assert.equal((result.reply.match(/\?/g) || []).length, 0);
});

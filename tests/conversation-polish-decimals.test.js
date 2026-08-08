import assert from "node:assert/strict";
import test from "node:test";
import { polishConversationPresentation } from "../lib/conversationPolish.js";

test("conversation polish preserves decimal mileage without inserting a sentence-space", () => {
  const result = polishConversationPresentation({
    reply: "BH23 1QH is approximately 15.6 miles in a straight line from SO40 2NN, so you’re within our normal 100-mile Rent2Buy area.",
    question: "BH23-1QH",
    productContext: "rent2buy",
    intent: { retrieval_required: true, clarification_required: false },
    orchestration: { recovery_required: false, product_boundary_blocked: false },
  });
  assert.match(result.reply, /15\.6 miles/);
  assert.doesNotMatch(result.reply, /15\.\s+6 miles/);
  assert.equal(result.response_sentence_count, 1);
});

test("conversation polish preserves multiple decimal values while still splitting real sentences", () => {
  const result = polishConversationPresentation({
    reply: "The distance is 101.2 miles. The rate shown is 9.9% APR.",
    question: "How far is it?",
    productContext: "rent2buy",
    intent: { retrieval_required: true, clarification_required: false },
    orchestration: { recovery_required: false, product_boundary_blocked: false },
  });
  assert.match(result.reply, /101\.2 miles/);
  assert.match(result.reply, /9\.9% APR/);
  assert.equal(result.response_sentence_count, 2);
});

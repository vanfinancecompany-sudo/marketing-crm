import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCustomerAssistantPersonality,
  personaliseCustomerPayload,
} from "../lib/customerAssistantPersonality.js";

test("assistant speaks as part of the business rather than as a third party", () => {
  const reply = applyCustomerAssistantPersonality(
    "Rent2Buy Vans can help with the application. A member of the team can confirm the final detail.",
    { message: "How does it work?", status: "ready" }
  );

  assert.match(reply, /we can help with the application/i);
  assert.match(reply, /one of our team can confirm/i);
  assert.doesNotMatch(reply, /Rent2Buy Vans can help/i);
});

test("assistant can use one short dry line for a normal price question", () => {
  const reply = applyCustomerAssistantPersonality(
    "The monthly payment shown for this van is £575 per month.",
    { message: "How much does this van cost monthly?", status: "ready" }
  );

  assert.match(reply, /£575 per month/i);
  assert.match(reply, /pocket change|loose-change|calculator/i);
});

test("assistant never adds humour to sensitive financial or complaint contexts", () => {
  const declined = applyCustomerAssistantPersonality(
    "We can explain the options available from the verified information we have.",
    { message: "I have a CCJ and was declined. Can I still apply?", status: "ready" }
  );
  const complaint = applyCustomerAssistantPersonality(
    "Our team can confirm the next step.",
    { message: "I am angry about a complaint and refund.", status: "ready" }
  );

  assert.doesNotMatch(declined, /pocket change|loose-change|calculator|alphabet soup|filing cabinet|geography lesson/i);
  assert.doesNotMatch(complaint, /pocket change|loose-change|calculator|alphabet soup|filing cabinet|geography lesson/i);
});

test("assistant can make van-choice guidance less robotic without changing the question", () => {
  const reply = applyCustomerAssistantPersonality(
    "We can help you narrow it down. What size or type of van do you need?",
    { message: "I am not sure what van I need", status: "ready" }
  );

  assert.match(reply, /alphabet soup|filing cabinet|geography lesson/i);
  assert.match(reply, /What size or type of van do you need\?/i);
});

test("error payloads remain untouched and customer payload shape is preserved", () => {
  const payload = personaliseCustomerPayload({
    reply: "The assistant is temporarily unavailable. Please try again shortly.",
    status: "unavailable",
    conversation_id: "abc",
  }, { message: "How much?" });

  assert.deepEqual(payload, {
    reply: "The assistant is temporarily unavailable. Please try again shortly.",
    status: "unavailable",
    conversation_id: "abc",
  });
});

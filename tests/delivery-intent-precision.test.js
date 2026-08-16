import test from "node:test";
import assert from "node:assert/strict";
import { deterministicDeliveryReply, isDirectDeliveryLogisticsQuestion } from "../lib/salesConversationEngine.js";
import { buildFinanceCoverageEvidence, buildRent2BuyDeliveryEvidence } from "../lib/productCoverageRules.js";

test("delivery logistics questions still use deterministic coverage replies", () => {
  for (const question of ["Do you deliver?", "Do you offer delivery?", "Can you deliver to Glasgow?", "Is delivery free?"]) {
    assert.equal(isDirectDeliveryLogisticsQuestion(question), true, question);
    const reply = deterministicDeliveryReply("finance", question, buildFinanceCoverageEvidence(question));
    assert.match(reply, /delivery|deliver/i, question);
  }
});

test("delivery wording does not hijack inspection, after-sales or timing questions", () => {
  const questions = [
    "Are your vans inspected before delivery?",
    "What happens if there is a problem after delivery?",
    "What warranty do I get after delivery?",
    "How long does remote van delivery usually take?",
  ];
  for (const question of questions) {
    assert.equal(isDirectDeliveryLogisticsQuestion(question), false, question);
    assert.equal(deterministicDeliveryReply("finance", question, buildFinanceCoverageEvidence(question)), null, question);
  }
});

test("Rent2Buy direct delivery questions remain collection-only without leaking into other questions", () => {
  const direct = "Do you deliver?";
  assert.match(deterministicDeliveryReply("rent2buy", direct, buildRent2BuyDeliveryEvidence(direct)), /collect|Southampton/i);
  const nonDeliveryIntent = "Are your vans inspected before delivery?";
  assert.equal(deterministicDeliveryReply("rent2buy", nonDeliveryIntent, buildRent2BuyDeliveryEvidence(nonDeliveryIntent)), null);
});

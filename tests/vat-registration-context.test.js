import test from "node:test";
import assert from "node:assert/strict";
import { buildConversationMemory, classifyConversationIntent } from "../lib/conversationIntelligence.js";

const history = [
  { role: "user", content: "Can my limited company apply and what paperwork is needed?" },
  { role: "assistant", content: "I can explain the application and paperwork requirements." },
];

test("bare VAT registration status is conversation state rather than a knowledge request", () => {
  const registered = classifyConversationIntent({ message: "VAT registered", productContext: "finance", history });
  assert.equal(registered.retrieval_required, false);
  assert.equal(registered.clarification_required, false);
  assert.equal(buildConversationMemory([...history, { role: "user", content: "VAT registered" }]).remembered_facts.vat_registered, true);

  const notRegistered = classifyConversationIntent({ message: "not VAT registered", productContext: "finance", history });
  assert.equal(notRegistered.retrieval_required, false);
  assert.equal(notRegistered.clarification_required, false);
  assert.equal(buildConversationMemory([...history, { role: "user", content: "not VAT registered" }]).remembered_facts.vat_registered, false);
});

test("actual VAT questions still require grounded retrieval", () => {
  for (const message of ["Is VAT included?", "Are prices plus VAT?", "Can VAT be financed?"]) {
    const intent = classifyConversationIntent({ message, productContext: "finance", history });
    assert.equal(intent.retrieval_required, true, message);
    assert.equal(intent.clarification_required, false, message);
    assert.equal(intent.secondary_intents.includes("vat_pricing"), true, message);
  }
});

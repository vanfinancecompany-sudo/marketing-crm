import test from "node:test";
import assert from "node:assert/strict";
import {
  RENT2BUY_BUSINESS_KNOWLEDGE_RULE,
  RENT2BUY_EVIDENCE_GUARDRAIL,
  rent2BuyPromptRule,
} from "../lib/rent2BuyRules.js";

const rent2BuySubject = {
  title: "Rent2Buy application guide",
  category: "Rent2Buy",
  article_type: "rent2buy-guide",
};

test("Rent2Buy generation guardrail blocks unsupported fixed operational claims", () => {
  const expected = [
    "fixed reservation or deposit amount",
    "approval or decision time",
    "mandatory document list",
    "agreement length",
    "mileage allowance",
    "tracking-device procedure",
    "ownership-transfer procedure",
    "age threshold",
    "driving-licence requirement",
    "business-type eligibility",
  ];

  expected.forEach((phrase) => assert.match(RENT2BUY_EVIDENCE_GUARDRAIL, new RegExp(phrase)));
  assert.match(RENT2BUY_EVIDENCE_GUARDRAIL, /unless that exact fact is present in current approved Rent2Buy Business Knowledge/);
  assert.match(RENT2BUY_EVIDENCE_GUARDRAIL, /team will confirm the current requirement/);
  assert.ok(RENT2BUY_BUSINESS_KNOWLEDGE_RULE.value.includes(RENT2BUY_EVIDENCE_GUARDRAIL));
  assert.ok(rent2BuyPromptRule(rent2BuySubject).includes(RENT2BUY_EVIDENCE_GUARDRAIL));
});

test("comparison prompts carry the same evidence guardrail on the Rent2Buy side", () => {
  const prompt = rent2BuyPromptRule(
    { ...rent2BuySubject, title: "Rent2Buy vs Van Finance", category: "Comparison", article_type: "comparison" },
    { scopeOverride: "both" },
  );
  assert.ok(prompt.includes(RENT2BUY_EVIDENCE_GUARDRAIL));
});

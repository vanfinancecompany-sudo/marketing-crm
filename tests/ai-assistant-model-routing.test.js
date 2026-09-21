import test from "node:test";
import assert from "node:assert/strict";
import {
  ASSISTANT_MODEL_POLICY,
  buildAssistantResponseModelParameters,
  chooseAssistantModel,
} from "../lib/aiAssistantModelRouter.js";
import { requestOpenAIConversationReply } from "../api/marketing-ai-assistant-competence.js";

function route(message, overrides = {}) {
  return chooseAssistantModel({
    message,
    intent: {
      primary_intent: "knowledge_question",
      secondary_intents: [],
      retrieval_required: true,
      clarification_required: false,
      confidence: 95,
      ...(overrides.intent || {}),
    },
    human: {
      confidence: 95,
      low_confidence: false,
      ...(overrides.human || {}),
    },
    orchestration: {
      retrieval_required: true,
      recovery_required: false,
      factual_topics: [],
      ...(overrides.orchestration || {}),
    },
    sourceCount: overrides.sourceCount ?? 2,
    environment: overrides.environment || {},
  });
}

test("harmless simple conversation uses Luna", () => {
  for (const primary_intent of ["greeting", "thanks", "goodbye", "general_help_request"]) {
    const selected = route("Hi", {
      intent: { primary_intent, retrieval_required: false },
      orchestration: { retrieval_required: false },
      sourceCount: 0,
    });
    assert.equal(selected.model, "gpt-5.6-luna", primary_intent);
    assert.equal(selected.tier, "mini", primary_intent);
  }
});

test("normal evidence-backed business questions use GPT-5.6 Terra", () => {
  const cases = [
    ["Are prices plus VAT?", ["vat_pricing"]],
    ["Which documents are required?", ["documents"]],
    ["Who owns the van at the end?", ["ownership"]],
    ["Do you offer delivery?", ["delivery_collection"]],
    ["Can I use the van for my business?", ["business_use"]],
    ["Can I apply with poor credit?", ["poor_credit"]],
    ["How much deposit do I need?", ["deposit"]],
    ["What would my monthly payment be?", ["monthly_cost"]],
  ];
  for (const [message, secondary_intents] of cases) {
    const selected = route(message, { intent: { secondary_intents } });
    assert.equal(selected.model, "gpt-5.6-terra", message);
    assert.equal(selected.tier, "full", message);
    assert.match(selected.reason, /quality-first|grounded/i);
  }
});

test("ordinary ambiguity stays on Terra while genuinely hard turns escalate to Sol", () => {
  const ambiguous = route("What about that?", {
    intent: { primary_intent: "incomplete_business_question", retrieval_required: false, clarification_required: true, confidence: 60 },
    human: { confidence: 60, low_confidence: true },
    orchestration: { retrieval_required: false, recovery_required: true },
    sourceCount: 0,
  });
  assert.equal(ambiguous.model, "gpt-5.6-terra");
  assert.equal(ambiguous.reasoning_effort, "medium");
  assert.match(ambiguous.reason, /stays on the main model/i);

  const multiStep = route("How does it work, what documents do I need, and what happens next?", {
    intent: { primary_intent: "multi_part_question", secondary_intents: ["documents", "application"] },
  });
  assert.equal(multiStep.model, "gpt-5.6-sol");
  assert.equal(multiStep.reasoning_effort, "medium");

  const hardRecovery = route("I was declined, I am self-employed and the lender says something different. What should I do?", {
    intent: { primary_intent: "knowledge_question", retrieval_required: true, clarification_required: true, confidence: 55 },
    human: { confidence: 55, low_confidence: true },
    orchestration: { retrieval_required: true, recovery_required: true },
    sourceCount: 2,
  });
  assert.equal(hardRecovery.model, "gpt-5.6-sol");
  assert.equal(hardRecovery.reasoning_effort, "medium");
});

test("normal compound sales statements do not escalate merely because they contain and", () => {
  const selected = route("I am self employed and have about £400 a month to spend", {
    intent: { primary_intent: "monthly_budget", retrieval_required: false },
    orchestration: { retrieval_required: false },
    sourceCount: 0,
  });
  assert.equal(selected.model, "gpt-5.6-terra");
  assert.equal(selected.reasoning_effort, "low");
});

test("high-confidence uncategorised turns default to Terra", () => {
  const selected = route("Please explain this properly", {
    intent: { primary_intent: "unknown", retrieval_required: false, secondary_intents: [] },
    orchestration: { retrieval_required: false },
    sourceCount: 0,
  });
  assert.equal(selected.model, "gpt-5.6-terra");
});

test("Wix model tiers can be overridden independently", () => {
  const environment = {
    OPENAI_WIX_FAST_MODEL: "fast-model",
    OPENAI_WIX_MAIN_MODEL: "main-model",
    OPENAI_WIX_ESCALATION_MODEL: "escalation-model",
  };

  const simple = route("Hi", {
    intent: { primary_intent: "greeting", retrieval_required: false },
    orchestration: { retrieval_required: false },
    sourceCount: 0,
    environment,
  });
  const factual = route("Are prices plus VAT?", { environment });
  const ambiguous = route("What about that?", {
    intent: { retrieval_required: false, clarification_required: true, confidence: 60 },
    human: { confidence: 60, low_confidence: true },
    orchestration: { retrieval_required: false, recovery_required: true },
    sourceCount: 0,
    environment,
  });
  const hardRecovery = route("I was declined and the lender says something different. What should I do?", {
    intent: { retrieval_required: true, clarification_required: true, confidence: 55 },
    human: { confidence: 55, low_confidence: true },
    orchestration: { retrieval_required: true, recovery_required: true },
    sourceCount: 2,
    environment,
  });

  assert.equal(simple.model, "fast-model");
  assert.equal(factual.model, "main-model");
  assert.equal(ambiguous.model, "main-model");
  assert.equal(hardRecovery.model, "escalation-model");
});

test("GPT-5.6 Responses API parameters omit temperature and include reasoning", () => {
  const fast = buildAssistantResponseModelParameters({ model: ASSISTANT_MODEL_POLICY.mini, temperature: 0.2 });
  assert.deepEqual(fast, { model: "gpt-5.6-luna" });

  const full = buildAssistantResponseModelParameters({ model: ASSISTANT_MODEL_POLICY.full, temperature: 0.2, reasoning_effort: "low" });
  assert.deepEqual(full, { model: "gpt-5.6-terra", reasoning: { effort: "low" } });

  const escalation = buildAssistantResponseModelParameters({ model: ASSISTANT_MODEL_POLICY.escalation, temperature: 0.2, reasoning_effort: "medium" });
  assert.deepEqual(escalation, { model: "gpt-5.6-sol", reasoning: { effort: "medium" } });

  const legacy = buildAssistantResponseModelParameters({ model: "gpt-4.1", temperature: 0.2 });
  assert.deepEqual(legacy, { model: "gpt-4.1", temperature: 0.2 });
});

test("the canonical conversation request sends GPT-5.6 Terra for a normal factual lookup", async () => {
  let requestBody;
  const selected = route("Are prices plus VAT?", { intent: { secondary_intents: ["vat_pricing"] } });
  const fetchImplementation = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ id: "resp_test", output_text: "{}" }),
    };
  };

  const requested = await requestOpenAIConversationReply(
    "grounded prompt",
    selected,
    { OPENAI_API_KEY: "test-key", OPENAI_MODEL: "gpt-4.1-mini" },
    fetchImplementation,
  );

  assert.equal(requestBody.model, "gpt-5.6-terra");
  assert.equal("temperature" in requestBody, false);
  assert.deepEqual(requestBody.reasoning, { effort: "low" });
  assert.equal(requested.model, "gpt-5.6-terra");
  assert.equal(requested.route.tier, "full");
});

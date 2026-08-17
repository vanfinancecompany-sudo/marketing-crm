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
  });
}

test("harmless simple conversation qualifies for the mini model", () => {
  for (const primary_intent of ["greeting", "thanks", "goodbye", "general_help_request"]) {
    const selected = route("Hi", {
      intent: { primary_intent, retrieval_required: false },
      orchestration: { retrieval_required: false },
      sourceCount: 0,
    });
    assert.equal(selected.model, "gpt-5-mini", primary_intent);
    assert.equal(selected.tier, "mini", primary_intent);
  }
});

test("high-confidence single-fact approved lookups can use the mini model", () => {
  const cases = [
    ["Are prices plus VAT?", ["vat_pricing"]],
    ["Which documents are required?", ["documents"]],
    ["Who owns the van at the end?", ["ownership"]],
    ["Do you offer delivery?", ["delivery_collection"]],
    ["Can I use the van for my business?", ["business_use"]],
  ];
  for (const [message, secondary_intents] of cases) {
    const selected = route(message, { intent: { secondary_intents } });
    assert.equal(selected.model, "gpt-5-mini", message);
    assert.equal(selected.tier, "mini", message);
    assert.match(selected.reason, /high-confidence|approved retrieval|lower-cost/i);
  }
});

test("decision-sensitive topics stay on gpt-5.1", () => {
  const cases = [
    ["Can I apply with poor credit?", ["poor_credit"]],
    ["How much deposit do I need?", ["deposit"]],
    ["What would my monthly payment be?", ["monthly_cost"]],
    ["Can I apply now?", ["application"]],
    ["Can I have three vans?", ["multiple_vehicles"]],
  ];
  for (const [message, secondary_intents] of cases) {
    const selected = route(message, { intent: { secondary_intents } });
    assert.equal(selected.model, "gpt-5.1", message);
    assert.equal(selected.tier, "full", message);
  }
});

test("safe lookup requires strong confidence and approved evidence", () => {
  const noEvidence = route("Are prices plus VAT?", {
    intent: { secondary_intents: ["vat_pricing"] },
    sourceCount: 0,
  });
  assert.equal(noEvidence.model, "gpt-5.1");

  const lowConfidence = route("Are prices plus VAT?", {
    intent: { secondary_intents: ["vat_pricing"], confidence: 70 },
    human: { confidence: 70, low_confidence: true },
  });
  assert.equal(lowConfidence.model, "gpt-5.1");
});

test("ambiguous, explanatory and multi-step turns default to the stronger model", () => {
  const ambiguous = route("What about that?", {
    intent: { primary_intent: "incomplete_business_question", retrieval_required: false, clarification_required: true, confidence: 60 },
    human: { confidence: 60, low_confidence: true },
    orchestration: { retrieval_required: false, recovery_required: true },
    sourceCount: 0,
  });
  assert.equal(ambiguous.model, "gpt-5.1");
  assert.equal(ambiguous.reasoning_effort, "medium");

  const explanatory = route("Can you explain how delivery works?", {
    intent: { secondary_intents: ["delivery_collection"] },
  });
  assert.equal(explanatory.model, "gpt-5.1");

  const multiStep = route("How does it work, what documents do I need, and what happens next?", {
    intent: { primary_intent: "multi_part_question", secondary_intents: ["documents", "application"] },
  });
  assert.equal(multiStep.model, "gpt-5.1");
  assert.equal(multiStep.reasoning_effort, "medium");
});

test("uncategorised turns do not fall through to the cheaper model", () => {
  const selected = route("Please explain this properly", {
    intent: { primary_intent: "unknown", retrieval_required: false, secondary_intents: [] },
    orchestration: { retrieval_required: false },
    sourceCount: 0,
  });
  assert.equal(selected.model, "gpt-5.1");
});

test("GPT-5 Responses API parameters omit unsupported temperature", () => {
  const mini = buildAssistantResponseModelParameters({ model: ASSISTANT_MODEL_POLICY.mini, temperature: 0.2 });
  assert.deepEqual(mini, { model: "gpt-5-mini" });

  const full = buildAssistantResponseModelParameters({ model: ASSISTANT_MODEL_POLICY.full, temperature: 0.2, reasoning_effort: "low" });
  assert.deepEqual(full, { model: "gpt-5.1", reasoning: { effort: "low" } });

  const legacy = buildAssistantResponseModelParameters({ model: "gpt-4.1", temperature: 0.2 });
  assert.deepEqual(legacy, { model: "gpt-4.1", temperature: 0.2 });
});

test("the canonical conversation request sends a supported mini payload for a safe lookup", async () => {
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

  assert.equal(requestBody.model, "gpt-5-mini");
  assert.equal("temperature" in requestBody, false);
  assert.equal("reasoning" in requestBody, false);
  assert.equal(requested.model, "gpt-5-mini");
  assert.equal(requested.route.tier, "mini");
  assert.equal(requested.route.reasoning_effort, null);
});

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

test("harmless simple conversation uses Terra rather than a low-end model", () => {
  for (const primary_intent of ["greeting", "thanks", "goodbye", "general_help_request"]) {
    const selected = route("Hi", {
      intent: { primary_intent, retrieval_required: false },
      orchestration: { retrieval_required: false },
      sourceCount: 0,
    });
    assert.equal(selected.model, "gpt-5.6-terra", primary_intent);
    assert.equal(selected.tier, "mini", primary_intent);
  }
});

test("all evidence-backed business questions use GPT-5.6 Sol", () => {
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
    assert.equal(selected.model, "gpt-5.6-sol", message);
    assert.equal(selected.tier, "full", message);
    assert.match(selected.reason, /quality-first|strongest/i);
  }
});

test("ambiguous and multi-step turns use Sol with stronger reasoning", () => {
  const ambiguous = route("What about that?", {
    intent: { primary_intent: "incomplete_business_question", retrieval_required: false, clarification_required: true, confidence: 60 },
    human: { confidence: 60, low_confidence: true },
    orchestration: { retrieval_required: false, recovery_required: true },
    sourceCount: 0,
  });
  assert.equal(ambiguous.model, "gpt-5.6-sol");
  assert.equal(ambiguous.reasoning_effort, "medium");

  const multiStep = route("How does it work, what documents do I need, and what happens next?", {
    intent: { primary_intent: "multi_part_question", secondary_intents: ["documents", "application"] },
  });
  assert.equal(multiStep.model, "gpt-5.6-sol");
  assert.equal(multiStep.reasoning_effort, "medium");
});

test("uncategorised turns default to Sol", () => {
  const selected = route("Please explain this properly", {
    intent: { primary_intent: "unknown", retrieval_required: false, secondary_intents: [] },
    orchestration: { retrieval_required: false },
    sourceCount: 0,
  });
  assert.equal(selected.model, "gpt-5.6-sol");
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

  assert.equal(simple.model, "fast-model");
  assert.equal(factual.model, "main-model");
  assert.equal(ambiguous.model, "escalation-model");
});

test("GPT-5.6 Responses API parameters omit temperature and include reasoning", () => {
  const mini = buildAssistantResponseModelParameters({ model: ASSISTANT_MODEL_POLICY.mini, temperature: 0.2 });
  assert.deepEqual(mini, { model: "gpt-5.6-terra" });

  const full = buildAssistantResponseModelParameters({ model: ASSISTANT_MODEL_POLICY.full, temperature: 0.2, reasoning_effort: "low" });
  assert.deepEqual(full, { model: "gpt-5.6-sol", reasoning: { effort: "low" } });

  const legacy = buildAssistantResponseModelParameters({ model: "gpt-4.1", temperature: 0.2 });
  assert.deepEqual(legacy, { model: "gpt-4.1", temperature: 0.2 });
});

test("the canonical conversation request sends GPT-5.6 Sol for a factual lookup", async () => {
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

  assert.equal(requestBody.model, "gpt-5.6-sol");
  assert.equal("temperature" in requestBody, false);
  assert.deepEqual(requestBody.reasoning, { effort: "low" });
  assert.equal(requested.model, "gpt-5.6-sol");
  assert.equal(requested.route.tier, "full");
});

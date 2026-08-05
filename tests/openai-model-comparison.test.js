import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  buildConversationOpenAIRequest,
  comparisonInputHashes,
  requestOpenAIConversationReply,
  runPreparedComparisonModel,
  saveModelComparisonReview,
  validateConfiguredModel,
} from "../api/marketing-ai-assistant-competence.js";
import {
  ALLOWED_COMPARISON_MODELS,
  DEFAULT_OPENAI_MODEL,
  estimateOpenAICost,
  openAIModelConfiguration,
  publicModelComparisonConfiguration,
  resolveServerModel,
  responseTokenUsage,
} from "../lib/openAIModelConfiguration.js";
import { MODEL_COMPARISON_RATING_FIELDS, modelComparisonSummary } from "../lib/modelComparison.js";
import { MODEL_COMPARISON_SCENARIOS } from "../lib/modelComparisonScenarios.js";

const root = new URL("../", import.meta.url);
const source = (path) => readFileSync(new URL(path, root), "utf8");

test("existing model fallback remains gpt-4.1-mini", () => {
  assert.equal(DEFAULT_OPENAI_MODEL, "gpt-4.1-mini");
  assert.equal(openAIModelConfiguration({}).default_model, "gpt-4.1-mini");
});

test("OPENAI_MODEL selects the server default", () => {
  assert.equal(openAIModelConfiguration({ OPENAI_MODEL: "gpt-4.1" }).default_model, "gpt-4.1");
  assert.equal(resolveServerModel("default", { OPENAI_MODEL: "gpt-4.1" }), "gpt-4.1");
});

test("comparison model is optional and allowlisted only", () => {
  assert.deepEqual(ALLOWED_COMPARISON_MODELS, ["gpt-4.1"]);
  assert.equal(openAIModelConfiguration({ VERCEL_ENV: "preview" }).comparison_available, false);
  assert.equal(openAIModelConfiguration({ VERCEL_ENV: "preview", OPENAI_COMPARISON_MODEL: "gpt-4.1" }).comparison_available, true);
  assert.equal(openAIModelConfiguration({ VERCEL_ENV: "preview", OPENAI_COMPARISON_MODEL: "invented-dashboard-label" }).comparison_allowed, false);
  assert.throws(() => resolveServerModel("comparison", { VERCEL_ENV: "preview", OPENAI_COMPARISON_MODEL: "invented-dashboard-label" }), /allowlist/i);
});

test("comparison is Preview-only and disabled in Production", () => {
  assert.equal(openAIModelConfiguration({ VERCEL_ENV: "production", OPENAI_COMPARISON_MODEL: "gpt-4.1" }).comparison_available, false);
  assert.throws(() => resolveServerModel("comparison", { VERCEL_ENV: "production", OPENAI_COMPARISON_MODEL: "gpt-4.1" }), /Preview/i);
  assert.match(source("api/marketing-ai-assistant-competence.js"), /Model comparison is not available on this deployment/);
});

test("both requests have identical model-agnostic OpenAI inputs", () => {
  const first = buildConversationOpenAIRequest("unchanged prompt", "gpt-4.1-mini");
  const second = buildConversationOpenAIRequest("unchanged prompt", "gpt-4.1");
  const { model: firstModel, ...firstInput } = first;
  const { model: secondModel, ...secondInput } = second;
  assert.equal(firstModel, "gpt-4.1-mini"); assert.equal(secondModel, "gpt-4.1");
  assert.deepEqual(firstInput, secondInput);
});

test("comparison hashes correlate the shared message, history, product, evidence and rule", () => {
  const value = { question: "two weeks", messages: [{ role: "assistant", content: "How long have you been trading?" }], productContext: "finance", prompt: "same prompt", sources: [{ id: "a" }], coverage: { diagnostics: { certainty: "confirmed" } } };
  const first = comparisonInputHashes(value); const second = comparisonInputHashes(structuredClone(value));
  assert.equal(first.input_hash, second.input_hash); assert.equal(first.conversation_history_hash, second.conversation_history_hash);
  assert.deepEqual(first.shared_input.retrieved_source_ids, ["S1"]);
});

test("model request construction keeps histories isolated", () => {
  const first = buildConversationOpenAIRequest("prompt", "gpt-4.1-mini");
  const second = buildConversationOpenAIRequest("prompt", "gpt-4.1");
  first.input[0].content = "changed locally";
  assert.notEqual(first.input[0].content, second.input[0].content);
});

test("shared deterministic evidence reaches both isolated results", async () => {
  const prepared = { prompt: null, deterministicResponse: { reply: "Covered.", source_ids: ["S1"], confidence: 100 }, sources: [{ title: "Coverage rule" }], coverage: { diagnostics: {} }, productContext: "finance", question: "Do you cover Wales?", messages: [], intent: { primary_intent: "coverage", clarification_required: false }, memory: { remembered_facts: {} }, buyingSignals: {}, journey: {} };
  const environment = { VERCEL_ENV: "preview", OPENAI_MODEL: "gpt-4.1-mini", OPENAI_COMPARISON_MODEL: "gpt-4.1" };
  const [defaultResult, comparisonResult] = await Promise.all([runPreparedComparisonModel(prepared, "default", environment), runPreparedComparisonModel(prepared, "comparison", environment)]);
  assert.deepEqual(defaultResult.knowledge_sources_used, comparisonResult.knowledge_sources_used);
  assert.equal(defaultResult.assistant_response, comparisonResult.assistant_response);
  assert.equal(defaultResult.generation_mode, "deterministic");
});

test("Responses API usage, timing and estimated cost are captured", async () => {
  const payload = { output_text: JSON.stringify({ reply: "A short answer.", insufficient_knowledge: false, human_handoff_recommended: false, recommended_action: "continue", confidence: 90, confidence_reason: "Grounded.", source_ids: [] }), usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 20 }, output_tokens: 25, total_tokens: 125 } };
  const fetchImplementation = async () => ({ ok: true, status: 200, statusText: "OK", json: async () => payload });
  const requested = await requestOpenAIConversationReply("prompt", { OPENAI_API_KEY: "test", OPENAI_MODEL: "gpt-4.1-mini" }, fetchImplementation);
  assert.deepEqual(requested.usage, { input_tokens: 100, cached_input_tokens: 20, output_tokens: 25, total_tokens: 125 });
  assert.equal(estimateOpenAICost("gpt-4.1-mini", requested.usage).estimated_cost_usd, 0.000074);
});

test("usage parser supports absent usage without inventing tokens", () => {
  assert.deepEqual(responseTokenUsage({}), { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_tokens: 0 });
});

test("API errors are isolated to the affected model", async () => {
  const prepared = { prompt: "prompt", deterministicResponse: null, sources: [{ title: "Approved evidence" }], coverage: null, productContext: "finance", question: "question", messages: [], intent: { primary_intent: "knowledge_question", clarification_required: false }, memory: { remembered_facts: {} }, buyingSignals: {}, journey: {} };
  const environment = { VERCEL_ENV: "preview", OPENAI_API_KEY: "test", OPENAI_MODEL: "gpt-4.1-mini", OPENAI_COMPARISON_MODEL: "gpt-4.1" };
  const failedFetch = async () => ({ ok: false, status: 401, statusText: "Unauthorized", json: async () => ({ error: { message: "Invalid API key" } }) });
  const successfulFetch = async () => ({ ok: true, status: 200, statusText: "OK", json: async () => ({ output_text: JSON.stringify({ reply: "Grounded answer.", insufficient_knowledge: false, human_handoff_recommended: false, recommended_action: "continue", confidence: 90, confidence_reason: "Grounded.", source_ids: ["S1"] }), usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } }) });
  const [failed, successful] = await Promise.all([runPreparedComparisonModel(prepared, "default", environment, failedFetch), runPreparedComparisonModel(prepared, "comparison", environment, successfulFetch)]);
  assert.equal(failed.status, "error"); assert.match(failed.error.message, /Invalid API key/);
  assert.equal(successful.status, "completed"); assert.equal(successful.assistant_response, "Grounded answer.");
});

test("project model availability uses a no-store server request", async () => {
  let received;
  const result = await validateConfiguredModel("gpt-4.1", { OPENAI_API_KEY: "secret" }, async (url, options) => { received = { url, options }; return { ok: true, json: async () => ({ id: "gpt-4.1" }) }; });
  assert.equal(result.available, true); assert.match(received.url, /\/v1\/models\/gpt-4\.1$/); assert.equal(received.options.cache, "no-store");
});

test("pricing estimate uses reviewed configuration and supports unavailable models", () => {
  assert.deepEqual(estimateOpenAICost("not-priced", { input_tokens: 100 }), { estimated_cost_usd: null, pricing_available: false, pricing_reviewed_at: null });
  assert.equal(estimateOpenAICost("gpt-4.1", { input_tokens: 1_000_000, output_tokens: 1_000_000 }).estimated_cost_usd, 10);
});

test("review persistence schema includes every independent rating", () => {
  const migration = source("supabase/migrations/038_preview_model_comparison.sql");
  const api = source("api/marketing-ai-assistant-competence.js");
  assert.match(migration, /knowledge_model_comparison_reviews/); assert.match(migration, /default_ratings jsonb/); assert.match(migration, /comparison_ratings jsonb/);
  assert.match(api, /MODEL_COMPARISON_RATING_FIELDS\.map/);
  const comparisonLibrary = source("lib/modelComparison.js");
  for (const field of MODEL_COMPARISON_RATING_FIELDS) assert.match(comparisonLibrary, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("reviewer scores and outcome are persisted through the protected server path", async () => {
  let stored;
  const supabase = { from: (table) => ({ upsert: (payload, options) => { stored = { table, payload, options }; return { select: () => ({ single: async () => ({ data: { id: "review", ...payload }, error: null }) }) }; } }) };
  const ratings = Object.fromEntries(MODEL_COMPARISON_RATING_FIELDS.map((field) => [field, 4]));
  const review = await saveModelComparisonReview(supabase, { comparison_id: "00000000-0000-0000-0000-000000000001", outcome: "comparison_better", default_ratings: ratings, comparison_ratings: ratings, reviewer_notes: "More natural." }, { VERCEL_ENV: "preview" });
  assert.equal(stored.table, "knowledge_model_comparison_reviews"); assert.equal(stored.options.onConflict, "comparison_id");
  assert.equal(stored.payload.outcome, "comparison_better"); assert.equal(stored.payload.default_ratings.context_understanding, 4); assert.equal(review.reviewer_notes, "More natural.");
});

test("comparison summary reports wins, timing, tokens, cost and segmented performance without significance claims", () => {
  const comparisons = [{ id: "one", submitted_message: "no", product_context: "finance", scenario_category: "negative_short", default_result: { status: "completed", response_time_ms: 100, input_tokens: 10, output_tokens: 5, estimated_cost_usd: 0.001 }, comparison_result: { status: "completed", response_time_ms: 200, input_tokens: 10, output_tokens: 6, estimated_cost_usd: 0.002 } }];
  const ratings = Object.fromEntries(MODEL_COMPARISON_RATING_FIELDS.map((field) => [field, 5]));
  const summary = modelComparisonSummary(comparisons, [{ comparison_id: "one", outcome: "comparison_better", default_ratings: ratings, comparison_ratings: ratings }]);
  assert.equal(summary.comparison_wins, 1); assert.equal(summary.by_product.finance.comparison_wins, 1); assert.equal(summary.by_scenario_category.negative_short.comparisons, 1); assert.equal(summary.difficult_short_messages.comparisons, 1); assert.equal(summary.statistical_significance_claimed, false);
});

test("protected requests and responses are no-store and request-correlated", () => {
  const service = source("services/aiAssistantCompetence.js"); const api = source("api/marketing-ai-assistant-competence.js");
  assert.match(service, /cache: "no-store"/); assert.match(service, /request_id: requestId/); assert.match(api, /Cache-Control", "no-store/); assert.match(api, /comparison_id: comparisonId/); assert.match(api, /cached_value_used: false/);
});

test("no API key or client-supplied model identifier is returned or accepted", () => {
  const publicConfiguration = publicModelComparisonConfiguration({ VERCEL_ENV: "preview", OPENAI_API_KEY: "never-return-this", OPENAI_MODEL: "gpt-4.1-mini", OPENAI_COMPARISON_MODEL: "gpt-4.1" });
  assert.doesNotMatch(JSON.stringify(publicConfiguration), /never-return-this/);
  assert.match(source("api/marketing-ai-assistant-competence.js"), /Model identifiers cannot be supplied by the browser/);
  assert.doesNotMatch(source("pages/RealCustomerSimulationPage.jsx"), /OPENAI_API_KEY|Authorization: `Bearer/);
});

test("all Marketing CRM model selection is centralised", () => {
  const apiFiles = readdirSync(new URL("api/", root)).filter((name) => name.endsWith(".js"));
  for (const name of apiFiles) {
    const file = source(`api/${name}`);
    assert.doesNotMatch(file, /process\.env\.OPENAI_MODEL|environment\.OPENAI_MODEL|"gpt-4\.1-mini"/, name);
  }
  assert.match(source("lib/openAIModelConfiguration.js"), /OPENAI_MODEL/);
});

test("controlled set contains every required exact recovery and progression input", () => {
  const messages = MODEL_COMPARISON_SCENARIOS.map((item) => item.message.toLowerCase());
  for (const required of ["two weeks", "no", "?", "what?", "eh?", "what’s my name?", "income changes", "ready to apply", "yes", "asdfghjkl"]) {
    const represented = messages.includes(required) || MODEL_COMPARISON_SCENARIOS.some((item) => item.history.some((entry) => entry.content.toLowerCase() === required));
    assert.equal(represented, true, required);
  }
});

test("comparison remains internal and adds no Wix or public assistant route", () => {
  const api = source("api/marketing-ai-assistant-competence.js"); const migration = source("supabase/migrations/038_preview_model_comparison.sql");
  assert.match(api, /competenceAuthorize/); assert.doesNotMatch(api, /public-chatbot|publishToWix|auto-submit/); assert.match(migration, /no browser policies/i);
});

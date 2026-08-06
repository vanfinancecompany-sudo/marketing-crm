import { createClient } from "@supabase/supabase-js";
import {
  AI_ASSISTANT_TEST_LIBRARY,
  COMPETENCE_PRODUCT_CONTEXTS,
  COMPETENCE_REVIEW_OUTCOMES,
  buildCompetencePrompt,
  buildKnowledgeGapReport,
  buildRetrievalCorpus,
  detectProduct,
  filterKnowledgeForProduct,
  isExplicitProductComparison,
  rankKnowledge,
} from "../lib/aiAssistantCompetence.js";
import { assessSavedCompetenceResult } from "./_knowledgeOpportunityStore.js";
import { resolveProductCoverage } from "./_productCoverage.js";
import {
  buildFinanceCoverageEvidence,
  buildRent2BuyCoverageEvidence,
  buildRent2BuyDeliveryEvidence,
  coverageConflictDetected,
  detectCoverageConflicts,
  extractUkLocation,
  isCoverageQuestion,
} from "../lib/productCoverageRules.js";
import {
  CONVERSATION_RATING_FIELDS,
  CONVERSATION_REVIEW_OUTCOMES,
  buildConversationMemory,
  classifyConversationIntent,
  conversationLearningDiagnosis,
  enforceGroundedConversationReply,
  insufficientKnowledgeReply,
  naturalConversationReply,
} from "../lib/conversationIntelligence.js";
import { REAL_CUSTOMER_SCENARIOS } from "../lib/customerSimulationScenarios.js";
import {
  applicationReadiness,
  buildConversationSummary,
  contextualClarification,
  conversationQualityDiagnostics,
  detectBuyingSignals,
  deterministicDeliveryReply,
  disclaimerControl,
  responseLengthTarget,
  naturalSalesReply,
  stripRepeatedDisclaimer,
} from "../lib/salesConversationEngine.js";
import {
  applicationModeReply,
  buildJourneyState,
  detectRepetitiveAssistantWording,
} from "../lib/applicationJourneyEngine.js";
import {
  classifyUniversalMessage,
  humanRecoveryReply,
  recentAssistantPhraseDiagnostics,
} from "../lib/humanConversationRecovery.js";
import {
  appendJourneyResume,
  completeKnowledgeOrchestration,
  orchestrateConversationTurn,
  preserveJourneyAcrossOrchestration,
} from "../lib/conversationKnowledgeOrchestrator.js";
import {
  CONVERSATION_POLISH_REVIEW_FIELDS,
  assessCtaTiming,
  polishConversationPresentation,
  serialisePolishReviewRatings,
} from "../lib/conversationPolish.js";
import {
  DETERMINISTIC_BATCH_LIMIT,
  LIVE_VALIDATION_BATCH_LIMIT,
  LIVE_VALIDATION_MAX,
  LIVE_VALIDATION_MIN,
  MAX_DETERMINISTIC_CONVERSATIONS,
  addHealthConversation,
  deterministicEvidenceReply,
  emptyHealthAccumulator,
  estimateOpenAICost,
  evaluateHealthConversation,
  liveValidationAllowed,
  representativeScenarioAt,
  summariseHealth,
  syntheticScenarioAt,
} from "../lib/aiAssistantHealth.js";
import {
  ASSISTANT_MODEL_POLICY,
  buildAssistantResponseModelParameters,
  chooseAssistantModel,
} from "../lib/aiAssistantModelRouter.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const clean = (value, limit = 10000) => String(value || "").trim().slice(0, limit);
const createRequestId = () => globalThis.crypto?.randomUUID?.() || `competence-${Date.now()}-${Math.random().toString(16).slice(2)}`;
class ApiError extends Error { constructor(status, message, type = "api", details = {}) { super(message); this.name = "ApiError"; this.status = status; this.type = type; this.details = details; } }
export function competenceAuthorize(request, environment = process.env) { const expected = clean(environment.MARKETING_CUSTOMER_DATABASE_API_KEY); const header = clean(request.headers?.[API_KEY_HEADER]); const bearer = clean(request.headers?.authorization).replace(/^Bearer\s+/i, ""); return Boolean(expected && (header === expected || bearer === expected)); }
function getSupabase() { if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new ApiError(500, "Supabase is not configured.", "configuration"); return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); }
function parseBody(request) { if (!request.body) return {}; if (typeof request.body === "object") return request.body; try { return JSON.parse(request.body); } catch { throw new ApiError(400, "The request body is not valid JSON.", "validation"); } }
function data(result, fallback) { if (result.error) throw new ApiError(500, result.error.message || fallback); return result.data; }
function elapsed(start) { return Math.max(0, Math.round(performance.now() - start)); }
function diagnosticContext(context = {}) {
  return Object.fromEntries(Object.entries(context).filter(([, value]) => value !== undefined));
}
function logStageError(stage, error, start, context = {}) {
  console.error("AI ASSISTANT COMPETENCE STAGE ERROR", {
    stage,
    exception_type: error?.name || error?.constructor?.name || typeof error,
    exception_message: clean(error?.message || error, 2000),
    stack_trace: clean(error?.stack, 10000) || null,
    relevant_ids: diagnosticContext(context),
    elapsed_time_ms: elapsed(start),
    ...(error?.details || {}),
  });
}
async function runStage(stage, context, operation) {
  const start = performance.now();
  try {
    return await operation();
  } catch (error) {
    logStageError(stage, error, start, context);
    error.stage ||= stage;
    throw error;
  }
}

const ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "confidence", "confidence_reason", "product_detected", "knowledge_gap", "conflict_detected", "source_ids"],
  properties: {
    answer: { type: "string" },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    confidence_reason: { type: "string" },
    product_detected: { type: "string", enum: ["finance", "rent2buy", "both", "unknown"] },
    knowledge_gap: { type: "boolean" },
    conflict_detected: { type: "boolean" },
    source_ids: { type: "array", items: { type: "string", pattern: "^S[1-8]$" }, maxItems: 8 },
  },
};

const CONVERSATION_REPLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "insufficient_knowledge", "human_handoff_recommended", "recommended_action", "confidence", "confidence_reason", "source_ids"],
  properties: {
    reply: { type: "string" },
    insufficient_knowledge: { type: "boolean" },
    human_handoff_recommended: { type: "boolean" },
    recommended_action: { type: "string", enum: ["continue", "clarify", "apply_finance", "apply_rent2buy", "human_handoff", "none"] },
    confidence: { type: "integer", minimum: 0, maximum: 100 },
    confidence_reason: { type: "string" },
    source_ids: { type: "array", items: { type: "string", pattern: "^S[1-8]$" }, maxItems: 8 },
  },
};

async function loadKnowledge(supabase) {
  const settings = await runStage("Load knowledge settings", {}, async () => data(await supabase.from("knowledge_settings").select("*").eq("settings_key", "default").maybeSingle(), "Knowledge settings could not be loaded.") || {});
  const sections = await runStage("Load Business Brain", {}, async () => data(await supabase.from("knowledge_business_sections").select("*").eq("active", true).order("sort_order", { ascending: true }), "Business Brain could not be loaded.") || []);
  const normalisedSections = await runStage("Load FAQs", { section_ids: sections.map((item) => item.id), section_count: sections.length }, async () => sections.map((section) => ({
    ...section,
    content: section.content ?? "",
    entries: Array.isArray(section.entries) ? section.entries : [],
  })));
  const articles = await runStage("Load Knowledge Hub articles", {}, async () => data(await supabase.from("knowledge_articles").select("id,title,category,content_markdown,faq_json,live_wix_url,status,is_active").eq("status", "approved").eq("is_active", true).order("updated_at", { ascending: false }), "Approved articles could not be loaded.") || []);
  return {
    settings,
    sections: normalisedSections,
    articles,
  };
}

function openAIErrorMessage(payload, response) {
  const apiError = payload?.error || {};
  const label = [response.status, response.statusText].filter(Boolean).join(" ");
  return `OpenAI request failed (${label || "unknown status"}${apiError.type ? `, ${apiError.type}` : ""}${apiError.code ? `, ${apiError.code}` : ""}): ${apiError.message || "No error message returned."}`;
}

export async function requestOpenAIAnswer(prompt, environment = process.env, fetchImplementation = fetch) {
  const apiKey = clean(environment.OPENAI_API_KEY);
  if (!apiKey) throw new ApiError(500, "OPENAI_API_KEY is not configured.", "configuration", { openai_api_key_present: false });
  const model = clean(environment.OPENAI_MODEL, 200) || "gpt-4.1-mini";
  const response = await fetchImplementation("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: "You are an internal competence-test version of a UK van website assistant. Use only supplied evidence and follow the schema exactly." },
        { role: "user", content: prompt },
      ],
      text: { format: { type: "json_schema", name: "assistant_competence_answer", strict: true, schema: ANSWER_SCHEMA } },
    }),
  });
  let payload;
  try { payload = await response.json(); } catch (error) { throw new ApiError(502, `OpenAI returned a non-JSON response (${response.status} ${response.statusText}).`, "ai", { model, openai_status: response.status, cause: clean(error.message, 500) }); }
  if (!response.ok) throw new ApiError(502, openAIErrorMessage(payload, response), "ai", { model, openai_status: response.status, openai_error_type: payload?.error?.type || null, openai_error_code: payload?.error?.code || null });
  return { payload, model };
}

export function parseOpenAIAnswer(payload, model) {
  const output = payload.output_text || payload.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!output) throw new ApiError(502, "The AI returned no competence-test answer.", "ai");
  let answer;
  try { answer = JSON.parse(output); } catch (error) { throw new ApiError(502, `The AI returned invalid JSON: ${error.message}`, "validation", { model }); }
  const required = ANSWER_SCHEMA.required;
  const missing = required.filter((key) => !(key in (answer || {})));
  if (!answer || typeof answer !== "object" || Array.isArray(answer) || missing.length) throw new ApiError(502, `The structured answer is missing required fields: ${missing.join(", ") || "invalid object"}.`, "validation", { model });
  answer.source_ids = [...new Set((Array.isArray(answer.source_ids) ? answer.source_ids : []).filter((id) => /^S[1-8]$/.test(id)))];
  return { answer, model };
}

export async function requestOpenAIConversationReply(prompt, route = {}, environment = process.env, fetchImplementation = fetch) {
  const apiKey = clean(environment.OPENAI_API_KEY);
  if (!apiKey) throw new ApiError(500, "OPENAI_API_KEY is not configured.", "configuration", { openai_api_key_present: false });
  const modelParameters = buildAssistantResponseModelParameters(route);
  const model = modelParameters.model;
  const response = await fetchImplementation("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...modelParameters,
      input: [
        { role: "system", content: "You are the grounded internal simulation of a UK van website assistant. Compose only the customer-facing reply. Never override product context, deterministic rules, remembered facts or supplied evidence." },
        { role: "user", content: prompt },
      ],
      text: { format: { type: "json_schema", name: "conversation_simulation_reply", strict: true, schema: CONVERSATION_REPLY_SCHEMA } },
    }),
  });
  let payload;
  try { payload = await response.json(); } catch (error) { throw new ApiError(502, `OpenAI returned a non-JSON conversation response (${response.status} ${response.statusText}).`, "ai", { model, cause: clean(error.message, 500) }); }
  if (!response.ok) throw new ApiError(502, openAIErrorMessage(payload, response), "ai", { model, openai_status: response.status });
  return {
    payload,
    model,
    route: {
      ...route,
      model,
      temperature: modelParameters.temperature,
      reasoning_effort: modelParameters.reasoning?.effort || null,
    },
  };
}

export function parseOpenAIConversationReply(payload, model) {
  const output = payload.output_text || payload.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!output) throw new ApiError(502, "The AI returned no conversation reply.", "ai", { model });
  let parsed;
  try { parsed = JSON.parse(output); } catch (error) { throw new ApiError(502, `The AI returned invalid conversation JSON: ${error.message}`, "validation", { model }); }
  const missing = CONVERSATION_REPLY_SCHEMA.required.filter((key) => !(key in (parsed || {})));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || missing.length) throw new ApiError(502, `The conversation reply is missing required fields: ${missing.join(", ") || "invalid object"}.`, "validation", { model });
  if (!CONVERSATION_REPLY_SCHEMA.properties.recommended_action.enum.includes(parsed.recommended_action)) throw new ApiError(502, "The conversation reply contains an unsupported recommended action.", "validation", { model });
  parsed.source_ids = [...new Set((Array.isArray(parsed.source_ids) ? parsed.source_ids : []).filter((id) => /^S[1-8]$/.test(id)))];
  return { reply: parsed, model };
}

function cleanMessages(messages) {
  return (Array.isArray(messages) ? messages : []).slice(-8).map((message) => ({ role: message?.role === "assistant" ? "assistant" : "user", content: clean(message?.content, 3000) })).filter((message) => message.content);
}

export async function testCompetenceAnswer(supabase, body) {
  const totalStart = performance.now();
  const retrievalStart = performance.now();
  const question = clean(body.question, 3000);
  if (!question) throw new ApiError(400, "Enter a customer question.", "validation");
  const mode = ["single", "conversation", "test_set"].includes(body.mode) ? body.mode : "single";
  const productContext = clean(body.product_context, 20).toLowerCase();
  if (!COMPETENCE_PRODUCT_CONTEXTS.includes(productContext)) throw new ApiError(400, "Choose a product context: finance or rent2buy.", "validation");
  const messages = cleanMessages(body.messages);
  const comparison = isExplicitProductComparison(question, messages);
  const requestId = clean(body.request_id, 100) || createRequestId();
  const context = { request_id: requestId, run_id: body.run_id || null, test_question_id: clean(body.test_question_id, 40) || null, product_context: productContext };
  console.info("AI ASSISTANT COMPETENCE REQUEST TRACE", { stage: "Backend request body", request_id: requestId, submitted_question: question, selected_product: productContext, mode, cached_value_used: false, previous_value_used: false });
  const knowledge = await loadKnowledge(supabase);
  const boundedKnowledge = await runStage("Apply product boundary", { ...context, comparison }, async () => filterKnowledgeForProduct(knowledge, productContext, { comparison }));
  const corpus = await runStage("Build temporary article chunks", { ...context, category_filter: boundedKnowledge.categoryFilter, article_ids: boundedKnowledge.articles.map((item) => item.id), article_count: boundedKnowledge.articles.length }, async () => buildRetrievalCorpus(boundedKnowledge));
  const coverage = await runStage("Resolve deterministic coverage", context, () => resolveProductCoverage({ question, productContext, settings: knowledge.settings }));
  const lexicalSources = await runStage("Lexical ranking", { ...context, corpus_size: corpus.length }, async () => rankKnowledge(question, corpus, { messages, limit: coverage ? 7 : 8 }));
  const coverageConflicts = await runStage("Check coverage conflicts", context, async () => detectCoverageConflicts(coverage, corpus, knowledge.settings));
  if (coverage) coverage.diagnostics.conflicting_sources = coverageConflicts;
  const sources = coverage ? [coverage.source, ...lexicalSources].slice(0, 8) : lexicalSources;
  if (!sources.length) console.warn("AI ASSISTANT COMPETENCE RETRIEVAL WARNING", { stage: "Lexical ranking", relevant_ids: context, corpus_size: corpus.length, message: "No relevant sources were retrieved; the assistant must report a knowledge gap." });
  const retrievalTime = elapsed(retrievalStart);
  const generationStart = performance.now();
  const prompt = await runStage("Prompt creation", { ...context, category_filter: boundedKnowledge.categoryFilter, source_count: sources.length }, async () => buildCompetencePrompt({ question, messages, sources, sections: boundedKnowledge.sections, settings: knowledge.settings, productContext, comparison }));
  if (!prompt.includes(`# Customer question\n${question}\n`)) throw new ApiError(500, "Generated prompt does not contain the current submitted question.", "validation");
  const model = clean(process.env.OPENAI_MODEL, 200) || "gpt-4.1-mini";
  const requested = await runStage("OpenAI request", { ...context, model, openai_api_key_present: Boolean(clean(process.env.OPENAI_API_KEY)), source_count: sources.length }, () => requestOpenAIAnswer(prompt));
  const generated = await runStage("Structured response parsing", { ...context, model: requested.model }, async () => parseOpenAIAnswer(requested.payload, requested.model));
  const generationTime = elapsed(generationStart);
  const selected = new Set(generated.answer.source_ids || []);
  if (coverage) selected.add("S1");
  const sourcesUsed = sources.filter((_source, index) => selected.has(`S${index + 1}`));
  const resultPayload = {
    run_id: body.run_id || null,
    test_question_id: clean(body.test_question_id, 40) || null,
    mode,
    product_context: productContext,
    question,
    conversation: messages,
    answer: clean(generated.answer.answer, 5000),
    product_detected: generated.answer.product_detected || detectProduct(question, messages),
    confidence: Number(generated.answer.confidence) || 0,
    confidence_reason: clean(generated.answer.confidence_reason, 2000),
    knowledge_gap: coverage ? coverage.diagnostics.certainty === "unresolved" : Boolean(generated.answer.knowledge_gap || sources.length === 0),
    conflict_detected: coverageConflictDetected(generated.answer.conflict_detected, coverageConflicts),
    coverage_diagnostics: coverage?.diagnostics || {},
    sources_used: sourcesUsed,
    response_time_ms: elapsed(totalStart),
    retrieval_time_ms: retrievalTime,
    generation_time_ms: generationTime,
    model: generated.model,
  };
  const saved = await runStage("Save test result", context, async () => data(await supabase.from("knowledge_competence_results").insert(resultPayload).select().single(), "The competence result could not be saved."));
  if (!saved?.id || clean(saved.question, 3000) !== question) throw new ApiError(500, "Saved competence result does not match the current request.", "validation", { request_id: requestId, result_id: saved?.id || null });
  await assessSavedCompetenceResult(supabase, saved.id);
  if (body.run_id) await supabase.rpc("increment_competence_run_progress", { target_run_id: body.run_id }).then(() => {}, () => {});
  const generatedAt = new Date().toISOString();
  const requestTrace = {
    request_id: requestId,
    submitted_question: question,
    selected_product: productContext,
    backend_question: question,
    retrieval_query: question,
    prompt_question: question,
    openai_response_id: clean(requested.payload?.id, 100) || null,
    result_id: saved.id,
    result_question: saved.question,
    generated_at: generatedAt,
    cached_value_used: false,
    previous_value_used: false,
    retrieved_source_ids: sources.map((source) => source.source_id),
    used_source_ids: sourcesUsed.map((source) => source.source_id),
  };
  console.info("AI ASSISTANT COMPETENCE REQUEST TRACE", { stage: "Return response", ...requestTrace });
  return { result: { ...saved, product_context: productContext, category_filter: boundedKnowledge.categoryFilter, comparison_mode: comparison, coverage_diagnostics: coverage?.diagnostics || {} }, retrieved_sources: sources, word_count: resultPayload.answer.split(/\s+/).filter(Boolean).length, request_trace: requestTrace };
}

function conversationRetrievalQuery(intent, memory, messages) {
  const recent = messages.filter((item) => item.role === "user").slice(-3).map((item) => item.content).join(" ");
  const facts = Object.entries(memory.remembered_facts).map(([key, value]) => `${key.replace(/_/g, " ")} ${value}`).join(" ");
  return clean(`${recent} ${intent.normalised_message} ${facts}`, 6000);
}

export function conversationPrompt({ question, messages, sources, sections, settings, productContext, comparison, intent, memory, buyingSignals = {}, lengthTarget = {}, contextualResolution = "", journey = {}, human = {}, phraseDiagnostics = {} }) {
  const base = buildCompetencePrompt({ question, messages, sources, sections, settings, productContext, comparison });
  const disclaimer = disclaimerControl(messages);
  return `${base}\n\n# Locked V5 human conversation and recovery\nUniversal message type: ${human.message_type || "question"} (${human.confidence || 0}% confidence). Customer emotion: ${human.emotion?.emotion || "neutral"}. Objection: ${human.objection?.objection || "none"}. The server conversation intent is ${intent.primary_intent}; secondary intents: ${intent.secondary_intents.join(", ") || "none"}. The locked product remains ${productContext} and must never be cross-sold. Remembered structured customer facts: ${JSON.stringify(memory.remembered_facts)}. Corrections: ${JSON.stringify(memory.corrections)}. Buying signal: ${buyingSignals.detected_buying_signal || "none"} (${buyingSignals.signal_strength || "low"}). Buying intent level: ${journey.buying_intent_level || "Research"}. Current customer goal: ${journey.conversation_goal || "Research"}. Journey stage: ${journey.journey_stage || "Research"}. Recommended single action: ${journey.recommended_cta || buyingSignals.recommended_next_action || "Continue conversation"}. Next best question: ${journey.next_best_question || "none"}. Context resolution: ${contextualResolution || "none required"}. Recently used terms to avoid repeating mechanically: ${(phraseDiagnostics.recently_used_terms || []).join(", ") || "none"}. Target reply band: ${lengthTarget.band || "normal"}, maximum ${lengthTarget.maximum_words || 90} words. Be helpful, friendly, patient and professional. Acknowledge an objection or emotion naturally before progressing. Listen, answer, reassure, progress, then stop. Ask at most one useful question, never ask for a known fact, and ask none when the factual answer or natural closing is complete. Never expose classifications, scores, rules or internal reasoning. Avoid repeated openings and unnecessary full disclaimers. ${disclaimer.instruction} Never invent approval likelihood, stock, rates, payment figures, affordability outcomes or a delivery date. Deterministic evidence is the highest-priority fact and overrides every article, Business Brain passage and model inference. If approved evidence is insufficient, use a plain, honest fallback and do not infer a business fact.`;
}

export async function simulateCustomerConversation(supabase, body, options = {}) {
  const totalStart = performance.now();
  const question = clean(body.message || body.question, 3000);
  if (!question) throw new ApiError(400, "Enter a customer message.", "validation");
  const productContext = clean(body.product_context, 20).toLowerCase();
  if (!COMPETENCE_PRODUCT_CONTEXTS.includes(productContext)) throw new ApiError(400, "Choose a locked product context: finance or rent2buy.", "validation");
  const messages = cleanMessages(body.messages);
  const requestId = clean(body.request_id, 100) || createRequestId();
  const sessionId = clean(body.session_id, 100) || requestId;
  const context = { request_id: requestId, session_id: sessionId, scenario_id: clean(body.scenario_id, 50) || null, product_context: productContext };
  const human = await runStage("Universal message classification", context, async () => classifyUniversalMessage({ message: question, messages, journey: body.journey_state }));
  const intent = await runStage("Conversation intent", context, async () => classifyConversationIntent({ message: question, history: messages, productContext }));
  const conversationWithCurrent = [...messages, { role: "user", content: question }];
  const memory = await runStage("Conversation memory", context, async () => buildConversationMemory(conversationWithCurrent, body.remembered_facts));
  const contextualResolution = contextualClarification(question, messages, memory.remembered_facts);
  if (/^how long\??$/i.test(question) && contextualResolution) {
    intent.clarification_required = true;
    intent.retrieval_required = false;
    intent.suggested_clarification_question = contextualResolution;
  }
  const buyingSignals = await runStage("Buying signal detection", context, async () => detectBuyingSignals(question, memory.remembered_facts));
  const lengthTarget = responseLengthTarget(question, intent);
  const updatedFacts = Object.fromEntries(Object.entries(memory.remembered_facts).filter(([key, value]) => clean(body.remembered_facts?.[key]) !== clean(value)));
  if (human.message_type === "objection" && !["uncertainty"].includes(human.objection.objection) && intent.primary_intent !== "product_clarification_required") intent.retrieval_required = true;
  let journey = await runStage("Application journey", context, async () => buildJourneyState({ message: question, messages, intent, facts: memory.remembered_facts, factMetadata: memory.fact_metadata, productContext, priorJourney: body.journey_state, updatedFacts }));
  let orchestration = await runStage("Conversation and knowledge orchestration", context, async () => orchestrateConversationTurn({ message: question, intent, human, journey, priorJourney: body.journey_state, buyingSignals }));
  journey = preserveJourneyAcrossOrchestration(journey, body.journey_state, orchestration);
  intent.retrieval_required = orchestration.retrieval_required;
  if (orchestration.retrieval_required || orchestration.recovery_required || orchestration.application_continuation) {
    intent.clarification_required = false;
    intent.suggested_clarification_question = "";
  }
  const recoveryRequired = orchestration.recovery_required;
  const comparison = isExplicitProductComparison(question, messages);
  let sources = [];
  let sourcesUsed = [];
  let coverage = null;
  let coverageConflicts = [];
  let categoryFilter = productContext === "rent2buy" ? "Rent2Buy only" : "All approved Finance categories; exclude Rent2Buy";
  let retrievalTime = 0;
  let generationTime = 0;
  let model = "deterministic-conversation-rules";
  let modelRoute = {
    model,
    tier: "deterministic",
    temperature: null,
    reasoning_effort: null,
    reason: "The turn was handled by canonical server-side conversation rules without an OpenAI generation call.",
  };
  let tokenUsage = { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
  let openAIResponseId = null;
  let response;
  const priorPhraseDiagnostics = recentAssistantPhraseDiagnostics(messages);

  if (!intent.retrieval_required) {
    response = recoveryRequired && intent.primary_intent !== "product_clarification_required"
      ? humanRecoveryReply(human, { messages, facts: memory.remembered_facts, productContext, journey })
      : naturalSalesReply(intent, productContext, buyingSignals, memory.remembered_facts) || naturalConversationReply(intent, productContext, memory.remembered_facts);
  } else {
    const retrievalStart = performance.now();
    const knowledge = options.knowledge || await loadKnowledge(supabase);
    const bounded = await runStage("Apply conversation product boundary", { ...context, comparison }, async () => filterKnowledgeForProduct(knowledge, productContext, { comparison }));
    categoryFilter = bounded.categoryFilter;
    const corpus = await runStage("Build conversation article chunks", { ...context, article_count: bounded.articles.length }, async () => buildRetrievalCorpus(bounded));
    const retrievalQuery = conversationRetrievalQuery(intent, memory, conversationWithCurrent);
    const location = memory.remembered_facts.location;
    const coverageQuestion = intent.secondary_intents.includes("coverage") && location ? `coverage for ${location}` : question;
    const coverageResolver = options.coverageResolver || resolveProductCoverage;
    coverage = await runStage("Resolve conversation deterministic coverage", context, () => coverageResolver({ question: coverageQuestion, productContext, settings: knowledge.settings }));
    const lexical = await runStage("Conversation lexical ranking", { ...context, retrieval_query: retrievalQuery }, async () => rankKnowledge(retrievalQuery, corpus, { messages, limit: coverage ? 7 : 8 }));
    coverageConflicts = await runStage("Check conversation coverage conflicts", context, async () => detectCoverageConflicts(coverage, corpus, knowledge.settings));
    if (coverage) coverage.diagnostics.conflicting_sources = coverageConflicts;
    sources = coverage ? [coverage.source, ...lexical].slice(0, 8) : lexical;
    retrievalTime = elapsed(retrievalStart);
    if (!sources.length) {
      response = insufficientKnowledgeReply(productContext);
    } else if (options.generationMode === "deterministic") {
      response = deterministicEvidenceReply(sources, productContext);
      sourcesUsed = sources.slice(0, 1);
      model = "deterministic-health-engine";
      modelRoute = {
        model,
        tier: "deterministic",
        temperature: null,
        reasoning_effort: null,
        reason: "The deterministic health engine generated the evidence response without an OpenAI call.",
      };
    } else {
      const generationStart = performance.now();
      const prompt = await runStage("Conversation prompt creation", { ...context, source_count: sources.length }, async () => conversationPrompt({ question, messages, sources, sections: bounded.sections, settings: knowledge.settings, productContext, comparison, intent, memory, buyingSignals, lengthTarget, contextualResolution, journey, human, phraseDiagnostics: priorPhraseDiagnostics }));
      const selectedModelRoute = chooseAssistantModel({
        message: question,
        intent,
        human,
        orchestration,
        sourceCount: sources.length,
      });
      const requested = await runStage("Conversation OpenAI request", { ...context, source_count: sources.length, model: selectedModelRoute.model, model_tier: selectedModelRoute.tier }, () => requestOpenAIConversationReply(prompt, selectedModelRoute));
      modelRoute = requested.route;
      const generated = await runStage("Conversation structured response parsing", { ...context, model: requested.model }, async () => parseOpenAIConversationReply(requested.payload, requested.model));
      response = generated.reply;
      model = generated.model;
      tokenUsage = {
        input_tokens: Number(requested.payload?.usage?.input_tokens) || 0,
        output_tokens: Number(requested.payload?.usage?.output_tokens) || 0,
        total_tokens: Number(requested.payload?.usage?.total_tokens) || (Number(requested.payload?.usage?.input_tokens) || 0) + (Number(requested.payload?.usage?.output_tokens) || 0),
      };
      openAIResponseId = clean(requested.payload?.id, 100) || null;
      response = enforceGroundedConversationReply(response, { deterministicRuleUsed: Boolean(coverage), productContext });
      const deterministicDelivery = deterministicDeliveryReply(productContext, question, coverage);
      if (deterministicDelivery) response = { ...response, reply: deterministicDelivery, insufficient_knowledge: false, confidence: 100, confidence_reason: "Server-side approved delivery rule.", source_ids: ["S1"] };
      response.reply = stripRepeatedDisclaimer(response.reply, messages);
      const selected = new Set(response.source_ids || []);
      if (coverage) selected.add("S1");
      sourcesUsed = sources.filter((_source, index) => selected.has(`S${index + 1}`));
      generationTime = elapsed(generationStart);
    }
  }

  if (journey.application_mode_active && !intent.retrieval_required && !recoveryRequired && !orchestration.product_boundary_blocked) {
    response = { ...response, reply: applicationModeReply(productContext, journey.application_state), insufficient_knowledge: false, human_handoff_recommended: false, recommended_action: productContext === "finance" ? "apply_finance" : "apply_rent2buy", confidence: 100, confidence_reason: "Server-side V4 Application Mode triggered by explicit customer progression.", source_ids: [] };
  }

  orchestration = completeKnowledgeOrchestration(orchestration, {
    retrievalPerformed: intent.retrieval_required && sources.length > 0,
    journey,
    sourceIds: sources.map((source) => source.source_id),
  });
  response.reply = appendJourneyResume(response.reply, productContext, orchestration);
  const ctaTiming = assessCtaTiming({
    journey,
    facts: memory.remembered_facts,
    productContext,
    insufficientKnowledge: response.insufficient_knowledge,
    conflictDetected: coverageConflictDetected(false, coverageConflicts),
  });
  const polish = polishConversationPresentation({
    reply: response.reply,
    question,
    messages,
    productContext,
    orchestration,
    intent,
    journey,
    ctaTiming,
    insufficientKnowledge: response.insufficient_knowledge,
  });
  response.reply = polish.reply;
  const applicationCta = journey.application_cta || ctaTiming.cta;

  const learningDiagnosis = conversationLearningDiagnosis({ intent, coverage, insufficientKnowledge: response.insufficient_knowledge });
  const repetitiveWording = detectRepetitiveAssistantWording(messages, response.reply);
  const phraseDiagnostics = recentAssistantPhraseDiagnostics(messages, response.reply);
  const quality = conversationQualityDiagnostics({ message: question, reply: response.reply, intent, messages, followUpAppropriate: !journey.application_mode_active && Boolean(intent.clarification_required || journey.next_best_question) });
  const readiness = applicationReadiness({ intent, buyingSignals, facts: memory.remembered_facts, insufficientKnowledge: response.insufficient_knowledge, contradiction: memory.corrections.length > 0 && intent.primary_intent === "customer_correction" });
  const conversationSummary = buildConversationSummary({ productContext, facts: memory.remembered_facts, buyingSignals, intent, insufficientKnowledge: response.insufficient_knowledge, humanHandoff: response.human_handoff_recommended });
  const structured = {
    reply: clean(response.reply, 5000),
    conversation_intent: intent.primary_intent,
    original_message: question,
    normalised_message: intent.normalised_message,
    secondary_intents: intent.secondary_intents,
    detected_product: intent.detected_product,
    product_context: productContext,
    retrieval_required: intent.retrieval_required,
    retrieval_used: intent.retrieval_required && sources.length > 0,
    clarification_required: intent.clarification_required,
    clarification_question: intent.suggested_clarification_question,
    remembered_facts: memory.remembered_facts,
    remembered_fact_metadata: memory.fact_metadata,
    updated_facts: updatedFacts,
    corrections: memory.corrections,
    deterministic_rules_used: coverage ? [coverage.source.source_id] : [],
    knowledge_sources_used: sourcesUsed,
    insufficient_knowledge: Boolean(response.insufficient_knowledge),
    human_handoff_recommended: Boolean(response.human_handoff_recommended),
    recommended_action: response.recommended_action,
    confidence: Math.min(100, Math.max(0, Number(response.confidence) || 0)),
    confidence_reason: clean(response.confidence_reason, 2000),
    intent_confidence: intent.confidence,
    intent_reason: intent.reason,
    coverage_diagnostics: coverage?.diagnostics || {},
    conflict_detected: coverageConflictDetected(false, coverageConflicts),
    learning_diagnosis: learningDiagnosis,
    buying_signal: buyingSignals.detected_buying_signal,
    buying_signal_strength: buyingSignals.signal_strength,
    buying_signal_reason: buyingSignals.reason,
    recommended_next_conversational_action: buyingSignals.recommended_next_action,
    response_length_target: quality.response_length_target,
    response_word_count: quality.actual_word_count,
    repeated_disclaimer: quality.repeated_disclaimer,
    next_best_question: journey.next_best_question || conversationSummary.next_best_question,
    application_readiness: journey.application_readiness || readiness,
    conversation_summary: { ...conversationSummary, application_readiness: journey.application_readiness || readiness, conversation_goal: journey.conversation_goal, journey_stage: journey.journey_stage, lead_completeness: journey.lead_completeness, recommended_cta: ctaTiming.generated_early ? "Show application button" : journey.recommended_cta },
    frustration_state: intent.primary_intent === "frustration" ? "active" : "none",
    sounded_article_like: quality.sounded_article_like,
    follow_up_question_appropriate: quality.follow_up_question_appropriate,
    one_question_at_a_time: quality.one_question_at_a_time,
    contextual_resolution: contextualResolution,
    buying_intent_level: journey.buying_intent_level,
    buying_intent_score: journey.buying_intent_score,
    buying_intent_confidence: journey.buying_intent_confidence,
    buying_intent_reasons: journey.buying_intent_reasons,
    conversation_goal: journey.conversation_goal,
    journey_stage: journey.journey_stage,
    lead_completeness: journey.lead_completeness,
    application_mode_active: journey.application_mode_active,
    application_state: journey.application_state,
    application_cta: applicationCta,
    application_cta_generated: Boolean(applicationCta),
    recommended_cta: ctaTiming.generated_early ? "Show application button" : journey.recommended_cta,
    cta_generated_early: ctaTiming.generated_early,
    cta_timing_eligible: ctaTiming.eligible,
    cta_timing_reason: ctaTiming.reason,
    cta_missing_required_facts: ctaTiming.missing_required_facts || [],
    conversation_progressing: journey.conversation_progressing,
    conversation_stalled: journey.conversation_stalled,
    journey_next_best_question: journey.next_best_question,
    repeated_assistant_wording: repetitiveWording.repeated,
    repeated_assistant_phrase: repetitiveWording.phrase,
    universal_message_type: human.message_type,
    universal_message_confidence: human.confidence,
    universal_message_reason: human.reason,
    conversation_confidence_below_threshold: human.low_confidence,
    recovery_required: recoveryRequired,
    recovery_rule_used: recoveryRequired && !journey.application_mode_active,
    customer_emotion: human.emotion.emotion,
    customer_emotion_confidence: human.emotion.confidence,
    customer_emotion_reason: human.emotion.reason,
    objection_detected: human.objection.detected,
    objection_type: human.objection.objection,
    objection_reason: human.objection.reason,
    repeated_phrase_detected: phraseDiagnostics.repeated_phrase_detected,
    recent_phrase_matches: phraseDiagnostics.recent_phrase_matches,
    detected_intents: orchestration.detected_intents,
    retrieval_performed: orchestration.retrieval_performed,
    conversation_paused: orchestration.conversation_paused,
    conversation_resumed: orchestration.conversation_resumed,
    resume_reason: orchestration.resume_reason,
    knowledge_source_ids: orchestration.knowledge_source_ids,
    journey_stage_before_retrieval: orchestration.journey_stage_before_retrieval,
    journey_stage_after_retrieval: orchestration.journey_stage_after_retrieval,
    application_mode_paused: orchestration.application_mode_paused,
    application_mode_resumed: orchestration.application_mode_resumed,
    priority_path_taken: orchestration.priority_path_taken,
    repeated_fact_score: polish.repeated_fact_score,
    repeated_fact_keys: polish.repeated_fact_keys,
    recently_communicated_facts: polish.recently_communicated_facts,
    recent_phrase_similarity: polish.recent_phrase_similarity,
    conversation_variety_score: polish.conversation_variety_score,
    redundancy_score: polish.redundancy_score,
    human_feel_rating: polish.human_feel_rating,
    response_sentence_count: polish.response_sentence_count,
    preferred_sentence_range_met: polish.preferred_sentence_range_met,
    polish_transition_applied: polish.transition_applied,
    polish_transition_type: polish.transition_type,
    factual_reply_preserved: polish.factual_reply_preserved,
    model_route: modelRoute,
    token_usage: tokenUsage,
    estimated_cost_usd: options.generationMode === "deterministic" ? 0 : estimateOpenAICost(tokenUsage),
    openai_response_id: openAIResponseId,
  };
  const resultPayload = {
    run_id: body.run_id || null,
    test_question_id: clean(body.scenario_id, 50) || null,
    mode: "conversation",
    product_context: productContext,
    question,
    conversation: messages,
    answer: structured.reply,
    product_detected: ["finance", "rent2buy", "both"].includes(intent.detected_product) ? intent.detected_product : productContext,
    confidence: structured.confidence,
    confidence_reason: structured.confidence_reason,
    knowledge_gap: structured.insufficient_knowledge,
    conflict_detected: structured.conflict_detected,
    sources_used: sourcesUsed,
    response_time_ms: elapsed(totalStart),
    retrieval_time_ms: retrievalTime,
    generation_time_ms: generationTime,
    model,
    coverage_diagnostics: structured.coverage_diagnostics,
    conversation_intent: intent.primary_intent,
    secondary_intents: intent.secondary_intents,
    conversation_diagnostics: structured,
    learning_diagnosis: learningDiagnosis,
    simulation_session_id: sessionId,
  };
  const saved = options.persist === false
    ? { ...resultPayload, id: `health-${requestId}` }
    : await runStage("Save conversation simulation", context, async () => data(await supabase.from("knowledge_competence_results").insert(resultPayload).select().single(), "The conversation simulation could not be saved."));
  if (options.persist !== false) await assessSavedCompetenceResult(supabase, saved.id);
  const trace = { request_id: requestId, session_id: sessionId, submitted_question: question, result_question: saved.question, result_id: saved.id, selected_product: productContext, generated_at: new Date().toISOString(), cached_value_used: false, previous_value_used: false };
  return { result: { ...structured, id: saved.id, response_time_ms: resultPayload.response_time_ms, retrieval_time_ms: retrievalTime, generation_time_ms: generationTime, model, model_route: modelRoute, category_filter: categoryFilter }, request_trace: trace };
}

function deterministicHealthCoverage({ question, productContext, settings = {} } = {}) {
  if (!isCoverageQuestion(question)) return null;
  if (productContext === "finance") return buildFinanceCoverageEvidence(question, settings);
  if (productContext !== "rent2buy") return null;
  const delivery = buildRent2BuyDeliveryEvidence(question, settings);
  if (delivery) return delivery;
  return buildRent2BuyCoverageEvidence({ location: extractUkLocation(question), settings });
}

async function executeHealthConversation(supabase, scenario, { generationMode, knowledge }) {
  let messages = [];
  let rememberedFacts = {};
  let journeyState = {};
  const turns = [];
  for (let turnIndex = 0; turnIndex < scenario.messages.length; turnIndex += 1) {
    const message = scenario.messages[turnIndex];
    const requestId = `health-${scenario.id}-${turnIndex + 1}`;
    const response = await simulateCustomerConversation(supabase, {
      request_id: requestId,
      session_id: `health-${scenario.id}`,
      scenario_id: scenario.source_scenario_id || scenario.id,
      message,
      product_context: scenario.product_context,
      messages,
      remembered_facts: rememberedFacts,
      journey_state: journeyState,
    }, {
      persist: false,
      generationMode,
      knowledge,
      coverageResolver: generationMode === "deterministic" ? deterministicHealthCoverage : resolveProductCoverage,
    });
    turns.push({ message, result: response.result });
    messages = [...messages, { role: "user", content: message }, { role: "assistant", content: response.result.reply }];
    rememberedFacts = response.result.remembered_facts || rememberedFacts;
    journeyState = response.result;
  }
  return evaluateHealthConversation({ scenario, turns, mode: generationMode === "deterministic" ? "deterministic" : "live" });
}

function failedHealthConversation(scenario, mode, error) {
  const evaluated = evaluateHealthConversation({ scenario, turns: [], mode });
  const failure = {
    rule: mode === "live" ? "live_generation_error" : "simulation_error",
    turn: 0,
    message: "",
    detail: clean(error?.message || error, 1000),
  };
  return { ...evaluated, rule_violations: 1, failures: [failure] };
}

export async function runDeterministicHealthBatch(supabase, body) {
  const startIndex = Math.max(0, Math.floor(Number(body.start_index) || 0));
  const count = Math.min(DETERMINISTIC_BATCH_LIMIT, Math.max(1, Math.floor(Number(body.count) || 1)));
  const requestedTotal = Math.min(MAX_DETERMINISTIC_CONVERSATIONS, Math.max(1, Math.floor(Number(body.total_conversations) || count)));
  if (startIndex >= requestedTotal) throw new ApiError(400, "The deterministic batch starts beyond the requested run size.", "validation");
  const boundedCount = Math.min(count, requestedTotal - startIndex);
  const knowledge = await loadKnowledge(supabase);
  let accumulator = emptyHealthAccumulator("deterministic");
  for (let offset = 0; offset < boundedCount; offset += 1) {
    const scenario = syntheticScenarioAt(startIndex + offset);
    let evaluated;
    try {
      evaluated = await executeHealthConversation(supabase, scenario, { generationMode: "deterministic", knowledge });
    } catch (error) {
      logStageError("Deterministic health scenario", error, performance.now(), { scenario_id: scenario.id, source_scenario_id: scenario.source_scenario_id });
      evaluated = failedHealthConversation(scenario, "deterministic", error);
    }
    accumulator = addHealthConversation(accumulator, evaluated);
  }
  return {
    report: summariseHealth(accumulator),
    batch: { start_index: startIndex, count: boundedCount, requested_total: requestedTotal, next_index: startIndex + boundedCount },
    validation: { openai_calls: 0, database_writes: 0, geocoding_calls: 0, source_library_size: REAL_CUSTOMER_SCENARIOS.length },
    generated_at: new Date().toISOString(),
    commit: clean(process.env.VERCEL_GIT_COMMIT_SHA, 100) || null,
  };
}

export async function runLiveHealthBatch(supabase, body, environment = process.env) {
  if (!liveValidationAllowed(environment)) throw new ApiError(403, "Live AI Validation is available only on protected Preview deployments.", "authorization");
  const sampleSize = Math.floor(Number(body.total_conversations) || 0);
  if (sampleSize < LIVE_VALIDATION_MIN || sampleSize > LIVE_VALIDATION_MAX) throw new ApiError(400, `Choose ${LIVE_VALIDATION_MIN}–${LIVE_VALIDATION_MAX} live validation conversations.`, "validation");
  if (body.confirm_live_validation !== true) throw new ApiError(400, "Confirm the live validation run before calling OpenAI.", "validation");
  const startIndex = Math.max(0, Math.floor(Number(body.start_index) || 0));
  if (startIndex >= sampleSize) throw new ApiError(400, "The live batch starts beyond the selected sample.", "validation");
  const count = Math.min(LIVE_VALIDATION_BATCH_LIMIT, Math.max(1, Math.floor(Number(body.count) || 1)), sampleSize - startIndex);
  const knowledge = await loadKnowledge(supabase);
  let accumulator = emptyHealthAccumulator("live");
  for (let offset = 0; offset < count; offset += 1) {
    const scenario = representativeScenarioAt(startIndex + offset, sampleSize);
    let evaluated;
    try {
      evaluated = await executeHealthConversation(supabase, scenario, { generationMode: "live", knowledge });
    } catch (error) {
      logStageError("Live health scenario", error, performance.now(), { scenario_id: scenario.id, source_scenario_id: scenario.source_scenario_id, model: ASSISTANT_MODEL_POLICY.full });
      evaluated = failedHealthConversation(scenario, "live", error);
    }
    accumulator = addHealthConversation(accumulator, evaluated);
  }
  return {
    report: summariseHealth(accumulator),
    batch: { start_index: startIndex, count, requested_total: sampleSize, next_index: startIndex + count },
    validation: { openai_calls_enabled: true, database_writes: 0, customer_records_created: 0, model: ASSISTANT_MODEL_POLICY.full, pricing_configured: estimateOpenAICost({}, environment) !== null },
    generated_at: new Date().toISOString(),
    commit: clean(environment.VERCEL_GIT_COMMIT_SHA, 100) || null,
  };
}

function loadHealthConfiguration(environment = process.env) {
  return {
    preview_live_validation_available: liveValidationAllowed(environment),
    deterministic_max_conversations: MAX_DETERMINISTIC_CONVERSATIONS,
    deterministic_batch_limit: DETERMINISTIC_BATCH_LIMIT,
    live_min_conversations: LIVE_VALIDATION_MIN,
    live_max_conversations: LIVE_VALIDATION_MAX,
    live_batch_limit: LIVE_VALIDATION_BATCH_LIMIT,
    scenario_library_size: REAL_CUSTOMER_SCENARIOS.length,
    model: ASSISTANT_MODEL_POLICY.full,
    pricing_configured: estimateOpenAICost({}, environment) !== null,
    pricing_environment_variables: ["OPENAI_INPUT_COST_PER_MILLION_USD", "OPENAI_OUTPUT_COST_PER_MILLION_USD"],
    commit: clean(environment.VERCEL_GIT_COMMIT_SHA, 100) || null,
    guarantees: { openai_api_key_exposed: false, deterministic_openai_calls: 0, database_writes: 0, customer_records_created: 0 },
  };
}

async function startRun(supabase, body) {
  const total = Math.max(0, Number(body.total_questions) || 0);
  return data(await supabase.from("knowledge_competence_runs").insert({ mode: body.mode === "test_set" ? "test_set" : body.mode === "conversation" ? "conversation" : "single", total_questions: total }).select().single(), "The test run could not be started.");
}

async function completeRun(supabase, body) {
  const runId = clean(body.run_id, 100);
  if (!runId) throw new ApiError(400, "Run id is required.", "validation");
  const results = data(await supabase.from("knowledge_competence_results").select("*").eq("run_id", runId), "Run results could not be loaded.") || [];
  const summary = {
    completed: results.length,
    average_response_ms: results.length ? Math.round(results.reduce((sum, item) => sum + item.response_time_ms, 0) / results.length) : 0,
    knowledge_gaps: results.filter((item) => item.knowledge_gap).length,
    conflicts: results.filter((item) => item.conflict_detected).length,
  };
  return data(await supabase.from("knowledge_competence_runs").update({ status: "completed", completed_questions: results.length, summary, completed_at: new Date().toISOString() }).eq("id", runId).select().single(), "The test run could not be completed.");
}

async function saveReview(supabase, body) {
  if (!clean(body.result_id, 100)) throw new ApiError(400, "Result id is required.", "validation");
  if (!COMPETENCE_REVIEW_OUTCOMES.includes(body.outcome)) throw new ApiError(400, "Choose a valid review outcome.", "validation");
  const rating = (value) => value == null || value === "" ? null : Math.min(5, Math.max(1, Number(value)));
  const saved = await runStage("Save review", { result_id: clean(body.result_id, 100) }, async () => data(await supabase.from("knowledge_competence_reviews").upsert({ result_id: body.result_id, outcome: body.outcome, accuracy: rating(body.accuracy), helpfulness: rating(body.helpfulness), conversion: rating(body.conversion), brevity: rating(body.brevity), reviewer_notes: clean(body.reviewer_notes, 5000), updated_at: new Date().toISOString() }, { onConflict: "result_id" }).select().single(), "The review could not be saved."));
  await assessSavedCompetenceResult(supabase, body.result_id);
  return saved;
}

async function saveConversationReview(supabase, body) {
  const resultId = clean(body.result_id, 100);
  if (!resultId) throw new ApiError(400, "Result id is required.", "validation");
  if (!CONVERSATION_REVIEW_OUTCOMES.includes(body.outcome)) throw new ApiError(400, "Choose a valid conversation review outcome.", "validation");
  const rating = (value) => value == null || value === "" ? null : Math.min(5, Math.max(1, Number(value)));
  const polishRatings = Object.fromEntries(CONVERSATION_POLISH_REVIEW_FIELDS.map((field) => [field, rating(body.polish_ratings?.[field])]).filter(([, value]) => value !== null));
  const payload = { result_id: resultId, outcome: body.outcome, reviewer_notes: serialisePolishReviewRatings(body.reviewer_notes, polishRatings), updated_at: new Date().toISOString() };
  for (const field of CONVERSATION_RATING_FIELDS) payload[field] = rating(body[field]);
  const saved = await runStage("Save conversation review", { result_id: resultId }, async () => data(await supabase.from("knowledge_competence_reviews").upsert(payload, { onConflict: "result_id" }).select().single(), "The conversation review could not be saved."));
  await assessSavedCompetenceResult(supabase, resultId);
  return saved;
}

async function loadReport(supabase) {
  const [runsResult, resultsResult, reviewsResult] = await Promise.all([
    supabase.from("knowledge_competence_runs").select("*").order("started_at", { ascending: false }).limit(20),
    supabase.from("knowledge_competence_results").select("*").order("created_at", { ascending: false }).limit(1000),
    supabase.from("knowledge_competence_reviews").select("*").order("updated_at", { ascending: false }).limit(1000),
  ]);
  const runs = data(runsResult, "Competence runs could not be loaded.") || [];
  const results = data(resultsResult, "Competence results could not be loaded.") || [];
  const reviews = data(reviewsResult, "Competence reviews could not be loaded.") || [];
  return { runs, results, reviews, report: buildKnowledgeGapReport(results, reviews) };
}

export default async function handler(request, response) {
  response.setHeader?.("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!competenceAuthorize(request)) return response.status(401).json({ ok: false, message: "Access key not recognised." });
  let body = {};
  try {
    body = parseBody(request);
    const supabase = getSupabase();
    let result;
    if (body.action === "testAnswer") result = await testCompetenceAnswer(supabase, body);
    else if (body.action === "simulateConversation") result = await simulateCustomerConversation(supabase, body);
    else if (body.action === "runDeterministicHealthBatch") result = await runDeterministicHealthBatch(supabase, body);
    else if (body.action === "runLiveHealthBatch") result = await runLiveHealthBatch(supabase, body);
    else if (body.action === "loadHealthConfiguration") result = { configuration: loadHealthConfiguration() };
    else if (body.action === "startRun") result = { run: await startRun(supabase, body) };
    else if (body.action === "completeRun") result = { run: await completeRun(supabase, body) };
    else if (body.action === "saveReview") result = { review: await saveReview(supabase, body) };
    else if (body.action === "saveConversationReview") result = { review: await saveConversationReview(supabase, body) };
    else if (body.action === "loadReport") result = await loadReport(supabase);
    else if (body.action === "loadTestLibrary") result = { questions: AI_ASSISTANT_TEST_LIBRARY, scenarios: REAL_CUSTOMER_SCENARIOS };
    else throw new ApiError(400, "Unsupported competence-test action.", "validation");
    return await runStage("Return response", { action: clean(body.action, 100), run_id: body.run_id || null, result_id: body.result_id || null }, async () => response.status(200).json({ ok: true, ...result }));
  } catch (error) {
    console.error("AI ASSISTANT COMPETENCE TEST ERROR", { action: clean(body.action, 100), stage: error.stage || "Request handling", type: error.type || "api", exception_type: error.name || error.constructor?.name || typeof error, message: clean(error.message, 2000), stack_trace: clean(error.stack, 10000) || null });
    return response.status(error.status || 500).json({ ok: false, error_type: error.type || "api", stage: error.stage || "Request handling", message: error.message || "Competence test failed." });
  }
}

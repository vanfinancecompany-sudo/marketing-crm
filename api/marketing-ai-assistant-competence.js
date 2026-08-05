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

const API_KEY_HEADER = "x-marketing-customer-database-key";
const clean = (value, limit = 10000) => String(value || "").trim().slice(0, limit);
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
  const context = { run_id: body.run_id || null, test_question_id: clean(body.test_question_id, 40) || null, product_context: productContext };
  const knowledge = await loadKnowledge(supabase);
  const boundedKnowledge = await runStage("Apply product boundary", { ...context, comparison }, async () => filterKnowledgeForProduct(knowledge, productContext, { comparison }));
  const corpus = await runStage("Build temporary article chunks", { ...context, category_filter: boundedKnowledge.categoryFilter, article_ids: boundedKnowledge.articles.map((item) => item.id), article_count: boundedKnowledge.articles.length }, async () => buildRetrievalCorpus(boundedKnowledge));
  const sources = await runStage("Lexical ranking", { ...context, corpus_size: corpus.length }, async () => rankKnowledge(question, corpus, { messages, limit: 8 }));
  if (!sources.length) console.warn("AI ASSISTANT COMPETENCE RETRIEVAL WARNING", { stage: "Lexical ranking", relevant_ids: context, corpus_size: corpus.length, message: "No relevant sources were retrieved; the assistant must report a knowledge gap." });
  const retrievalTime = elapsed(retrievalStart);
  const generationStart = performance.now();
  const prompt = await runStage("Prompt creation", { ...context, category_filter: boundedKnowledge.categoryFilter, source_count: sources.length }, async () => buildCompetencePrompt({ question, messages, sources, sections: boundedKnowledge.sections, settings: knowledge.settings, productContext, comparison }));
  const model = clean(process.env.OPENAI_MODEL, 200) || "gpt-4.1-mini";
  const requested = await runStage("OpenAI request", { ...context, model, openai_api_key_present: Boolean(clean(process.env.OPENAI_API_KEY)), source_count: sources.length }, () => requestOpenAIAnswer(prompt));
  const generated = await runStage("Structured response parsing", { ...context, model: requested.model }, async () => parseOpenAIAnswer(requested.payload, requested.model));
  const generationTime = elapsed(generationStart);
  const selected = new Set(generated.answer.source_ids || []);
  const sourcesUsed = sources.filter((_source, index) => selected.has(`S${index + 1}`));
  const resultPayload = {
    run_id: body.run_id || null,
    test_question_id: clean(body.test_question_id, 40) || null,
    mode,
    question,
    conversation: messages,
    answer: clean(generated.answer.answer, 5000),
    product_detected: generated.answer.product_detected || detectProduct(question, messages),
    confidence: Number(generated.answer.confidence) || 0,
    confidence_reason: clean(generated.answer.confidence_reason, 2000),
    knowledge_gap: Boolean(generated.answer.knowledge_gap || sources.length === 0),
    conflict_detected: Boolean(generated.answer.conflict_detected),
    sources_used: sourcesUsed,
    response_time_ms: elapsed(totalStart),
    retrieval_time_ms: retrievalTime,
    generation_time_ms: generationTime,
    model: generated.model,
  };
  const saved = await runStage("Save test result", context, async () => data(await supabase.from("knowledge_competence_results").insert(resultPayload).select().single(), "The competence result could not be saved."));
  if (body.run_id) await supabase.rpc("increment_competence_run_progress", { target_run_id: body.run_id }).then(() => {}, () => {});
  return { result: { ...saved, product_context: productContext, category_filter: boundedKnowledge.categoryFilter, comparison_mode: comparison }, retrieved_sources: sources, word_count: resultPayload.answer.split(/\s+/).filter(Boolean).length };
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
  return runStage("Save review", { result_id: clean(body.result_id, 100) }, async () => data(await supabase.from("knowledge_competence_reviews").upsert({ result_id: body.result_id, outcome: body.outcome, accuracy: rating(body.accuracy), helpfulness: rating(body.helpfulness), conversion: rating(body.conversion), brevity: rating(body.brevity), reviewer_notes: clean(body.reviewer_notes, 5000), updated_at: new Date().toISOString() }, { onConflict: "result_id" }).select().single(), "The review could not be saved."));
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
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!competenceAuthorize(request)) return response.status(401).json({ ok: false, message: "Access key not recognised." });
  let body = {};
  try {
    body = parseBody(request);
    const supabase = getSupabase();
    let result;
    if (body.action === "testAnswer") result = await testCompetenceAnswer(supabase, body);
    else if (body.action === "startRun") result = { run: await startRun(supabase, body) };
    else if (body.action === "completeRun") result = { run: await completeRun(supabase, body) };
    else if (body.action === "saveReview") result = { review: await saveReview(supabase, body) };
    else if (body.action === "loadReport") result = await loadReport(supabase);
    else if (body.action === "loadTestLibrary") result = { questions: AI_ASSISTANT_TEST_LIBRARY };
    else throw new ApiError(400, "Unsupported competence-test action.", "validation");
    return await runStage("Return response", { action: clean(body.action, 100), run_id: body.run_id || null, result_id: body.result_id || null }, async () => response.status(200).json({ ok: true, ...result }));
  } catch (error) {
    console.error("AI ASSISTANT COMPETENCE TEST ERROR", { action: clean(body.action, 100), stage: error.stage || "Request handling", type: error.type || "api", exception_type: error.name || error.constructor?.name || typeof error, message: clean(error.message, 2000), stack_trace: clean(error.stack, 10000) || null });
    return response.status(error.status || 500).json({ ok: false, error_type: error.type || "api", stage: error.stage || "Request handling", message: error.message || "Competence test failed." });
  }
}

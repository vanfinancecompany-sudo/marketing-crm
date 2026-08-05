import { createClient } from "@supabase/supabase-js";
import {
  AI_ASSISTANT_TEST_LIBRARY,
  COMPETENCE_REVIEW_OUTCOMES,
  buildCompetencePrompt,
  buildKnowledgeGapReport,
  buildRetrievalCorpus,
  detectProduct,
  rankKnowledge,
} from "../lib/aiAssistantCompetence.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const clean = (value, limit = 10000) => String(value || "").trim().slice(0, limit);
class ApiError extends Error { constructor(status, message, type = "api") { super(message); this.status = status; this.type = type; } }
export function competenceAuthorize(request, environment = process.env) { const expected = clean(environment.MARKETING_CUSTOMER_DATABASE_API_KEY); const header = clean(request.headers?.[API_KEY_HEADER]); const bearer = clean(request.headers?.authorization).replace(/^Bearer\s+/i, ""); return Boolean(expected && (header === expected || bearer === expected)); }
function getSupabase() { if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new ApiError(500, "Supabase is not configured.", "configuration"); return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }); }
function parseBody(request) { if (!request.body) return {}; if (typeof request.body === "object") return request.body; try { return JSON.parse(request.body); } catch { throw new ApiError(400, "The request body is not valid JSON.", "validation"); } }
function data(result, fallback) { if (result.error) throw new ApiError(500, result.error.message || fallback); return result.data; }
function elapsed(start) { return Math.max(0, Math.round(performance.now() - start)); }

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
    source_ids: { type: "array", items: { type: "string", pattern: "^S[1-8]$" }, uniqueItems: true },
  },
};

async function loadKnowledge(supabase) {
  const [settingsResult, sectionsResult, articlesResult] = await Promise.all([
    supabase.from("knowledge_settings").select("*").eq("settings_key", "default").maybeSingle(),
    supabase.from("knowledge_business_sections").select("*").eq("active", true).order("sort_order", { ascending: true }),
    supabase.from("knowledge_articles").select("id,title,category,content_markdown,faq_json,live_wix_url,status,is_active").eq("status", "approved").eq("is_active", true).order("updated_at", { ascending: false }),
  ]);
  return {
    settings: data(settingsResult, "Knowledge settings could not be loaded.") || {},
    sections: data(sectionsResult, "Business Brain could not be loaded.") || [],
    articles: data(articlesResult, "Approved articles could not be loaded.") || [],
  };
}

async function generateAnswer(prompt) {
  if (!clean(process.env.OPENAI_API_KEY)) throw new ApiError(500, "OPENAI_API_KEY is not configured.", "configuration");
  const model = clean(process.env.OPENAI_MODEL, 200) || "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${clean(process.env.OPENAI_API_KEY)}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      input: [
        { role: "system", content: "You are an internal competence-test version of a UK van website assistant. Use only supplied evidence and follow the schema exactly." },
        { role: "user", content: prompt },
      ],
      text: { format: { type: "json_schema", name: "assistant_competence_answer", strict: true, schema: ANSWER_SCHEMA } },
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new ApiError(502, "The AI service could not generate the test answer.", "ai");
  const output = payload.output_text || payload.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!output) throw new ApiError(502, "The AI returned no competence-test answer.", "ai");
  try { return { answer: JSON.parse(output), model }; } catch { throw new ApiError(502, "The AI returned an invalid competence-test answer.", "ai"); }
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
  const messages = cleanMessages(body.messages);
  const knowledge = await loadKnowledge(supabase);
  const corpus = buildRetrievalCorpus(knowledge);
  const sources = rankKnowledge(question, corpus, { messages, limit: 8 });
  const retrievalTime = elapsed(retrievalStart);
  const generationStart = performance.now();
  const generated = await generateAnswer(buildCompetencePrompt({ question, messages, sources, sections: knowledge.sections, settings: knowledge.settings }));
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
  const saved = data(await supabase.from("knowledge_competence_results").insert(resultPayload).select().single(), "The competence result could not be saved.");
  if (body.run_id) await supabase.rpc("increment_competence_run_progress", { target_run_id: body.run_id }).then(() => {}, () => {});
  return { result: saved, retrieved_sources: sources, word_count: resultPayload.answer.split(/\s+/).filter(Boolean).length };
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
  return data(await supabase.from("knowledge_competence_reviews").upsert({ result_id: body.result_id, outcome: body.outcome, accuracy: rating(body.accuracy), helpfulness: rating(body.helpfulness), conversion: rating(body.conversion), brevity: rating(body.brevity), reviewer_notes: clean(body.reviewer_notes, 5000), updated_at: new Date().toISOString() }, { onConflict: "result_id" }).select().single(), "The review could not be saved.");
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
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error("AI ASSISTANT COMPETENCE TEST ERROR", { action: clean(body.action, 100), type: error.type || "api", message: clean(error.message, 500) });
    return response.status(error.status || 500).json({ ok: false, error_type: error.type || "api", message: error.message || "Competence test failed." });
  }
}

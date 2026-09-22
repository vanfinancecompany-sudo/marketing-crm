import { createClient } from "@supabase/supabase-js";
import {
  assessSavedCompetenceResult,
  loadLearningKnowledge,
} from "./_knowledgeOpportunityStore.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const DEFAULT_BATCH_SIZE = 5;
const MAX_BATCH_SIZE = 10;
const STALE_PROCESSING_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);

function getSupabase(environment = process.env) {
  if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Assistant learning worker Supabase configuration is incomplete.");
  }
  return createClient(environment.SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function assistantLearningWorkerAuthorised(request, environment = process.env) {
  const bearer = clean(request?.headers?.authorization, 4000).replace(/^Bearer\s+/i, "");
  const header = clean(request?.headers?.[API_KEY_HEADER], 4000);
  const cronSecret = clean(environment.CRON_SECRET, 4000);
  const marketingKey = clean(environment.MARKETING_CUSTOMER_DATABASE_API_KEY, 4000);
  return Boolean(
    (cronSecret && bearer === cronSecret) ||
    (marketingKey && (header === marketingKey || bearer === marketingKey))
  );
}

function diagnosticsWith(row, patch) {
  return {
    ...(row?.conversation_diagnostics && typeof row.conversation_diagnostics === "object"
      ? row.conversation_diagnostics
      : {}),
    ...patch,
  };
}

export function assistantLearningResultIsStale(row, now = new Date()) {
  const diagnostics = row?.conversation_diagnostics || {};
  if (diagnostics.learning_capture_status !== "processing") return false;
  const startedAt = Date.parse(diagnostics.learning_capture_started_at || "");
  if (!Number.isFinite(startedAt)) return true;
  return now.getTime() - startedAt >= STALE_PROCESSING_MS;
}

async function recoverStaleRows(supabase, now = new Date()) {
  const result = await supabase
    .from("knowledge_competence_results")
    .select("id,conversation_diagnostics")
    .eq("mode", "conversation")
    .contains("conversation_diagnostics", { learning_capture_status: "processing" })
    .order("created_at", { ascending: true })
    .limit(25);
  if (result.error) throw new Error(result.error.message || "Could not inspect stale assistant learning rows.");

  let recovered = 0;
  for (const row of result.data || []) {
    if (!assistantLearningResultIsStale(row, now)) continue;
    const diagnostics = diagnosticsWith(row, {
      learning_capture_status: "pending",
      learning_capture_recovered_at: now.toISOString(),
    });
    const update = await supabase
      .from("knowledge_competence_results")
      .update({ conversation_diagnostics: diagnostics })
      .eq("id", row.id)
      .contains("conversation_diagnostics", { learning_capture_status: "processing" });
    if (update.error) throw new Error(update.error.message || "Could not recover stale assistant learning row.");
    recovered += 1;
  }
  return recovered;
}

async function loadPendingRows(supabase, batchSize) {
  const result = await supabase
    .from("knowledge_competence_results")
    .select("id,conversation_diagnostics,created_at")
    .eq("mode", "conversation")
    .contains("conversation_diagnostics", { learning_capture_status: "pending" })
    .order("created_at", { ascending: true })
    .limit(batchSize);
  if (result.error) throw new Error(result.error.message || "Could not load pending assistant learning rows.");
  return result.data || [];
}

async function claimRow(supabase, row, now = new Date()) {
  const diagnostics = row?.conversation_diagnostics || {};
  const attempt = Number(diagnostics.learning_capture_attempts || 0) + 1;
  const next = diagnosticsWith(row, {
    learning_capture_status: "processing",
    learning_capture_attempts: attempt,
    learning_capture_started_at: now.toISOString(),
    learning_capture_last_error: null,
  });
  const result = await supabase
    .from("knowledge_competence_results")
    .update({ conversation_diagnostics: next })
    .eq("id", row.id)
    .contains("conversation_diagnostics", { learning_capture_status: "pending" })
    .select("id,conversation_diagnostics")
    .maybeSingle();
  if (result.error) throw new Error(result.error.message || "Could not claim assistant learning row.");
  return result.data || null;
}

async function finishRow(supabase, row, result, now = new Date()) {
  const diagnostics = row.conversation_diagnostics || {};
  const captured = result?.captured === true;
  const attempts = Number(diagnostics.learning_capture_attempts || 1);
  const retryable = !captured && attempts < MAX_ATTEMPTS;
  const next = diagnosticsWith(row, {
    learning_capture_status: captured ? "complete" : retryable ? "pending" : "failed",
    learning_capture_completed_at: captured ? now.toISOString() : null,
    learning_capture_last_error: captured ? null : clean(result?.message || "Knowledge learning capture failed.", 2000),
    learning_capture_failed_at: !captured && !retryable ? now.toISOString() : null,
  });
  const update = await supabase
    .from("knowledge_competence_results")
    .update({ conversation_diagnostics: next })
    .eq("id", row.id)
    .contains("conversation_diagnostics", { learning_capture_status: "processing" });
  if (update.error) throw new Error(update.error.message || "Could not finish assistant learning row.");
  return { captured, retryable };
}

export async function runAssistantLearningWorker({
  supabase,
  environment = process.env,
  now = new Date(),
  batchSize = Number(environment.AI_ASSISTANT_LEARNING_BATCH_SIZE) || DEFAULT_BATCH_SIZE,
} = {}) {
  const db = supabase || getSupabase(environment);
  const boundedBatchSize = Math.max(1, Math.min(MAX_BATCH_SIZE, Math.floor(batchSize)));
  const recovered = await recoverStaleRows(db, now);
  const pending = await loadPendingRows(db, boundedBatchSize);
  if (!pending.length) {
    return { ok: true, recovered, processed: 0, completed: 0, retried: 0, failed: 0 };
  }

  // One shared snapshot for the whole batch avoids rereading the full library per result.
  const knowledge = await loadLearningKnowledge(db);
  let processed = 0;
  let completed = 0;
  let retried = 0;
  let failed = 0;

  for (const pendingRow of pending) {
    const claimed = await claimRow(db, pendingRow, new Date());
    if (!claimed) continue;
    processed += 1;
    const capture = await assessSavedCompetenceResult(db, claimed.id, { knowledge });
    const finished = await finishRow(db, claimed, capture, new Date());
    if (finished.captured) completed += 1;
    else if (finished.retryable) retried += 1;
    else failed += 1;
  }

  return { ok: true, recovered, processed, completed, retried, failed };
}

export default async function handler(request, response) {
  response.setHeader?.("Cache-Control", "no-store, max-age=0");
  if (!assistantLearningWorkerAuthorised(request)) {
    return response.status(401).json({ ok: false, message: "Assistant learning worker access denied." });
  }
  if (!new Set(["GET", "POST"]).has(request.method)) {
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }
  try {
    const result = await runAssistantLearningWorker();
    return response.status(200).json(result);
  } catch (error) {
    console.error("AI ASSISTANT LEARNING WORKER ERROR", {
      message: clean(error?.message || error, 2000),
      stack: clean(error?.stack, 5000),
    });
    return response.status(500).json({ ok: false, message: "Assistant learning worker failed." });
  }
}

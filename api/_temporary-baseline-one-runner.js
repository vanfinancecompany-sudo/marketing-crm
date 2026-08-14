import { createClient } from "@supabase/supabase-js";
import { runDeterministicHealthBatch } from "./marketing-ai-assistant-competence.js";
import {
  emptyHealthAccumulator,
  mergeHealthAccumulators,
  summariseHealth,
} from "../lib/aiAssistantHealth.js";
import { normaliseHealthBaselineInput } from "./marketing-ai-control-centre.js";

const TARGET_PROJECT_ID = "prj_zD76dAe2MHZdBTO08GNFSqOb9UHf";
const TARGET_BRANCH = "agent/run-assistant-baseline-one";
const SOURCE_MAIN_COMMIT = "7fe4e8b2b5bb0d1396d71b5b45b71c3702195023";
const TOTAL_CONVERSATIONS = 10000;

function allowed(environment = process.env) {
  return environment.VERCEL_ENV === "preview"
    && environment.VERCEL_PROJECT_ID === TARGET_PROJECT_ID
    && environment.VERCEL_GIT_COMMIT_REF === TARGET_BRANCH;
}

function getSupabase(environment = process.env) {
  if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Baseline One runtime storage is unavailable.");
  }
  return createClient(environment.SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "object") return request.body;
  try { return JSON.parse(request.body); } catch { throw new Error("Request body is not valid JSON."); }
}

async function existingBaseline(supabase) {
  const result = await supabase
    .from("ai_assistant_health_baselines")
    .select("id,name,mode,commit_sha,conversations,turns,overall_ai_health_score,report,validation,generated_at,created_at")
    .eq("mode", "deterministic")
    .eq("conversations", TOTAL_CONVERSATIONS)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data || null;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (!allowed()) return response.status(404).json({ ok: false, message: "Not found." });
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });

  try {
    const body = parseBody(request);
    const supabase = getSupabase();

    if (body.action === "existing") {
      const baseline = await existingBaseline(supabase);
      return response.status(200).json({ ok: true, baseline });
    }

    if (body.action === "batch") {
      const startIndex = Math.max(0, Math.floor(Number(body.start_index) || 0));
      const accumulator = body.accumulator && typeof body.accumulator === "object"
        ? body.accumulator
        : emptyHealthAccumulator("deterministic");
      const payload = await runDeterministicHealthBatch(supabase, {
        start_index: startIndex,
        count: 100,
        total_conversations: TOTAL_CONVERSATIONS,
      });
      const merged = mergeHealthAccumulators(accumulator, payload.report);
      return response.status(200).json({
        ok: true,
        accumulator: merged,
        summary: summariseHealth(merged),
        batch: payload.batch,
        validation: payload.validation,
        generated_at: payload.generated_at,
      });
    }

    if (body.action === "save") {
      const alreadySaved = await existingBaseline(supabase);
      if (alreadySaved) return response.status(200).json({ ok: true, baseline: alreadySaved, already_existed: true });
      if (!body.accumulator || typeof body.accumulator !== "object") throw new Error("Completed deterministic accumulator is required.");

      const report = {
        ...summariseHealth(body.accumulator),
        generated_at: new Date().toISOString(),
        commit: SOURCE_MAIN_COMMIT,
        validation: {
          openai_calls: 0,
          database_writes: 0,
          geocoding_calls: 0,
          source_library_size: Number(body.source_library_size) || 0,
        },
      };
      if (report.mode !== "deterministic" || Number(report.conversations) !== TOTAL_CONVERSATIONS) {
        throw new Error(`Incomplete Baseline One report: ${report.conversations || 0}/${TOTAL_CONVERSATIONS} conversations.`);
      }

      const existingRows = await supabase.from("ai_assistant_health_baselines").select("id").limit(100);
      if (existingRows.error) throw existingRows.error;
      const sequence = (existingRows.data || []).length + 1;
      const payload = normaliseHealthBaselineInput(
        { name: `Baseline ${sequence} · Deterministic`, mode: "deterministic", report },
        { ...process.env, VERCEL_GIT_COMMIT_SHA: SOURCE_MAIN_COMMIT },
      );
      const saved = await supabase
        .from("ai_assistant_health_baselines")
        .insert(payload)
        .select("id,name,mode,commit_sha,conversations,turns,overall_ai_health_score,report,validation,generated_at,created_at")
        .single();
      if (saved.error) throw saved.error;
      return response.status(200).json({ ok: true, baseline: saved.data, already_existed: false });
    }

    return response.status(400).json({ ok: false, message: "Unsupported action." });
  } catch (error) {
    console.error("TEMPORARY BASELINE ONE RUNNER ERROR", {
      name: error?.name || "Error",
      message: error?.message || String(error),
    });
    return response.status(500).json({ ok: false, message: error?.message || "Baseline One runner failed." });
  }
}

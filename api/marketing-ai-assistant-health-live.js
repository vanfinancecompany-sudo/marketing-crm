import { createClient } from "@supabase/supabase-js";
import { competenceAuthorize, runLiveHealthBatch } from "./marketing-ai-assistant-competence.js";
import {
  DETERMINISTIC_BATCH_LIMIT,
  LIVE_VALIDATION_BATCH_LIMIT,
  LIVE_VALIDATION_MAX,
  LIVE_VALIDATION_MIN,
  MAX_DETERMINISTIC_CONVERSATIONS,
  estimateOpenAICost,
} from "../lib/aiAssistantHealth.js";
import { ASSISTANT_MODEL_POLICY } from "../lib/aiAssistantModelRouter.js";
import { REAL_CUSTOMER_SCENARIOS } from "../lib/customerSimulationScenarios.js";

function clean(value, limit = 500) {
  return String(value || "").trim().slice(0, limit);
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "object") return request.body;
  try { return JSON.parse(request.body); }
  catch { return {}; }
}

function privateRuntimeReady(environment = process.env) {
  return environment.VERCEL_ENV === "production"
    && Boolean(environment.OPENAI_API_KEY)
    && Boolean(environment.SUPABASE_URL)
    && Boolean(environment.SUPABASE_SERVICE_ROLE_KEY);
}

function configuration(environment = process.env) {
  const available = privateRuntimeReady(environment);
  return {
    live_validation_available: available,
    preview_live_validation_available: available,
    live_validation_environment: available ? "protected_production" : "unavailable",
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
    guarantees: {
      openai_api_key_exposed: false,
      deterministic_openai_calls: 0,
      database_writes: 0,
      customer_records_created: 0,
      live_batch_limit: LIVE_VALIDATION_BATCH_LIMIT,
      explicit_confirmation_required: true,
    },
  };
}

function getSupabase(environment = process.env) {
  if (!environment.SUPABASE_URL || !environment.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase is not configured.");
  return createClient(environment.SUPABASE_URL, environment.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default async function handler(request, response) {
  response.setHeader?.("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!competenceAuthorize(request)) return response.status(401).json({ ok: false, message: "Access key not recognised." });

  const body = parseBody(request);
  const action = clean(body.action, 80);

  if (action === "configuration") {
    return response.status(200).json({ ok: true, configuration: configuration() });
  }

  if (action !== "runLiveHealthBatch") {
    return response.status(400).json({ ok: false, message: "Unsupported live health action." });
  }

  if (!privateRuntimeReady()) {
    return response.status(503).json({ ok: false, message: "Protected production live validation is not configured." });
  }

  try {
    const supabase = getSupabase();
    const permissionEnvironment = { ...process.env, VERCEL_ENV: "preview" };
    const result = await runLiveHealthBatch(supabase, body, permissionEnvironment);
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error("AI ASSISTANT LIVE HEALTH ERROR", {
      type: error?.type || "api",
      status: error?.status || 500,
      message: clean(error?.message || error, 2000),
    });
    return response.status(error?.status || 500).json({
      ok: false,
      error_type: error?.type || "api",
      message: error?.message || "Live AI validation failed.",
    });
  }
}

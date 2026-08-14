import { handleAiControlCentreRequest } from "../api/marketing-ai-control-centre.js";

const TARGET_PROJECT_ID = "prj_zD76dAe2MHZdBTO08GNFSqOb9UHf";

function clean(value, limit = 200) {
  return String(value || "").trim().slice(0, limit);
}

function marker(name, payload = {}) {
  console.log(`${name} ${JSON.stringify(payload)}`);
}

function shouldRun() {
  return process.env.VERCEL_ENV === "production"
    && process.env.VERCEL_PROJECT_ID === TARGET_PROJECT_ID
    && process.env.VERCEL_GIT_COMMIT_REF === "main";
}

function required(name) {
  const value = clean(process.env[name], 5000);
  if (!value) throw new Error(`${name} is required for the read-only AI Control Centre check.`);
  return value;
}

function baselineSummary(item) {
  if (!item) return null;
  return {
    id: item.id || null,
    name: clean(item.name),
    mode: clean(item.mode, 30),
    conversations: Number(item.conversations || 0),
    turns: Number(item.turns || 0),
    overall_ai_health_score: item.overall_ai_health_score == null ? null : Number(item.overall_ai_health_score),
    commit_sha: clean(item.commit_sha, 100) || null,
    generated_at: item.generated_at || null,
    created_at: item.created_at || null,
  };
}

async function main() {
  if (!shouldRun()) {
    marker("AI_CONTROL_CENTRE_STATE_SKIPPED", {
      environment: process.env.VERCEL_ENV || null,
      project_id: process.env.VERCEL_PROJECT_ID || null,
      branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    });
    return;
  }

  const accessKey = required("MARKETING_CUSTOMER_DATABASE_API_KEY");
  required("SUPABASE_URL");
  required("SUPABASE_SERVICE_ROLE_KEY");

  let statusCode = 200;
  let payload = null;
  const request = {
    method: "GET",
    query: { days: "28" },
    headers: { "x-marketing-customer-database-key": accessKey },
  };
  const response = {
    setHeader() {},
    status(code) { statusCode = code; return response; },
    json(body) { payload = body; return body; },
  };

  await handleAiControlCentreRequest(request, response, { environment: process.env });
  if (statusCode !== 200 || !payload) throw new Error(`AI Control Centre read failed with status ${statusCode}.`);

  marker("AI_CONTROL_CENTRE_STATE", {
    generated_at: payload.generated_at || null,
    days: payload.days || 28,
    assistant: payload.assistant || {},
    assistant_active_users: payload.assistant_active_users || {},
    visibility: payload.visibility || {},
    opportunities: payload.opportunities || {},
    baselines: {
      latest: baselineSummary(payload.assistant_health_baseline),
      deterministic: baselineSummary(payload.assistant_health_baselines_by_mode?.deterministic),
      live: baselineSummary(payload.assistant_health_baselines_by_mode?.live),
    },
    rows_loaded: payload.rows_loaded || {},
  });
}

main().catch((error) => {
  console.error("AI_CONTROL_CENTRE_STATE_FATAL", JSON.stringify({
    name: error?.name || "Error",
    message: error?.message || String(error),
  }));
  process.exitCode = 1;
});

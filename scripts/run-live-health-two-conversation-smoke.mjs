import { createClient } from "@supabase/supabase-js";
import { runLiveHealthBatch } from "../api/marketing-ai-assistant-competence.js";

const TARGET_PROJECT_ID = "prj_zD76dAe2MHZdBTO08GNFSqOb9UHf";
const TARGET_BRANCH = "agent/live-health-two-conversation-smoke";

function marker(name, payload = {}) {
  console.log(`${name} ${JSON.stringify(payload)}`);
}

function shouldRun() {
  return process.env.VERCEL_ENV === "preview"
    && process.env.VERCEL_PROJECT_ID === TARGET_PROJECT_ID
    && process.env.VERCEL_GIT_COMMIT_REF === TARGET_BRANCH;
}

function requireEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required for the live health smoke test.`);
  return value;
}

async function main() {
  if (!shouldRun()) {
    marker("LIVE_HEALTH_SMOKE_SKIPPED", {
      environment: process.env.VERCEL_ENV || null,
      project_id: process.env.VERCEL_PROJECT_ID || null,
      branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    });
    return;
  }

  const supabase = createClient(
    requireEnvironment("SUPABASE_URL"),
    requireEnvironment("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  requireEnvironment("OPENAI_API_KEY");

  marker("LIVE_HEALTH_SMOKE_START", {
    total_sample_context: 100,
    conversations_in_smoke: 2,
    database_writes_expected: 0,
  });

  const result = await runLiveHealthBatch(supabase, {
    total_conversations: 100,
    start_index: 0,
    count: 2,
    confirm_live_validation: true,
  }, process.env);

  marker("LIVE_HEALTH_SMOKE_RESULT", result);

  if (Number(result.validation?.database_writes || 0) !== 0 || Number(result.validation?.customer_records_created || 0) !== 0) {
    throw new Error("Live health smoke violated write-safety expectations.");
  }
}

main().catch((error) => {
  console.error("LIVE_HEALTH_SMOKE_FATAL", JSON.stringify({
    name: error?.name || "Error",
    message: error?.message || String(error),
    stack: error?.stack || null,
  }));
  process.exitCode = 1;
});

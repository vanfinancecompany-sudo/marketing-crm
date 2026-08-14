import {
  emptyHealthAccumulator,
  mergeHealthAccumulators,
  summariseHealth,
} from "../lib/aiAssistantHealth.js";

const TARGET_PROJECT_ID = "prj_zD76dAe2MHZdBTO08GNFSqOb9UHf";
const TARGET_BRANCH = "agent/run-assistant-baseline-one";
const BRANCH_RUNTIME = "https://marketing-crm-github-work-git-ag-73b82f-stuart-westons-projects.vercel.app";
const ENDPOINT = `${BRANCH_RUNTIME}/api/temporary-baseline-one-runner`;
const TOTAL = 10000;
const BATCH_SIZE = 100;

function shouldRun() {
  return process.env.VERCEL_ENV === "preview"
    && process.env.VERCEL_PROJECT_ID === TARGET_PROJECT_ID
    && process.env.VERCEL_GIT_COMMIT_REF === TARGET_BRANCH;
}

function marker(name, payload = {}) {
  console.log(`${name} ${JSON.stringify(payload)}`);
}

async function request(url, options = {}) {
  const bypass = String(process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "").trim();
  if (!bypass) throw new Error("VERCEL_AUTOMATION_BYPASS_SECRET is not configured for this protected preview project.");
  const response = await fetch(url, {
    ...options,
    headers: {
      "x-vercel-protection-bypass": bypass,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(120000),
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error(`Baseline One preview returned non-JSON (${response.status}): ${text.slice(0, 300)}`); }
  if (!response.ok || payload?.ok !== true) throw new Error(payload?.message || `Baseline One preview request failed (${response.status}).`);
  return payload;
}

async function main() {
  if (!shouldRun()) {
    marker("BASELINE_ONE_CLIENT_SKIPPED", {
      environment: process.env.VERCEL_ENV || null,
      project_id: process.env.VERCEL_PROJECT_ID || null,
      branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    });
    return;
  }

  marker("BASELINE_ONE_CLIENT_START", { total: TOTAL, batch_size: BATCH_SIZE, runtime: BRANCH_RUNTIME });
  const existing = await request(`${ENDPOINT}?action=existing`);
  if (existing.baseline) {
    marker("BASELINE_ONE_ALREADY_EXISTS", {
      id: existing.baseline.id,
      name: existing.baseline.name,
      conversations: existing.baseline.conversations,
      score: existing.baseline.overall_ai_health_score,
      created_at: existing.baseline.created_at,
    });
    marker("BASELINE_ONE_SUMMARY", existing.baseline.report || {});
    return;
  }

  let accumulator = emptyHealthAccumulator("deterministic");
  let sourceLibrarySize = 0;
  for (let start = 0; start < TOTAL; start += BATCH_SIZE) {
    const result = await request(`${ENDPOINT}?action=chunk&start=${start}&count=${BATCH_SIZE}`);
    accumulator = mergeHealthAccumulators(accumulator, result.report);
    sourceLibrarySize = Number(result.report?.validation?.source_library_size || sourceLibrarySize || 0);
    const completed = start + BATCH_SIZE;
    if (completed % 1000 === 0 || completed === TOTAL) {
      const summary = summariseHealth(accumulator);
      marker("BASELINE_ONE_PROGRESS", {
        completed,
        total: TOTAL,
        score: summary.overall_ai_health_score,
        rule_violations: summary.rule_violations,
        failed_scenarios: summary.failed_scenario_count,
      });
    }
  }

  const summary = summariseHealth(accumulator);
  if (summary.mode !== "deterministic" || Number(summary.conversations) !== TOTAL) {
    throw new Error(`Baseline One accumulator is incomplete: ${summary.conversations || 0}/${TOTAL}.`);
  }

  const saved = await request(ENDPOINT, {
    method: "POST",
    body: JSON.stringify({
      action: "save-accumulator",
      accumulator,
      source_library_size: sourceLibrarySize,
    }),
  });

  marker("BASELINE_ONE_SAVED", {
    id: saved.baseline?.id,
    name: saved.baseline?.name,
    conversations: saved.baseline?.conversations,
    turns: saved.baseline?.turns,
    score: saved.baseline?.overall_ai_health_score,
    already_existed: saved.already_existed,
    created_at: saved.baseline?.created_at,
  });
  marker("BASELINE_ONE_SUMMARY", saved.baseline?.report || summary);
  for (const failure of saved.baseline?.report?.failed_scenarios || summary.failed_scenarios || []) {
    marker("BASELINE_ONE_FAILURE", failure);
  }
}

main().catch((error) => {
  console.error("BASELINE_ONE_CLIENT_FATAL", JSON.stringify({
    name: error?.name || "Error",
    message: error?.message || String(error),
    stack: error?.stack || null,
  }));
  process.exitCode = 1;
});

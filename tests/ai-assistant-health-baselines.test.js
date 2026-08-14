import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normaliseHealthBaselineInput } from "../api/marketing-ai-control-centre.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/042_ai_assistant_health_baselines.sql"), "utf8");
const api = fs.readFileSync(path.join(root, "api/marketing-ai-control-centre.js"), "utf8");
const service = fs.readFileSync(path.join(root, "services/aiAssistantHealthBaselines.js"), "utf8");
const healthPage = fs.readFileSync(path.join(root, "pages/AIAssistantHealthPage.jsx"), "utf8");

function report(overrides = {}) {
  return {
    mode: "deterministic",
    conversations: 10000,
    turns: 24000,
    overall_ai_health_score: 98.6,
    generated_at: "2026-08-14T10:30:00Z",
    commit: "browser-fallback-commit",
    validation: { openai_calls: 0, database_writes: 0 },
    failed_scenarios: [],
    ...overrides,
  };
}

test("baseline table is private and service-role only", () => {
  assert.match(migration, /create table if not exists public\.ai_assistant_health_baselines/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.ai_assistant_health_baselines from public, anon, authenticated/);
  assert.match(migration, /grant all on table public\.ai_assistant_health_baselines to service_role/);
  assert.match(migration, /Validation execution itself remains write-free/);
});

test("deterministic Baseline One accepts the full 10,000-run report and stamps the server commit", () => {
  const payload = normaliseHealthBaselineInput({ name: "Baseline 1 · Deterministic", mode: "deterministic", report: report() }, { VERCEL_GIT_COMMIT_SHA: "server-commit" });
  assert.equal(payload.name, "Baseline 1 · Deterministic");
  assert.equal(payload.mode, "deterministic");
  assert.equal(payload.conversations, 10000);
  assert.equal(payload.commit_sha, "server-commit");
  assert.equal(payload.overall_ai_health_score, 98.6);
});

test("live baselines require a representative 50 to 100 conversation sample", () => {
  assert.throws(() => normaliseHealthBaselineInput({ mode: "live", report: report({ mode: "live", conversations: 49 }) }, {}), /outside the supported range/);
  assert.doesNotThrow(() => normaliseHealthBaselineInput({ mode: "live", report: report({ mode: "live", conversations: 100 }) }, {}));
  assert.throws(() => normaliseHealthBaselineInput({ mode: "live", report: report({ mode: "live", conversations: 101 }) }, {}), /outside the supported range/);
});

test("baseline mode must match the completed report and report size is bounded", () => {
  assert.throws(() => normaliseHealthBaselineInput({ mode: "live", report: report() }, {}), /does not match/);
  assert.throws(() => normaliseHealthBaselineInput({ mode: "deterministic", report: report({ padding: "x".repeat(260000) }) }, {}), /too large/);
});

test("baseline persistence uses the shared protected Marketing CRM service", () => {
  assert.match(service, /buildMarketingAccessHeaders/);
  assert.match(service, /\/api\/marketing-ai-control-centre/);
  assert.match(service, /loadHealthBaselines/);
  assert.match(service, /saveHealthBaseline/);
  assert.match(api, /authorize\(request, environment\)/);
});

test("validation remains write-free and saving is a separate explicit UI action", () => {
  const runValidation = healthPage.match(/async function runValidation[\s\S]*?\n  }\n\n  async function saveBaseline/)?.[0] || "";
  assert.match(runValidation, /runDeterministicHealthBatch/);
  assert.match(runValidation, /runLiveHealthBatch/);
  assert.doesNotMatch(runValidation, /saveAssistantHealthBaseline/);
  assert.doesNotMatch(runValidation, /localStorage\.setItem/);
  assert.match(healthPage, /async function saveBaseline/);
  assert.match(healthPage, /saveAssistantHealthBaseline/);
  assert.match(healthPage, /Save as Server Baseline/);
});

test("Baseline One defaults are 10,000 deterministic and 100 live without auto-starting either run", () => {
  assert.match(healthPage, /useState\(10000\)/);
  assert.match(healthPage, /useState\(100\)/);
  assert.doesNotMatch(healthPage, /useEffect\([\s\S]{0,1000}runValidation\(/);
  assert.match(healthPage, /paid mode is manually started/);
});

test("latest server baselines are used for comparison before browser fallback", () => {
  assert.match(healthPage, /serverBaselines\.find\(\(item\) => item\.mode === mode\)/);
  assert.match(healthPage, /latestServerBaseline\?\.report \|\|/);
  assert.match(healthPage, /BaselineLibrary/);
});

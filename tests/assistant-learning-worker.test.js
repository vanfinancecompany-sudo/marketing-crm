import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assistantLearningResultIsStale,
  assistantLearningWorkerAuthorised,
} from "../api/ai-assistant-learning-worker.js";

test("assistant learning worker accepts Vercel cron secret and rejects unknown callers", () => {
  const environment = {
    CRON_SECRET: "cron-secret",
    MARKETING_CUSTOMER_DATABASE_API_KEY: "marketing-key",
  };
  assert.equal(assistantLearningWorkerAuthorised({ headers: { authorization: "Bearer cron-secret" } }, environment), true);
  assert.equal(assistantLearningWorkerAuthorised({ headers: { "x-marketing-customer-database-key": "marketing-key" } }, environment), true);
  assert.equal(assistantLearningWorkerAuthorised({ headers: { authorization: "Bearer wrong" } }, environment), false);
});

test("assistant learning worker recovers only stale processing results", () => {
  const now = new Date("2026-09-22T23:00:00.000Z");
  assert.equal(assistantLearningResultIsStale({
    conversation_diagnostics: {
      learning_capture_status: "processing",
      learning_capture_started_at: "2026-09-22T22:40:00.000Z",
    },
  }, now), true);
  assert.equal(assistantLearningResultIsStale({
    conversation_diagnostics: {
      learning_capture_status: "processing",
      learning_capture_started_at: "2026-09-22T22:55:00.000Z",
    },
  }, now), false);
  assert.equal(assistantLearningResultIsStale({
    conversation_diagnostics: {
      learning_capture_status: "pending",
    },
  }, now), false);
});

test("live public chat defers learning capture and Vercel schedules the background worker", async () => {
  const publicRoute = await readFile(new URL("../api/ai-assistant-customer.js", import.meta.url), "utf8");
  const competence = await readFile(new URL("../api/marketing-ai-assistant-competence.js", import.meta.url), "utf8");
  const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));

  assert.match(publicRoute, /captureLearning:\s*false/);
  assert.match(competence, /learning_capture_status:\s*options\.persist !== false && options\.captureLearning === false \? "pending"/);

  const cron = vercel.crons.find((item) => item.path === "/api/ai-assistant-learning-worker");
  assert.deepEqual(cron, { path: "/api/ai-assistant-learning-worker", schedule: "* * * * *" });
  assert.equal(vercel.functions["api/ai-assistant-learning-worker.js"].maxDuration, 60);
});

test("background learning reuses one knowledge snapshot across the batch", async () => {
  const worker = await readFile(new URL("../api/ai-assistant-learning-worker.js", import.meta.url), "utf8");
  const store = await readFile(new URL("../api/_knowledgeOpportunityStore.js", import.meta.url), "utf8");
  assert.match(worker, /const knowledge = await loadLearningKnowledge\(db\)/);
  assert.match(worker, /assessSavedCompetenceResult\(db, claimed\.id, \{ knowledge \}\)/);
  assert.match(store, /options\.knowledge \|\| null/);
});

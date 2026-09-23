import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PRIORITY_AI_MODEL_DEFAULTS } from "../lib/priorityAiModelPolicy.js";

test("GPT-6 workforce policy keeps public chat on Sol and bounded background work on Luna", () => {
  assert.equal(PRIORITY_AI_MODEL_DEFAULTS.wix_fast, "gpt-6-sol");
  assert.equal(PRIORITY_AI_MODEL_DEFAULTS.wix_main, "gpt-6-sol");
  assert.equal(PRIORITY_AI_MODEL_DEFAULTS.wix_escalation, "gpt-6-sol");

  for (const key of [
    "knowledge_topic",
    "knowledge",
    "editorial",
    "marketing_content",
    "marketing_review",
    "website_intelligence",
    "editorial_automation",
    "competence_bulk",
  ]) {
    assert.equal(PRIORITY_AI_MODEL_DEFAULTS[key], "gpt-6-luna", key);
  }
  assert.equal(PRIORITY_AI_MODEL_DEFAULTS.knowledge_review, "gpt-6-sol");
});

test("direct Marketing CRM AI workers are pinned to the GPT-6 operation policy", async () => {
  const [
    knowledgeHub,
    marketingPlatform,
    editorial,
    competence,
    seo,
    corrections,
    reconciliation,
    monitor,
  ] = await Promise.all([
    readFile(new URL("../api/marketing-knowledge-hub.js", import.meta.url), "utf8"),
    readFile(new URL("../api/marketing-ai-platform.js", import.meta.url), "utf8"),
    readFile(new URL("../api/marketing-editorial-engine.js", import.meta.url), "utf8"),
    readFile(new URL("../api/marketing-ai-assistant-competence.js", import.meta.url), "utf8"),
    readFile(new URL("../api/knowledge-hub-seo-fields.js", import.meta.url), "utf8"),
    readFile(new URL("../api/marketing-knowledge-corrections.js", import.meta.url), "utf8"),
    readFile(new URL("../api/stock-reconciliation-agent.js", import.meta.url), "utf8"),
    readFile(new URL("../api/stock-watch-monitor-agent.js", import.meta.url), "utf8"),
  ]);

  assert.match(knowledgeHub, /modelOperation: "knowledge_topic"/);
  assert.match(knowledgeHub, /modelOperation: "knowledge_generation"/);
  assert.match(knowledgeHub, /modelOperation: "knowledge_review"/);
  assert.match(marketingPlatform, /modelOperation: "marketing_content"/);
  assert.match(marketingPlatform, /modelOperation: "marketing_review"/);
  assert.match(marketingPlatform, /modelOperation: "website_intelligence"/);
  assert.match(editorial, /resolveAiOperationModel\(environment, "editorial"\)/);
  assert.match(competence, /resolveAiOperationModel\(environment, "competence_bulk"\)/);
  assert.match(seo, /resolveAiOperationModel\(process\.env, "editorial"\)/);
  assert.match(corrections, /resolveAiOperationModel\(process\.env, "editorial"\)/);
  assert.match(reconciliation, /OPENAI_STOCK_RECONCILIATION_MODEL/);
  assert.match(reconciliation, /resolveAiOperationModel\(process\.env, "marketing_review"\)/);
  assert.match(monitor, /OPENAI_STOCK_WATCH_MONITOR_MODEL[\s\S]{0,120}"gpt-6-luna"/);
});

test("workforce routing no longer defaults any audited background agent to GPT-5.6", async () => {
  const policy = await readFile(new URL("../lib/priorityAiModelPolicy.js", import.meta.url), "utf8");
  const monitor = await readFile(new URL("../api/stock-watch-monitor-agent.js", import.meta.url), "utf8");
  assert.doesNotMatch(policy, /gpt-5\.6/i);
  assert.doesNotMatch(monitor, /gpt-5\.6/i);
});

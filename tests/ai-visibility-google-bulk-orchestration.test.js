import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("published-page Google checks use bounded client batches instead of one four-minute request", async () => {
  const service = await read("../services/aiVisibility.js");

  assert.match(service, /const GOOGLE_BULK_CONCURRENCY = 5;/);
  assert.match(service, /\.filter\(isConfirmedPublishedArticle\)/);
  assert.match(service, /for \(let index = 0; index < published\.length; index \+= GOOGLE_BULK_CONCURRENCY\)/);
  assert.match(service, /Promise\.allSettled/);
  assert.match(service, /checkGoogleForArticle\(article\.id, `\$\{runId\}:\$\{article\.id\}`\)/);
  assert.doesNotMatch(service, /BULK_GOOGLE_CHECK_TIMEOUT_MS/);
  assert.doesNotMatch(service, /exceeded four minutes/);
  assert.doesNotMatch(service, /requestConnection\("bulkGoogleCheck"/);
});

test("single Google checks skip whole-history normalization during client batching", async () => {
  const api = await read("../api/marketing-ai-visibility-google.js");

  assert.match(api, /async function normalizationForAction\(supabase, action\)/);
  assert.match(api, /if \(action === "checkGoogle"\)/);
  assert.match(api, /skipped: true/);
  assert.match(api, /const normalization = await normalizationForAction\(supabase, body\.action\);/);
});

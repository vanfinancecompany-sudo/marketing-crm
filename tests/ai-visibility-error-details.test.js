import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("article detail exposes the exact stored Google error", async () => {
  const component = await read("../components/AIVisibilityErrorDetails.jsx");
  assert.match(component, /Why this page shows Error/);
  assert.match(component, /latest\.error_details \|\| structured\.inspection_error/);
  assert.match(component, /VIEW GOOGLE EVIDENCE DETAILS/);
  assert.match(component, /Failure code/);
  assert.match(component, /Search impressions/);
  assert.match(component, /Search clicks/);
  assert.match(component, /VIEW PREVIOUS GOOGLE ATTEMPTS/);
});

test("error detail panel mounts only on an article evidence page", async () => {
  const component = await read("../components/AIVisibilityErrorDetails.jsx");
  assert.match(component, /Current provider results/);
  assert.match(component, /data-ai-visibility-google-error-host/);
  assert.match(component, /if \(!latest \|\| latest\.result_status !== "error"\) return null/);
  assert.match(component, /entry\.root\.unmount\(\)/);
});

test("AI Visibility service installs the error details panel", async () => {
  const service = await read("../services/aiVisibility.js");
  assert.match(service, /AIVisibilityErrorDetails\.jsx/);
  assert.match(service, /installAiVisibilityErrorDetails/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("automation worker keeps OFF as a hard stop and never uses shareNow", async () => {
  const source = await readFile(
    new URL("../api/buffer-facebook-automation-worker.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /automationConfig\.mode === "off"/);
  assert.match(source, /No content was created/);
  assert.equal(source.includes("shareNow"), false);
  assert.equal(source.includes("Facebook Marketplace"), false);
});

test("only sent Buffer image posts enter confirmed posting history", async () => {
  const worker = await readFile(
    new URL("../api/buffer-facebook-automation-worker.js", import.meta.url),
    "utf8",
  );
  assert.match(worker, /status \|\| ""\)\.toLowerCase\(\) !== "sent"/);
  assert.match(worker, /source: "buffer_automation"/);
  assert.match(worker, /buffer_status: "sent"/);

  const service = await readFile(
    new URL("../services/marketingDailyOperations.js", import.meta.url),
    "utf8",
  );
  assert.match(service, /BUFFER_HISTORY_ROUTE = "\/api\/buffer-posting-history"/);
  assert.match(service, /requestBufferPostingHistory/);
});

test("queue mode requires explicit UI and API confirmation", async () => {
  const apiSource = await readFile(
    new URL("../api/buffer-automation-settings.js", import.meta.url),
    "utf8",
  );
  const clientSource = await readFile(
    new URL("../public/buffer-posting-bridge.js", import.meta.url),
    "utf8",
  );
  assert.match(apiSource, /ENABLE_BUFFER_QUEUE/);
  assert.match(clientSource, /LIVE BUFFER QUEUE can publish to Facebook/);
  assert.match(clientSource, /ENABLE_BUFFER_QUEUE/);
});

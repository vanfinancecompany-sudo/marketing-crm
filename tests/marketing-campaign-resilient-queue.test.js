import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("campaign confirmation uses a bounded fast resolver and chunked recipient reservation", () => {
  const source = fs.readFileSync(new URL("../api/marketing-template-campaign-sends-resilient.js", import.meta.url), "utf8");
  assert.match(source, /firstEligibleRecipients/);
  assert.match(source, /const INSERT_CHUNK = 50/);
  assert.match(source, /marketing_email_send_recipients/);
  assert.match(source, /queue_state: "reserving_fast"/);
  assert.match(source, /dispatch_mode: "queued_worker"/);
  assert.match(source, /status: "sending"/);
  assert.match(source, /No campaign email was submitted and it is safe to retry/);
});

test("parent send is not marked sending until after recipient reservation loop", () => {
  const source = fs.readFileSync(new URL("../api/marketing-template-campaign-sends-resilient.js", import.meta.url), "utf8");
  const loop = source.indexOf("for (let i = 0; i < rows.length; i += INSERT_CHUNK)");
  const sending = source.indexOf('status: "sending"', loop);
  assert.ok(loop >= 0);
  assert.ok(sending > loop);
});

test("Vercel routes the public campaign send API through the resilient dispatcher", () => {
  const config = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.equal(
    config.rewrites.some((entry) => entry.source === "/api/marketing-template-campaign-sends" && entry.destination === "/api/marketing-template-campaign-sends-resilient"),
    true,
  );
  assert.equal(config.functions["api/marketing-template-campaign-sends-resilient.js"]?.maxDuration, 300);
});

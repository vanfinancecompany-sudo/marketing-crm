import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const controlSource = fs.readFileSync(new URL("../public/campaigns/sendgrid-test-control.js", import.meta.url), "utf8");

function loadControl() {
  const context = { globalThis: {}, Response };
  vm.runInNewContext(controlSource, context);
  return context.globalThis.SendGridTestControl;
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function setup(fetchImpl, overrides = {}) {
  const messages = [];
  const button = { hidden: false, disabled: false };
  const configurationNode = { hidden: false, textContent: "" };
  const control = loadControl().create({
    button,
    configurationNode,
    fetchImpl,
    getCampaignId: () => "11111111-1111-4111-8111-111111111111",
    getEmail: () => "internal@vanfinancecompany.co.uk",
    getStoredKey: () => "stored-access-value",
    setMessage: (message, error) => messages.push({ message, error }),
    ...overrides,
  });
  return { button, configurationNode, control, messages };
}

function previewDiagnostics(overrides = {}) {
  return {
    ok: true,
    preview_enabled: true,
    recipient_configured: true,
    recipient_valid: true,
    recipient_length: 29,
    recipient_domain: "vanfinancecompany.co.uk",
    ...overrides,
  };
}

test("SendGrid test button stays hidden in production", async () => {
  const { button, control } = setup(async () => response({ ok: true, preview_enabled: false }));
  assert.equal(button.hidden, true);
  assert.equal(await control.checkAvailability(), false);
  assert.equal(button.hidden, true);
});

test("SendGrid test button is visible in Vercel Preview", async () => {
  const { button, configurationNode, control } = setup(async () => response(previewDiagnostics()));
  assert.equal(await control.checkAvailability(), true);
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false);
  assert.equal(configurationNode.textContent, "SendGrid test recipient configured for vanfinancecompany.co.uk.");
});

test("SendGrid test request uses the currently open campaign ID", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return options.method === "GET"
      ? response(previewDiagnostics())
      : response({ ok: true, send_id: "22222222-2222-4222-8222-222222222222" });
  };
  const { control } = setup(fetchImpl, { getCampaignId: () => "33333333-3333-4333-8333-333333333333" });
  await control.checkAvailability();
  await control.send();
  const post = requests.find(({ options }) => options.method === "POST");
  assert.equal(post.url, "/api/sendgrid-test-email");
  assert.deepEqual(JSON.parse(post.options.body), {
    campaign_id: "33333333-3333-4333-8333-333333333333",
    email: "internal@vanfinancecompany.co.uk",
  });
});

test("duplicate SendGrid test clicks are ignored while a request is pending", async () => {
  let release;
  let postCount = 0;
  const pendingResponse = new Promise((resolve) => { release = resolve; });
  const fetchImpl = async (_url, options) => {
    if (options.method === "GET") return response(previewDiagnostics());
    postCount += 1;
    return pendingResponse;
  };
  const { button, control } = setup(fetchImpl);
  await control.checkAvailability();
  const first = control.send();
  const second = await control.send();
  assert.equal(second, false);
  assert.equal(postCount, 1);
  assert.equal(button.disabled, true);
  release(response({ ok: true }));
  await first;
  assert.equal(button.disabled, false);
});

test("successful SendGrid test shows only the accepted state and safe send ID", async () => {
  const fetchImpl = async (_url, options) => options.method === "GET"
    ? response(previewDiagnostics())
    : response({ ok: true, send_id: "44444444-4444-4444-8444-444444444444", provider_message_id: "provider-detail" });
  const { control, messages } = setup(fetchImpl);
  await control.checkAvailability();
  await control.send();
  assert.deepEqual(messages.at(-1), {
    message: "SendGrid test accepted — Send ID: 44444444-4444-4444-8444-444444444444",
    error: false,
  });
});

test("unsafe endpoint failure details are not displayed", async () => {
  const fetchImpl = async (_url, options) => options.method === "GET"
    ? response(previewDiagnostics())
    : response({ ok: false, message: "Provider failed\nAuthorization: Bearer do-not-render" }, 502);
  const { control, messages } = setup(fetchImpl);
  await control.checkAvailability();
  await control.send();
  assert.deepEqual(messages.at(-1), { message: "SendGrid test send failed.", error: true });
});

test("invalid Preview recipient diagnostics show safe configuration detail and disable sending", async () => {
  const diagnostics = previewDiagnostics({
    recipient_valid: false,
    recipient_length: 17,
    recipient_domain: "example.com",
  });
  const { button, configurationNode, control } = setup(async () => response(diagnostics));
  await control.checkAvailability();
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, true);
  assert.equal(
    configurationNode.textContent,
    "SendGrid test recipient configuration is invalid for example.com (normalised length 17)."
  );
  assert.doesNotMatch(configurationNode.textContent, /sales@/i);
});

test("SendGrid client assets contain no server environment secret names or values", () => {
  const sendingSource = fs.readFileSync(new URL("../public/campaigns/sending-foundation.js", import.meta.url), "utf8");
  const clientSource = `${controlSource}\n${sendingSource}`;
  for (const forbidden of [
    "SENDGRID_API_KEY",
    "SENDGRID_TEST_RECIPIENT_EMAIL",
    "MARKETING_CUSTOMER_DATABASE_API_KEY",
    "SENDGRID_WEBHOOK_VERIFICATION_KEY",
  ]) assert.doesNotMatch(clientSource, new RegExp(forbidden));
});

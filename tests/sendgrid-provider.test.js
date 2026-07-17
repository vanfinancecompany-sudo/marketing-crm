import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import {
  SENDGRID_TEST_SENDER_EMAIL,
  SendGridProviderError,
  sendSendGridEmail,
} from "../lib/emailProviders/sendgrid.js";
import {
  allowedSendGridTestRecipient,
  isSendGridTestEnvironment,
  normalizeSendGridRecipientEmail,
  safeSendGridTestErrorMessage,
  sendGridRecipientDiagnostics,
} from "../api/sendgrid-test-email.js";
import sendGridTestEmailHandler from "../api/sendgrid-test-email.js";

test("SendGrid test send stores the provider message ID returned on success", async () => {
  let submitted;
  const result = await sendSendGridEmail({
    apiKey: crypto.randomBytes(24).toString("base64url"),
    to: "internal@vanfinancecompany.co.uk",
    subject: "Test subject",
    html: "<p>Test body</p>",
    customArgs: { marketing_recipient_id: "recipient-id", marketing_send_type: "test" },
    fetchImpl: async (_url, options) => {
      submitted = { headers: options.headers, body: JSON.parse(options.body) };
      return new Response("", { status: 202, headers: { "x-message-id": "sendgrid-message-id" } });
    },
  });

  assert.equal(result.messageId, "sendgrid-message-id");
  assert.equal(submitted.body.from.email, SENDGRID_TEST_SENDER_EMAIL);
  assert.equal(submitted.body.personalizations[0].custom_args.marketing_recipient_id, "recipient-id");
  assert.match(submitted.headers.Authorization, /^Bearer /);
});

test("SendGrid provider failure is surfaced without treating it as accepted", async () => {
  await assert.rejects(
    sendSendGridEmail({
      apiKey: crypto.randomBytes(24).toString("base64url"),
      to: "internal@vanfinancecompany.co.uk",
      subject: "Test subject",
      html: "<p>Test body</p>",
      fetchImpl: async () => new Response(JSON.stringify({ errors: [{ message: "sender rejected" }] }), { status: 400 }),
    }),
    (error) => error instanceof SendGridProviderError && error.providerStatusCode === 400 && !error.ambiguous
  );
});

test("controlled test recipient must exactly match one configured internal address", () => {
  assert.equal(
    allowedSendGridTestRecipient("safe@vanfinancecompany.co.uk", "safe@vanfinancecompany.co.uk"),
    "safe@vanfinancecompany.co.uk"
  );
  assert.equal(allowedSendGridTestRecipient("other@vanfinancecompany.co.uk", "safe@vanfinancecompany.co.uk"), "");
  assert.equal(allowedSendGridTestRecipient("safe@example.com", "safe@example.com"), "");
});

test("normal SendGrid recipient email is preserved and normalised to lowercase", () => {
  assert.equal(normalizeSendGridRecipientEmail("Sales@VanFinanceCompany.co.uk"), "sales@vanfinancecompany.co.uk");
});

test("SendGrid recipient normalisation removes surrounding single and double quotes", () => {
  assert.equal(normalizeSendGridRecipientEmail('"sales@vanfinancecompany.co.uk"'), "sales@vanfinancecompany.co.uk");
  assert.equal(normalizeSendGridRecipientEmail("'sales@vanfinancecompany.co.uk'"), "sales@vanfinancecompany.co.uk");
});

test("SendGrid recipient normalisation removes CR and LF characters", () => {
  assert.equal(normalizeSendGridRecipientEmail("\r\nsales@vanfinancecompany.co.uk\r\n"), "sales@vanfinancecompany.co.uk");
});

test("SendGrid recipient normalisation removes zero-width Unicode characters", () => {
  assert.equal(
    normalizeSendGridRecipientEmail("\u200Bsales@vanfinance\u200Ccompany.co.uk\u2060\uFEFF"),
    "sales@vanfinancecompany.co.uk"
  );
});

test("SendGrid recipient normalisation removes non-breaking spaces", () => {
  assert.equal(
    normalizeSendGridRecipientEmail("\u00A0sales@vanfinancecompany.co.uk\u202F"),
    "sales@vanfinancecompany.co.uk"
  );
});

test("valid external recipient configuration remains ineligible", () => {
  assert.deepEqual(sendGridRecipientDiagnostics("sales@example.com"), {
    recipient_configured: true,
    recipient_valid: false,
    recipient_length: 17,
    recipient_domain: "example.com",
  });
  assert.equal(allowedSendGridTestRecipient("sales@example.com", "sales@example.com"), "");
});

test("recipient matching remains exact after robust normalisation", () => {
  assert.equal(
    allowedSendGridTestRecipient("\u200Bsales@vanfinancecompany.co.uk\u00A0", '"sales@vanfinancecompany.co.uk"'),
    "sales@vanfinancecompany.co.uk"
  );
  assert.equal(
    allowedSendGridTestRecipient("other@vanfinancecompany.co.uk", '"sales@vanfinancecompany.co.uk"'),
    ""
  );
});

test("authenticated SendGrid diagnostics expose no complete email or secrets", async () => {
  const previous = {
    access: process.env.MARKETING_CUSTOMER_DATABASE_API_KEY,
    recipient: process.env.SENDGRID_TEST_RECIPIENT_EMAIL,
    vercel: process.env.VERCEL_ENV,
  };
  const accessSecret = crypto.randomBytes(24).toString("base64url");
  process.env.MARKETING_CUSTOMER_DATABASE_API_KEY = accessSecret;
  process.env.SENDGRID_TEST_RECIPIENT_EMAIL = '"\u200Bsales@vanfinancecompany.co.uk\u00A0"\r\n';
  process.env.VERCEL_ENV = "preview";
  let statusCode = 0;
  let payload;
  const response = {
    setHeader() {},
    status(value) { statusCode = value; return this; },
    json(value) { payload = value; return this; },
  };
  try {
    await sendGridTestEmailHandler({ method: "GET", headers: { "x-marketing-customer-database-key": accessSecret } }, response);
  } finally {
    if (previous.access === undefined) delete process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
    else process.env.MARKETING_CUSTOMER_DATABASE_API_KEY = previous.access;
    if (previous.recipient === undefined) delete process.env.SENDGRID_TEST_RECIPIENT_EMAIL;
    else process.env.SENDGRID_TEST_RECIPIENT_EMAIL = previous.recipient;
    if (previous.vercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous.vercel;
  }
  assert.equal(statusCode, 200);
  assert.deepEqual(payload, {
    ok: true,
    preview_enabled: true,
    recipient_configured: true,
    recipient_valid: true,
    recipient_length: 29,
    recipient_domain: "vanfinancecompany.co.uk",
  });
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /sales@vanfinancecompany\.co\.uk/i);
  assert.doesNotMatch(serialized, new RegExp(accessSecret));
});

test("SendGrid test endpoint is enabled only in Preview or local non-production environments", () => {
  assert.equal(isSendGridTestEnvironment({ VERCEL_ENV: "preview", NODE_ENV: "production" }), true);
  assert.equal(isSendGridTestEnvironment({ VERCEL_ENV: "development" }), true);
  assert.equal(isSendGridTestEnvironment({ VERCEL_ENV: "production", NODE_ENV: "development" }), false);
  assert.equal(isSendGridTestEnvironment({ NODE_ENV: "test" }), true);
  assert.equal(isSendGridTestEnvironment({ NODE_ENV: "production" }), false);
});

test("SendGrid provider response bodies are not returned by the test endpoint", () => {
  const error = new SendGridProviderError("SendGrid HTTP 400: provider response body", { providerStatusCode: 400 });
  assert.equal(safeSendGridTestErrorMessage(error), "SendGrid rejected the test email.");
});

test("migration 014 adds SendGrid without changing the Brevo provider default", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/014_sendgrid_provider_integration.sql", import.meta.url), "utf8");
  assert.match(sql, /marketing_email_events_provider_check[\s\S]*provider in \('brevo', 'sendgrid'\)/i);
  assert.match(sql, /marketing_email_sends_provider_check[\s\S]*provider in \('brevo', 'sendgrid'\)/i);
  assert.match(sql, /'Brevo webhook', 'SMTP2GO webhook', 'SendGrid webhook'/);
  assert.match(sql, /v_type text := lower\(trim\(coalesce\(p_type, ''\)\)\);/);
  assert.doesNotMatch(sql, /set default\s+'sendgrid'/i);
});

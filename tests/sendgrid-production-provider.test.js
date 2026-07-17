import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import {
  activeEmailProvider,
  callEmailProvider,
  emailProviderConfig,
  providerStatus,
  requestedBatchSize,
} from "../api/marketing-template-campaign-sends.js";
import { checkEmailProviderConnection, dashboardEmailProviderConfig } from "../api/marketing-dashboard.js";
import { SENDGRID_SENDER_EMAIL, SendGridProviderError, sendGridApiKeyFormatValid } from "../lib/emailProviders/sendgrid.js";

const sendingSource = fs.readFileSync(new URL("../api/marketing-template-campaign-sends.js", import.meta.url), "utf8");
const dashboardSource = fs.readFileSync(new URL("../api/marketing-dashboard.js", import.meta.url), "utf8");
const dashboardClientSource = fs.readFileSync(new URL("../public/marketing-dashboard/index.html", import.meta.url), "utf8");

function sendGridEnvironment() {
  return {
    MARKETING_EMAIL_PROVIDER: "sendgrid",
    SENDGRID_API_KEY: `SG.${crypto.randomBytes(16).toString("base64url")}.${crypto.randomBytes(32).toString("base64url")}`,
    SENDGRID_WEBHOOK_VERIFICATION_KEY: crypto.randomBytes(24).toString("base64url"),
    SMTP2GO_SENDER_NAME: "Van Finance Company",
  };
}

function basePayload(sendType = "test") {
  return {
    to: "internal@vanfinancecompany.co.uk",
    name: "Internal recipient",
    subject: "Provider test",
    html: "<p>Provider test</p>",
    tags: ["marketing-crm", sendType, "campaign-id"],
    sendType,
    headers: {
      "X-Marketing-Campaign-Id": "campaign-id",
      "X-Marketing-Send-Id": "send-id",
      "X-Marketing-Recipient-Id": "recipient-id",
    },
  };
}

test("absent MARKETING_EMAIL_PROVIDER preserves the existing SMTP2GO-or-Brevo fallback", () => {
  assert.equal(activeEmailProvider({ SMTP2GO_API_KEY: "configured" }), "smtp2go");
  assert.equal(activeEmailProvider({ SMTP2GO_SENDER_EMAIL: "sender@example.com" }), "smtp2go");
  assert.equal(activeEmailProvider({ BREVO_API_KEY: "configured" }), "brevo");
  assert.equal(activeEmailProvider({}), "brevo");
});

test("MARKETING_EMAIL_PROVIDER explicitly selects SendGrid", () => {
  const environment = sendGridEnvironment();
  assert.equal(activeEmailProvider(environment), "sendgrid");
  const config = emailProviderConfig("sendgrid", environment);
  assert.equal(config.provider, "SendGrid");
  assert.equal(config.senderEmail, SENDGRID_SENDER_EMAIL);
  assert.equal(config.webhookVerificationConfigured, true);
});

test("Campaign Builder and Marketing Dashboard share the explicit provider selection", () => {
  assert.match(dashboardSource, /activeEmailProvider\(environment\)/);
  assert.match(dashboardSource, /emailProviderConfig\(selected, environment\)/);
  assert.doesNotMatch(dashboardSource, /api\.sendgrid\.com\/v3\/user\/profile/);
  assert.doesNotMatch(sendingSource, /api\.sendgrid\.com\/v3\/user\/profile/);
  assert.match(dashboardSource, /query\.eq\("provider", "sendgrid"\)/);
  assert.match(dashboardClientSource, /sender email configured/);
});

test("Mail Send-only SendGrid configuration is ready without a remote permission probe", async () => {
  const environment = sendGridEnvironment();
  assert.equal(sendGridApiKeyFormatValid(environment.SENDGRID_API_KEY), true);
  let healthRequests = 0;
  const restrictedEndpoint = async () => {
    healthRequests += 1;
    return new Response("forbidden", { status: 403 });
  };
  const campaignHealth = await providerStatus(environment, restrictedEndpoint);
  const dashboardHealth = await checkEmailProviderConnection(dashboardEmailProviderConfig(environment), restrictedEndpoint);
  assert.equal(healthRequests, 0);
  assert.equal(campaignHealth.provider_status.connectivity, "configured");
  assert.equal(campaignHealth.provider_status.message, "Configured for Mail Send. Provider acceptance is confirmed only by an actual controlled send.");
  assert.equal(campaignHealth.provider_status.webhook_verification_configured, true);
  assert.equal(dashboardHealth.state, "configured");
  assert.equal(dashboardHealth.label, "Configured for Mail Send");
  assert.equal("status_code" in dashboardHealth, false);
});

test("SendGrid health diagnostics reject malformed key configuration without exposing it", async () => {
  const malformedSecret = "not-a-sendgrid-key-private-value";
  const environment = { ...sendGridEnvironment(), SENDGRID_API_KEY: malformedSecret };
  const result = await providerStatus(environment, async () => {
    throw new Error("Health checks must not make a SendGrid request.");
  });
  const serialized = JSON.stringify(result);
  assert.equal(result.provider_status.connectivity, "not_configured");
  assert.equal(result.provider_status.api_key_configured, true);
  assert.equal(result.provider_status.api_key_valid, false);
  assert.doesNotMatch(serialized, new RegExp(malformedSecret));
  assert.doesNotMatch(serialized, /SENDGRID_API_KEY/);
});

test("actual SendGrid Mail Send rejection still fails safely", async () => {
  await assert.rejects(
    callEmailProvider(basePayload("test"), {
      environment: sendGridEnvironment(),
      fetchImpl: async (url) => {
        assert.equal(url, "https://api.sendgrid.com/v3/mail/send");
        return new Response("restricted provider detail", { status: 403 });
      },
    }),
    (error) => error instanceof SendGridProviderError
      && error.providerStatusCode === 403
      && !error.message.includes("restricted provider detail")
  );
});

test("configured webhook awaiting its first event does not block readiness", () => {
  assert.match(dashboardSource, /webhook_secret_configured: webhook\.configured/);
  assert.doesNotMatch(dashboardSource, /provider_authorised:.*hasReceivedEvents/);
});

test("invalid MARKETING_EMAIL_PROVIDER fails safely", () => {
  assert.throws(
    () => activeEmailProvider({ MARKETING_EMAIL_PROVIDER: "automatic" }),
    (error) => error.statusCode === 400 && /must be smtp2go, brevo or sendgrid/i.test(error.message)
  );
});

test("SendGrid internal test send includes complete test correlation and stores the returned message ID", async () => {
  let request;
  const result = await callEmailProvider(basePayload("test"), {
    environment: sendGridEnvironment(),
    fetchImpl: async (url, options) => {
      request = { url, headers: options.headers, body: JSON.parse(options.body) };
      return new Response("", { status: 202, headers: { "x-message-id": "sendgrid-test-message" } });
    },
  });
  assert.equal(result.messageId, "sendgrid-test-message");
  assert.equal(request.url, "https://api.sendgrid.com/v3/mail/send");
  assert.equal(request.body.from.email, SENDGRID_SENDER_EMAIL);
  assert.deepEqual(request.body.personalizations[0].custom_args, {
    marketing_campaign_id: "campaign-id",
    marketing_send_id: "send-id",
    marketing_recipient_id: "recipient-id",
    marketing_send_type: "test",
  });
});

test("SendGrid production send includes recipient correlation and unsubscribe header", async () => {
  let requestBody;
  const payload = basePayload("production");
  payload.headers["List-Unsubscribe"] = "<https://crm.example/api/marketing-unsubscribe?token=redacted>";
  const result = await callEmailProvider(payload, {
    environment: sendGridEnvironment(),
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response("", { status: 202, headers: { "x-message-id": "sendgrid-production-message" } });
    },
  });
  assert.equal(result.messageId, "sendgrid-production-message");
  assert.equal(requestBody.personalizations[0].custom_args.marketing_send_type, "production");
  assert.equal(requestBody.personalizations[0].custom_args.marketing_recipient_id, "recipient-id");
  assert.match(requestBody.personalizations[0].headers["List-Unsubscribe"], /^<https:\/\//);
  assert.deepEqual(requestBody.categories, ["marketing-crm", "production", "campaign-id"]);
});

test("SMTP2GO and Brevo send paths remain available", async () => {
  const smtpResult = await callEmailProvider(basePayload("test"), {
    provider: "smtp2go",
    environment: {
      SMTP2GO_API_KEY: "smtp-key",
      SMTP2GO_SENDER_EMAIL: "sender@vanfinancecompany.co.uk",
      SMTP2GO_SENDER_NAME: "Van Finance Company",
    },
    fetchImpl: async () => new Response(JSON.stringify({ data: { succeeded: 1, failed: 0, email_id: "smtp-message" } }), { status: 200 }),
  });
  assert.equal(smtpResult.messageId, "smtp-message");

  const brevoResult = await callEmailProvider(basePayload("test"), {
    provider: "brevo",
    environment: {
      BREVO_API_KEY: "brevo-key",
      BREVO_SENDER_EMAIL: "sender@vanfinancecompany.co.uk",
      BREVO_SENDER_NAME: "Van Finance Company",
    },
    fetchImpl: async () => new Response(JSON.stringify({ messageId: "brevo-message" }), { status: 201 }),
  });
  assert.equal(brevoResult.messageId, "brevo-message");
});

test("production batch size remains capped at 500", () => {
  assert.equal(requestedBatchSize(500), 500);
  assert.throws(() => requestedBatchSize(501), /between 1 and 500/i);
});

test("production workflow retains suppression, duplicate, confirmation and ambiguous-send protections", () => {
  assert.match(sendingSource, /marketing_suppression_identities/);
  assert.match(sendingSource, /latestContact\.lifecycle_status !== "active"/);
  assert.match(sendingSource, /skipped_suppressed/);
  assert.match(sendingSource, /message\.includes\("duplicate"\) \|\| message\.includes\("unique"\)/);
  assert.match(sendingSource, /confirmation_phrase/);
  assert.match(sendingSource, /status: "submission_unknown"/);
  assert.match(sendingSource, /provider_message_id: provider\.messageId \|\| null/);
  assert.match(sendingSource, /provider: databaseSendProvider\(selectedProvider\)/);
});

test("browser assets contain no provider secret values or server variable names", () => {
  const clientSource = [
    "../public/campaigns/sending-foundation.js",
    "../public/campaigns/ui-preview-polish.js",
    "../public/campaigns/reporting-foundation.js",
    "../public/marketing-dashboard/index.html",
  ].map((path) => fs.readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
  for (const forbidden of [
    "SENDGRID_API_KEY",
    "SENDGRID_WEBHOOK_VERIFICATION_KEY",
    "MARKETING_EMAIL_PROVIDER",
    "SMTP2GO_API_KEY",
    "BREVO_API_KEY",
  ]) assert.doesNotMatch(clientSource, new RegExp(forbidden));
});

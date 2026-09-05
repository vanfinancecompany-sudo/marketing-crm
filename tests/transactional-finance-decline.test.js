import assert from "node:assert/strict";
import test from "node:test";
import handler, { normalizeFinanceDeclinePayload } from "../api/transactional-finance-decline.js";

function responseHarness() {
  const result = { statusCode: 200, payload: null, headers: {} };
  return {
    result,
    response: {
      setHeader(name, value) { result.headers[name] = value; },
      status(code) { result.statusCode = code; return this; },
      json(payload) { result.payload = payload; return this; },
    },
  };
}

test("normalizes the trusted CRM finance decline payload", () => {
  const payload = normalizeFinanceDeclinePayload({
    lead_id: "lead-123",
    application_ref: "vfc-abc123",
    customer_name: "Alex Example",
    customer_email: " ALEX@EXAMPLE.COM ",
    decline_send_id: "decline-send-1",
    subject: "Re: Van Finance Application",
    html: "<p>Declined</p>",
    text: "Declined",
  });

  assert.equal(payload.leadId, "lead-123");
  assert.equal(payload.applicationRef, "VFC-ABC123");
  assert.equal(payload.customerEmail, "alex@example.com");
  assert.equal(payload.declineSendId, "decline-send-1");
});

test("sends the CRM-rendered finance decline email only to the supplied customer", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const originalSendGrid = process.env.SENDGRID_API_KEY;
  let providerRequest;

  process.env.MARKETING_CUSTOMER_DATABASE_API_KEY = "marketing-secret";
  process.env.SENDGRID_API_KEY = "SG.abcdefghijklmnop.qrstuvwxyzABCDEFGHIJKLMN";
  globalThis.fetch = async (url, options) => {
    providerRequest = { url, options };
    return {
      ok: true,
      status: 202,
      text: async () => "",
      headers: { get: (name) => name.toLowerCase() === "x-message-id" ? "sg-finance-decline-1" : "" },
    };
  };

  try {
    const { response, result } = responseHarness();
    await handler({
      method: "POST",
      headers: { "x-marketing-customer-database-key": "marketing-secret" },
      body: {
        lead_id: "lead-123",
        application_ref: "VFC-ABC123",
        customer_name: "Alex Example",
        customer_email: "alex@example.com",
        decline_send_id: "decline-send-1",
        subject: "Re: Van Finance Application",
        html: "<p>Existing finance decline template</p>",
        text: "Existing finance decline template",
      },
    }, response);

    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.ok, true);
    assert.equal(result.payload.provider_message_id, "sg-finance-decline-1");
    const body = JSON.parse(providerRequest.options.body);
    assert.equal(body.personalizations[0].to[0].email, "alex@example.com");
    assert.equal(body.from.name, "Van Finance Company");
    assert.equal(body.subject, "Re: Van Finance Application");
    assert.deepEqual(body.categories, ["transactional", "finance-decline"]);
    assert.equal(body.personalizations[0].custom_args.decline_send_id, "decline-send-1");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
    else process.env.MARKETING_CUSTOMER_DATABASE_API_KEY = originalApiKey;
    if (originalSendGrid === undefined) delete process.env.SENDGRID_API_KEY;
    else process.env.SENDGRID_API_KEY = originalSendGrid;
  }
});

test("rejects unauthorised finance decline sends", async () => {
  const originalApiKey = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const originalSendGrid = process.env.SENDGRID_API_KEY;
  process.env.MARKETING_CUSTOMER_DATABASE_API_KEY = "marketing-secret";
  process.env.SENDGRID_API_KEY = "SG.abcdefghijklmnop.qrstuvwxyzABCDEFGHIJKLMN";

  try {
    const { response, result } = responseHarness();
    await handler({ method: "POST", headers: {}, body: {} }, response);
    assert.equal(result.statusCode, 401);
    assert.equal(result.payload.ok, false);
  } finally {
    if (originalApiKey === undefined) delete process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
    else process.env.MARKETING_CUSTOMER_DATABASE_API_KEY = originalApiKey;
    if (originalSendGrid === undefined) delete process.env.SENDGRID_API_KEY;
    else process.env.SENDGRID_API_KEY = originalSendGrid;
  }
});

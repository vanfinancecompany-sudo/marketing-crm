import assert from "node:assert/strict";
import test from "node:test";
import handler, { normalizeRent2BuyApprovalChasePayload } from "../api/transactional-rent2buy-approval-chase.js";

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

test("normalizes the trusted CRM approval chase payload", () => {
  const payload = normalizeRent2BuyApprovalChasePayload({
    lead_id: "lead-123",
    application_ref: "r2b-abc123",
    customer_name: "Alex Example",
    customer_email: " ALEX@EXAMPLE.COM ",
    approval_chase_send_id: "approval-send-1",
    chase_number: 1,
    subject: "Just checking you received your Rent2Buy approval",
    html: "<p>Approval details</p>",
    text: "Approval details",
  });

  assert.equal(payload.leadId, "lead-123");
  assert.equal(payload.applicationRef, "R2B-ABC123");
  assert.equal(payload.customerEmail, "alex@example.com");
  assert.equal(payload.approvalChaseSendId, "approval-send-1");
  assert.equal(payload.chaseNumber, 1);
});

test("sends the CRM-rendered approval chase only to the supplied customer", async () => {
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
      headers: { get: (name) => name.toLowerCase() === "x-message-id" ? "sg-approval-message-1" : "" },
    };
  };

  try {
    const { response, result } = responseHarness();
    await handler({
      method: "POST",
      headers: { "x-marketing-customer-database-key": "marketing-secret" },
      body: {
        lead_id: "lead-123",
        application_ref: "R2B-ABC123",
        customer_name: "Alex Example",
        customer_email: "alex@example.com",
        approval_chase_send_id: "approval-send-1",
        chase_number: 2,
        subject: "Final check – do you still want to use your Rent2Buy approval?",
        html: "<p>Existing CRM approval template</p>",
        text: "Existing CRM approval template",
      },
    }, response);

    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.ok, true);
    assert.equal(result.payload.provider_message_id, "sg-approval-message-1");
    const body = JSON.parse(providerRequest.options.body);
    assert.equal(body.personalizations[0].to[0].email, "alex@example.com");
    assert.equal(body.from.name, "Rent2Buy Vans");
    assert.equal(body.subject, "Final check – do you still want to use your Rent2Buy approval?");
    assert.equal(body.content.find((item) => item.type === "text/html").value, "<p>Existing CRM approval template</p>");
    assert.deepEqual(body.categories, ["transactional", "rent2buy-approval-chase"]);
    assert.equal(body.personalizations[0].custom_args.approval_chase_send_id, "approval-send-1");
    assert.equal(body.personalizations[0].custom_args.approval_chase_number, "2");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
    else process.env.MARKETING_CUSTOMER_DATABASE_API_KEY = originalApiKey;
    if (originalSendGrid === undefined) delete process.env.SENDGRID_API_KEY;
    else process.env.SENDGRID_API_KEY = originalSendGrid;
  }
});

test("rejects invalid chase numbers and unauthorised sends", async () => {
  assert.throws(() => normalizeRent2BuyApprovalChasePayload({
    lead_id: "1",
    customer_email: "alex@example.com",
    approval_chase_send_id: "send-1",
    chase_number: 3,
    subject: "Subject",
    html: "<p>Hi</p>",
  }), /must be 1 or 2/);

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

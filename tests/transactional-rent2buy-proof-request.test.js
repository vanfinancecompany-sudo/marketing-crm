import assert from "node:assert/strict";
import test from "node:test";
import handler, { normalizeRent2BuyProofRequestPayload } from "../api/transactional-rent2buy-proof-request.js";
import approvalHandler, { normalizeRent2BuyApprovalChasePayload } from "../api/transactional-rent2buy-approval-chase.js";
import { renderEmail as renderRent2BuyProofLinkEmail } from "../api/transactional-rent2buy-proof-link.js";
import { validateRent2BuyProofPayload } from "../api/transactional-rent2buy-proofs.js";

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



function proofFile(name) {
  return {
    name,
    content: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF").toString("base64"),
  };
}

function flexibleProofPayload(bankCount) {
  return {
    applicationRef: "R2B-ABC123",
    fullName: "Alex Example",
    email: "alex@example.com",
    phone: "07123456789",
    postcode: "SO40 2NN",
    bankMode: "flexible",
    groups: {
      address: [proofFile("address-1.pdf"), proofFile("address-2.pdf")],
      licence: [proofFile("licence.pdf")],
      bank: Array.from({ length: bankCount }, (_, index) => proofFile(`bank-${index + 1}.pdf`)),
    },
  };
}

test("accepts Rent2Buy flexible bank uploads with one to three PDFs", () => {
  for (const count of [1, 2, 3]) {
    const validated = validateRent2BuyProofPayload(flexibleProofPayload(count));
    assert.equal(validated.meta.bankMode, "flexible");
    assert.equal(validated.groups.bank.length, count);
  }
});

test("rejects Rent2Buy flexible bank uploads outside one to three PDFs", () => {
  assert.throws(
    () => validateRent2BuyProofPayload(flexibleProofPayload(0)),
    /1 to 3 PDF files/i,
  );
  assert.throws(
    () => validateRent2BuyProofPayload(flexibleProofPayload(4)),
    /1 to 3 PDF files/i,
  );
});

test("personal proof-link email makes document completion explicit", () => {
  const email = renderRent2BuyProofLinkEmail({
    applicationRef: "R2B-ABC123",
    fullName: "Alex Example",
    email: "alex@example.com",
    vehicle: "Example Van",
    uploadUrl: "https://www.rent2buyvans.co.uk/upload-your-documents?proofToken=test-token",
  });
  assert.equal(email.subject, "Complete your Rent2Buy application – upload your documents");
  assert.match(email.plain, /assessment cannot begin until the required proofs are received/i);
  assert.match(email.plain, /3 months’ full bank statements/i);
  assert.match(email.html, /Complete my application/);
  assert.doesNotMatch(email.html, /whenever it’s convenient/i);
});

test("normalizes the trusted CRM proof request payload", () => {
  const payload = normalizeRent2BuyProofRequestPayload({
    lead_id: "lead-123",
    application_ref: "r2b-abc123",
    customer_name: "Alex Example",
    customer_email: " ALEX@EXAMPLE.COM ",
    proof_request_send_id: "proof-send-1",
    subject: "Rent2Buy Vans – Proofs Required",
    html: "<p>Proofs required</p>",
    text: "Proofs required",
  });

  assert.equal(payload.leadId, "lead-123");
  assert.equal(payload.applicationRef, "R2B-ABC123");
  assert.equal(payload.customerEmail, "alex@example.com");
  assert.equal(payload.proofRequestSendId, "proof-send-1");
});

test("sends the existing CRM-rendered proofs email only to the supplied customer", async () => {
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
      headers: { get: (name) => name.toLowerCase() === "x-message-id" ? "sg-proof-message-1" : "" },
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
        proof_request_send_id: "proof-send-1",
        subject: "Rent2Buy Vans – Proofs Required",
        html: "<p>Existing CRM proofs template</p>",
        text: "Existing CRM proofs template",
      },
    }, response);

    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.ok, true);
    assert.equal(result.payload.provider_message_id, "sg-proof-message-1");
    const body = JSON.parse(providerRequest.options.body);
    assert.equal(body.personalizations[0].to[0].email, "alex@example.com");
    assert.equal(body.from.name, "Rent2Buy Vans");
    assert.equal(body.subject, "Rent2Buy Vans – Proofs Required");
    assert.equal(body.content.find((item) => item.type === "text/html").value, "<p>Existing CRM proofs template</p>");
    assert.deepEqual(body.categories, ["transactional", "rent2buy-proof-request"]);
    assert.equal(body.personalizations[0].custom_args.proof_request_send_id, "proof-send-1");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
    else process.env.MARKETING_CUSTOMER_DATABASE_API_KEY = originalApiKey;
    if (originalSendGrid === undefined) delete process.env.SENDGRID_API_KEY;
    else process.env.SENDGRID_API_KEY = originalSendGrid;
  }
});

test("rejects unauthorised proof request sends", async () => {
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

test("approval chase endpoint validates and sends CRM-rendered chase content", async () => {
  const normalized = normalizeRent2BuyApprovalChasePayload({
    lead_id: "lead-456",
    application_ref: "r2b-def456",
    customer_name: "Jordan Example",
    customer_email: " JORDAN@EXAMPLE.COM ",
    approval_chase_send_id: "approval-send-1",
    chase_number: 2,
    subject: "Final approval check",
    html: "<p>Approval chase</p>",
    text: "Approval chase",
  });
  assert.equal(normalized.customerEmail, "jordan@example.com");
  assert.equal(normalized.chaseNumber, 2);

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
    await approvalHandler({
      method: "POST",
      headers: { "x-marketing-customer-database-key": "marketing-secret" },
      body: {
        lead_id: "lead-456",
        application_ref: "R2B-DEF456",
        customer_name: "Jordan Example",
        customer_email: "jordan@example.com",
        approval_chase_send_id: "approval-send-1",
        chase_number: 2,
        subject: "Final approval check",
        html: "<p>Approval chase</p>",
        text: "Approval chase",
      },
    }, response);
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.provider_message_id, "sg-approval-message-1");
    const body = JSON.parse(providerRequest.options.body);
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

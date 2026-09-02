import test from "node:test";
import assert from "node:assert/strict";
import { validateRent2BuyProofPayload } from "../api/transactional-rent2buy-proofs.js";
import { sendSendGridEmail } from "../lib/emailProviders/sendgrid.js";

const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const png = b64([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00,0x00]);
const jpg = b64([0xff,0xd8,0xff,0x00,0x00]);
const pdf = Buffer.from("%PDF-1.4\n% QA TEST\n").toString("base64");

function payload() {
  return {
    applicationRef: "R2B-ABC123",
    directUpload: false,
    fullName: "QA Test",
    email: "sales@vanfinancecompany.co.uk",
    phone: "03301336376",
    postcode: "SO40 2NN",
    registration: "",
    bankMode: "combined",
    groups: {
      address: [
        { name: "address-one.png", content: png },
        { name: "address-two.png", content: png },
      ],
      licence: [{ name: "licence-front.jpg", content: jpg }],
      bank: [{ name: "bank.pdf", content: pdf }],
    },
  };
}

test("validates supported Rent2Buy proof files", () => {
  const result = validateRent2BuyProofPayload(payload());
  assert.equal(result.groups.address.length, 2);
  assert.equal(result.groups.licence.length, 1);
  assert.equal(result.groups.bank[0].type, "application/pdf");
});

test("rejects a non-PDF bank statement", () => {
  const input = payload();
  input.groups.bank = [{ name: "bank.png", content: png }];
  assert.throws(() => validateRent2BuyProofPayload(input), /genuine PDF/i);
});

test("SendGrid helper maps attachments and reply-to without changing existing calls", async () => {
  let submitted;
  const fakeFetch = async (_url, options) => {
    submitted = JSON.parse(options.body);
    return {
      ok: true,
      status: 202,
      text: async () => "",
      headers: { get: (name) => name.toLowerCase() === "x-message-id" ? "proof-message-id" : "" },
    };
  };
  const result = await sendSendGridEmail({
    apiKey: "SG.abcdefghijklmnop.abcdefghijklmnopqrstuvwxyz",
    to: "sales@vanfinancecompany.co.uk",
    subject: "Proof test",
    html: "<p>test</p>",
    replyToEmail: "customer@example.com",
    attachments: [{ content: pdf, filename: "bank.pdf", type: "application/pdf" }],
    fetchImpl: fakeFetch,
  });
  assert.equal(result.messageId, "proof-message-id");
  assert.equal(submitted.reply_to.email, "customer@example.com");
  assert.equal(submitted.attachments.length, 1);
  assert.equal(submitted.attachments[0].filename, "bank.pdf");
});

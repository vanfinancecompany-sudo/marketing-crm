import crypto from "node:crypto";
import { sendSendGridEmail } from "../lib/emailProviders/sendgrid.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_HTML_BYTES = 180_000;
const MAX_TEXT_BYTES = 40_000;

function text(value, limit = 1000) {
  return String(value ?? "").trim().slice(0, limit);
}

function safeEqual(left, right) {
  const a = Buffer.from(text(left, 10000));
  const b = Buffer.from(text(right, 10000));
  return Boolean(a.length && a.length === b.length && crypto.timingSafeEqual(a, b));
}

function authorize(request) {
  const expected = text(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY, 10000);
  const header = text(request.headers?.[API_KEY_HEADER], 10000);
  const authorization = text(request.headers?.authorization, 12000);
  const bearer = authorization.startsWith("Bearer ") ? text(authorization.slice(7), 10000) : "";
  return Boolean(expected && (safeEqual(header, expected) || safeEqual(bearer, expected)));
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body); } catch { return {}; }
  }
  return request.body;
}

function byteLength(value) {
  return Buffer.byteLength(String(value || ""), "utf8");
}

export function normalizeRent2BuyProofRequestPayload(body = {}) {
  const payload = {
    leadId: text(body.lead_id || body.leadId, 120),
    applicationRef: text(body.application_ref || body.applicationRef, 80).toUpperCase(),
    customerName: text(body.customer_name || body.customerName, 200),
    customerEmail: text(body.customer_email || body.customerEmail, 254).toLowerCase(),
    proofRequestSendId: text(body.proof_request_send_id || body.proofRequestSendId, 255),
    subject: text(body.subject, 998),
    html: String(body.html || ""),
    plainText: String(body.text || body.plain_text || body.plainText || ""),
  };

  if (!payload.leadId) throw new Error("Lead ID is required.");
  if (!EMAIL_PATTERN.test(payload.customerEmail)) throw new Error("Customer email is not valid.");
  if (!payload.proofRequestSendId) throw new Error("Proof request send ID is required.");
  if (!payload.subject) throw new Error("Proof request subject is required.");
  if (!payload.html.trim()) throw new Error("Proof request HTML is required.");
  if (byteLength(payload.html) > MAX_HTML_BYTES) throw new Error("Proof request HTML is too large.");
  if (byteLength(payload.plainText) > MAX_TEXT_BYTES) throw new Error("Proof request plain text is too large.");

  return payload;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorize(request)) return response.status(401).json({ ok: false, message: "Transactional email access denied." });
  if (!process.env.SENDGRID_API_KEY) return response.status(500).json({ ok: false, message: "SendGrid is not configured." });

  let payload;
  try {
    payload = normalizeRent2BuyProofRequestPayload(parseBody(request));
  } catch (error) {
    return response.status(400).json({ ok: false, message: text(error?.message, 240) || "Proof request email is invalid." });
  }

  try {
    const provider = await sendSendGridEmail({
      apiKey: process.env.SENDGRID_API_KEY,
      to: payload.customerEmail,
      toName: payload.customerName,
      subject: payload.subject,
      html: payload.html,
      text: payload.plainText,
      fromEmail: "sales@vanfinancecompany.co.uk",
      fromName: "Rent2Buy Vans",
      categories: ["transactional", "rent2buy-proof-request"],
      customArgs: {
        transactional_template: "rent2buy-existing-proofs-request",
        crm_lead_id: payload.leadId,
        application_ref: payload.applicationRef,
        proof_request_send_id: payload.proofRequestSendId,
      },
    });

    console.info("RENT2BUY PROOF REQUEST EMAIL ACCEPTED", {
      leadId: payload.leadId,
      applicationRef: payload.applicationRef,
      providerMessageId: provider.messageId,
    });

    return response.status(200).json({
      ok: true,
      provider: "sendgrid",
      provider_message_id: provider.messageId,
      proof_request_send_id: payload.proofRequestSendId,
    });
  } catch (error) {
    console.error("RENT2BUY PROOF REQUEST EMAIL FAILED", {
      leadId: payload.leadId,
      applicationRef: payload.applicationRef,
      ambiguous: Boolean(error?.ambiguous),
      message: error?.message || "send_failed",
    });
    return response.status(error?.statusCode || 502).json({
      ok: false,
      ambiguous: Boolean(error?.ambiguous),
      message: error?.ambiguous
        ? "Proof request email submission could not be confirmed."
        : "Proof request email could not be sent.",
    });
  }
}

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

export function normalizeFinanceDeclinePayload(body = {}) {
  const payload = {
    leadId: text(body.lead_id || body.leadId, 120),
    applicationRef: text(body.application_ref || body.applicationRef, 80).toUpperCase(),
    customerName: text(body.customer_name || body.customerName, 200),
    customerEmail: text(body.customer_email || body.customerEmail, 254).toLowerCase(),
    declineSendId: text(body.decline_send_id || body.declineSendId, 255),
    subject: text(body.subject, 998),
    html: String(body.html || ""),
    plainText: String(body.text || body.plain_text || body.plainText || ""),
  };

  if (!payload.leadId) throw new Error("Lead ID is required.");
  if (!EMAIL_PATTERN.test(payload.customerEmail)) throw new Error("Customer email is not valid.");
  if (!payload.declineSendId) throw new Error("Decline send ID is required.");
  if (!payload.subject) throw new Error("Decline email subject is required.");
  if (!payload.html.trim()) throw new Error("Decline email HTML is required.");
  if (byteLength(payload.html) > MAX_HTML_BYTES) throw new Error("Decline email HTML is too large.");
  if (byteLength(payload.plainText) > MAX_TEXT_BYTES) throw new Error("Decline email plain text is too large.");

  return payload;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorize(request)) return response.status(401).json({ ok: false, message: "Transactional email access denied." });
  if (!process.env.SENDGRID_API_KEY) return response.status(500).json({ ok: false, message: "SendGrid is not configured." });

  let payload;
  try {
    payload = normalizeFinanceDeclinePayload(parseBody(request));
  } catch (error) {
    return response.status(400).json({ ok: false, message: text(error?.message, 240) || "Finance decline email is invalid." });
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
      fromName: "Van Finance Company",
      categories: ["transactional", "finance-decline"],
      customArgs: {
        transactional_template: "finance-existing-decline",
        crm_lead_id: payload.leadId,
        application_ref: payload.applicationRef,
        decline_send_id: payload.declineSendId,
      },
    });

    console.info("FINANCE DECLINE EMAIL ACCEPTED", {
      leadId: payload.leadId,
      applicationRef: payload.applicationRef,
      providerMessageId: provider.messageId,
    });

    return response.status(200).json({
      ok: true,
      provider: "sendgrid",
      provider_message_id: provider.messageId,
      decline_send_id: payload.declineSendId,
    });
  } catch (error) {
    console.error("FINANCE DECLINE EMAIL FAILED", {
      leadId: payload.leadId,
      applicationRef: payload.applicationRef,
      ambiguous: Boolean(error?.ambiguous),
      message: error?.message || "send_failed",
    });
    return response.status(error?.statusCode || 502).json({
      ok: false,
      ambiguous: Boolean(error?.ambiguous),
      message: error?.ambiguous
        ? "Finance decline email submission could not be confirmed."
        : "Finance decline email could not be sent.",
    });
  }
}

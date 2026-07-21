import { renderApplicationReceivedEmail, normalizeApplicationReceivedPayload } from "../lib/applicationReceivedEmail.js";
import { sendSendGridEmail } from "../lib/emailProviders/sendgrid.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(response, status, payload) {
  response.status(status).json(payload);
}

function authorize(request) {
  const expected = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const header = request.headers?.[API_KEY_HEADER] || "";
  const authorization = request.headers?.authorization || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return Boolean(expected && (header === expected || bearer === expected));
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body); } catch { return {}; }
  }
  return request.body;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return json(response, 405, { ok: false, message: "Method not allowed." });
  if (!authorize(request)) return json(response, 401, { ok: false, message: "Transactional email access denied." });
  if (!process.env.SENDGRID_API_KEY) return json(response, 500, { ok: false, message: "SendGrid is not configured." });

  const payload = normalizeApplicationReceivedPayload(parseBody(request));
  if (!payload.leadId) return json(response, 400, { ok: false, message: "Lead ID is required." });
  if (!EMAIL_PATTERN.test(payload.customerEmail)) return json(response, 400, { ok: false, message: "Customer email is not valid." });

  try {
    const email = renderApplicationReceivedEmail(payload);
    const provider = await sendSendGridEmail({
      apiKey: process.env.SENDGRID_API_KEY,
      to: payload.customerEmail,
      toName: payload.customerName,
      subject: email.subject,
      html: email.html,
      categories: ["transactional", "application-received"],
      customArgs: {
        transactional_template: email.templateName,
        crm_lead_id: payload.leadId,
        application_ref: payload.applicationRef,
      },
    });
    return json(response, 200, {
      ok: true,
      template_name: email.templateName,
      provider: "sendgrid",
      provider_message_id: provider.messageId,
    });
  } catch (error) {
    console.error("APPLICATION RECEIVED EMAIL FAILED:", {
      leadId: payload.leadId,
      provider: "sendgrid",
      ambiguous: Boolean(error?.ambiguous),
      message: error?.message || "send_failed",
    });
    return json(response, error?.statusCode || 502, {
      ok: false,
      ambiguous: Boolean(error?.ambiguous),
      message: error?.ambiguous
        ? "Application email submission could not be confirmed."
        : "Application email could not be sent.",
    });
  }
}


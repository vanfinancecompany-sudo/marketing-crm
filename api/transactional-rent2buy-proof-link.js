import crypto from "node:crypto";
import { sendSendGridEmail } from "../lib/emailProviders/sendgrid.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const APPLICATION_REF_PATTERN = /^R2B-[A-Z0-9]{6}$/i;

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

function escapeHtml(value) {
  return text(value, 4000)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizePayload(body = {}) {
  const applicationRef = text(body.applicationRef, 40).toUpperCase();
  const fullName = text(body.fullName, 200);
  const email = text(body.email, 254).toLowerCase();
  const vehicle = text(body.vehicle, 300) || "your Rent2Buy van";
  const uploadUrl = text(body.uploadUrl, 4000);

  if (!APPLICATION_REF_PATTERN.test(applicationRef)) throw new Error("Application reference is invalid.");
  if (!EMAIL_PATTERN.test(email)) throw new Error("Applicant email is invalid.");
  if (!uploadUrl) throw new Error("Upload link is missing.");

  let parsedUrl;
  try { parsedUrl = new URL(uploadUrl); } catch { throw new Error("Upload link is invalid."); }
  if (parsedUrl.protocol !== "https:" || parsedUrl.pathname !== "/upload-your-documents" || !parsedUrl.searchParams.get("proofToken")) {
    throw new Error("Upload link is invalid.");
  }
  const host = parsedUrl.hostname.toLowerCase();
  if (host !== "www.rent2buyvans.co.uk" && host !== "rent2buyvans.co.uk" && !host.endsWith(".vercel.app")) {
    throw new Error("Upload link host is not allowed.");
  }

  return { applicationRef, fullName, email, vehicle, uploadUrl: parsedUrl.toString() };
}

function renderEmail(payload) {
  const greeting = payload.fullName ? `Hi ${escapeHtml(payload.fullName)},` : "Hi there,";
  const subject = "Your Rent2Buy application – upload your documents";
  const plain = `Thanks for your Rent2Buy application. We’ve received it successfully.\n\nWhen you’re ready, use the personal link below to upload your supporting documents.\n\n${payload.uploadUrl}\n\nApplication: ${payload.applicationRef}\nVehicle: ${payload.vehicle}\n\nIf you don’t have everything ready, that’s fine. You can return to this link when convenient.`;
  const html = `<!doctype html><html><body style="margin:0;background:#f2f2ef;font-family:Arial,Helvetica,sans-serif;color:#111114"><table width="100%" cellspacing="0" cellpadding="0" style="padding:26px 12px"><tr><td align="center"><table width="620" cellspacing="0" cellpadding="0" style="width:100%;max-width:620px;background:#fff;border-radius:18px;overflow:hidden;border:1px solid #e1e0dc"><tr><td style="padding:24px 26px;background:#111114;color:#fff"><div style="color:#f4213e;font-size:11px;font-weight:800;letter-spacing:1.4px">RENT2BUY</div><h1 style="margin:10px 0 0;font-size:25px">Your application has been received.</h1></td></tr><tr><td style="padding:26px"><p style="margin:0 0 16px;line-height:1.6">${greeting}</p><p style="margin:0 0 18px;line-height:1.6">Thanks for your Rent2Buy application. You can upload your supporting documents whenever it’s convenient.</p><a href="${escapeHtml(payload.uploadUrl)}" style="display:block;background:#f4213e;color:#fff;text-decoration:none;text-align:center;font-weight:800;padding:15px 18px;border-radius:12px">Upload my documents</a><table width="100%" cellspacing="0" cellpadding="0" style="margin-top:22px;background:#f7f7f4;border-radius:12px"><tr><td style="padding:6px 10px;color:#777;font-size:12px">Application</td><td style="padding:6px 10px;font-weight:800;font-size:12px">${escapeHtml(payload.applicationRef)}</td></tr><tr><td style="padding:6px 10px;color:#777;font-size:12px">Vehicle</td><td style="padding:6px 10px;font-weight:800;font-size:12px">${escapeHtml(payload.vehicle)}</td></tr></table><p style="margin:20px 0 0;color:#777;font-size:12px;line-height:1.6">This is your personal upload link. It expires after seven days. If you don’t have everything ready, that’s fine. You can come back to it later.</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, plain, html };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorize(request)) return response.status(401).json({ ok: false, message: "Proof-link email access denied." });
  if (!process.env.SENDGRID_API_KEY) return response.status(500).json({ ok: false, message: "Proof-link email provider is not configured." });

  let payload;
  try { payload = normalizePayload(parseBody(request)); }
  catch (error) { return response.status(400).json({ ok: false, message: text(error?.message, 240) || "Proof-link email request is invalid." }); }

  const email = renderEmail(payload);
  try {
    const provider = await sendSendGridEmail({
      apiKey: process.env.SENDGRID_API_KEY,
      to: payload.email,
      toName: payload.fullName,
      subject: email.subject,
      html: email.html,
      text: email.plain,
      fromEmail: "sales@vanfinancecompany.co.uk",
      fromName: "Rent2Buy Vans",
      categories: ["transactional", "rent2buy-proof-link"],
      customArgs: {
        application_ref: payload.applicationRef,
        transactional_template: "rent2buy-proof-link",
      },
    });
    console.info("RENT2BUY PROOF LINK EMAIL ACCEPTED", { applicationRef: payload.applicationRef, providerMessageId: provider.messageId });
    return response.status(200).json({ ok: true, provider: "sendgrid", provider_message_id: provider.messageId });
  } catch (error) {
    console.error("RENT2BUY PROOF LINK EMAIL FAILED", { applicationRef: payload.applicationRef, message: error?.message || "send_failed", ambiguous: Boolean(error?.ambiguous) });
    return response.status(error?.statusCode || 502).json({
      ok: false,
      ambiguous: Boolean(error?.ambiguous),
      message: error?.ambiguous ? "Upload-link email submission could not be confirmed. Please contact the Rent2Buy team before retrying." : "Upload-link email could not be sent. Please try again.",
    });
  }
}

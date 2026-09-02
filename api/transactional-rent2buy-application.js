import crypto from "node:crypto";
import { sendSendGridEmail } from "../lib/emailProviders/sendgrid.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const APPLICATION_REF_PATTERN = /^R2B-[A-Z0-9]{6}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value, limit = 2000) {
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
  return text(value, 8000)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizePayload(body = {}) {
  const applicationRef = text(body.applicationRef || body.application_ref, 40).toUpperCase();
  const applicant = body.applicant && typeof body.applicant === "object" ? body.applicant : {};
  const vehicle = body.vehicle && typeof body.vehicle === "object" ? body.vehicle : {};
  const attribution = body.attribution && typeof body.attribution === "object" ? body.attribution : {};
  const fullName = text(applicant.fullName || body.fullName || body.name, 240);
  const email = text(applicant.email || body.email, 254).toLowerCase();

  const payload = {
    applicationRef,
    leadId: text(body.leadId, 80),
    submittedAt: text(body.submittedAt || body.submitted_at, 120),
    source: text(body.source, 160) || "Rent2BuyVans.co.uk",
    applicant: {
      fullName,
      email,
      phone: text(applicant.phone || body.phone, 80),
    },
    address: text(body.fullAddress || body.full_address, 1200),
    postcode: text(body.postcode, 30).toUpperCase(),
    distanceMiles: text(body.distanceMiles || body.distance_miles, 40),
    basePostcode: text(body.basePostcode || body.base_coverage_postcode, 30).toUpperCase(),
    hireType: text(body.hireType || body.hire_type, 120),
    companyName: text(body.companyName || body.company_name, 240),
    vehicle: {
      registration: text(vehicle.registration || body.registration, 40).toUpperCase(),
      title: text(vehicle.title || body.vehicle_title || body.vehicle, 500),
      type: text(vehicle.type || body.vehicle_type, 160),
      pageUrl: text(vehicle.pageUrl || body.vehicle_page_url || body.vehicle_url, 2000),
    },
    businessType: text(body.businessType || body.business_type, 240),
    monthlyMileage: text(body.monthlyMileage || body.monthly_mileage, 100),
    needTiming: text(body.needTiming || body.need_timing, 160),
    monthlyBudget: text(body.monthlyBudget || body.monthly_budget, 100),
    attribution: {
      utmSource: text(attribution.utmSource || body.utm_source, 300),
      utmMedium: text(attribution.utmMedium || body.utm_medium, 300),
      utmCampaign: text(attribution.utmCampaign || body.utm_campaign, 300),
      utmTerm: text(attribution.utmTerm || body.utm_term, 300),
      utmContent: text(attribution.utmContent || body.utm_content, 300),
      landingUrl: text(attribution.landingUrl || body.landing_url, 900),
      referrer: text(attribution.referrer || body.referrer, 900),
    },
  };

  if (!APPLICATION_REF_PATTERN.test(payload.applicationRef)) throw new Error("Application reference is invalid.");
  if (!payload.applicant.fullName || !EMAIL_PATTERN.test(payload.applicant.email)) throw new Error("Applicant details are incomplete.");
  return payload;
}

function display(value) {
  return text(value, 8000) || "—";
}

function attributionLabel(p) {
  return [p.attribution.utmSource, p.attribution.utmMedium, p.attribution.utmCampaign].filter(Boolean).join(" / ") || "Direct / untagged";
}

function buildPlain(p) {
  return `NEW RENT2BUY APPLICATION\n\nReference: ${p.applicationRef}\nSubmitted: ${display(p.submittedAt)}\nSource: ${display(p.source)}\nAttribution: ${attributionLabel(p)}\n\nCONTACT DETAILS\nApplicant: ${display(p.applicant.fullName)}\nEmail: ${display(p.applicant.email)}\nPhone: ${display(p.applicant.phone)}\n\nELIGIBILITY & ADDRESS\nApplying as: ${display(p.hireType)}\nAddress: ${display(p.address)}\nPostcode: ${display(p.postcode)}\nDriving distance: ${p.distanceMiles ? `${p.distanceMiles} miles` : "—"}\nBase postcode: ${display(p.basePostcode)}\nCompany: ${display(p.companyName)}\n\nVEHICLE / USE\nRegistration: ${display(p.vehicle.registration)}\nVehicle: ${display(p.vehicle.title)}\nVehicle type: ${display(p.vehicle.type)}\nVehicle page: ${display(p.vehicle.pageUrl)}\nBusiness / use: ${display(p.businessType)}\nMonthly mileage: ${display(p.monthlyMileage)}\nTiming: ${display(p.needTiming)}\nMonthly budget: ${display(p.monthlyBudget)}\n\nATTRIBUTION\nUTM source: ${display(p.attribution.utmSource)}\nUTM medium: ${display(p.attribution.utmMedium)}\nUTM campaign: ${display(p.attribution.utmCampaign)}\nUTM term: ${display(p.attribution.utmTerm)}\nUTM content: ${display(p.attribution.utmContent)}\nLanding page: ${display(p.attribution.landingUrl)}\nReferrer: ${display(p.attribution.referrer)}`;
}

function buildHtml(p) {
  const e = escapeHtml;
  const v = (value) => e(display(value));
  const row = (label, value) => `<tr><td style="padding:8px 0;color:#aeb0b7;width:40%;font-size:13px;vertical-align:top">${e(label)}</td><td style="padding:8px 0;color:#fff;font-size:13px;font-weight:700;vertical-align:top">${v(value)}</td></tr>`;
  const section = (title, rows) => `<tr><td style="padding:0 28px 22px"><div style="font-size:15px;font-weight:800;margin-bottom:8px">${e(title)}</div><table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">${rows}</table></td></tr>`;
  const vehicleName = p.vehicle.title || p.vehicle.registration || p.vehicle.type || "Rent2Buy application";
  return `<!doctype html><html><body style="margin:0;background:#efefef;font-family:Arial,Helvetica,sans-serif"><table width="100%" cellspacing="0" cellpadding="0" style="padding:24px 10px"><tr><td align="center"><table width="660" cellspacing="0" cellpadding="0" style="width:100%;max-width:660px;background:#17171b;color:#fff;border-radius:18px;overflow:hidden"><tr><td style="padding:24px 28px;background:#0d0d10"><div style="display:inline-block;background:#f4213e;border-radius:999px;padding:6px 10px;font-size:10px;font-weight:800;letter-spacing:.08em">RENT2BUY VANS</div><h1 style="margin:12px 0 5px;font-size:28px">New Rent2Buy Application</h1><div style="color:#b9bac0;font-size:12px">${v(p.applicationRef)} · ${v(p.submittedAt)}</div></td></tr><tr><td style="padding:22px 28px 14px"><table width="100%" cellspacing="0" cellpadding="0" style="background:#222228;border:1px solid #34343a;border-radius:12px"><tr><td style="padding:13px 16px"><div style="color:#b9bac0;font-size:10px;text-transform:uppercase;letter-spacing:.08em">Vehicle</div><div style="font-size:16px;font-weight:800;margin-top:4px">${v(vehicleName)}</div></td><td style="padding:13px 16px;text-align:right"><div style="color:#b9bac0;font-size:10px;text-transform:uppercase;letter-spacing:.08em">Applicant</div><div style="font-size:13px;font-weight:800;margin-top:4px">${v(p.applicant.fullName)}</div></td></tr></table></td></tr>${section("Contact Details",row("Applicant",p.applicant.fullName)+row("Email",p.applicant.email)+row("Phone",p.applicant.phone))}${section("Eligibility & Address",row("Applying as",p.hireType)+row("Address",p.address)+row("Postcode",p.postcode)+row("Driving distance",p.distanceMiles?`${p.distanceMiles} miles`:"")+row("Base postcode",p.basePostcode)+row("Company",p.companyName))}${section("Vehicle & Use",row("Registration",p.vehicle.registration)+row("Vehicle",p.vehicle.title)+row("Vehicle type",p.vehicle.type)+row("Vehicle page",p.vehicle.pageUrl)+row("Business / use",p.businessType)+row("Monthly mileage",p.monthlyMileage)+row("Timing",p.needTiming)+row("Monthly budget",p.monthlyBudget))}${section("Attribution",row("Source",p.source)+row("Attribution",attributionLabel(p))+row("UTM term",p.attribution.utmTerm)+row("UTM content",p.attribution.utmContent)+row("Landing page",p.attribution.landingUrl)+row("Referrer",p.attribution.referrer))}<tr><td style="padding:16px 28px;background:#111114;color:#9fa0a6;font-size:11px;text-align:center">Rent2Buy Vans · Internal application notification</td></tr></table></td></tr></table></body></html>`;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorize(request)) return response.status(401).json({ ok: false, message: "Rent2Buy application email access denied." });
  if (!process.env.SENDGRID_API_KEY) return response.status(500).json({ ok: false, message: "Rent2Buy application email provider is not configured." });

  let payload;
  try { payload = normalizePayload(parseBody(request)); }
  catch (error) { return response.status(400).json({ ok: false, message: text(error?.message, 240) || "Rent2Buy application email data is invalid." }); }

  const subject = `New Rent2Buy Application - ${payload.applicationRef} - ${payload.applicant.fullName}${payload.vehicle.registration ? ` - ${payload.vehicle.registration}` : ""}`;
  try {
    const provider = await sendSendGridEmail({
      apiKey: process.env.SENDGRID_API_KEY,
      to: "sales@vanfinancecompany.co.uk",
      toName: "Van Finance Company",
      subject,
      html: buildHtml(payload),
      text: buildPlain(payload),
      replyToEmail: payload.applicant.email,
      replyToName: payload.applicant.fullName,
      fromEmail: "sales@vanfinancecompany.co.uk",
      fromName: "Rent2Buy Vans",
      categories: ["transactional", "rent2buy-application", "internal-notification"],
      customArgs: {
        application_ref: payload.applicationRef,
        crm_lead_id: payload.leadId,
        internal_notification: "rent2buy_application",
      },
    });
    return response.status(200).json({
      ok: true,
      provider: "sendgrid",
      provider_message_id: provider.messageId,
    });
  } catch (error) {
    console.error("RENT2BUY APPLICATION EMAIL FAILED", {
      applicationRef: payload.applicationRef,
      leadId: payload.leadId,
      ambiguous: Boolean(error?.ambiguous),
      message: error?.message || "send_failed",
    });
    return response.status(error?.statusCode || 502).json({
      ok: false,
      ambiguous: Boolean(error?.ambiguous),
      message: error?.ambiguous
        ? "Rent2Buy application email submission could not be confirmed."
        : "Rent2Buy application email could not be sent.",
    });
  }
}

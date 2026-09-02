import crypto from "node:crypto";
import { sendSendGridEmail } from "../lib/emailProviders/sendgrid.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const APPLICATION_REF_PATTERN = /^FA-[A-Z0-9]{6}$/i;
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
  const applicationRef = text(body.applicationRef, 40).toUpperCase();
  const applicant = body.applicant && typeof body.applicant === "object" ? body.applicant : {};
  const currentAddress = body.currentAddress && typeof body.currentAddress === "object" ? body.currentAddress : {};
  const employment = body.employment && typeof body.employment === "object" ? body.employment : {};
  const budget = body.budget && typeof body.budget === "object" ? body.budget : {};
  const partExchange = body.partExchange && typeof body.partExchange === "object" ? body.partExchange : {};
  const referral = body.referral && typeof body.referral === "object" ? body.referral : {};
  const company = body.company && typeof body.company === "object" ? body.company : {};
  const bank = body.bank && typeof body.bank === "object" ? body.bank : {};
  const vehicle = body.vehicle && typeof body.vehicle === "object" ? body.vehicle : {};
  const previousAddresses = Array.isArray(body.previousAddresses) ? body.previousAddresses.slice(0, 3) : [];

  const payload = {
    applicationRef,
    leadId: text(body.leadId, 80),
    submittedAt: text(body.submittedAt, 120),
    applicationType: text(body.applicationType, 80) || "Finance",
    applicationRoute: text(body.applicationRoute, 160),
    applicant: {
      title: text(applicant.title, 40),
      firstName: text(applicant.firstName, 120),
      lastName: text(applicant.lastName, 120),
      fullName: text(applicant.fullName, 240),
      email: text(applicant.email, 254).toLowerCase(),
      phone: text(applicant.phone, 80),
      dob: text(applicant.dob, 40),
      maritalStatus: text(applicant.maritalStatus, 80),
      licenceType: text(applicant.licenceType, 120),
    },
    currentAddress: {
      address: text(currentAddress.address, 1200),
      postcode: text(currentAddress.postcode, 30).toUpperCase(),
      timeAtAddress: text(currentAddress.timeAtAddress, 100),
      residentialStatus: text(currentAddress.residentialStatus, 120),
      totalAddressMonths: text(currentAddress.totalAddressMonths, 20),
    },
    previousAddresses: previousAddresses.map((item) => ({
      address: text(item?.address, 1200),
      timeThere: text(item?.timeThere, 100),
    })).filter((item) => item.address),
    employment: {
      status: text(employment.status, 120),
      employer: text(employment.employer, 240),
      occupation: text(employment.occupation, 240),
      timeInJob: text(employment.timeInJob, 100),
      annualNetSalary: text(employment.annualNetSalary, 80),
    },
    budget: { availableDeposit: text(budget.availableDeposit, 80) },
    partExchange: {
      answer: text(partExchange.answer, 40),
      registration: text(partExchange.registration, 40).toUpperCase(),
      make: text(partExchange.make, 120),
      model: text(partExchange.model, 160),
      mileage: text(partExchange.mileage, 80),
      condition: text(partExchange.condition, 240),
      estimatedValue: text(partExchange.estimatedValue, 80),
    },
    referral: { source: text(referral.source, 160), other: text(referral.other, 240) },
    company: {
      name: text(company.name, 240),
      natureOfBusiness: text(company.natureOfBusiness, 400),
      vatNumber: text(company.vatNumber, 80),
      companyNumber: text(company.companyNumber, 80),
      businessProperty: text(company.businessProperty, 120),
      businessAddress: text(company.businessAddress, 1200),
    },
    bank: {
      accountName: text(bank.accountName, 240),
      sortCode: text(bank.sortCode, 40),
      accountNumberLast4: text(bank.accountNumberLast4, 4).replace(/\D/g, ""),
    },
    vehicle: {
      registration: text(vehicle.registration, 40).toUpperCase(),
      title: text(vehicle.title, 400),
      details: text(vehicle.details, 1200),
      pageUrl: text(vehicle.pageUrl, 2000),
    },
  };

  if (!APPLICATION_REF_PATTERN.test(payload.applicationRef)) throw new Error("Application reference is invalid.");
  if (!payload.applicant.fullName) payload.applicant.fullName = `${payload.applicant.firstName} ${payload.applicant.lastName}`.trim();
  if (!payload.applicant.fullName || !EMAIL_PATTERN.test(payload.applicant.email)) throw new Error("Applicant details are incomplete.");
  return payload;
}

function display(value) {
  return text(value, 8000) || "—";
}

function buildPlain(p) {
  const previous = p.previousAddresses.length
    ? p.previousAddresses.map((item, index) => `Previous address ${index + 1}: ${display(item.address)} | Time there: ${display(item.timeThere)}`).join("\n")
    : "No previous addresses supplied.";
  const px = p.partExchange.answer.toLowerCase() === "yes"
    ? `${display(p.partExchange.registration)} | ${display(p.partExchange.make)} ${display(p.partExchange.model)} | Mileage: ${display(p.partExchange.mileage)} | Condition: ${display(p.partExchange.condition)} | Estimated value: ${display(p.partExchange.estimatedValue)}`
    : "No part exchange details supplied.";
  return `NEW FINANCE APPLICATION\n\nReference: ${p.applicationRef}\nSubmitted: ${display(p.submittedAt)}\nApplicant: ${display(p.applicant.fullName)}\nVehicle: ${display(p.vehicle.title || p.vehicle.registration)}\n\nCONTACT DETAILS\nEmail: ${display(p.applicant.email)}\nPhone: ${display(p.applicant.phone)}\n\nAPPLICANT DETAILS\nTitle: ${display(p.applicant.title)}\nDate of Birth: ${display(p.applicant.dob)}\nMarital Status: ${display(p.applicant.maritalStatus)}\nLicence Type: ${display(p.applicant.licenceType)}\n\nCURRENT ADDRESS\n${display(p.currentAddress.address)}\nPostcode: ${display(p.currentAddress.postcode)}\nTime at current address: ${display(p.currentAddress.timeAtAddress)}\nResidential Status: ${display(p.currentAddress.residentialStatus)}\n\nPREVIOUS ADDRESSES\n${previous}\n\nEMPLOYMENT & INCOME\nEmployment Status: ${display(p.employment.status)}\nEmployer: ${display(p.employment.employer)}\nOccupation: ${display(p.employment.occupation)}\nTime in current job: ${display(p.employment.timeInJob)}\nAnnual Net Salary: ${display(p.employment.annualNetSalary)}\n\nBUDGET & DEPOSIT\nAvailable Deposit: ${display(p.budget.availableDeposit)}\n\nPART EXCHANGE\nPart Exchange: ${display(p.partExchange.answer)}\n${px}\n\nREFERRAL\nSource: ${display(p.referral.source)}\nOther: ${display(p.referral.other)}\n\nCOMPANY DETAILS\nCompany Name: ${display(p.company.name)}\nNature of Business: ${display(p.company.natureOfBusiness)}\nVAT Number: ${display(p.company.vatNumber)}\nCompany Registration Number: ${display(p.company.companyNumber)}\nBusiness Property: ${display(p.company.businessProperty)}\nBusiness Address: ${display(p.company.businessAddress)}\n\nBANK DETAILS\nAccount Name: ${display(p.bank.accountName)}\nSort Code: ${display(p.bank.sortCode)}\nAccount Number: ${p.bank.accountNumberLast4 ? `****${p.bank.accountNumberLast4}` : "—"}\n\nVEHICLE APPLIED FOR\nRegistration: ${display(p.vehicle.registration)}\nVehicle Title: ${display(p.vehicle.title)}\nVehicle Details: ${display(p.vehicle.details)}\nVehicle Page: ${display(p.vehicle.pageUrl)}`;
}

function buildHtml(p) {
  const e = escapeHtml;
  const v = (value) => e(display(value));
  const row = (label, value) => `<tr><td style="padding:8px 0;color:#bfc2c7;width:40%;font-size:13px;vertical-align:top">${e(label)}</td><td style="padding:8px 0;color:#fff;font-size:13px;font-weight:700;vertical-align:top">${v(value)}</td></tr>`;
  const section = (title, rows) => `<tr><td style="padding:0 28px 22px"><div style="font-size:15px;font-weight:800;margin-bottom:8px">${e(title)}</div><table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">${rows}</table></td></tr>`;
  const previous = p.previousAddresses.length
    ? p.previousAddresses.map((item, index) => row(`Previous address ${index + 1}`, `${display(item.address)} · ${display(item.timeThere)}`)).join("")
    : row("Previous addresses", "None supplied");
  const pxDetails = p.partExchange.answer.toLowerCase() === "yes"
    ? `${display(p.partExchange.registration)} · ${display(p.partExchange.make)} ${display(p.partExchange.model)} · ${display(p.partExchange.mileage)} miles · ${display(p.partExchange.condition)} · ${display(p.partExchange.estimatedValue)}`
    : "No part exchange details supplied.";
  const vehicleName = p.vehicle.title || p.vehicle.registration || "Application form";
  const subjectLine = `${p.applicationRef} · ${p.applicant.fullName}`;
  return `<!doctype html><html><body style="margin:0;background:#efefef;font-family:Arial,Helvetica,sans-serif"><table width="100%" cellspacing="0" cellpadding="0" style="padding:24px 10px"><tr><td align="center"><table width="660" cellspacing="0" cellpadding="0" style="width:100%;max-width:660px;background:#474747;color:#fff;border-radius:18px;overflow:hidden"><tr><td style="padding:24px 28px;background:#2f2f2f"><div style="display:inline-block;background:#453a22;color:#f5dc8e;border-radius:999px;padding:6px 10px;font-size:10px;font-weight:800;letter-spacing:.08em">VAN FINANCE COMPANY</div><h1 style="margin:12px 0 5px;font-size:28px">New Finance Application</h1><div style="color:#cfcfcf;font-size:12px">${e(subjectLine)}</div></td></tr><tr><td style="padding:22px 28px 14px"><table width="100%" cellspacing="0" cellpadding="0" style="background:#565656;border:1px solid #686868;border-radius:12px"><tr><td style="padding:13px 16px"><div style="color:#bfc2c7;font-size:10px;text-transform:uppercase;letter-spacing:.08em">Vehicle</div><div style="font-size:16px;font-weight:800;margin-top:4px">${v(vehicleName)}</div></td><td style="padding:13px 16px;text-align:right"><div style="color:#bfc2c7;font-size:10px;text-transform:uppercase;letter-spacing:.08em">Submitted</div><div style="font-size:13px;font-weight:800;margin-top:4px">${v(p.submittedAt)}</div></td></tr></table></td></tr>${section("Contact Details",row("Applicant",p.applicant.fullName)+row("Email",p.applicant.email)+row("Phone",p.applicant.phone))}${section("Applicant Details",row("Title",p.applicant.title)+row("Date of Birth",p.applicant.dob)+row("Marital Status",p.applicant.maritalStatus)+row("Licence Type",p.applicant.licenceType))}${section("Current Address",row("Address",p.currentAddress.address)+row("Postcode",p.currentAddress.postcode)+row("Time at current address",p.currentAddress.timeAtAddress)+row("Residential Status",p.currentAddress.residentialStatus))}${section("Previous Addresses",previous)}${section("Employment & Income",row("Employment Status",p.employment.status)+row("Employer",p.employment.employer)+row("Occupation",p.employment.occupation)+row("Time in current job",p.employment.timeInJob)+row("Annual Net Salary",p.employment.annualNetSalary))}${section("Budget & Deposit",row("Available Deposit",p.budget.availableDeposit))}${section("Part Exchange",row("Part Exchange",p.partExchange.answer)+row("Details",pxDetails))}${section("Referral",row("Source",p.referral.source)+row("Other",p.referral.other))}${section("Company Details",row("Company Name",p.company.name)+row("Nature of Business",p.company.natureOfBusiness)+row("VAT Number",p.company.vatNumber)+row("Company Registration Number",p.company.companyNumber)+row("Business Property",p.company.businessProperty)+row("Business Address",p.company.businessAddress))}${section("Bank Details",row("Account Name",p.bank.accountName)+row("Sort Code",p.bank.sortCode)+row("Account Number",p.bank.accountNumberLast4?`****${p.bank.accountNumberLast4}`:"—"))}${section("Vehicle Applied For",row("Registration",p.vehicle.registration)+row("Vehicle Title",p.vehicle.title)+row("Vehicle Details",p.vehicle.details)+row("Vehicle Page",p.vehicle.pageUrl))}<tr><td style="padding:16px 28px;background:#3c3c3c;color:#bfc2c7;font-size:11px;text-align:center">Internal finance application notification · Van Finance Company</td></tr></table></td></tr></table></body></html>`;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorize(request)) return response.status(401).json({ ok: false, message: "Finance application email access denied." });
  if (!process.env.SENDGRID_API_KEY) return response.status(500).json({ ok: false, message: "Finance application email provider is not configured." });

  let payload;
  try { payload = normalizePayload(parseBody(request)); }
  catch (error) { return response.status(400).json({ ok: false, message: text(error?.message, 240) || "Finance application email data is invalid." }); }

  const subject = `New Finance Application - ${payload.applicationRef} - ${payload.applicant.fullName} - ${payload.vehicle.registration || payload.vehicle.title || "APPLICATION FORM"}`;
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
      fromName: "Van Finance Company Applications",
      categories: ["transactional", "finance-application", "internal-notification"],
      customArgs: {
        application_ref: payload.applicationRef,
        crm_lead_id: payload.leadId,
        application_type: "finance",
      },
    });
    console.info("FINANCE APPLICATION EMAIL ACCEPTED", { applicationRef: payload.applicationRef, providerMessageId: provider.messageId });
    return response.status(200).json({ ok: true, provider: "sendgrid", provider_message_id: provider.messageId });
  } catch (error) {
    console.error("FINANCE APPLICATION EMAIL FAILED", { applicationRef: payload.applicationRef, message: error?.message || "send_failed", ambiguous: Boolean(error?.ambiguous) });
    return response.status(error?.statusCode || 502).json({
      ok: false,
      ambiguous: Boolean(error?.ambiguous),
      message: error?.ambiguous ? "Finance application email submission could not be confirmed." : "Finance application email could not be sent.",
    });
  }
}

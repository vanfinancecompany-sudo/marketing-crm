import crypto from "node:crypto";
import { sendSendGridEmail } from "../lib/emailProviders/sendgrid.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const MAX_TOTAL_BYTES = 3_000_000;
const MAX_FILE_BYTES = 3_000_000;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/heic", "image/heif", "image/avif", "image/tiff"]);

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

function cleanFilename(value) {
  return text(value, 120).replace(/[^a-zA-Z0-9._() -]/g, "_") || "document";
}

function escapeHtml(value) {
  return text(value, 2000)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function hasPrefix(buffer, prefix) {
  if (buffer.length < prefix.length) return false;
  for (let index = 0; index < prefix.length; index += 1) if (buffer[index] !== prefix[index]) return false;
  return true;
}

function ascii(buffer, start, length) {
  return buffer.subarray(start, start + length).toString("ascii");
}

function detectType(buffer) {
  if (hasPrefix(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (hasPrefix(buffer, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (hasPrefix(buffer, [0x49, 0x49, 0x2a, 0x00]) || hasPrefix(buffer, [0x4d, 0x4d, 0x00, 0x2a])) return "image/tiff";
  if (buffer.length >= 12 && ascii(buffer, 4, 4) === "ftyp") {
    const brand = ascii(buffer, 8, 4).toLowerCase();
    if (["avif", "avis"].includes(brand)) return "image/avif";
    if (["heic", "heix", "hevc", "hevx"].includes(brand)) return "image/heic";
    if (["mif1", "msf1"].includes(brand)) return "image/heif";
  }
  return "";
}

function decodeFile(file, group) {
  const name = cleanFilename(file?.name);
  const content = String(file?.content || "").trim();
  if (!content || content.length > 4_100_000 || content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) {
    throw new Error(`${group} contains an invalid file.`);
  }
  const bytes = Buffer.from(content, "base64");
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new Error(`${name} is too large for secure proof delivery.`);
  const detected = detectType(bytes);
  const extension = (name.split(".").pop() || "").toLowerCase();
  if (group === "Bank statements") {
    if (detected !== "application/pdf" || extension !== "pdf") throw new Error("Bank statements must be genuine PDF files.");
  } else if (detected !== "application/pdf" && !ALLOWED_IMAGE_TYPES.has(detected)) {
    throw new Error(`${name} must be PDF, JPG/JPEG, PNG, HEIC/HEIF, AVIF or TIFF.`);
  }
  return { name, size: bytes.length, type: detected, content: bytes.toString("base64") };
}

function validEmail(value) {
  return /^\S+@\S+\.\S+$/.test(text(value, 254));
}

export function validateRent2BuyProofPayload(body = {}) {
  const meta = {
    applicationRef: text(body.applicationRef, 40).toUpperCase(),
    directUpload: Boolean(body.directUpload),
    fullName: text(body.fullName, 200),
    email: text(body.email, 254).toLowerCase(),
    phone: text(body.phone, 80),
    postcode: text(body.postcode, 20).toUpperCase(),
    registration: text(body.registration, 30).toUpperCase(),
    bankMode: text(body.bankMode, 20).toLowerCase() || "combined",
  };
  if (!meta.applicationRef || !meta.fullName || !validEmail(meta.email)) throw new Error("Proof delivery metadata is incomplete.");
  if (!["combined", "separate"].includes(meta.bankMode)) throw new Error("Bank statement upload mode is invalid.");

  const sourceGroups = body.groups && typeof body.groups === "object" ? body.groups : {};
  const addressRaw = Array.isArray(sourceGroups.address) ? sourceGroups.address : [];
  const licenceRaw = Array.isArray(sourceGroups.licence) ? sourceGroups.licence : [];
  const bankRaw = Array.isArray(sourceGroups.bank) ? sourceGroups.bank : [];
  if (addressRaw.length < 2 || addressRaw.length > 4) throw new Error("Please attach between two and four proofs of address.");
  if (licenceRaw.length !== 1) throw new Error("Please attach one clear file showing the front of the driving licence.");
  if (meta.bankMode === "combined" && bankRaw.length !== 1) throw new Error("Please attach one combined bank statement PDF.");
  if (meta.bankMode === "separate" && bankRaw.length !== 3) throw new Error("Please attach exactly three separate bank statement PDFs.");

  const groups = {
    address: addressRaw.map((file) => decodeFile(file, "Proof of address")),
    licence: licenceRaw.map((file) => decodeFile(file, "Driving licence front")),
    bank: bankRaw.map((file) => decodeFile(file, "Bank statements")),
  };
  const totalBytes = [...groups.address, ...groups.licence, ...groups.bank].reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error("The selected documents are too large for one secure proof delivery.");
  return { meta, groups, totalBytes };
}

function buildHtml(meta, counts) {
  const row = (label, value) => `<tr><td style="padding:8px 0;color:#aeb0b7;width:40%;font-size:13px">${escapeHtml(label)}</td><td style="padding:8px 0;color:#fff;font-size:13px;font-weight:700">${escapeHtml(value || "—")}</td></tr>`;
  const source = meta.directUpload ? "Standalone website upload" : "Application-linked upload";
  return `<!doctype html><html><body style="margin:0;background:#efefef;font-family:Arial,Helvetica,sans-serif"><table width="100%" cellspacing="0" cellpadding="0" style="padding:24px 10px"><tr><td align="center"><table width="660" cellspacing="0" cellpadding="0" style="width:100%;max-width:660px;background:#17171b;color:#fff;border-radius:18px;overflow:hidden"><tr><td style="padding:24px 28px;background:#0d0d10"><div style="display:inline-block;background:#f4213e;border-radius:999px;padding:6px 10px;font-size:10px;font-weight:800">RENT2BUY PROOFS</div><h1 style="margin:12px 0 4px;font-size:28px">Customer proofs received</h1><div style="color:#b9bac0;font-size:12px">${escapeHtml(meta.applicationRef)} · ${escapeHtml(source)}</div></td></tr><tr><td style="padding:22px 28px"><table width="100%" cellspacing="0" cellpadding="0">${row("Reference", meta.applicationRef)}${row("Applicant", meta.fullName)}${row("Email", meta.email)}${row("Phone", meta.phone)}${row("Postcode", meta.postcode)}${row("Vehicle", meta.registration || "No specific registration")}${row("Proof of address", `${counts.address} file${counts.address === 1 ? "" : "s"}`)}${row("Driving licence front", `${counts.licence} file${counts.licence === 1 ? "" : "s"}`)}${row("Bank statements", `${counts.bank} PDF file${counts.bank === 1 ? "" : "s"}`)}${row("Bank upload mode", meta.bankMode === "separate" ? "3 separate PDFs" : "1 combined PDF")}</table><div style="margin-top:18px;padding:14px 16px;background:#101013;border:1px solid #34343a;border-radius:12px;color:#d8d8dd;font-size:12px;line-height:1.5">All documents are attached to this email. The website and relay services do not retain or save copies of the uploaded files.</div></td></tr><tr><td style="padding:16px 28px;background:#111114;color:#9fa0a6;font-size:11px;text-align:center">Rent2Buy by Van Finance Company · Proof submission</td></tr></table></td></tr></table></body></html>`;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorize(request)) return response.status(401).json({ ok: false, message: "Proof email access denied." });
  if (!process.env.SENDGRID_API_KEY) return response.status(500).json({ ok: false, message: "Proof email provider is not configured." });

  let validated;
  try {
    validated = validateRent2BuyProofPayload(parseBody(request));
  } catch (error) {
    return response.status(400).json({ ok: false, message: text(error?.message, 240) || "Proof files are invalid." });
  }

  const { meta, groups } = validated;
  const counts = { address: groups.address.length, licence: groups.licence.length, bank: groups.bank.length };
  const subject = `Rent2Buy Proofs - ${meta.applicationRef} - ${meta.fullName}${meta.registration ? ` - ${meta.registration}` : ""}`;
  const attachments = [...groups.address, ...groups.licence, ...groups.bank].map((file) => ({
    content: file.content,
    filename: file.name,
    type: file.type,
  }));
  const plain = `RENT2BUY PROOFS RECEIVED\nReference: ${meta.applicationRef}\nSource: ${meta.directUpload ? "Standalone website upload" : "Application-linked upload"}\nApplicant: ${meta.fullName}\nEmail: ${meta.email}\nPhone: ${meta.phone}\nPostcode: ${meta.postcode}\nVehicle: ${meta.registration || "No specific registration"}\nBank upload mode: ${meta.bankMode === "separate" ? "3 separate PDFs" : "1 combined PDF"}\n\nProof of address: ${counts.address} file(s)\nDriving licence front: ${counts.licence} file(s)\nBank statements: ${counts.bank} PDF file(s)\n\nAll documents are attached to this email. The website and relay services do not retain or save copies of the uploaded files.`;

  try {
    const provider = await sendSendGridEmail({
      apiKey: process.env.SENDGRID_API_KEY,
      to: "sales@vanfinancecompany.co.uk",
      toName: "Van Finance Company",
      subject,
      html: buildHtml(meta, counts),
      text: plain,
      replyToEmail: meta.email,
      replyToName: meta.fullName,
      fromEmail: "sales@vanfinancecompany.co.uk",
      fromName: "Rent2Buy by Van Finance Company",
      attachments,
      categories: ["transactional", "rent2buy-proofs", "customer-upload"],
      customArgs: {
        application_ref: meta.applicationRef,
        proof_source: meta.directUpload ? "direct" : "application-linked",
      },
    });
    console.info("RENT2BUY PROOFS EMAIL ACCEPTED", { applicationRef: meta.applicationRef, counts, providerMessageId: provider.messageId });
    return response.status(200).json({ ok: true, provider: "sendgrid", provider_message_id: provider.messageId });
  } catch (error) {
    console.error("RENT2BUY PROOFS EMAIL FAILED", { applicationRef: meta.applicationRef, message: error?.message || "send_failed", ambiguous: Boolean(error?.ambiguous) });
    return response.status(error?.statusCode || 502).json({
      ok: false,
      ambiguous: Boolean(error?.ambiguous),
      message: error?.ambiguous ? "Proof email submission could not be confirmed. Please contact the Rent2Buy team before retrying." : "Proof email could not be sent. Please try again.",
    });
  }
}

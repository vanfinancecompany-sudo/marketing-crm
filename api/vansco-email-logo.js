import crypto from "node:crypto";
import { put } from "@vercel/blob";

// Vansco Email Studio only. Does not share the customer-email provider or transactional routes.
const KEY_HEADER = "x-marketing-customer-database-key";
const MAX_BYTES = 1_500_000;
const MIME_TYPES = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };
function authorised(request) {
  const a = String(request.headers?.[KEY_HEADER] || "");
  const b = String(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY || "");
  if (!a || !b) return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
export function verifyLogoBytes(bytes, claimedType) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12 || bytes.length > MAX_BYTES) throw new Error("Upload a logo under 1.5 MB.");
  const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  const detected = png ? "image/png" : jpeg ? "image/jpeg" : webp ? "image/webp" : null;
  if (!detected || detected !== claimedType) throw new Error("Use a genuine PNG, JPG or WebP logo file.");
  return detected;
}
export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorised(request)) return response.status(401).json({ ok: false, message: "Vansco studio access denied." });
  try {
    const body = typeof request.body === "string" ? JSON.parse(request.body) : request.body || {};
    const contentType = String(body.content_type || "");
    if (!Object.hasOwn(MIME_TYPES, contentType)) return response.status(400).json({ ok: false, message: "Upload PNG, JPG or WebP." });
    const base64 = String(body.base64 || "");
    if (!base64 || base64.length > Math.ceil(MAX_BYTES * 4 / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      return response.status(400).json({ ok: false, message: "Invalid or oversized logo image." });
    }
    const buffer = Buffer.from(base64, "base64");
    verifyLogoBytes(buffer, contentType);
    if (!process.env.BLOB_READ_WRITE_TOKEN) return response.status(503).json({ ok: false, message: "Logo uploads need Vercel Blob configured. You can paste an existing logo image URL instead." });
    const result = await put("vansco-email-studio/logos/" + crypto.randomUUID() + MIME_TYPES[contentType], buffer, {
      access: "public", addRandomSuffix: false, contentType, token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return response.status(200).json({ ok: true, url: result.url });
  } catch (error) {
    console.error("[Vansco email logo]", String(error?.message || error).slice(0,140));
    return response.status(400).json({ ok: false, message: error.message || "Logo upload failed." });
  }
}

/**
 * Safe Rent2Buy quote handoff envelope.
 * Server-side only. Never sign amounts passed directly from a browser.
 * Issuer must recompute with approved stock data, active override and matrix.
 *
 * The consumer (application API / CRM) verifies token, registration, expiry,
 * and current stock/quote version before treating amounts as approved.
 * This module is staged only: no live issuer is connected.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const version = "r2bq1";
const terms = new Set([12,18,24,30,36,42,48]);
const bands = new Set([1000,1500,2000,2500,3000,3500,4000]);
const reg = value => String(value ?? "").toUpperCase().replace(/\s+/g,"");
const validMoney = value => Number.isFinite(value) && value > 0 &&
  Math.round(value * 100) === value * 100;
const validSecret = value => typeof value === "string" && value.length >= 32;
const strict = value => value && typeof value === "object" && !Array.isArray(value);
const b64url = obj => Buffer.from(JSON.stringify(obj)).toString("base64url");
const signature = (head,secret) => createHmac("sha256",secret).update(head).digest("base64url");

export function validateRent2BuyQuoteEnvelope(value, now = Date.now()) {
  if (!strict(value)) return null;
  const registration = reg(value.registration);
  const issuedAt = Number(value.issuedAt);
  const expiresAt = Number(value.expiresAt);
  const termMonths = Number(value.termMonths);
  const milesPerMonth = Number(value.milesPerMonth);
  const monthlyExVat = Number(value.monthlyExVat);
  const initialExVat = Number(value.initialExVat);
  if (!/^[A-Z]{2}\d{2}[A-Z]{3}$/.test(registration) ||
      !/^[A-Za-z0-9._-]{8,100}$/.test(String(value.quoteId ?? "")) ||
      !["matrix","special"].includes(value.pricingMode) ||
      !terms.has(termMonths) || !bands.has(milesPerMonth) ||
      !validMoney(monthlyExVat) || !validMoney(initialExVat) ||
      initialExVat < 1000 ||
      !Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) ||
      issuedAt > now + 60000 || expiresAt <= now ||
      expiresAt <= issuedAt || expiresAt - issuedAt > 86400000) return null;
  const vehicleTitle = String(value.vehicleTitle ?? "").trim().slice(0,200);
  const sourceRevision = String(value.sourceRevision ?? "").trim().slice(0,120);
  if (!vehicleTitle || !sourceRevision) return null;
  const amountVat = val => Math.round((val * 1.2 + Number.EPSILON) * 100) / 100;
  return {
    quoteId:String(value.quoteId),
    registration,
    vehicleTitle,
    pricingMode:value.pricingMode,
    termMonths,
    milesPerMonth,
    monthlyExVat,
    monthlyIncVat:amountVat(monthlyExVat),
    initialExVat,
    initialIncVat:amountVat(initialExVat),
    sourceRevision,
    issuedAt,
    expiresAt,
  };
}

export function signRent2BuyQuote(quote, secret, now = Date.now()) {
  if (!validSecret(secret)) throw new Error("Rent2Buy quote signing secret is not configured.");
  const approved = validateRent2BuyQuoteEnvelope(quote,now);
  if (!approved) throw new Error("Cannot sign an invalid or expired Rent2Buy quote.");
  const head = version + "." + b64url(approved);
  return head + "." + signature(head,secret);
}

export function verifyRent2BuyQuoteToken(token, secret, {registration,now=Date.now()}={}) {
  if (!validSecret(secret) || typeof token !== "string" || token.length > 4096) return null;
  const parts=token.split(".");
  if (parts.length!==3 || parts[0]!==version ||
      !/^[A-Za-z0-9_-]+$/.test(parts[1]) ||
      !/^[A-Za-z0-9_-]+$/.test(parts[2])) return null;
  const head=parts.slice(0,2).join(".");
  const expected=Buffer.from(signature(head,secret));
  const actual=Buffer.from(parts[2]);
  if (expected.length!==actual.length || !timingSafeEqual(expected,actual)) return null;
  let decoded;
  try { decoded=JSON.parse(Buffer.from(parts[1],"base64url").toString("utf8")); }
  catch { return null; }
  const approved=validateRent2BuyQuoteEnvelope(decoded,now);
  if (!approved || (registration && approved.registration!==reg(registration))) return null;
  return approved;
}

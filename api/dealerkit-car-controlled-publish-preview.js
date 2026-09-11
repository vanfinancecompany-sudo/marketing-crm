import { normalizeFinanceRegistration } from "../lib/vanscoWixPrice.js";
import { buildFreshCarControlledPublishState } from "./_dealerkit-car-controlled-publish-state.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);

function authorised(request, environment = process.env) {
  const expected = clean(environment.MARKETING_CUSTOMER_DATABASE_API_KEY, 2000);
  const header = clean(request.headers?.[API_KEY_HEADER], 2000);
  const bearer = clean(request.headers?.authorization, 2200).replace(/^Bearer\s+/i, "");
  return Boolean(expected && (header === expected || bearer === expected));
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (!authorised(request)) return response.status(401).json({ ok: false, message: "Marketing CRM access is required." });
  if (request.method !== "GET") return response.status(405).json({ ok: false, message: "Method not allowed." });

  try {
    const registration = normalizeFinanceRegistration(request.query?.registration || "");
    const state = await buildFreshCarControlledPublishState(registration);
    return response.status(200).json({
      ok: true,
      readOnly: true,
      writesAttempted: false,
      registration: state.registration,
      plan: state.plan,
      media: state.media,
    });
  } catch (error) {
    return response.status(error?.status || 502).json({
      ok: false,
      readOnly: true,
      writesAttempted: false,
      message: error?.message || "Could not build the final Cars publish preview.",
      details: error?.details || null,
    });
  }
}

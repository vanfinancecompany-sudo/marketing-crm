import { normalizeFinanceRegistration } from "../lib/vanscoWixPrice.js";
import { buildFreshControlledPublishState } from "./_dealerkit-controlled-publish-state.js";

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
    const productMode = ["finance", "rent2buy", "both"].includes(clean(request.query?.product, 30)) ? clean(request.query.product, 30) : undefined;
    const state = await buildFreshControlledPublishState(registration, process.env, { productMode });
    response.status(200).json({
      ok: true,
      readOnly: true,
      writesAttempted: false,
      registration: state.registration,
      plan: state.plan,
      media: {
        dealerKitImported: state.importedDealerKitMedia.length,
        dealerKitExpected: state.imageSets.dealerKitImageIds.length,
        dealerKitReady: state.importedDealerKitMedia.filter((item) => item.ready).length,
        missingDealerKitImageIds: state.imageSets.missingDealerKitImageIds,
        manualSelectedReady: state.manualMediaReadiness.selectedReady,
      },
    });
  } catch (error) {
    response.status(error?.status || 502).json({ ok: false, readOnly: true, writesAttempted: false, message: error?.message || "Could not build the final controlled publish preview.", details: error?.details || null });
  }
}

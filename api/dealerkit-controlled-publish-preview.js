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

function selectedDealerKitIds(imageSets = {}, productMode) {
  if (productMode === "rent2buy") return imageSets.rent2buy?.dealerKitImageIds || [];
  if (productMode === "finance") return imageSets.vanFinance?.dealerKitImageIds || [];
  return imageSets.dealerKitImageIds || [];
}

function productMediaSummary(state, productMode) {
  const selectedIds = selectedDealerKitIds(state.imageSets, productMode);
  const importedById = new Map((state.importedDealerKitMedia || []).map((item) => [clean(item?.dealerKitImageId, 300), item]));
  const readyIds = selectedIds.filter((id) => importedById.get(id)?.ready);
  const unpreparedIds = selectedIds.filter((id) => !importedById.has(id));
  const processingIds = selectedIds.filter((id) => importedById.has(id) && !importedById.get(id)?.ready);
  return {
    dealerKitImported: selectedIds.filter((id) => importedById.has(id)).length,
    dealerKitExpected: selectedIds.length,
    dealerKitReady: readyIds.length,
    missingDealerKitImageIds: [...unpreparedIds, ...processingIds],
    unpreparedDealerKitImageIds: unpreparedIds,
    processingDealerKitImageIds: processingIds,
    manualSelectedReady: state.manualMediaReadiness.selectedReady,
  };
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
      media: productMediaSummary(state, productMode),
    });
  } catch (error) {
    response.status(error?.status || 502).json({ ok: false, readOnly: true, writesAttempted: false, message: error?.message || "Could not build the final controlled publish preview.", details: error?.details || null });
  }
}

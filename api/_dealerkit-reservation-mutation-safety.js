import { normalizeRegistration } from "./_vansco-cache-utils.js";
import { verifyDealerKitReservedRegistration } from "./_dealerkit-reservation-verification.js";

function clean(value) {
  return String(value ?? "").trim();
}

function safetyStop(message) {
  return new Error(`Safety stop: ${message} Nothing was changed in Wix.`);
}

export function wixReservationPreviewReadFailures(preview) {
  const failures = [];
  const addCollectionFailures = (collections = [], siteLabel = "") => {
    for (const collection of collections || []) {
      if (!collection?.error) continue;
      failures.push({
        siteLabel: clean(siteLabel),
        collectionId: clean(collection?.id),
        collectionLabel: clean(collection?.label) || clean(collection?.id) || "unknown collection",
        error: clean(collection?.error) || "Could not read collection.",
      });
    }
  };

  addCollectionFailures(preview?.collections);
  for (const site of preview?.sites || []) {
    if (site?.error) {
      failures.push({
        siteLabel: clean(site?.label) || clean(site?.id),
        collectionId: "",
        collectionLabel: "site read",
        error: clean(site.error),
      });
    }
    addCollectionFailures(site?.collections, site?.label || site?.id);
  }
  return failures;
}

export function assertCompleteWixReservationPreview(preview) {
  const failures = wixReservationPreviewReadFailures(preview);
  if (!failures.length) return preview;

  const labels = failures
    .map((failure) => [failure.siteLabel, failure.collectionLabel].filter(Boolean).join(" / "))
    .join(", ");
  throw safetyStop(`Wix could not be fully verified because required collection reads failed${labels ? ` (${labels})` : ""}.`);
}

export function finalDealerKitVerificationError(error) {
  return clean(error?.message || error || "DealerKit could not be verified immediately before the Wix change.")
    .replace(/Nothing was changed in Wix\.?/i, "No Wix change was attempted for this target.");
}

export async function prepareDealerKitReservedWixMutation({
  registrationValue,
  supplierStockId,
  loadPreview,
  verifyDealerKit = verifyDealerKitReservedRegistration,
}) {
  const registration = normalizeRegistration(registrationValue);
  const stockId = clean(supplierStockId);
  if (!registration) throw new Error("A valid vehicle registration is required.");
  if (!stockId) {
    throw safetyStop(`Exact DealerKit stock identity is missing for ${registration}. Refresh Stock Watch before changing Wix.`);
  }
  if (typeof loadPreview !== "function") throw new Error("Reservation preview dependency is not configured.");

  const dealerKit = await verifyDealerKit(registration, { supplierStockId: stockId });
  const preview = assertCompleteWixReservationPreview(await loadPreview(registration));
  return {
    registration,
    supplierStockId: stockId,
    dealerKit,
    preview,
    verifyDealerKit,
  };
}

export async function executeDealerKitReservedWixMutations({
  registrationValue,
  supplierStockId,
  loadPreview,
  mutateMatch,
  verifyDealerKit = verifyDealerKitReservedRegistration,
}) {
  if (typeof mutateMatch !== "function") throw new Error("Reservation mutation dependency is not configured.");
  const prepared = await prepareDealerKitReservedWixMutation({
    registrationValue,
    supplierStockId,
    loadPreview,
    verifyDealerKit,
  });
  const { registration, supplierStockId: stockId, dealerKit, preview } = prepared;
  const matches = Array.isArray(preview?.matches) ? preview.matches : [];
  const results = [];
  let verificationStopped = false;

  for (const match of matches) {
    let finalDealerKit;
    try {
      // This exact identity/status read is deliberately the final asynchronous
      // safety gate before the destructive Wix call for this one target.
      finalDealerKit = await verifyDealerKit(registration, { supplierStockId: stockId });
    } catch (error) {
      verificationStopped = true;
      results.push({
        ok: false,
        safetyStop: true,
        ...match,
        error: finalDealerKitVerificationError(error),
      });
      break;
    }

    try {
      results.push({ ok: true, ...(await mutateMatch(match)), finalDealerKit });
    } catch (error) {
      results.push({
        ok: false,
        ...match,
        error: clean(error?.message || error || "Could not move the Wix item to draft."),
      });
    }
  }

  return {
    registration,
    supplierStockId: stockId,
    dealerKit,
    preview,
    results,
    verificationStopped,
  };
}

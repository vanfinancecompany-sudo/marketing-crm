import { normaliseManualMediaPurpose } from "./dealerKitWixManualMedia.js";

const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);

function statusOf(item = {}) {
  return clean(item.liveOperationStatus || item.operationStatus, 80).toUpperCase() || "UNKNOWN";
}

export function buildDealerKitWixManualMediaReadiness(items = []) {
  const source = Array.isArray(items) ? items : [];
  const normalised = source.map((item) => {
    const purpose = normaliseManualMediaPurpose(item?.purpose);
    const operationStatus = statusOf(item);
    const liveVerified = item?.liveVerified === true;
    return {
      id: clean(item?.id, 100),
      purpose: purpose?.key || clean(item?.purpose, 80),
      purposeLabel: purpose?.label || clean(item?.purposeLabel, 200) || "Manual Wix image",
      siteScope: purpose?.siteScope || clean(item?.siteScope, 80),
      wixFileId: clean(item?.wixFileId, 500),
      displayName: clean(item?.displayName, 500),
      url: clean(item?.url, 3000) || null,
      thumbnailUrl: clean(item?.thumbnailUrl, 3000) || null,
      operationStatus,
      liveVerified,
      liveVerifiedAt: clean(item?.liveVerifiedAt, 100) || null,
      liveVerificationError: clean(item?.liveVerificationError, 1000) || null,
      eligibleForLaterSelection: liveVerified && operationStatus === "READY",
    };
  });

  const ready = normalised.filter((item) => item.eligibleForLaterSelection);
  const pending = normalised.filter((item) => item.liveVerified && !["READY", "FAILED"].includes(item.operationStatus));
  const failed = normalised.filter((item) => item.liveVerified && item.operationStatus === "FAILED");
  const unverified = normalised.filter((item) => !item.liveVerified);
  const readyByPurpose = Object.create(null);
  for (const item of ready) {
    readyByPurpose[item.purpose] = (readyByPurpose[item.purpose] || 0) + 1;
  }
  const purposesNeedingSelection = Object.entries(readyByPurpose)
    .filter(([, count]) => count > 1)
    .map(([purpose]) => purpose);

  return {
    readOnly: true,
    affectsPublishReadiness: false,
    total: normalised.length,
    ready: ready.length,
    pending: pending.length,
    failed: failed.length,
    unverified: unverified.length,
    purposesNeedingSelection,
    selectionRequired: ready.length > 0,
    items: normalised,
    note: ready.length
      ? "READY manual Wix media is visible to this preview, but no item is selected or attached automatically. A later controlled publish step must recheck Wix again and require an explicit media choice."
      : "No live-verified READY manual Wix media is available to this preview yet.",
  };
}

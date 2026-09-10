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
    const selected = item?.selected === true;
    const eligibleForLaterSelection = liveVerified && operationStatus === "READY";
    return {
      id: clean(item?.id, 100),
      purpose: purpose?.key || clean(item?.purpose, 80),
      purposeLabel: purpose?.label || clean(item?.purposeLabel, 200) || "Manual Wix image",
      siteScope: purpose?.siteScope || clean(item?.siteScope, 80),
      wixSiteId: clean(item?.wixSiteId, 500),
      wixFileId: clean(item?.wixFileId, 500),
      displayName: clean(item?.displayName, 500),
      url: clean(item?.url, 3000) || null,
      thumbnailUrl: clean(item?.thumbnailUrl, 3000) || null,
      operationStatus,
      liveVerified,
      liveVerifiedAt: clean(item?.liveVerifiedAt, 100) || null,
      liveVerificationError: clean(item?.liveVerificationError, 1000) || null,
      eligibleForLaterSelection,
      selected,
      selectedAt: clean(item?.selectedAt, 100) || null,
      selectedAndReady: selected && eligibleForLaterSelection,
    };
  });

  const ready = normalised.filter((item) => item.eligibleForLaterSelection);
  const pending = normalised.filter((item) => item.liveVerified && !["READY", "FAILED"].includes(item.operationStatus));
  const failed = normalised.filter((item) => item.liveVerified && item.operationStatus === "FAILED");
  const unverified = normalised.filter((item) => !item.liveVerified);
  const selected = normalised.filter((item) => item.selected);
  const selectedReady = normalised.filter((item) => item.selectedAndReady);
  const selectedInvalid = selected.filter((item) => !item.selectedAndReady);

  const readyByPurpose = Object.create(null);
  const selectedByPurpose = Object.create(null);
  for (const item of ready) {
    readyByPurpose[item.purpose] = (readyByPurpose[item.purpose] || 0) + 1;
  }
  for (const item of selectedReady) {
    if (!selectedByPurpose[item.purpose]) selectedByPurpose[item.purpose] = [];
    selectedByPurpose[item.purpose].push(item);
  }

  const purposesNeedingSelection = Object.keys(readyByPurpose)
    .filter((purpose) => !selectedByPurpose[purpose]?.length);
  const duplicateSelectedPurposes = Object.entries(selectedByPurpose)
    .filter(([, matches]) => matches.length > 1)
    .map(([purpose]) => purpose);
  const selections = Object.fromEntries(
    Object.entries(selectedByPurpose).map(([purpose, matches]) => [purpose, matches.length === 1 ? matches[0] : null]),
  );

  return {
    readOnly: true,
    affectsPublishReadiness: false,
    total: normalised.length,
    ready: ready.length,
    pending: pending.length,
    failed: failed.length,
    unverified: unverified.length,
    selected: selected.length,
    selectedReady: selectedReady.length,
    selectedInvalid: selectedInvalid.length,
    purposesNeedingSelection,
    duplicateSelectedPurposes,
    selectionRequired: purposesNeedingSelection.length > 0,
    selections,
    items: normalised,
    note: selectedReady.length
      ? "Selected manual Wix media has been live-verified as READY for this preview. A controlled publish must still recheck the selected file immediately before writing vehicle data."
      : ready.length
        ? "READY manual Wix media is available, but no image is selected for at least one purpose. Select the intended image before controlled publishing."
        : "No live-verified READY manual Wix media is available to this preview yet.",
  };
}

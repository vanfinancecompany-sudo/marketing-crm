// Read-only photo readiness derived from one Stock Watch source generation.
// Mutation endpoints never use these cached records as DealerKit authority.
function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function defaultRegistration(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function cmsImageCount(item = {}) {
  const explicit = Number(item.imageCount ?? item.numberOfImages);
  const galleries = [item.images, item.mainImages, item.gallery]
    .filter(Array.isArray)
    .map((images) => images.filter(Boolean).length);
  const gallery = galleries.length ? Math.max(...galleries) : 0;
  return Number.isFinite(explicit) && explicit >= 0 ? Math.max(explicit, gallery) : gallery;
}

export function buildStockWatchImageReadiness({
  pipeline,
  records = [],
  listingPresence = {},
  cmsItems = [],
  normalizeRegistration = defaultRegistration,
} = {}) {
  const registrationOf = (value) => normalizeRegistration(value || "");
  const liveRegistrations = new Set((listingPresence.registrations || []).map(registrationOf).filter(Boolean));
  const listingByRegistration = new Map((listingPresence.vehicles || [])
    .map((vehicle) => [registrationOf(vehicle.registration), vehicle])
    .filter(([registration]) => registration));
  const cmsCounts = new Map();
  for (const item of cmsItems) {
    const registration = registrationOf(item.registration || item.title);
    if (!registration) continue;
    cmsCounts.set(registration, Math.max(cmsCounts.get(registration) || 0, cmsImageCount(item)));
  }

  const alerts = [];
  for (const record of records) {
    if (record.isCurrentDealerKitBulkRecord !== true) continue;
    const registration = registrationOf(record.registration);
    const sourceImageCount = Number(record.imageCount);
    if (!registration || !liveRegistrations.has(registration)) continue;
    if (!Number.isFinite(sourceImageCount) || sourceImageCount < 5) continue;

    // A published listing with no reported gallery count still has one visible
    // primary image. Normal galleries of three or more are not due-in alerts.
    const reportedCount = cmsCounts.get(registration) || 0;
    const currentAdvertImageCount = reportedCount > 0 ? reportedCount : 1;
    if (currentAdvertImageCount > 2 || sourceImageCount <= currentAdvertImageCount) continue;

    const listing = listingByRegistration.get(registration) || {};
    alerts.push({
      id: `images-ready-${pipeline}-${registration}`,
      pipeline,
      displayStatus: "images_ready",
      matchStatus: "images_ready",
      imageReadinessAlert: true,
      registration,
      title: clean(record.title || listing.title || registration),
      imageUrl: clean(record.imageUrl || listing.picture || ""),
      stockUrl: clean(record.stockUrl || ""),
      localStockUrl: clean(listing.webLink || listing.weblink || ""),
      sourceStatus: clean(record.sourceStatus || "unknown"),
      workflowStatus: "",
      notes: "",
      safeExactRegistrationMatch: true,
      cmsImageCount: currentAdvertImageCount,
      currentAdvertImageCount,
      sourceImageCount,
      newImageCount: sourceImageCount - currentAdvertImageCount,
      advertisedPipelines: [pipeline],
      advertisedImageCounts: { [pipeline]: currentAdvertImageCount },
      referencePipeline: pipeline,
      crossProductEvidence: false,
      sourceCheckedAt: record.lastCheckedAt || "",
      supplierStockId: clean(record.supplierStockId || ""),
    });
  }
  return alerts.sort((a, b) => b.newImageCount - a.newImageCount || b.sourceImageCount - a.sourceImageCount || a.registration.localeCompare(b.registration));
}

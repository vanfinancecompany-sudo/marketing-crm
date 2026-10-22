const clean = (value) => String(value ?? "").trim();

export function normalizeCarRegistration(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function wixImageUrl(value) {
  const raw = clean(typeof value === "object" ? value?.src || value?.url || "" : value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const slug = raw.match(/^wix:image:\/\/v1\/([^/]+)/i)?.[1] || "";
  return slug ? `https://static.wixstatic.com/media/${slug}` : raw;
}

function updatedMillis(data = {}) {
  const raw = typeof data?._updatedDate === "object"
    ? data?._updatedDate?.$date
    : data?._updatedDate;
  const parsed = Date.parse(raw || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function publishedCarsFromWixRows(rows = []) {
  const latest = new Map();
  const duplicatePublishedRegistrations = new Set();

  for (const item of Array.isArray(rows) ? rows : []) {
    const data = item?.data || {};
    if (clean(data?._publishStatus).toUpperCase() !== "PUBLISHED") continue;

    const registration = normalizeCarRegistration(data.title || data.registration);
    if (!registration) continue;

    const current = latest.get(registration);
    if (current) duplicatePublishedRegistrations.add(registration);
    if (current && current.updatedAt > updatedMillis(data)) continue;

    latest.set(registration, {
      updatedAt: updatedMillis(data),
      payload: {
        registration,
        title: clean(data.vanDescription || data.titleText || data.vehicleDescription || registration),
        picture: wixImageUrl(data.picture || data.image || data.mainImage),
        price: clean(data.price || data.priceVat),
        salePrice: clean(data.salePrice || data.from116Month),
        description: clean(data.vanDescription || data.vehicleDescriptionTextClick || data.description),
        spec: clean(data.vanSpec || data.descriptionLine || data.vehicleSpecificationText),
        weblink:
          clean(data.webLink || data.weblink || data.link) ||
          `https://www.vanfinancecompany.co.uk/van-finance/${registration}`,
        is_active: true,
      },
    });
  }

  return {
    vehicles: [...latest.values()].map((entry) => entry.payload),
    duplicatePublishedRegistrations: [...duplicatePublishedRegistrations].sort(),
  };
}

export function buildCarStockReconciliationPreview(sourceVehicles = [], existingRows = []) {
  const sourceByRegistration = new Map();
  const sourceDuplicates = new Set();

  for (const vehicle of Array.isArray(sourceVehicles) ? sourceVehicles : []) {
    const registration = normalizeCarRegistration(vehicle?.registration || vehicle?.reg || vehicle?.title);
    if (!registration) continue;
    if (sourceByRegistration.has(registration)) sourceDuplicates.add(registration);
    sourceByRegistration.set(registration, { ...vehicle, registration });
  }

  const existingByRegistration = new Map();
  const existingDuplicates = new Set();

  for (const row of Array.isArray(existingRows) ? existingRows : []) {
    const registration = normalizeCarRegistration(row?.registration || row?.reg || row?.title);
    if (!registration) continue;
    const group = existingByRegistration.get(registration) || [];
    group.push(row);
    existingByRegistration.set(registration, group);
    if (group.length > 1) existingDuplicates.add(registration);
  }

  const keep = [];
  const add = [];
  const reactivate = [];
  const deactivate = [];

  for (const [registration] of sourceByRegistration) {
    const existing = existingByRegistration.get(registration) || [];
    if (!existing.length) {
      add.push(registration);
      continue;
    }
    if (existing.some((row) => row?.is_active !== false)) keep.push(registration);
    else reactivate.push(registration);
  }

  for (const [registration, rows] of existingByRegistration) {
    if (sourceByRegistration.has(registration)) continue;
    if (rows.some((row) => row?.is_active !== false)) deactivate.push(registration);
  }

  keep.sort();
  add.sort();
  reactivate.sort();
  deactivate.sort();

  const activeExisting = [...existingByRegistration.values()]
    .filter((rows) => rows.some((row) => row?.is_active !== false))
    .length;
  const deactivationRatio = activeExisting > 0 ? deactivate.length / activeExisting : 0;
  const warnings = [];

  if (!sourceByRegistration.size) {
    warnings.push("No published Cars were returned by the authoritative Wix collection. No write operation should run.");
  }
  if (sourceDuplicates.size) {
    warnings.push(`The source contains duplicate registrations: ${[...sourceDuplicates].sort().join(", ")}.`);
  }
  if (existingDuplicates.size) {
    warnings.push(`The Marketing CRM Cars table contains duplicate registrations: ${[...existingDuplicates].sort().join(", ")}.`);
  }
  if (deactivationRatio >= 0.5 && deactivate.length >= 5) {
    warnings.push(`Large stale-stock change: ${deactivate.length} of ${activeExisting} currently active Cars would be deactivated.`);
  }

  return {
    safeToApply: sourceByRegistration.size > 0 && sourceDuplicates.size === 0,
    counts: {
      sourcePublished: sourceByRegistration.size,
      crmRows: Array.isArray(existingRows) ? existingRows.length : 0,
      crmUniqueRegistrations: existingByRegistration.size,
      crmActiveRegistrations: activeExisting,
      keep: keep.length,
      add: add.length,
      reactivate: reactivate.length,
      deactivate: deactivate.length,
    },
    keep,
    add,
    reactivate,
    deactivate,
    sourceDuplicates: [...sourceDuplicates].sort(),
    existingDuplicates: [...existingDuplicates].sort(),
    warnings,
  };
}

// DealerKit Stock Watch mileage-only field mapping.
// Never replace whole Wix records or copy DealerKit advertising/specification text.
export const MILEAGE_COLLECTIONS = Object.freeze({
  finance: [
    "VANFINANCE-ALLVANS", "VANFINANCE-SMALLVANS", "VANFINANCE-MWB",
    "VANFINANCE-LWBVANS", "FINANCE-CREWVANS", "VANFINANCE-PICKUPS",
    "VANFINANCE-TIPPERSDROPSIDEL", "VANFINANCE-ELECTRIC", "AUTOMATIC",
    "VANFINANCEPAGES",
  ],
  rent2buy: [
    "ALLRENT2BUYVANS", "SmallVans", "MEDIUMVANS", "LWBVANS", "CREWVANS",
    "AUTOMATICVANS", "ELECTRICVANS", "PICKUPS", "TIPPERS-LUTONS-DROPSDIES",
    "VANPAGES",
  ],
  cars: ["CARFINANCE", "CARPAGES"],
});

export const MILEAGE_CANONICAL = Object.freeze({
  finance: ["VANFINANCE-ALLVANS", "VANFINANCEPAGES"],
  rent2buy: ["ALLRENT2BUYVANS", "VANPAGES"],
  cars: ["CARFINANCE", "CARPAGES"],
});

const LINE_FIELDS = Object.freeze({
  VANFINANCEPAGES: ["vehicleSpecificationText", "descriptionLine"],
  VANPAGES: ["specText", "vehicleSpecificationText"],
  CARFINANCE: ["vanSpec"],
  CARPAGES: ["descriptionLine", "vehicleSpecificationText"],
  LWBVANS: ["specText", "vanSpec"],
  PICKUPS: ["vanDetails", "vanSpec"],
});
const MILEAGE_LINE = /^([ \t]*(?:MILEAGE|MILLAGE)[ \t]*[:\-][ \t]*)([0-9][0-9,]*)([ \t]*(?:miles?|mi)?[ \t]*)$/i;
const LABEL_LINE = /^[ \t]*(?:MILEAGE|MILLAGE)\b/i;

export function cleanMileage(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 && value < 1000000 ? value : null;
  }
  const text = String(value ?? "").trim();
  if (!/^[0-9][0-9,]*(?:\s*(?:miles?|mi))?$/i.test(text)) return null;
  const digits = text.replace(/,/g, "").replace(/\s*(?:miles?|mi)$/i, "");
  if (!/^\d+$/.test(digits)) return null;
  const number = Number(digits);
  return Number.isSafeInteger(number) && number > 0 && number < 1000000 ? number : null;
}

export function mileageFromSpecification(value) {
  if (typeof value !== "string") return null;
  const numbers = value.split(/\r?\n/).map((line) => line.match(MILEAGE_LINE))
    .filter(Boolean).map((match) => cleanMileage(match[2]));
  return numbers.length === 1 ? numbers[0] : null;
}

export function listingMileage(data = {}, pipeline = "finance") {
  const fields = pipeline === "rent2buy"
    ? ["vanSpec", "specText", "vanDetails"]
    : ["vanSpec", "specText"];
  for (const field of fields) {
    const mileage = mileageFromSpecification(data[field]);
    if (mileage !== null) return mileage;
  }
  return null;
}

export function normalizeMileageRegistration(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function buildMileageDifferences(dealerKitRecords = [], wixListings = [], pipeline = "finance") {
  const sourceByRegistration = new Map();
  for (const record of dealerKitRecords) {
    const registration = normalizeMileageRegistration(record?.registration);
    if (!registration || record?.isCurrentlyOnVansco === false) continue;
    const stockId = String(record?.supplierStockId || "").trim();
    if (!stockId) continue;
    const group = sourceByRegistration.get(registration) || new Map();
    group.set(stockId, record);
    sourceByRegistration.set(registration, group);
  }
  const results = [];
  for (const wix of wixListings) {
    const registration = normalizeMileageRegistration(wix?.registration);
    const group = sourceByRegistration.get(registration);
    if (!registration || !group || group.size !== 1) continue;
    const dealer = [...group.values()][0];
    const sourceMileage = cleanMileage(dealer.mileage);
    const publishedMileage = cleanMileage(wix.mileage);
    if (sourceMileage === null || publishedMileage === sourceMileage) continue;
    results.push({
      id: "mileage-" + pipeline + "-" + registration,
      pipeline, registration, title: wix.vehicleDescription || wix.title || dealer.title || registration,
      supplierStockId: dealer.supplierStockId,
      dealerMileage: sourceMileage, wixMileage: publishedMileage,
      difference: publishedMileage === null ? null : sourceMileage - publishedMileage,
      sourceStatus: dealer.sourceStatus || dealer.status || "",
      imageUrl: wix.imageUrl || dealer.imageUrl || "",
      localStockUrl: wix.advertUrl || "",
      displayStatus: "mileage_difference",
      reviewOnly: publishedMileage === null,
    });
  }
  return results.sort((a, b) => a.registration.localeCompare(b.registration));
}

function fieldNames(collectionId, pipeline) {
  if (LINE_FIELDS[collectionId]) return LINE_FIELDS[collectionId];
  if (pipeline === "rent2buy") return ["vanSpec", "specText", "vanDetails"];
  return ["vanSpec"];
}

function updateMileageSpecText(value, newMileage) {
  const lines = value.split(/(\r?\n)/);
  let found = 0;
  let malformed = false;
  const previous = [];
  const proposed = lines.map((line) => {
    if (/^\r?\n$/.test(line) || !LABEL_LINE.test(line)) return line;
    const match = line.match(MILEAGE_LINE);
    if (!match) { malformed = true; return line; }
    const original = cleanMileage(match[2]);
    if (original === null) { malformed = true; return line; }
    found += 1;
    previous.push(original);
    return match[1] + newMileage.toLocaleString("en-GB") + match[3];
  }).join("");
  if (malformed || found > 1) return { error: "Ambiguous or unrecognised mileage line." };
  return found === 1 ? { previous: previous[0], proposed } : { previous: null, proposed: value };
}

export function buildMileageFieldPatch(collectionId, data, dealerMileage, pipeline) {
  const validMileage = cleanMileage(dealerMileage);
  if (!validMileage) return { error: "DealerKit mileage is invalid.", fields: {} };
  if (!MILEAGE_COLLECTIONS[pipeline]?.includes(collectionId)) {
    return { error: "Collection is not approved for mileage updates.", fields: {} };
  }
  const fields = {};
  const prior = [];
  if (collectionId === "VANFINANCEPAGES") {
    const original = cleanMileage(data?.mileage);
    if (original === null) return { error: "Finance detail mileage field is missing or invalid.", fields: {} };
    prior.push(original);
    const proposed = validMileage.toLocaleString("en-GB");
    if (String(data.mileage) !== proposed) fields.mileage = proposed;
  }
  for (const field of fieldNames(collectionId, pipeline)) {
    const value = data?.[field];
    if (typeof value !== "string" || !value.trim()) continue;
    const check = updateMileageSpecText(value, validMileage);
    if (check.error) return { error: field + ": " + check.error, fields: {} };
    if (check.previous !== null) {
      prior.push(check.previous);
      if (check.proposed !== value) fields[field] = check.proposed;
    }
  }
  if (!prior.length) return { error: "Published row has no safely identifiable mileage field.", fields: {} };
  return {
    fields, previousMileage: prior[0],
    conflicts: new Set(prior).size > 1,
    changed: Object.keys(fields).length > 0,
  };
}

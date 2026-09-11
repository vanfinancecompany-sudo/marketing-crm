import crypto from "node:crypto";
import {
  dealerKitAcceleration,
  dealerKitCo2,
  dealerKitCombinedMpg,
  dealerKitEngineSize,
  dealerKitEuro,
  dealerKitFeatures,
  dealerKitFeatureSections,
  dealerKitTopSpeed,
} from "./dealerKitVehicleEquipment.js";

export const TEMP_BACKFILL_VERSION = 1;
export const EXPECTED_FINANCE_COUNT = 33;
export const EXPECTED_CARS_COUNT = 6;

export const FINANCE_ALLOWED_FIELDS = Object.freeze([
  "vehicleSpecificationText",
  "audioAndCommunications",
  "driversAssistance",
  "exterior",
  "illumination",
  "interior",
  "performance",
  "safetyAndSecurity",
]);

export const CARS_ALLOWED_FIELDS = Object.freeze([
  "descriptionLine",
  "vehicleSpecificationText",
  "audioAndCommunications",
  "driversAssistance",
  "exterior",
  "illumination",
  "interior",
  "performance",
  "safetyAndSecurity",
]);

const WIX_AUTO_MUTATING_DATA_FIELDS = new Set(["_updatedDate"]);
const clean = (value, limit = 20000) => String(value ?? "").trim().slice(0, limit);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, nested]) => [key, stable(nested)]),
    );
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(stable(value));
}

export function sha256(value) {
  return crypto.createHash("sha256").update(typeof value === "string" ? value : stableStringify(value)).digest("hex");
}

function normalizedLine(value) {
  return clean(value, 2000).replace(/\s+/g, " ").toLowerCase();
}

function existingLines(value) {
  return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function appendRaw(currentValue, snippets = []) {
  const current = String(currentValue ?? "");
  const additions = snippets.map((item) => clean(item, 4000)).filter(Boolean);
  if (!additions.length) return current;
  if (!current) return additions.join("\n");
  return `${current}${current.endsWith("\n") ? "" : "\n"}${additions.join("\n")}`;
}

function appendFeatureLines(currentValue, features = []) {
  const seen = new Set(existingLines(currentValue).map(normalizedLine));
  const additions = [];
  for (const feature of features) {
    const text = clean(feature, 2000);
    const key = normalizedLine(text);
    if (!text || !key || seen.has(key)) continue;
    seen.add(key);
    additions.push(text);
  }
  return { value: appendRaw(currentValue, additions), additions };
}

function normalizedLabel(value) {
  return clean(value, 300).replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
}

function hasLabel(currentValue, label) {
  const wanted = normalizedLabel(label);
  if (!wanted) return false;
  return existingLines(currentValue).some((line) => {
    const text = normalizedLabel(line);
    if (text === wanted) return true;
    const colon = line.match(/^\s*([^:]{1,120})\s*:/);
    return colon ? normalizedLabel(colon[1]) === wanted : false;
  });
}

function appendLabelPairs(currentValue, pairs = [], { block = false } = {}) {
  let value = String(currentValue ?? "");
  const additions = [];
  for (const pair of pairs) {
    const label = clean(pair?.[0], 200);
    const pairValue = clean(pair?.[1], 1000);
    if (!label || !pairValue || hasLabel(value, label)) continue;
    const snippet = block ? `${label}\n${pairValue}` : `${label}: ${pairValue}`;
    value = appendRaw(value, [snippet]);
    additions.push(snippet);
  }
  return { value, additions };
}

function financeEngine(vehicle) {
  const raw = clean(dealerKitEngineSize(vehicle), 120);
  if (!raw) return "";
  const text = raw.replace(/\s+/g, " ").trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return `${text} CC`;
  return text.replace(/\s*cc$/i, " CC").toUpperCase();
}

function financeEuro(vehicle) {
  const raw = clean(dealerKitEuro(vehicle), 120);
  if (!raw) return "";
  const text = raw.replace(/\s+/g, " ").trim();
  if (/^[4567](?:[a-z])?$/i.test(text)) return `EURO ${text.toUpperCase()}`;
  return text.toUpperCase().replace(/^EURO(?=\d)/, "EURO ");
}

function financeCo2(vehicle) {
  const raw = clean(dealerKitCo2(vehicle), 120);
  if (!raw) return "";
  const text = raw.replace(/\s+/g, " ").trim();
  return /^\d+(?:\.\d+)?$/.test(text) ? `${text} G/KM` : text.toUpperCase();
}

function mpg(vehicle) {
  return clean(dealerKitCombinedMpg(vehicle), 120).replace(/\s*mpg$/i, "").trim();
}

function carsEngine(vehicle) {
  const raw = clean(dealerKitEngineSize(vehicle), 120);
  if (!raw) return "";
  const numeric = Number(raw.replace(/[^0-9.]/g, ""));
  if (Number.isFinite(numeric) && numeric >= 500) return (numeric / 1000).toFixed(1);
  return raw.replace(/\s*cc$/i, "").trim();
}

function carsEuro(vehicle) {
  const raw = clean(dealerKitEuro(vehicle), 120);
  const match = raw.match(/([4567](?:[a-z])?)/i);
  return match ? match[1].toUpperCase() : raw.replace(/^EURO\s*/i, "").toUpperCase();
}

function keyInformationPairs(vehicle = {}) {
  const bhp = Number(vehicle.bhp);
  return [
    ["Engine Size", clean(dealerKitEngineSize(vehicle), 120)],
    ["Top Speed", clean(dealerKitTopSpeed(vehicle), 120)],
    ["0-62mph", clean(dealerKitAcceleration(vehicle), 120)],
    ["Power", Number.isFinite(bhp) && bhp > 0 ? `${Math.round(bhp)} bhp` : ""],
  ].filter(([, value]) => value);
}

function buildEquipmentChanges(data = {}, vehicle = {}, allowedFields = []) {
  const sections = dealerKitFeatureSections(vehicle);
  const proposed = {};
  const audit = {};
  for (const field of allowedFields.filter((name) => name !== "vehicleSpecificationText" && name !== "descriptionLine")) {
    const current = data[field] ?? "";
    let merged = { value: String(current ?? ""), additions: [] };
    if (field === "audioAndCommunications") {
      const key = appendLabelPairs(merged.value, keyInformationPairs(vehicle), { block: true });
      merged = { value: key.value, additions: [...merged.additions, ...key.additions] };
    }
    const features = appendFeatureLines(merged.value, existingLines(sections[field] || ""));
    merged = { value: features.value, additions: [...merged.additions, ...features.additions] };
    if (merged.value !== String(current ?? "")) {
      proposed[field] = merged.value;
      audit[field] = merged.additions;
    }
  }
  return { proposed, audit };
}

export function buildFinanceAllowedBackfill(data = {}, vehicle = {}) {
  const technicalPairs = [
    ["BODY TYPE", clean(vehicle.bodyType, 160).toUpperCase()],
    ["ENGINE SIZE", financeEngine(vehicle)],
    ["EURO STATUS", financeEuro(vehicle)],
    ["CO2 EMISSIONS", financeCo2(vehicle)],
    ["COMBINED MPG", mpg(vehicle)],
    ["MPG", mpg(vehicle)],
  ].filter(([, value]) => value);
  const technical = appendLabelPairs(data.vehicleSpecificationText ?? "", technicalPairs);
  const equipment = buildEquipmentChanges(data, vehicle, FINANCE_ALLOWED_FIELDS);
  const proposed = { ...equipment.proposed };
  const audit = { ...equipment.audit };
  if (technical.value !== String(data.vehicleSpecificationText ?? "")) {
    proposed.vehicleSpecificationText = technical.value;
    audit.vehicleSpecificationText = technical.additions;
  }
  return { proposed, audit };
}

export function buildCarsAllowedBackfill(data = {}, vehicle = {}) {
  const descriptionPairs = [
    ["EURO", carsEuro(vehicle)],
    ["ENGINE SIZE", carsEngine(vehicle)],
    ["MPG", mpg(vehicle)],
  ].filter(([, value]) => value);
  const description = appendLabelPairs(data.descriptionLine ?? "", descriptionPairs);
  const featureMerge = appendFeatureLines(data.vehicleSpecificationText ?? "", dealerKitFeatures(vehicle));
  const equipment = buildEquipmentChanges(data, vehicle, CARS_ALLOWED_FIELDS);
  const proposed = { ...equipment.proposed };
  const audit = { ...equipment.audit };
  if (description.value !== String(data.descriptionLine ?? "")) {
    proposed.descriptionLine = description.value;
    audit.descriptionLine = description.additions;
  }
  if (featureMerge.value !== String(data.vehicleSpecificationText ?? "")) {
    proposed.vehicleSpecificationText = featureMerge.value;
    audit.vehicleSpecificationText = featureMerge.additions;
  }
  return { proposed, audit };
}

export function allowedFieldsForLane(lane) {
  return lane === "cars" ? CARS_ALLOWED_FIELDS : FINANCE_ALLOWED_FIELDS;
}

export function protectedData(data = {}, lane) {
  const allowed = new Set(allowedFieldsForLane(lane));
  return Object.fromEntries(Object.entries(data || {}).filter(([key]) => !allowed.has(key) && !WIX_AUTO_MUTATING_DATA_FIELDS.has(key)));
}

export function buildBackfillFingerprint({ lane, registration, masterItem, detailItem, vehicle, proposed = {} } = {}) {
  return {
    version: TEMP_BACKFILL_VERSION,
    lane,
    registration,
    masterItemId: clean(masterItem?.id, 300),
    masterDataHash: sha256(masterItem?.data || {}),
    detailItemId: clean(detailItem?.id, 300),
    detailDataHash: sha256(detailItem?.data || {}),
    protectedDataHash: sha256(protectedData(detailItem?.data || {}, lane)),
    supplierStockId: clean(vehicle?.supplierStockId, 300),
    sourceUpdatedAt: clean(vehicle?.sourceUpdatedAt, 100),
    proposedHash: sha256(proposed),
  };
}

export function signBackfillFingerprint(secret, fingerprint) {
  const key = clean(secret, 5000);
  if (!key) return "";
  return crypto.createHmac("sha256", key).update(stableStringify(fingerprint)).digest("hex");
}

export function safeTokenEqual(left, right) {
  const a = Buffer.from(clean(left, 200), "utf8");
  const b = Buffer.from(clean(right, 200), "utf8");
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

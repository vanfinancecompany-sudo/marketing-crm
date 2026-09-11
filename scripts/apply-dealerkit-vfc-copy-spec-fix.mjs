import fs from "node:fs";
import { fileURLToPath } from "node:url";

const targetPath = fileURLToPath(new URL("../lib/dealerKitWixCreatePlan.js", import.meta.url));
let source = fs.readFileSync(targetPath, "utf8");

function patch({ label, before, after, already }) {
  if (already && source.includes(already)) return;
  const first = source.indexOf(before);
  if (first === -1) throw new Error(`DealerKit VFC copy/spec fix could not find: ${label}`);
  if (source.indexOf(before, first + before.length) !== -1) throw new Error(`DealerKit VFC copy/spec fix found duplicate anchor: ${label}`);
  source = source.replace(before, after);
}

patch({
  label: "shared DealerKit equipment import",
  already: "dealerKitFeatureSections,",
  before: `} from "./vanscoWixPrice.js";\n\nexport const VFC_WIX_CREATE_SCHEMA_VERIFIED_AT`,
  after: `} from "./vanscoWixPrice.js";\nimport {\n  dealerKitFeatureSections,\n  dealerKitKeyVehicleInformation,\n  dealerKitTechnicalValue as sharedDealerKitTechnicalValue,\n  dealerKitEngineSize,\n  dealerKitEuro,\n  dealerKitCo2,\n  dealerKitCombinedMpg,\n} from "./dealerKitVehicleEquipment.js";\n\nexport const VFC_WIX_CREATE_SCHEMA_VERIFIED_AT`,
});

patch({
  label: "richer listing headline",
  already: "function dealerKitAdvertHeadline(vehicle = {})",
  before: `function listingDescription(vehicle = {}) {
  const lineOne = [clean(vehicle.make, 80), clean(vehicle.model, 100)].filter(Boolean).join(" ").trim();
  const lineTwo = clean(vehicle.trim || vehicle.derivative, 120);
  return [lineOne || clean(vehicle.title, 160), lineTwo].filter(Boolean).join("\\n");
}`,
  after: `function dealerKitAdvertHeadline(vehicle = {}) {
  const make = clean(vehicle.make, 80);
  const model = clean(vehicle.model, 100);
  const identity = [make, model].filter(Boolean).join(" ").replace(/\\s+/g, " ").trim();
  const firstCommentLine = clean(vehicle.description, 1200)
    .split(/\\r?\\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
  const lead = firstCommentLine.replace(/\\s+/g, " ").trim();
  const identityLower = identity.toLowerCase();
  const modelLower = model.toLowerCase();
  const leadLower = lead.toLowerCase();
  const supplierLeadLooksLikeVehicleHeadline = Boolean(
    lead
    && lead.length <= 140
    && ((identityLower && leadLower.startsWith(identityLower)) || (modelLower && leadLower.startsWith(modelLower)))
    && !/[.!?]$/.test(lead),
  );
  if (supplierLeadLooksLikeVehicleHeadline) return lead;

  const derivative = clean(vehicle.derivative, 220)
    .replace(/\\b(?:panel van|chassis cab|crew van|double cab|single cab|dropside|drop side|tipper|luton|low loader)\\b.*$/i, "")
    .replace(/\\s+/g, " ")
    .trim();
  const variant = derivative || clean(vehicle.trim, 100);
  return [identity || clean(vehicle.title, 160), variant].filter(Boolean).join(" ").replace(/\\s+/g, " ").trim();
}

function listingDescription(vehicle = {}) {
  return dealerKitAdvertHeadline(vehicle);
}`,
});

patch({
  label: "technical value helpers",
  already: "function dealerKitTechnicalValue(vehicle = {}, labels = [])",
  before: `export function buildDealerKitVehicleSpecText(vehicle = {}) {
  const registration = normalizeFinanceRegistration(vehicle.registration || "");
  const bhp = optionalNumber(vehicle.bhp);`,
  after: `function normaliseTechnicalLabel(value) {
  return clean(value, 200).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function dealerKitTechnicalValue(vehicle = {}, labels = []) {
  const sharedValue = sharedDealerKitTechnicalValue(vehicle, labels);
  if (sharedValue) return sharedValue;
  const wanted = labels.map(normaliseTechnicalLabel).filter(Boolean);
  const technical = Array.isArray(vehicle.specifications?.technical) ? vehicle.specifications.technical : [];
  for (const item of technical) {
    if (!item || typeof item !== "object") continue;
    const itemLabel = normaliseTechnicalLabel(item.name || item.label || item.title);
    if (!itemLabel || !wanted.some((label) => itemLabel === label || itemLabel.startsWith(label + " "))) continue;
    for (const key of ["value", "text", "content"]) {
      const value = item[key];
      if (typeof value === "string" || typeof value === "number") {
        const text = clean(value, 160);
        if (text) return text;
      }
    }
  }
  return "";
}

function engineSizeText(vehicle = {}) {
  const value = dealerKitEngineSize(vehicle) || dealerKitTechnicalValue(vehicle, ["Engine Size", "Engine Capacity", "Engine CC"]);
  if (!value) return "";
  const text = value.replace(/\\s+/g, " ").trim();
  return /^\\d+(?:\\.\\d+)?$/.test(text) ? text + " CC" : text.replace(/\\s*cc$/i, " CC");
}

function euroStatusText(vehicle = {}) {
  let value = dealerKitEuro(vehicle) || dealerKitTechnicalValue(vehicle, ["Euro Status", "Euro", "Emission Standard", "Emissions Standard", "Euro Emissions"]);
  if (!value) {
    const source = [vehicle.title, vehicle.derivative].filter(Boolean).join(" ");
    value = source.match(/\\bEuro\\s*[4567](?:[a-z])?\\b/i)?.[0] || "";
  }
  if (!value) return "";
  const text = value.replace(/\\s+/g, " ").trim();
  if (/^[4567](?:[a-z])?$/i.test(text)) return "EURO " + text.toUpperCase();
  return text.toUpperCase().replace(/^EURO(?=\\d)/, "EURO ");
}

function co2Text(vehicle = {}) {
  const value = dealerKitCo2(vehicle) || dealerKitTechnicalValue(vehicle, ["CO2 Emissions", "CO2 Emission", "CO2"]);
  if (!value) return "";
  const text = value.replace(/\\s+/g, " ").trim();
  return /^\\d+(?:\\.\\d+)?$/.test(text) ? text + " G/KM" : text.toUpperCase();
}

function combinedMpgText(vehicle = {}) {
  const value = dealerKitCombinedMpg(vehicle) || dealerKitTechnicalValue(vehicle, ["Combined MPG", "MPG Combined", "Fuel Consumption Combined"]);
  return value ? value.replace(/\\s*mpg$/i, "").trim() : "";
}

export function buildDealerKitVehicleSpecText(vehicle = {}) {
  const registration = normalizeFinanceRegistration(vehicle.registration || "");
  const bhp = optionalNumber(vehicle.bhp);
  const combinedMpg = combinedMpgText(vehicle);`,
});

patch({
  label: "established VFC spec labels",
  already: `["COMBINED MPG", combinedMpg],\n    ["MPG", combinedMpg],`,
  before: `    ["MILEAGE", formatMileage(vehicle.mileage)],
    ["FUEL TYPE", clean(vehicle.fuel, 100).toUpperCase()],
    ["COLOUR", clean(vehicle.colour, 120).toUpperCase()],
    ["TRANSMISSION", clean(vehicle.transmission, 100).toUpperCase()],
    ["BHP", bhp !== null && bhp > 0 ? String(Math.round(bhp)) : ""],`,
  after: `    ["MILEAGE", formatMileage(vehicle.mileage)],
    ["FUEL", clean(vehicle.fuel, 100).toUpperCase()],
    ["BODY TYPE", clean(vehicle.bodyType, 160).toUpperCase()],
    ["COLOUR", clean(vehicle.colour, 120).toUpperCase()],
    ["TRANSMISSION", clean(vehicle.transmission, 100).toUpperCase()],
    ["ENGINE SIZE", engineSizeText(vehicle)],
    ["EURO STATUS", euroStatusText(vehicle)],
    ["CO2 EMISSIONS", co2Text(vehicle)],
    ["COMBINED MPG", combinedMpg],
    ["MPG", combinedMpg],
    ["BHP", bhp !== null && bhp > 0 ? String(Math.round(bhp)) : ""],`,
});

patch({
  label: "full Finance equipment groups",
  already: "const equipmentSections = dealerKitFeatureSections(vehicle);",
  before: `function buildDetailFields(vehicle, decision, registration, retailPrice, monthlyPrice, vatText, imageCount) {
  return {
    title: registration,`,
  after: `function buildDetailFields(vehicle, decision, registration, retailPrice, monthlyPrice, vatText, imageCount) {
  const equipmentSections = dealerKitFeatureSections(vehicle);
  return {
    title: registration,`,
});

patch({
  label: "Finance detail equipment field writes",
  already: "audioAndCommunications: [dealerKitKeyVehicleInformation(vehicle), equipmentSections.audioAndCommunications]",
  before: `    vehicleSpecificationText: buildDealerKitVehicleSpecText(vehicle),
    applyLink:`,
  after: `    vehicleSpecificationText: buildDealerKitVehicleSpecText(vehicle),
    audioAndCommunications: [dealerKitKeyVehicleInformation(vehicle), equipmentSections.audioAndCommunications].filter(Boolean).join("\\n\\n"),
    driversAssistance: equipmentSections.driversAssistance,
    exterior: equipmentSections.exterior,
    illumination: equipmentSections.illumination,
    interior: equipmentSections.interior,
    performance: equipmentSections.performance,
    safetyAndSecurity: equipmentSections.safetyAndSecurity,
    applyLink:`,
});

patch({
  label: "remove obsolete equipment pending marker",
  already: "equipment groups: mapped from DealerKit standard/options",
  before: `        "equipment groups: DealerKit specifications need a verified category mapping before writing",`,
  after: `        "equipment groups: mapped from DealerKit standard/options",`,
});

fs.writeFileSync(targetPath, source);

const carPath = fileURLToPath(new URL("../lib/dealerKitCarWixPlan.js", import.meta.url));
let carSource = fs.readFileSync(carPath, "utf8");

function patchCar({ label, before, after, already }) {
  if (already && carSource.includes(already)) return;
  const first = carSource.indexOf(before);
  if (first === -1) throw new Error(`DealerKit Cars spec fix could not find: ${label}`);
  if (carSource.indexOf(before, first + before.length) !== -1) throw new Error(`DealerKit Cars spec fix found duplicate anchor: ${label}`);
  carSource = carSource.replace(before, after);
}

patchCar({
  label: "shared technical reader import",
  already: "sharedDealerKitTechnicalValue",
  before: `} from "./vanscoWixPrice.js";\n\nconst clean`,
  after: `} from "./vanscoWixPrice.js";\nimport { dealerKitTechnicalValue as sharedDealerKitTechnicalValue } from "./dealerKitVehicleEquipment.js";\n\nconst clean`,
});

patchCar({
  label: "robust Cars technical values",
  already: "const sharedValue = sharedDealerKitTechnicalValue(vehicle, labels);",
  before: `function technicalValue(vehicle = {}, labels = []) {
  const wanted = labels.map(normaliseLabel).filter(Boolean);`,
  after: `function technicalValue(vehicle = {}, labels = []) {
  const sharedValue = sharedDealerKitTechnicalValue(vehicle, labels);
  if (sharedValue) return sharedValue;
  const wanted = labels.map(normaliseLabel).filter(Boolean);`,
});

fs.writeFileSync(carPath, carSource);
console.log("Applied DealerKit VFC/Cars copy/spec fix: source-backed technical data and complete Finance equipment groups.");

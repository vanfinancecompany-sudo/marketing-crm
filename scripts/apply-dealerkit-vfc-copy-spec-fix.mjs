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
  label: "complete VFC vehicle specification text",
  already: "function dealerKitTechnicalValue(vehicle = {}, labels = [])",
  before: `export function buildDealerKitVehicleSpecText(vehicle = {}) {
  const registration = normalizeFinanceRegistration(vehicle.registration || "");
  const bhp = optionalNumber(vehicle.bhp);
  const rows = [
    ["REGISTRATION", formatRegistration(registration)],
    ["YEAR", yearDisplay(vehicle, registration)],
    ["MILEAGE", formatMileage(vehicle.mileage)],
    ["FUEL TYPE", clean(vehicle.fuel, 100).toUpperCase()],
    ["COLOUR", clean(vehicle.colour, 120).toUpperCase()],
    ["TRANSMISSION", clean(vehicle.transmission, 100).toUpperCase()],
    ["BHP", bhp !== null && bhp > 0 ? String(Math.round(bhp)) : ""],
  ].filter(([, value]) => value);
  return rows.map(([label, value]) => label + ": " + value).join("\\n");
}`,
  after: `function normaliseTechnicalLabel(value) {
  return clean(value, 200).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function dealerKitTechnicalValue(vehicle = {}, labels = []) {
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
  const value = dealerKitTechnicalValue(vehicle, ["Engine Size", "Engine Capacity", "Engine CC"]);
  if (!value) return "";
  const text = value.replace(/\\s+/g, " ").trim();
  return /^\\d+(?:\\.\\d+)?$/.test(text) ? text + " CC" : text.replace(/\\s*cc$/i, " CC");
}

function euroStatusText(vehicle = {}) {
  let value = dealerKitTechnicalValue(vehicle, ["Euro Status", "Euro", "Emission Standard", "Emissions Standard", "Euro Emissions"]);
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
  const value = dealerKitTechnicalValue(vehicle, ["CO2 Emissions", "CO2 Emission", "CO2"]);
  if (!value) return "";
  const text = value.replace(/\\s+/g, " ").trim();
  return /^\\d+(?:\\.\\d+)?$/.test(text) ? text + " G/KM" : text.toUpperCase();
}

function combinedMpgText(vehicle = {}) {
  const value = dealerKitTechnicalValue(vehicle, ["Combined MPG", "MPG Combined", "Fuel Consumption Combined"]);
  return value ? value.replace(/\\s*mpg$/i, "").trim() : "";
}

export function buildDealerKitVehicleSpecText(vehicle = {}) {
  const registration = normalizeFinanceRegistration(vehicle.registration || "");
  const bhp = optionalNumber(vehicle.bhp);
  const combinedMpg = combinedMpgText(vehicle);
  const rows = [
    ["REGISTRATION", formatRegistration(registration)],
    ["YEAR", yearDisplay(vehicle, registration)],
    ["MILEAGE", formatMileage(vehicle.mileage)],
    ["FUEL", clean(vehicle.fuel, 100).toUpperCase()],
    ["BODY TYPE", clean(vehicle.bodyType, 160).toUpperCase()],
    ["COLOUR", clean(vehicle.colour, 120).toUpperCase()],
    ["TRANSMISSION", clean(vehicle.transmission, 100).toUpperCase()],
    ["ENGINE SIZE", engineSizeText(vehicle)],
    ["EURO STATUS", euroStatusText(vehicle)],
    ["CO2 EMISSIONS", co2Text(vehicle)],
    ["COMBINED MPG", combinedMpg],
    ["MPG", combinedMpg],
    ["BHP", bhp !== null && bhp > 0 ? String(Math.round(bhp)) : ""],
  ].filter(([, value]) => value);
  return rows.map(([label, value]) => label + ": " + value).join("\\n");
}`,
});

fs.writeFileSync(targetPath, source);
console.log("Applied DealerKit VFC copy/spec fix: richer listing headlines plus source-backed engine, Euro, CO2 and combined MPG fields, including the live MPG summary alias.");

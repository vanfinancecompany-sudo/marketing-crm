const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);

function normalizedSourceVat(value) {
  return clean(value, 120)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NO_VAT_SOURCE_VALUES = new Set([
  "no vat",
  "non vat",
  "vat free",
  "margin",
  "margin scheme",
]);

export function resolveVanFinanceVatText(vehicle = {}) {
  if (vehicle.vatStatus === "plus_vat") return "+VAT";
  if (vehicle.vatStatus === "no_vat") return "N/A";

  const sourceVatStatus = normalizedSourceVat(vehicle.sourceVatStatus);
  if (NO_VAT_SOURCE_VALUES.has(sourceVatStatus)) return "N/A";

  const advertEvidence = [vehicle.description, vehicle.attentionGrabber]
    .map((value) => clean(value, 12000))
    .filter(Boolean)
    .join("\n");

  // Only use explicit supplier wording as a safe fallback. Ambiguous/unknown VAT
  // states still fail closed in the Van Finance publish plan.
  if (/\bno\s+vat\b/i.test(advertEvidence)) return "N/A";

  return "";
}

export function rent2BuyRentalVatPolicy(sourceVatStatus = "unknown") {
  return {
    sourceVatStatus: clean(sourceVatStatus, 80) || "unknown",
    vatStatus: "plus_vat",
    vatKnown: true,
    vatMultiplier: 1.2,
  };
}

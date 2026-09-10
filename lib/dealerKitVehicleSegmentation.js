const clean = (value, limit = 500) => String(value ?? "").trim().slice(0, limit);

const COMMERCIAL_TYPES = /\b(lcv|van|commercial|commercial vehicle|light commercial|pickup|pick-up|chassis cab|minibus)\b/i;
const CAR_TYPES = /\b(car|passenger car|passenger vehicle|mpv)\b/i;
const COMMERCIAL_BODIES = /\b(panel van|crew van|box van|city van|window van|car derived van|chassis cab|dropside|drop side|tipper|luton|pickup|pick-up|commercial|double cab|single cab)\b/i;
const CAR_BODIES = /\b(hatchback|saloon|sedan|estate|coupe|convertible|cabriolet|roadster|suv|crossover)\b/i;

// Used only when DealerKit has not supplied a usable type/body classification.
// It is deliberately conservative: it can rescue well-known commercial models,
// but an unknown record is never allowed to drift into Cars.
const COMMERCIAL_MODEL_FALLBACK = /\b(transit(?: custom| connect| courier)?|berlingo|partner|dispatch|expert|relay|boxer|combo|vivaro|movano|trafic|traffic|master|kangoo|sprinter|vito|crafter|caddy|transporter|ducato|daily|doblo|proace|primastar|nv200|nv300|townstar|maxus|l200|ranger|hilux|d-?max|amarok|pickup|pick-up|tipper|luton|dropside|panel van|crew van|chassis cab)\b/i;

function sourceText(vehicle = {}) {
  return [
    vehicle.vehicleType,
    vehicle.vehicleCategory,
    vehicle.vehicleClass,
    vehicle.bodyType,
    vehicle.bodyStyle,
  ].map((value) => clean(value)).filter(Boolean).join(" ");
}

export function classifyDealerKitVehicle(vehicle = {}) {
  const classification = sourceText(vehicle);
  const title = [vehicle.make, vehicle.model, vehicle.derivative, vehicle.title]
    .map((value) => clean(value)).filter(Boolean).join(" ");

  // Commercial body data wins over a generic "Car" type. Dealer feeds often
  // register car-derived vans and pickups under broad passenger taxonomies.
  if (COMMERCIAL_BODIES.test(classification)) {
    return { segment: "commercial", confidence: "explicit", reason: "commercial_body", source: classification };
  }
  if (CAR_BODIES.test(classification) && !COMMERCIAL_TYPES.test(classification)) {
    return { segment: "car", confidence: "explicit", reason: "car_body", source: classification };
  }
  if (COMMERCIAL_TYPES.test(classification)) {
    return { segment: "commercial", confidence: "explicit", reason: "commercial_type", source: classification };
  }
  if (CAR_TYPES.test(classification)) {
    return { segment: "car", confidence: "explicit", reason: "car_type", source: classification };
  }
  if (COMMERCIAL_MODEL_FALLBACK.test(title)) {
    return { segment: "commercial", confidence: "fallback", reason: "known_commercial_model", source: title };
  }
  return { segment: "unknown", confidence: "insufficient", reason: "unclassified", source: classification || title };
}

export function dealerKitVehicleBelongsToPipeline(vehicle, pipeline) {
  const segment = classifyDealerKitVehicle(vehicle).segment;
  if (pipeline === "cars") return segment === "car";
  if (pipeline === "finance" || pipeline === "rent2buy") return segment === "commercial";
  return false;
}

export function summariseDealerKitSegments(vehicles = []) {
  const summary = { commercial: 0, car: 0, unknown: 0 };
  for (const vehicle of Array.isArray(vehicles) ? vehicles : []) {
    summary[classifyDealerKitVehicle(vehicle).segment] += 1;
  }
  return summary;
}

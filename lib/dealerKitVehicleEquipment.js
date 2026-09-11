const clean = (value, limit = 10000) => String(value ?? "").trim().slice(0, limit);

function normaliseLabel(value) {
  return clean(value, 300).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function scalar(value, limit = 500) {
  if (typeof value === "string" || typeof value === "number") return clean(value, limit);
  return "";
}

function itemLabel(item) {
  if (!item || typeof item !== "object") return "";
  for (const key of ["name", "label", "title", "key", "field", "specification"]) {
    const value = scalar(item[key], 300);
    if (value) return value;
  }
  return "";
}

function itemValue(item) {
  if (!item || typeof item !== "object") return "";
  for (const key of ["value", "text", "content", "displayValue", "display_value"]) {
    const value = scalar(item[key], 500);
    if (value) return value;
  }
  return "";
}

function splitSpecificationString(item) {
  const text = scalar(item, 700);
  if (!text) return null;
  const colon = text.match(/^\s*([^:]{2,120})\s*:\s*(.+?)\s*$/);
  if (colon) return { label: colon[1], value: colon[2] };
  const dash = text.match(/^\s*([^–—-]{2,120})\s+[–—-]\s+(.+?)\s*$/);
  return dash ? { label: dash[1], value: dash[2] } : { label: text, value: "" };
}

function labelMatches(label, wanted) {
  const value = normaliseLabel(label);
  if (!value) return false;
  return wanted.some((target) => value === target || value.startsWith(`${target} `) || value.endsWith(` ${target}`));
}

export function dealerKitTechnicalValue(vehicle = {}, labels = []) {
  const wanted = labels.map(normaliseLabel).filter(Boolean);
  const technical = Array.isArray(vehicle.specifications?.technical) ? vehicle.specifications.technical : [];
  for (const item of technical) {
    if (typeof item === "string" || typeof item === "number") {
      const parsed = splitSpecificationString(item);
      if (parsed && labelMatches(parsed.label, wanted) && parsed.value) return clean(parsed.value, 500);
      continue;
    }
    const label = itemLabel(item);
    if (!labelMatches(label, wanted)) continue;
    const value = itemValue(item);
    if (value) return value;
    const parsed = splitSpecificationString(label);
    if (parsed?.value) return clean(parsed.value, 500);
  }
  return "";
}

export function dealerKitEngineSize(vehicle = {}) {
  return dealerKitTechnicalValue(vehicle, [
    "Engine Size", "Engine Capacity", "Engine Capacity CC", "Engine CC", "Cylinder Capacity", "Cubic Capacity", "CC",
  ]);
}

export function dealerKitTopSpeed(vehicle = {}) {
  return dealerKitTechnicalValue(vehicle, ["Top Speed", "Maximum Speed", "Max Speed"]);
}

export function dealerKitAcceleration(vehicle = {}) {
  return dealerKitTechnicalValue(vehicle, [
    "0-62mph", "0 - 62 mph", "0-62 mph", "0 to 62 mph", "Acceleration 0-62", "Acceleration 0 to 62", "0-60mph", "0 to 60 mph",
  ]);
}

export function dealerKitCombinedMpg(vehicle = {}) {
  return dealerKitTechnicalValue(vehicle, [
    "Combined MPG", "MPG Combined", "Fuel Consumption Combined", "Fuel Consumption (Combined)", "Combined Fuel Consumption",
  ]).replace(/\s*mpg$/i, "").trim();
}

export function dealerKitCo2(vehicle = {}) {
  const direct = dealerKitTechnicalValue(vehicle, ["CO2 Emissions", "CO2 Emission", "CO2", "CO2 g/km", "CO2 g km"]);
  if (direct) return direct;
  return [vehicle.title, vehicle.derivative].filter(Boolean).join(" ").match(/\b(\d{2,3})\s*g\s*\/\s*km\b/i)?.[1] || "";
}

export function dealerKitEuro(vehicle = {}) {
  const direct = dealerKitTechnicalValue(vehicle, ["Euro Status", "Euro", "Emission Standard", "Emissions Standard", "Euro Emissions", "Emission Class"]);
  if (direct) return direct;
  return [vehicle.title, vehicle.derivative].filter(Boolean).join(" ").match(/\bEuro\s*([4567](?:[a-z])?)\b/i)?.[1] || "";
}

function featureText(item) {
  if (typeof item === "string" || typeof item === "number") return clean(item, 700);
  if (!item || typeof item !== "object") return "";
  const name = itemLabel(item);
  const value = itemValue(item);
  if (!name) return value;
  if (!value || /^(yes|included|standard|true)$/i.test(value)) return name;
  if (normaliseLabel(name) === normaliseLabel(value)) return name;
  return `${name}: ${value}`;
}

export function dealerKitFeatures(vehicle = {}) {
  const result = [];
  const seen = new Set();
  for (const group of [vehicle.specifications?.options, vehicle.specifications?.standard]) {
    for (const item of Array.isArray(group) ? group : []) {
      const text = featureText(item);
      const key = text.toLowerCase();
      if (!text || seen.has(key)) continue;
      seen.add(key);
      result.push(text);
    }
  }
  return result;
}

const SECTION_RULES = Object.freeze([
  ["safetyAndSecurity", /\b(?:airbag|abs\b|alarm|immobil|isofix|stability|traction|seat ?belt|child lock|collision|emergency|brake assist|hill hold|security|central lock|deadlock|anti theft|anti-theft|roll over|roll-over)/i],
  ["illumination", /\b(?:headlight|headlamp|fog light|daytime running|rear light|tail light|lighting|led\b|xenon|high beam|low beam|third brake|stop lamp)/i],
  ["audioAndCommunications", /\b(?:bluetooth|dab\b|radio|audio|speaker|stereo|usb\b|aux\b|carplay|android auto|navigation|sat nav|media|telephone|touchscreen|connected|telematics|power socket)/i],
  ["driversAssistance", /\b(?:cruise|parking|camera|sensor|lane|driver assist|traffic|speed limiter|tpms|tyre pressure|trip computer|blind spot|attention|drive mode|rev counter|speedometer|gear efficiency|gear change|service indicator)/i],
  ["exterior", /\b(?:alloy|steel wheel|wheel|mirror|window|roof rail|roof rack|bumper|privacy glass|tinted|exhaust|spoiler|door handle|windscreen|windshield|wiper|tyre repair|spare wheel|side rubbing)/i],
  ["performance", /\b(?:suspension|power steering|steering assistance|power assisted steering|electric power steering|epas\b|servotronic|charging cable|limited slip|four wheel drive|4wd|awd|rear axle)/i],
]);

export function dealerKitFeatureSections(vehicle = {}) {
  const sections = {
    audioAndCommunications: [],
    driversAssistance: [],
    exterior: [],
    illumination: [],
    interior: [],
    performance: [],
    safetyAndSecurity: [],
  };
  for (const feature of dealerKitFeatures(vehicle)) {
    const rule = SECTION_RULES.find(([, pattern]) => pattern.test(feature));
    sections[rule?.[0] || "interior"].push(feature);
  }
  return Object.fromEntries(Object.entries(sections).map(([key, values]) => [key, values.join("\n")]));
}

export function dealerKitKeyVehicleInformation(vehicle = {}) {
  const bhp = Number(vehicle.bhp);
  const engine = dealerKitEngineSize(vehicle);
  const topSpeed = dealerKitTopSpeed(vehicle);
  const acceleration = dealerKitAcceleration(vehicle);
  return [
    engine ? `Engine Size\n${engine}` : "",
    topSpeed ? `Top Speed\n${topSpeed}` : "",
    acceleration ? `0-62mph\n${acceleration}` : "",
    Number.isFinite(bhp) && bhp > 0 ? `Power\n${Math.round(bhp)} bhp` : "",
  ].filter(Boolean).join("\n");
}

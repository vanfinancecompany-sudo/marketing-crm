const clean = (value, limit = 500) => String(value || "").trim().slice(0, limit);

export const DEFAULT_COVERAGE_SETTINGS = Object.freeze({
  finance_covered_nations: ["England", "Wales", "Scotland"],
  rent2buy_base_postcode: "SO40 2NN",
  rent2buy_max_radius_miles: 100,
  coverage_borderline_tolerance_miles: 10,
  coverage_distance_method: "straight_line",
});

const UK_POSTCODE = /\b(GIR\s?0AA|(?:[A-PR-UWYZ][0-9][0-9A-HJKPSTUW]?|[A-PR-UWYZ][A-HK-Y][0-9][0-9ABEHMNPRV-Y]?)\s?[0-9][ABD-HJLNP-UW-Z]{2})\b/i;
const COVERAGE_TERMS = /\b(cover(?:age|ed)?|available|area|radius|distance|miles?|nationwide|location|live|living|based|located|postcode|england|wales|scotland|northern ireland)\b/i;

export function normaliseCoverageSettings(settings = {}) {
  const nations = Array.isArray(settings.finance_covered_nations)
    ? settings.finance_covered_nations.map((item) => clean(item, 50)).filter(Boolean)
    : [];
  const configuredRadius = Number(settings.rent2buy_max_radius_miles);
  const configuredTolerance = Number(settings.coverage_borderline_tolerance_miles);
  return {
    finance_covered_nations: nations.length ? nations : [...DEFAULT_COVERAGE_SETTINGS.finance_covered_nations],
    rent2buy_base_postcode: clean(settings.rent2buy_base_postcode, 20).toUpperCase() || DEFAULT_COVERAGE_SETTINGS.rent2buy_base_postcode,
    rent2buy_max_radius_miles: Number.isFinite(configuredRadius) && configuredRadius > 0 ? configuredRadius : DEFAULT_COVERAGE_SETTINGS.rent2buy_max_radius_miles,
    coverage_borderline_tolerance_miles: Number.isFinite(configuredTolerance) && configuredTolerance >= 0 ? configuredTolerance : DEFAULT_COVERAGE_SETTINGS.coverage_borderline_tolerance_miles,
    coverage_distance_method: settings.coverage_distance_method === "straight_line" ? "straight_line" : DEFAULT_COVERAGE_SETTINGS.coverage_distance_method,
  };
}

export function isCoverageQuestion(question) {
  const text = clean(question, 3000);
  return COVERAGE_TERMS.test(text) || UK_POSTCODE.test(text);
}

export function extractUkLocation(question) {
  const text = clean(question, 3000);
  const postcode = text.match(UK_POSTCODE)?.[0];
  if (postcode) return { query: postcode.toUpperCase().replace(/\s+/g, " "), type: "full_postcode" };
  const patterns = [
    /\b(?:live|living|based|located)\s+(?:in|near|at)\s+([^?.!,;]+)/i,
    /\b(?:available|cover(?:ed)?|deliver)\s+(?:in|near|to)\s+([^?.!,;]+)/i,
    /\b(?:from|near|in|about)\s+([^?.!,;]+)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = clean(match?.[1], 120).replace(/\s+(?:and|but|because|with|for|please)\b.*$/i, "").trim();
    if (candidate && !/^(the|your|our|this|that)\b/i.test(candidate)) return { query: candidate, type: "town_or_city" };
  }
  return null;
}

export function haversineMiles(from, to) {
  const radians = (degrees) => Number(degrees) * Math.PI / 180;
  const earthRadiusMiles = 3958.7613;
  const lat1 = radians(from.latitude);
  const lat2 = radians(to.latitude);
  const deltaLat = radians(Number(to.latitude) - Number(from.latitude));
  const deltaLon = radians(Number(to.longitude) - Number(from.longitude));
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function classifyRent2BuyDistance(distanceMiles, locationType, settings = {}) {
  const rules = normaliseCoverageSettings(settings);
  const distance = Number(distanceMiles);
  const lower = rules.rent2buy_max_radius_miles - rules.coverage_borderline_tolerance_miles;
  const upper = rules.rent2buy_max_radius_miles + rules.coverage_borderline_tolerance_miles;
  if (!Number.isFinite(distance)) return { coverage_result: "unresolved", certainty: "unresolved" };
  if (distance >= lower && distance <= upper) return { coverage_result: "borderline_manual_confirmation", certainty: "borderline" };
  return {
    coverage_result: distance < lower ? "within_normal_area" : "outside_normal_area",
    certainty: locationType === "full_postcode" ? "confirmed" : "indicative",
  };
}

export function detectFinanceNation(question) {
  const text = clean(question, 3000).toLowerCase();
  if (/\bnorthern ireland\b|\bni\b/.test(text)) return "Northern Ireland";
  if (/\bengland\b/.test(text)) return "England";
  if (/\bwales\b|\bwelsh\b/.test(text)) return "Wales";
  if (/\bscotland\b|\bscottish\b/.test(text)) return "Scotland";
  return "";
}

export function buildFinanceCoverageEvidence(question, settings = {}) {
  if (!isCoverageQuestion(question)) return null;
  const rules = normaliseCoverageSettings(settings);
  const nation = detectFinanceNation(question);
  const covered = nation ? rules.finance_covered_nations.some((item) => item.toLowerCase() === nation.toLowerCase()) : null;
  const list = rules.finance_covered_nations.join(", ");
  const passage = nation
    ? `Approved Finance coverage rule: ${nation} is ${covered ? "within" : "not within"} the normal Finance coverage area. Finance is available nationally across ${list}.`
    : `Approved Finance coverage rule: Finance is available nationally across ${list}. Northern Ireland is not included unless it is added explicitly to the approved settings.`;
  return {
    source: { type: "coverage_rule", source_id: "coverage:finance", title: "Approved Finance coverage", heading: nation || "Covered nations", passage, public_url: "", score: 1000, product: "finance" },
    diagnostics: {
      detected_location: nation || null,
      resolved_postcode: null,
      resolved_coordinates: null,
      distance_miles: null,
      calculation_type: "approved_nation_rule",
      base_postcode: null,
      coverage_result: covered == null ? "rule_summary" : covered ? "covered" : "not_covered",
      certainty: "confirmed",
    },
  };
}

export function buildRent2BuyCoverageEvidence({ location, resolved, base, settings = {}, error = "" } = {}) {
  const rules = normaliseCoverageSettings(settings);
  if (!location || !resolved || !base) {
    const passage = `Approved Rent2Buy coverage rule: applicants normally need to live within ${rules.rent2buy_max_radius_miles} miles of ${rules.rent2buy_base_postcode}. The customer's location could not be resolved, so do not guess or estimate distance; ask for their full home postcode before confirming coverage.${error ? " The location service was unavailable or returned no match." : ""}`;
    return {
      source: { type: "coverage_rule", source_id: "coverage:rent2buy", title: "Approved Rent2Buy coverage", heading: "Unresolved location", passage, public_url: "", score: 1000, product: "rent2buy" },
      diagnostics: { detected_location: location?.query || null, resolved_postcode: null, resolved_coordinates: null, distance_miles: null, calculation_type: rules.coverage_distance_method, base_postcode: rules.rent2buy_base_postcode, coverage_result: "unresolved", certainty: "unresolved" },
    };
  }
  const distance = haversineMiles(base, resolved);
  const rounded = Number(distance.toFixed(1));
  const classification = classifyRent2BuyDistance(rounded, location.type, rules);
  const indicative = location.type === "town_or_city";
  const outcome = classification.coverage_result === "borderline_manual_confirmation"
    ? `This is within the ${rules.rent2buy_max_radius_miles - rules.coverage_borderline_tolerance_miles}–${rules.rent2buy_max_radius_miles + rules.coverage_borderline_tolerance_miles} mile borderline band and needs manual confirmation.`
    : classification.coverage_result === "within_normal_area"
      ? `This is within the normal ${rules.rent2buy_max_radius_miles}-mile area.`
      : `This is outside the normal ${rules.rent2buy_max_radius_miles}-mile area.`;
  const confirmation = indicative ? "This town/city result is indicative only; ask for the customer's full home postcode before confirming." : "This result is calculated from the supplied full postcode.";
  return {
    source: { type: "coverage_rule", source_id: "coverage:rent2buy", title: "Approved Rent2Buy coverage", heading: resolved.label || location.query, passage: `Approved Rent2Buy coverage rule: applicants normally need to live within ${rules.rent2buy_max_radius_miles} miles of ${rules.rent2buy_base_postcode}. The server-calculated straight-line distance for ${resolved.label || location.query} is ${rounded} miles. ${outcome} ${confirmation} Do not mention Finance.`, public_url: "", score: 1000, product: "rent2buy" },
    diagnostics: {
      detected_location: location.query,
      resolved_postcode: resolved.postcode || resolved.outcode || null,
      resolved_coordinates: { latitude: resolved.latitude, longitude: resolved.longitude },
      distance_miles: rounded,
      calculation_type: rules.coverage_distance_method,
      base_postcode: rules.rent2buy_base_postcode,
      coverage_result: classification.coverage_result,
      certainty: classification.certainty,
    },
  };
}

export function detectCoverageConflicts(coverage, corpus = [], settings = {}) {
  if (!coverage?.source) return [];
  const rules = normaliseCoverageSettings(settings);
  const detectedLocation = clean(coverage.diagnostics?.detected_location).toLowerCase();
  return corpus.filter((source) => {
    const text = clean(`${source.title} ${source.heading} ${source.passage}`, 20000).toLowerCase();
    if (!text) return false;
    if (coverage.source.product === "finance") {
      const claimsUkWide = /(?:cover|available|nationwide).{0,60}(?:whole|all|across).{0,20}(?:uk|united kingdom)/i.test(text);
      const claimsNorthernIreland = /(?:cover|available|include|deliver).{0,50}northern ireland/i.test(text);
      const excludesCoveredNation = rules.finance_covered_nations.some((nation) => new RegExp(`(?:not|exclude|outside).{0,40}${nation}`, "i").test(text));
      return claimsUkWide || claimsNorthernIreland || excludesCoveredNation;
    }
    const statedRadii = [...text.matchAll(/\b(\d{2,3}(?:\.\d+)?)\s*(?:-| )?miles?\b/g)].map((match) => Number(match[1]));
    if (/\b(?:cover|coverage|available|area|radius|distance|live|based|location)\b/i.test(text) && statedRadii.some((radius) => radius !== rules.rent2buy_max_radius_miles && radius > 20)) return true;
    if (!detectedLocation || !text.includes(detectedLocation)) return false;
    const result = coverage.diagnostics?.coverage_result;
    if (result === "within_normal_area") return /\b(outside|not (?:available|covered|eligible)|too far)\b/i.test(text);
    if (result === "outside_normal_area") return /\b(within|available|covered|eligible|in range)\b/i.test(text);
    return false;
  }).map((source) => ({ source_id: source.source_id, title: source.title, heading: source.heading }));
}

export function coverageConflictDetected(modelConflict, conflictingSources = []) {
  return Boolean(modelConflict || conflictingSources.length);
}

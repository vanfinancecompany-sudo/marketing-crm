import { normaliseCoverageSettings } from "./productCoverageRules.js";

const clean = (value, limit = 500) => String(value || "").trim().slice(0, limit);

export function deterministicRent2BuyCoverageReply(coverage, settings = {}) {
  if (!coverage?.source || coverage.source.product !== "rent2buy") return "";
  if (!String(coverage.source.source_id || "").startsWith("coverage:rent2buy")) return "";

  const rules = normaliseCoverageSettings(settings);
  const diagnostics = coverage.diagnostics || {};
  const result = diagnostics.coverage_result;
  const certainty = diagnostics.certainty;
  const distance = Number(diagnostics.distance_miles);
  const base = clean(diagnostics.base_postcode, 30) || rules.rent2buy_base_postcode;
  const label = clean(coverage.source.heading || diagnostics.detected_location, 120) || "That location";

  if (result === "invalid_postcode") {
    return `That looks like a postcode, but I can’t verify it in that format. Please check and resend your full home postcode, for example ${base}, and I’ll check the distance.`;
  }

  if (!Number.isFinite(distance)) {
    if (diagnostics.detected_location) {
      return `I can’t verify ${clean(diagnostics.detected_location, 120)} right now, so I don’t want to guess the distance. Please check the location or send your full home postcode and I’ll try again.`;
    }
    return `Rent2Buy applicants normally need to live within ${rules.rent2buy_max_radius_miles} miles of ${base}. Send me your full home postcode and I’ll check the distance for you.`;
  }

  const distanceText = Number.isInteger(distance) ? String(distance) : distance.toFixed(1);
  const distanceSentence = `${label} is approximately ${distanceText} miles in a straight line from ${base}`;

  if (certainty === "indicative") {
    if (result === "within_normal_area") {
      return `${distanceSentence}, so it appears to be within our normal ${rules.rent2buy_max_radius_miles}-mile Rent2Buy area. That’s an indicative town/city result — send me your full home postcode and I’ll confirm it.`;
    }
    if (result === "outside_normal_area") {
      return `${distanceSentence}, so it appears to be outside our normal ${rules.rent2buy_max_radius_miles}-mile Rent2Buy area. That’s an indicative town/city result — send me your full home postcode and I’ll confirm it.`;
    }
    if (result === "borderline_manual_confirmation") {
      const lower = rules.rent2buy_max_radius_miles - rules.coverage_borderline_tolerance_miles;
      const upper = rules.rent2buy_max_radius_miles + rules.coverage_borderline_tolerance_miles;
      return `${distanceSentence}. That falls in our ${lower}–${upper} mile borderline band, so we’d need the full home postcode and manual confirmation before confirming coverage.`;
    }
  }

  if (result === "within_normal_area") {
    return `${distanceSentence}, so you’re within our normal ${rules.rent2buy_max_radius_miles}-mile Rent2Buy area.`;
  }
  if (result === "outside_normal_area") {
    return `Unfortunately, ${distanceSentence.toLowerCase()}, so you’re outside our normal ${rules.rent2buy_max_radius_miles}-mile Rent2Buy area.`;
  }
  if (result === "borderline_manual_confirmation") {
    const lower = rules.rent2buy_max_radius_miles - rules.coverage_borderline_tolerance_miles;
    const upper = rules.rent2buy_max_radius_miles + rules.coverage_borderline_tolerance_miles;
    return `${distanceSentence}. That falls in our ${lower}–${upper} mile borderline band, so we need manual confirmation before confirming Rent2Buy coverage.`;
  }

  return "";
}

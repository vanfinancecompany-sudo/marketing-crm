const VALID_LIFECYCLE = new Map([
  ["reserved", "reserved"],
  ["deposit_taken", "reserved"],
  ["sold", "unavailable"],
  ["awaiting_delivery", "unavailable"],
  ["removed_from_dealerkit", "unavailable"],
]);
const HIDDEN = new Set(["hidden", "ignored", "never_show_again", "not_listing_spec", "not_listing_price", "not_listing_mileage"]);
const PIPELINES = new Set(["finance", "rent2buy", "cars"]);

export function publicRegistration(value) {
  const registration = String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{5,8}$/.test(registration) && /[A-Z]/.test(registration) && /\d/.test(registration) ? registration : "";
}

export function publicStatusOf(value) {
  return VALID_LIFECYCLE.get(String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_")) || null;
}

export function projectPublicDealerKitAvailability(sourceRows = [], workflowRows = [], { now = Date.now(), maxAgeDays = 14 } = {}) {
  const nowMs = Number(now);
  const cutoff = nowMs - Math.max(1, Number(maxAgeDays) || 14) * 86400000;
  const hidden = new Map();
  for (const action of workflowRows) {
    const registration = publicRegistration(action?.registration);
    const pipeline = String(action?.pipeline || "").toLowerCase();
    if (!registration || !PIPELINES.has(pipeline)) continue;
    if (!HIDDEN.has(String(action.workflow_status || "").trim().toLowerCase())) continue;
    if (!hidden.has(registration)) hidden.set(registration, new Set());
    hidden.get(registration).add(pipeline);
  }
  const latest = new Map();
  for (const source of sourceRows) {
    const registration = publicRegistration(source?.registration);
    const state = publicStatusOf(source?.source_status || source?.last_status);
    const seen = Date.parse(source?.last_seen_at || "");
    if (!registration || !state || !Number.isFinite(seen) || seen < cutoff || seen > nowMs + 60000) continue;
    if (!String(source.supplier_stock_id || "").trim()) continue;
    const previous = latest.get(registration);
    if (!previous || seen > previous.seen) {
      latest.set(registration, { registration, status: state, seen, hidden: [...(hidden.get(registration) || [])].sort() });
    }
  }
  return [...latest.values()].map(({ seen, ...value }) => value).sort((a, b) => a.registration.localeCompare(b.registration));
}

// Turns the verified, normalised vehicle on the customer's current page into
// evidence Ask Me can quote and cite. Only fields that are present are listed;
// nothing is inferred. Listing figures are labelled as advertised illustrations.

const clean = (value, limit = 7000) => String(value ?? "").trim().slice(0, limit);

const SPEC_LABELS = {
  engine_size: "Engine size",
  power: "Power",
  payload: "Payload",
  wheelbase: "Wheelbase",
  doors: "Doors",
  seats: "Seats",
  euro_standard: "Euro standard",
  mpg: "MPG",
};

function hasVehicle(vehicle = {}) {
  return Boolean(clean(vehicle.registration, 20) || clean(vehicle.title, 200));
}

export function vehicleContextText(vehicle = {}, product = "finance") {
  if (!hasVehicle(vehicle)) return "";
  const lines = [];
  const add = (label, value) => { const text = clean(value, 400); if (text) lines.push(`${label}: ${text}`); };
  add("Vehicle", vehicle.title);
  add("Registration", vehicle.registration);
  add("Type", vehicle.vehicle_kind);
  add("Make", vehicle.make);
  add("Model", vehicle.model);
  add("Derivative", vehicle.derivative);
  add("Year", vehicle.year);
  add("Mileage", vehicle.mileage);
  add("Fuel", vehicle.fuel);
  add("Transmission", vehicle.transmission);
  add("Body", vehicle.body_type);
  add("Colour", vehicle.colour);
  for (const [key, label] of Object.entries(SPEC_LABELS)) add(label, vehicle.public_specifications?.[key]);
  const status = clean(vehicle.stock_status, 40).toLowerCase();
  if (status === "reserved") lines.push("Availability: this vehicle is currently reserved and cannot be applied for.");
  else if (status === "unavailable" || status === "sold") lines.push("Availability: this vehicle is no longer available.");
  else if (status) lines.push("Availability: shown as available on the website (subject to confirmation).");
  add("VAT", vehicle.vat_status);
  const pricing = vehicle.pricing || {};
  if (product === "finance") {
    add("Advertised retail price", pricing.finance_retail_vat);
    add("Advertised finance illustration", pricing.finance_monthly ? `From ${clean(pricing.finance_monthly, 60).replace(/^from\s+/i, "")} per month (an illustration, not a confirmed payment)` : "");
  } else {
    add("Advertised Rent2Buy initial rental (listing illustration)", pricing.rent2buy_initial);
    add("Advertised Rent2Buy monthly rental (listing illustration)", pricing.rent2buy_monthly);
    add("Advertised term (listing illustration)", vehicle.term_months ? `${vehicle.term_months} months` : "");
    add("Final purchase option", vehicle.final_purchase_option);
  }
  const features = Array.isArray(vehicle.important_features) ? vehicle.important_features.filter(Boolean).slice(0, 12) : [];
  if (features.length) add("Key features", features.join("; "));
  add("Specification (as listed)", clean(vehicle.specification, 1500).replace(/\s*\n\s*/g, "; "));
  add("Listing description", clean(vehicle.description || vehicle.short_description, 1200).replace(/\s*\n\s*/g, " "));
  add("Apply link for this vehicle", vehicle.apply_link);
  return lines.join("\n");
}

export function vehicleContextSource(vehicle = {}, product = "finance") {
  const passage = vehicleContextText(vehicle, product);
  if (!passage) return null;
  return {
    source_id: `askme-vehicle-${clean(vehicle.registration, 20) || "page"}`,
    type: "business_brain",
    product: product === "rent2buy" ? "Rent2Buy" : "Finance",
    title: `Vehicle on the customer's current page${vehicle.title ? ` — ${clean(vehicle.title, 120)}` : ""}`,
    heading: "Verified live vehicle details",
    passage,
  };
}

const clean = (value, limit = 500) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, limit);

export function normalizeRent2BuyRegistration(value) {
  const registration = clean(value, 20).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return registration.length >= 5 && registration.length <= 8 && /[A-Z]/.test(registration) && /\d/.test(registration)
    ? registration
    : "";
}

function modelYear(value) {
  const match = clean(value, 30).match(/\b(19|20)\d{2}\b/);
  return match?.[0] || "";
}

export function buildRent2BuyVehicleSeoTitle({ titleText, year } = {}, maxLength = 68) {
  const vehicle = clean(titleText, 180);
  if (!vehicle) return "";
  const yearText = modelYear(year);
  const prefix = yearText && !vehicle.startsWith(yearText) ? `${yearText} ` : "";
  const suffix = " | Rent2Buy Vans";
  const available = Math.max(20, maxLength - suffix.length - prefix.length);
  let label = vehicle;
  if (label.length > available) {
    label = label.slice(0, available + 1).replace(/\s+\S*$/, "").replace(/[\s,;:/-]+$/, "");
    if (label.length < Math.min(20, vehicle.length)) label = vehicle.slice(0, available).trim();
  }
  return `${prefix}${label}${suffix}`.trim();
}

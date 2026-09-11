const cleanRegistration = (value) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function publishedPrice(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export function mergeCarsPublishedListingVehicles(supportVehicles = [], publishedVehicles = []) {
  const supportByRegistration = new Map();
  for (const vehicle of Array.isArray(supportVehicles) ? supportVehicles : []) {
    const registration = cleanRegistration(vehicle?.reg || vehicle?.registration || vehicle?.title || vehicle?.name);
    if (registration && !supportByRegistration.has(registration)) supportByRegistration.set(registration, vehicle);
  }

  const merged = [];
  const seen = new Set();
  for (const liveVehicle of Array.isArray(publishedVehicles) ? publishedVehicles : []) {
    const registration = cleanRegistration(liveVehicle?.registration || liveVehicle?.reg || liveVehicle?.title);
    if (!registration || seen.has(registration)) continue;
    seen.add(registration);

    const support = supportByRegistration.get(registration) || {};
    const livePrice = publishedPrice(liveVehicle?.price);
    merged.push({
      ...support,
      ...liveVehicle,
      reg: registration,
      registration,
      // CARFINANCE is the authority for the currently published Cars price.
      // If Wix does not expose a safe price, fail closed instead of falling back
      // to a stale Marketing CRM value that could create a false difference.
      price: livePrice,
      title: liveVehicle?.title || support?.title || support?.name || registration,
      image: support?.image || support?.picture || support?.imageUrl || support?.image_url || liveVehicle?.image || "",
      picture: support?.picture || support?.image || support?.imageUrl || support?.image_url || liveVehicle?.picture || "",
      weblink: support?.weblink || support?.webLink || support?.link || liveVehicle?.weblink || liveVehicle?.webLink || "",
    });
  }

  return merged;
}

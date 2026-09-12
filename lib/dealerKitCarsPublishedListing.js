const cleanRegistration = (value) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function publishedPrice(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.]/g, ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function supportByRegistration(vehicles = []) {
  const result = new Map();
  for (const vehicle of Array.isArray(vehicles) ? vehicles : []) {
    const registration = cleanRegistration(vehicle?.reg || vehicle?.registration || vehicle?.title || vehicle?.name);
    if (registration && !result.has(registration)) result.set(registration, vehicle);
  }
  return result;
}

export function mergePublishedListingVehicles(pipelineValue, supportVehicles = [], publishedVehicles = []) {
  const pipeline = String(pipelineValue || "").trim().toLowerCase();
  const supportByReg = supportByRegistration(supportVehicles);
  const merged = [];
  const seen = new Set();

  for (const liveVehicle of Array.isArray(publishedVehicles) ? publishedVehicles : []) {
    const registration = cleanRegistration(liveVehicle?.registration || liveVehicle?.reg || liveVehicle?.title);
    if (!registration || seen.has(registration)) continue;
    seen.add(registration);

    const support = supportByReg.get(registration) || {};
    const base = {
      ...support,
      ...liveVehicle,
      reg: registration,
      registration,
      title: liveVehicle?.title || support?.title || support?.name || registration,
      image: support?.image || support?.picture || support?.imageUrl || support?.image_url || liveVehicle?.image || "",
      picture: support?.picture || support?.image || support?.imageUrl || support?.image_url || liveVehicle?.picture || "",
      weblink: support?.weblink || support?.webLink || support?.link || liveVehicle?.weblink || liveVehicle?.webLink || "",
      link: support?.link || support?.weblink || support?.webLink || liveVehicle?.link || liveVehicle?.weblink || liveVehicle?.webLink || "",
      publishedSource: "wix",
    };

    if (pipeline === "rent2buy") {
      // The live ALLRENT2BUYVANS monthly value is authoritative for comparison.
      // Never fall back to a stale rent_vehicles.monthly value when Wix is missing
      // or malformed, otherwise a corrected price can reappear after refresh.
      base.monthly = publishedPrice(liveVehicle?.monthly);
      base.price = support?.price || support?.initialRental || "";
      base.initialRental = support?.initialRental || support?.price || "";
    } else {
      // Finance and Cars compare DealerKit cash price to the currently published
      // Wix listing price. Missing Wix price fails closed rather than using CRM.
      base.price = publishedPrice(liveVehicle?.price);
      base.monthly = support?.monthly || support?.salePrice || liveVehicle?.monthly || "";
    }

    base.vat = liveVehicle?.vat || support?.vat || support?.vatText || support?.vat_text || "";
    merged.push(base);
  }

  return merged;
}

export function mergeCarsPublishedListingVehicles(supportVehicles = [], publishedVehicles = []) {
  return mergePublishedListingVehicles("cars", supportVehicles, publishedVehicles);
}

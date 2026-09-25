import { timingSafeEqual } from "node:crypto";

const ACCESS_HEADER = "x-marketing-customer-database-key";
const META_URL = "https://api.dealerkit.uk/meta-catalogue";

function authorised(request, environment) {
  const expected = environment.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const supplied = request.headers?.[ACCESS_HEADER];
  if (typeof expected !== "string" || !expected || typeof supplied !== "string") return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function scalar(value) {
  if (typeof value === "string") return value.trim().slice(0, 300) || null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return null;
}

function pick(record, names) {
  for (const name of names) {
    const value = scalar(record?.[name]);
    if (value !== null) return value;
  }
  return null;
}

function url(value) {
  const candidate = scalar(value);
  if (typeof candidate !== "string") return null;
  try {
    const parsed = new URL(candidate);
    return ["https:", "http:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function imageSummary(vehicle) {
  const images = vehicle.images ?? vehicle.image_urls ?? vehicle.imageUrls ?? vehicle.photos ?? vehicle.media;
  const list = Array.isArray(images) ? images : Array.isArray(images?.images) ? images.images : [];
  const first = list[0];
  return {
    imageUrl: url(pick(vehicle, ["image_url", "imageUrl", "primary_image_url", "primaryImageUrl", "thumbnail_url", "thumbnailUrl"]))
      ?? url(typeof first === "string" ? first : pick(first, ["url", "image_url", "imageUrl", "src"])),
    imageCount: list.length || pick(vehicle, ["image_count", "imageCount", "photo_count", "photoCount"]) || 0,
  };
}

function fieldNames(value) {
  if (Array.isArray(value)) return [...new Set(value.flatMap((item) => Object.keys(object(item) ?? {})))].sort();
  return Object.keys(object(value) ?? {}).sort();
}

function advertisingFlags(vehicle) {
  return Object.fromEntries(Object.entries(vehicle).flatMap(([key, value]) => {
    if (!/^(?:is_?|has_?)?(?:advertis(?:ed|ing)?|published|live)(?:_?(?:status|flag|enabled|online))?$/i.test(key)) return [];
    if (typeof value === "boolean") return [[key, value]];
    if (value === 0 || value === 1) return [[key, value]];
    if (typeof value === "string" && /^(?:true|false|yes|no|active|inactive|on|off|live|published|unpublished)$/i.test(value.trim())) return [[key, value.trim()]];
    return [];
  }));
}

function vehicleSummary(vehicle) {
  return {
    registration: pick(vehicle, ["registration", "reg", "vrm", "registration_number", "registrationNumber"]),
    make: pick(vehicle, ["make", "manufacturer"]),
    model: pick(vehicle, ["model"]),
    derivative: pick(vehicle, ["derivative", "variant", "trim"]),
    title: pick(vehicle, ["title", "name"]),
    price: pick(vehicle, ["price", "advertised_price", "advertisedPrice", "retail_price", "retailPrice"]),
    vat: pick(vehicle, ["vat", "vat_status", "vatStatus", "vat_qualifying", "vatQualifying"]),
    mileage: pick(vehicle, ["mileage", "miles"]),
    vehicleUrl: url(pick(vehicle, ["vehicle_url", "vehicleUrl", "url", "advert_url", "advertUrl", "website_url", "websiteUrl"])),
    ...imageSummary(vehicle),
    branch: pick(vehicle, ["branch", "branch_name", "branchName"]),
    site: pick(vehicle, ["site", "site_name", "siteName"]),
    location: pick(vehicle, ["location", "location_name", "locationName"]),
    availability: pick(vehicle, ["availability", "availability_status", "availabilityStatus"]),
    status: pick(vehicle, ["status", "stock_status", "stockStatus"]),
    advertisingFlags: advertisingFlags(vehicle),
    featureFieldNames: fieldNames(vehicle.features ?? vehicle.feature ?? vehicle.options),
    specificationFieldNames: fieldNames(vehicle.specifications ?? vehicle.specification ?? vehicle.specs),
  };
}

function findVehicles(payload) {
  if (Array.isArray(payload)) return { vehicles: payload, path: "$" };
  const root = object(payload);
  if (!root) return { vehicles: [], path: null };
  for (const key of ["vehicles", "stock", "items", "results", "data", "catalogue", "catalog"]) {
    if (Array.isArray(root[key])) return { vehicles: root[key], path: key };
    const nested = object(root[key]);
    if (nested) {
      for (const child of ["vehicles", "stock", "items", "results", "data"]) {
        if (Array.isArray(nested[child])) return { vehicles: nested[child], path: `${key}.${child}` };
      }
    }
  }
  return { vehicles: [], path: null };
}

function unique(vehicles, names) {
  return [...new Set(vehicles.flatMap((vehicle) => names.map((name) => scalar(vehicle?.[name]))).filter((value) => value !== null))]
    .sort((a, b) => String(a).localeCompare(String(b)));
}

export function summariseMetaCatalogue(payload) {
  const { vehicles, path } = findVehicles(payload);
  const validVehicles = vehicles.filter(object);
  const fieldNamesAvailable = [...new Set(validVehicles.flatMap((vehicle) => Object.keys(vehicle)))].sort();
  const representative = [];
  const seen = new Set();
  for (const vehicle of validVehicles) {
    const summary = vehicleSummary(vehicle);
    const diversityKey = `${summary.branch}|${summary.site}|${summary.location}|${summary.availability}|${summary.status}`;
    if (seen.has(diversityKey)) continue;
    seen.add(diversityKey);
    representative.push(summary);
    if (representative.length === 5) break;
  }
  for (const vehicle of validVehicles) {
    if (representative.length === 5) break;
    const summary = vehicleSummary(vehicle);
    if (!representative.some((item) => item.registration && item.registration === summary.registration)) representative.push(summary);
  }
  return {
    totalVehicleCount: validVehicles.length,
    responseShape: {
      type: Array.isArray(payload) ? "array" : object(payload) ? "object" : typeof payload,
      topLevelFields: Object.keys(object(payload) ?? {}).sort(),
      vehiclesPath: path,
    },
    vehicleFieldNames: fieldNamesAvailable,
    representativeRecords: representative,
    branchLocationValues: unique(validVehicles, ["branch", "branch_name", "branchName", "site", "site_name", "siteName", "location", "location_name", "locationName"]),
    availabilityStatusValues: unique(validVehicles, ["availability", "availability_status", "availabilityStatus", "status", "stock_status", "stockStatus"]),
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed." });
  if (process.env.VERCEL_ENV !== "preview") return response.status(404).json({ ok: false, error: "Not found." });
  if (!authorised(request, process.env)) return response.status(401).json({ ok: false, error: "Marketing CRM access is required." });

  const username = process.env.DEALERKIT_META_USERNAME;
  const password = process.env.DEALERKIT_META_PASSWORD;
  if (!username || !password) return response.status(503).json({ ok: false, error: "Catalogue credentials are unavailable." });

  try {
    const upstream = await fetch(META_URL, {
      method: "GET",
      headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(25000),
    });
    if (!upstream.ok) return response.status(502).json({ ok: false, error: "Catalogue request failed.", upstreamStatus: upstream.status });
    const payload = await upstream.json();
    const summary = summariseMetaCatalogue(payload);
    if (!summary.responseShape.vehiclesPath) return response.status(502).json({ ok: false, error: "Catalogue vehicle array was not found.", responseShape: summary.responseShape });
    return response.status(200).json({ ok: true, readOnly: true, summary });
  } catch {
    return response.status(502).json({ ok: false, error: "Catalogue request failed." });
  }
}


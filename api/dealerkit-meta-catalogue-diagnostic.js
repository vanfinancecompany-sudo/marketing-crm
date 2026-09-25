import { timingSafeEqual } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { parse as parseDelimited } from "csv-parse/sync";

const ACCESS_HEADER = "x-marketing-customer-database-key";
const META_URL = "https://api.dealerkit.uk/meta-catalogue";
const MAX_BODY_BYTES = 25 * 1024 * 1024;

function canonicalKey(value) {
  return String(value).replace(/^.*:/, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

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
  if (object(value)) return scalar(value["#text"] ?? value.value ?? value.amount);
  if (typeof value === "string") return value.trim().slice(0, 300) || null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return null;
}

function pick(record, names) {
  const wanted = new Set(names.map(canonicalKey));
  for (const [key, raw] of Object.entries(object(record) ?? {})) {
    if (!wanted.has(canonicalKey(key))) continue;
    const value = scalar(raw);
    if (value !== null) return value;
  }
  return null;
}

function literal(record, key) {
  return scalar((object(record) ?? {})[key]);
}

function firstLiteral(record, keys) {
  for (const key of keys) {
    const value = literal(record, key);
    if (value !== null) return value;
  }
  return null;
}

function countBy(values) {
  const counts = new Map();
  for (const value of values) {
    const key = value === null || value === undefined || value === "" ? "(blank)" : String(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
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
  const images = vehicle.images ?? vehicle.image_urls ?? vehicle.imageUrls ?? vehicle.photos ?? vehicle.media ?? vehicle.image;
  const nestedImages = object(images) ? Object.entries(images).find(([key]) => ["image", "images", "photo", "photos"].includes(canonicalKey(key)))?.[1] : null;
  const list = Array.isArray(images) ? images : Array.isArray(nestedImages) ? nestedImages : nestedImages ? [nestedImages] : [];
  const first = list[0];
  const primary = pick(vehicle, ["image_url", "imageUrl", "primary_image_url", "primaryImageUrl", "thumbnail_url", "thumbnailUrl", "image_link", "imageLink", "image"]);
  const additional = Object.entries(vehicle).find(([key]) => canonicalKey(key) === "additionalimagelink")?.[1];
  const additionalCount = Array.isArray(additional) ? additional.length : additional ? 1 : 0;
  const firstImage = typeof first === "string" ? first : pick(first, ["url", "image_url", "imageUrl", "src", "link"]);
  return {
    imageUrl: url(primary) ?? url(firstImage),
    imageCount: list.length || (primary ? 1 + additionalCount : additionalCount) || pick(vehicle, ["image_count", "imageCount", "photo_count", "photoCount"]) || 0,
  };
}

function fieldNames(value) {
  if (Array.isArray(value)) return [...new Set(value.flatMap((item) => Object.keys(object(item) ?? {})))].sort();
  return Object.keys(object(value) ?? {}).sort();
}

function advertisingFlags(vehicle) {
  return Object.fromEntries(Object.entries(vehicle).flatMap(([key, value]) => {
    if (!/^(?:is|has)?(?:advertis(?:ed|ing)?|published|live)(?:(?:status|flag|enabled|online))?$/.test(canonicalKey(key))) return [];
    if (typeof value === "boolean") return [[key, value]];
    if (value === 0 || value === 1) return [[key, value]];
    if (typeof value === "string" && /^(?:true|false|yes|no|active|inactive|on|off|live|published|unpublished)$/i.test(value.trim())) return [[key, value.trim()]];
    return [];
  }));
}

function vehicleSummary(vehicle) {
  const mileageValue = firstLiteral(vehicle, ["mileage.value", "mileage"]);
  const mileageUnit = firstLiteral(vehicle, ["mileage.unit"]);
  const literalImage = firstLiteral(vehicle, ["image[0].url", "image.0.url", "image_url", "image"]);
  return {
    vehicleId: firstLiteral(vehicle, ["vehicle_id", "vehicleId"]),
    vin: firstLiteral(vehicle, ["vin"]),
    registration: pick(vehicle, ["registration", "reg", "vrm", "registration_number", "registrationNumber", "registrationMark"]),
    make: pick(vehicle, ["make", "manufacturer", "vehicleMake"]),
    model: pick(vehicle, ["model"]),
    derivative: pick(vehicle, ["derivative", "variant", "trim"]),
    title: pick(vehicle, ["title", "name"]),
    year: pick(vehicle, ["year"]),
    price: pick(vehicle, ["price", "advertised_price", "advertisedPrice", "retail_price", "retailPrice", "salePrice"]),
    vat: pick(vehicle, ["vat", "vat_status", "vatStatus", "vat_qualifying", "vatQualifying"]),
    mileage: mileageValue,
    mileageUnit,
    vehicleUrl: url(pick(vehicle, ["vehicle_url", "vehicleUrl", "url", "advert_url", "advertUrl", "website_url", "websiteUrl", "link"])),
    imageUrl: url(literalImage) ?? imageSummary(vehicle).imageUrl,
    address1: firstLiteral(vehicle, ["address.address1", "address1"]),
    address2: firstLiteral(vehicle, ["address.address2", "address2"]),
    city: firstLiteral(vehicle, ["address.city", "city"]),
    region: firstLiteral(vehicle, ["address.region", "region"]),
    country: firstLiteral(vehicle, ["address.country", "country"]),
    availability: pick(vehicle, ["availability", "availability_status", "availabilityStatus"]),
    status: pick(vehicle, ["status", "stock_status", "stockStatus"]),
    stateOfVehicle: firstLiteral(vehicle, ["state_of_vehicle", "stateOfVehicle"]),
    bodyStyle: firstLiteral(vehicle, ["body_style", "bodyStyle"]),
    descriptionPresent: Boolean(firstLiteral(vehicle, ["description"])),
    advertisingFlags: advertisingFlags(vehicle),
    featureFieldNames: fieldNames(vehicle.features ?? vehicle.feature ?? vehicle.options),
    specificationFieldNames: fieldNames(vehicle.specifications ?? vehicle.specification ?? vehicle.specs),
  };
}

function findVehicles(payload) {
  if (Array.isArray(payload)) return { vehicles: payload, path: "$" };
  const candidates = [];
  const recordNames = new Set(["vehicle", "vehicles", "item", "items", "entry", "entries", "record", "records", "product", "products", "advert", "adverts", "listing", "listings", "stock"]);
  const vehicleFields = new Set(["registration", "registrationnumber", "vrm", "make", "model", "title", "price", "mileage", "link", "vehicleurl"]);
  function visit(value, path, depth) {
    if (depth > 7) return;
    if (Array.isArray(value)) {
      const records = value.filter(object);
      if (records.length) {
        const last = canonicalKey(path.split(".").at(-1));
        const keys = new Set(records.slice(0, 5).flatMap((record) => Object.keys(record).map(canonicalKey)));
        const score = (recordNames.has(last) ? 20 : 0) + [...keys].filter((key) => vehicleFields.has(key)).length * 4;
        candidates.push({ vehicles: records, path, score });
      }
      return;
    }
    for (const [key, child] of Object.entries(object(value) ?? {})) {
      const childPath = path === "$" ? key : `${path}.${key}`;
      if (object(child) && recordNames.has(canonicalKey(key))) {
        const keys = Object.keys(child).map(canonicalKey);
        if (keys.some((item) => vehicleFields.has(item))) candidates.push({ vehicles: [child], path: childPath, score: 15 });
      }
      visit(child, childPath, depth + 1);
    }
  }
  visit(payload, "$", 0);
  candidates.sort((a, b) => b.score - a.score || b.vehicles.length - a.vehicles.length);
  return candidates[0] ?? { vehicles: [], path: null };
}

function unique(vehicles, names) {
  return [...new Set(vehicles.flatMap((vehicle) => names.map((name) => pick(vehicle, [name]))).filter((value) => value !== null))]
    .sort((a, b) => String(a).localeCompare(String(b)));
}

function safeStructure(raw) {
  const trimmed = raw.trimStart();
  const root = trimmed.match(/^(?:<\?xml[^>]*\?>\s*)?<([A-Za-z_][\w:.-]*)\b/);
  return {
    byteLength: Buffer.byteLength(raw),
    lineCount: raw.split(/\r\n|\n|\r/).length,
    firstCharacterType: trimmed.startsWith("<") ? "angle_bracket" : trimmed.startsWith("{") ? "brace" : trimmed.startsWith("[") ? "square_bracket" : "other",
    xmlRootElement: root?.[1] ?? null,
  };
}

function detectFormat(raw, contentType) {
  const trimmed = raw.replace(/^\uFEFF/, "").trimStart();
  if (/^[{[]/.test(trimmed)) return "json";
  if (/^<!doctype\s+html\b|^<html\b/i.test(trimmed)) return "html";
  if (trimmed.startsWith("<")) return "xml";
  const firstLine = trimmed.split(/\r\n|\n|\r/, 1)[0];
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  if (tabs > commas) return "tsv";
  if (commas > 0) return "csv";
  if (/\bjson\b|\+json\b/i.test(contentType)) return "json";
  if (/\bxml\b|\+xml\b/i.test(contentType)) return "xml";
  if (/\btab-separated-values\b|\btsv\b/i.test(contentType)) return "tsv";
  if (/\bcsv\b/i.test(contentType)) return "csv";
  return "unknown";
}

export function parseMetaCatalogueText(raw, contentType = "") {
  const detectedFormat = detectFormat(raw, contentType);
  const structure = safeStructure(raw);
  if (structure.byteLength > MAX_BODY_BYTES) return { detectedFormat, structure, errorCode: "body_too_large" };
  try {
    if (detectedFormat === "json") return { detectedFormat, structure, payload: JSON.parse(raw.replace(/^\uFEFF/, "")) };
    if (detectedFormat === "xml") {
      if (/<!DOCTYPE\b|<!ENTITY\b/i.test(raw) || XMLValidator.validate(raw) !== true) throw new Error("xml_invalid");
      const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text", parseTagValue: false, parseAttributeValue: false, processEntities: false,
        isArray: (name) => ["vehicle", "item", "entry", "record", "product", "advert", "listing"].includes(canonicalKey(name)) });
      return { detectedFormat, structure, payload: parser.parse(raw) };
    }
    if (detectedFormat === "csv" || detectedFormat === "tsv") {
      const delimiter = detectedFormat === "tsv" ? "\t" : ",";
      const payload = parseDelimited(raw, { columns: true, bom: true, delimiter, skip_empty_lines: true, relax_column_count: true, max_record_size: 1024 * 1024 });
      if (!payload.length) throw new Error("empty_table");
      return { detectedFormat, structure, payload };
    }
    return { detectedFormat, structure, errorCode: "unsupported_format" };
  } catch {
    return { detectedFormat, structure, errorCode: "parse_failed" };
  }
}

export function summariseMetaCatalogue(payload) {
  const { vehicles, path } = findVehicles(payload);
  const validVehicles = vehicles.filter(object);
  const fieldNamesAvailable = [...new Set(validVehicles.flatMap((vehicle) => Object.keys(vehicle)))].sort();
  const representative = [];
  const selected = new Set();
  const seen = new Set();
  for (const [index, vehicle] of validVehicles.entries()) {
    const summary = vehicleSummary(vehicle);
    const diversityKey = `${summary.branch}|${summary.site}|${summary.location}|${summary.availability}|${summary.status}`;
    if (seen.has(diversityKey)) continue;
    seen.add(diversityKey);
    representative.push(summary);
    selected.add(index);
    if (representative.length === 5) break;
  }
  for (const [index, vehicle] of validVehicles.entries()) {
    if (representative.length === 5) break;
    if (!selected.has(index)) representative.push(vehicleSummary(vehicle));
  }
  const locations = validVehicles.map((vehicle) => {
    const address1 = firstLiteral(vehicle, ["address.address1", "address1"]);
    const city = firstLiteral(vehicle, ["address.city", "city"]);
    const region = firstLiteral(vehicle, ["address.region", "region"]);
    const country = firstLiteral(vehicle, ["address.country", "country"]);
    return [address1, city, region, country].filter(Boolean).join(" | ") || null;
  });
  const imageUrls = validVehicles.map((vehicle) => url(firstLiteral(vehicle, ["image[0].url", "image.0.url", "image_url", "image"])));
  const registrationFields = fieldNamesAvailable.filter((name) => /registration|\breg\b|vrm/i.test(name));
  const vatFields = fieldNamesAvailable.filter((name) => /vat|tax/i.test(name));
  const vehicleIds = validVehicles.map((vehicle) => firstLiteral(vehicle, ["vehicle_id", "vehicleId"])).filter(Boolean);
  const ukRegistrationLike = vehicleIds.filter((value) => /^[A-Z0-9]{2,8}$/i.test(String(value).replace(/\s+/g, ""))).length;
  return {
    totalVehicleCount: validVehicles.length,
    responseShape: {
      type: Array.isArray(payload) ? "array" : object(payload) ? "object" : typeof payload,
      topLevelFields: Object.keys(object(payload) ?? {}).sort(),
      vehiclesPath: path,
    },
    vehicleFieldNames: fieldNamesAvailable,
    registrationFieldNames: registrationFields,
    vatFieldNames: vatFields,
    representativeRecords: representative,
    locationCounts: countBy(locations),
    availabilityCounts: countBy(validVehicles.map((vehicle) => pick(vehicle, ["availability", "availability_status", "availabilityStatus"]))),
    stateOfVehicleCounts: countBy(validVehicles.map((vehicle) => firstLiteral(vehicle, ["state_of_vehicle", "stateOfVehicle"]))),
    statusCounts: countBy(validVehicles.map((vehicle) => pick(vehicle, ["status", "stock_status", "stockStatus"]))),
    imageCoverage: {
      withPrimaryImage: imageUrls.filter(Boolean).length,
      withoutPrimaryImage: imageUrls.filter((value) => !value).length,
    },
    vehicleIdAssessment: {
      nonBlankCount: vehicleIds.length,
      registrationLikeCount: ukRegistrationLike,
      note: "Heuristic only. Compare representative vehicleId values with Vansco URLs/titles before treating vehicle_id as registration.",
    },
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed." });
  if (process.env.VERCEL_ENV !== "preview") return response.status(404).json({ ok: false, error: "Not found." });
  if (!authorised(request, process.env)) return response.status(401).json({ ok: false, error: "Marketing CRM access is required." });

  const username = process.env.DEALERKIT_META_USERNAME;
  const password = process.env.DEALERKIT_META_PASSWORD;
  if (!username || !password) {
    console.warn("Meta catalogue diagnostic: credentials_missing", { usernameConfigured: Boolean(username), passwordConfigured: Boolean(password) });
    return response.status(503).json({ ok: false, error: "Catalogue credentials are unavailable.", errorCode: "credentials_missing" });
  }

  try {
    const upstream = await fetch(META_URL, {
      method: "GET",
      headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` },
      cache: "no-store",
      signal: AbortSignal.timeout(25000),
    });
    const contentType = String(upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase().slice(0, 80);
    if (!upstream.ok) {
      console.warn("Meta catalogue diagnostic: upstream_http_error", { upstreamStatus: upstream.status, contentType });
      return response.status(502).json({ ok: false, error: "Catalogue request was rejected by the upstream service.", errorCode: "upstream_http_error", upstreamStatus: upstream.status, contentType });
    }
    let raw;
    try {
      raw = await upstream.text();
    } catch {
      console.warn("Meta catalogue diagnostic: body_read_failed", { upstreamStatus: upstream.status, contentType });
      return response.status(502).json({ ok: false, error: "Catalogue response could not be read.", errorCode: "body_read_failed", upstreamStatus: upstream.status, contentType });
    }
    const parsed = parseMetaCatalogueText(raw, contentType);
    if (parsed.errorCode) {
      console.warn("Meta catalogue diagnostic: format_parse_failed", { upstreamStatus: upstream.status, contentType, detectedFormat: parsed.detectedFormat, structure: parsed.structure, errorCode: parsed.errorCode });
      return response.status(502).json({ ok: false, error: "Catalogue format could not be parsed.", errorCode: parsed.errorCode, upstreamStatus: upstream.status, contentType, detectedFormat: parsed.detectedFormat, structure: parsed.structure });
    }
    const summary = summariseMetaCatalogue(parsed.payload);
    if (!summary.responseShape.vehiclesPath) {
      console.warn("Meta catalogue diagnostic: vehicle_array_missing", { upstreamStatus: upstream.status, contentType, detectedFormat: parsed.detectedFormat, structure: parsed.structure, responseType: summary.responseShape.type, topLevelFields: summary.responseShape.topLevelFields });
      return response.status(502).json({ ok: false, error: "Catalogue vehicle array was not found.", errorCode: "vehicle_array_missing", upstreamStatus: upstream.status, contentType, detectedFormat: parsed.detectedFormat, structure: parsed.structure, responseShape: summary.responseShape });
    }
    return response.status(200).json({ ok: true, readOnly: true, summary: { contentType, detectedFormat: parsed.detectedFormat, ...summary } });
  } catch (error) {
    const errorCode = error?.name === "TimeoutError" ? "upstream_timeout" : "request_failed";
    console.warn(`Meta catalogue diagnostic: ${errorCode}`);
    return response.status(502).json({ ok: false, error: "Catalogue request failed before a usable response was received.", errorCode });
  }
}


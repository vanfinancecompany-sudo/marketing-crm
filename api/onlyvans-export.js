import { createClient } from "@supabase/supabase-js";

const ONLYVANS_COLUMNS = [
  "title",
  "make",
  "model",
  "year",
  "registration",
  "mileage",
  "price",
  "fuel_type",
  "transmission",
  "engine_size_cc",
  "location",
  "postcode",
  "description",
  "image_urls",
  "features",
  "price_includes_vat",
  "price_negotiable",
  "v5c_logbook_available",
  "hpi_clear",
  "ulez_compliant",
  "seller_type",
  "service_history",
  "condition",
  "is_camper_van",
  "berths",
  "seatbelts",
  "kitchen",
  "shower",
  "toilet",
  "cooker",
  "water_tank_size",
  "electric_power",
  "height",
  "pop_top",
  "insulation_level",
];

const SUPPORTED_MAKES = new Set([
  "Ford",
  "Mercedes-Benz",
  "Renault",
  "Volkswagen",
  "Fiat",
  "Peugeot",
  "Citroen",
  "Vauxhall",
  "Nissan",
  "Iveco",
  "MAN",
  "MAXUS",
  "Dacia",
  "DFSK",
  "Hyundai",
  "Suzuki",
  "Mitsubishi",
  "Kia",
  "Toyota",
  "LDV",
  "Isuzu",
  "Elddis",
  "Leisuredrive",
  "Auto-Sleepers",
  "Bailey",
  "Dethleffs",
  "Hymer",
  "Knaus",
  "Roller Team",
  "Weinsberg",
  "Adria",
  "Chausson",
  "Pilote",
  "Rapido",
  "Bürstner",
]);

const FORD_MODELS = [
  "Transit Custom",
  "Transit Connect",
  "Transit Courier",
  "Transit Tipper",
  "Tourneo Custom",
  "Tourneo Connect",
  "Fiesta Van",
  "Transit",
  "Ranger",
  "Tourneo",
];

const MODEL_RULES = [
  ["Mercedes-Benz", ["Sprinter", "Vito", "Citan"]],
  ["Renault", ["Trafic", "Master", "Kangoo"]],
  ["Volkswagen", ["Transporter", "Caddy", "Crafter", "Amarok"]],
  ["Fiat", ["Ducato", "Doblo", "Talento", "Scudo"]],
  ["Peugeot", ["Partner", "Expert", "Boxer"]],
  ["Citroen", ["Berlingo", "Dispatch", "Relay"]],
  ["Vauxhall", ["Vivaro", "Combo", "Movano"]],
  ["Nissan", ["Primastar", "NV200", "NV300", "NV400", "Interstar", "Navara"]],
  ["Iveco", ["Daily"]],
  ["MAN", ["TGE"]],
  ["MAXUS", ["Deliver 9", "Deliver 3", "eDeliver 9", "eDeliver 3"]],
  ["Toyota", ["Proace", "Hilux"]],
  ["Isuzu", ["D-Max"]],
];

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables.");

  return createClient(url, key, { auth: { persistSession: false } });
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeRegistration(value) {
  const text = normalizeText(value).toUpperCase();
  const match = text.match(/\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/);
  return match ? match[1].replace(/\s+/g, "") : "";
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvLine(values) {
  return values.map(csvEscape).join(",");
}

function parseNumber(value) {
  const digits = String(value || "").replace(/[^0-9.]/g, "");
  return digits ? String(Math.round(Number(digits))) : "";
}

function extractYear(...values) {
  const text = values.map(normalizeText).join(" ");
  const explicit = text.match(/\b(20[0-3][0-9])\b/);
  if (explicit) return explicit[1];
  const reg = normalizeRegistration(text);
  const age = reg.match(/^[A-Z]{2}([0-9]{2})[A-Z]{3}$/);
  if (!age) return "";
  const value = Number(age[1]);
  if (!Number.isFinite(value)) return "";
  if (value >= 50) return String(2000 + value - 50);
  return String(2000 + value);
}

function extractMileage(...values) {
  const text = values.map(normalizeText).join(" ");
  const match = text.match(/\b([0-9]{1,3}(?:,[0-9]{3})|[0-9]{4,6})\s*(?:miles|mile|mls|mileage)\b/i);
  return match ? parseNumber(match[1]) : "";
}

function extractEngineSizeCc(...values) {
  const text = values.map(normalizeText).join(" ");
  const cc = text.match(/\b([1-9][0-9]{2,4})\s*cc\b/i);
  if (cc) return parseNumber(cc[1]);
  const litres = text.match(/\b([1-9](?:\.[0-9])?)\s*(?:l|litre|liter)\b/i);
  if (litres) return String(Math.round(Number(litres[1]) * 1000));
  return "";
}

function detectFuel(...values) {
  const text = values.map(normalizeText).join(" ").toLowerCase();
  if (/electric|ev|e[-\s]?transit|e[-\s]?deliver/.test(text)) return "electric";
  if (/hybrid|phev|mhev/.test(text)) return "hybrid";
  if (/petrol|ecoboost/.test(text)) return "petrol";
  return "diesel";
}

function detectTransmission(...values) {
  const text = values.map(normalizeText).join(" ").toLowerCase();
  if (/semi[-\s]?automatic|semi auto/.test(text)) return "semi-automatic";
  if (/automatic|\bauto\b|powershift/.test(text)) return "automatic";
  return "manual";
}

function titleWithoutReg(value) {
  const registration = normalizeRegistration(value);
  if (!registration) return normalizeText(value);
  const spaced = registration.replace(/^([A-Z]{2}[0-9]{2})([A-Z]{3})$/, "$1 $2");
  return normalizeText(String(value || "").replace(registration, "").replace(spaced, ""));
}

function detectMake(text) {
  const value = normalizeText(text);
  const candidates = [
    ["Mercedes-Benz", /\b(mercedes|mercedes-benz|benz)\b/i],
    ["Volkswagen", /\b(volkswagen|vw)\b/i],
    ["Citroen", /\b(citroen|citroën)\b/i],
    ["Vauxhall", /\bvauxhall\b/i],
    ["Peugeot", /\bpeugeot\b/i],
    ["Renault", /\brenault\b/i],
    ["Nissan", /\bnissan\b/i],
    ["Toyota", /\btoyota\b/i],
    ["MAXUS", /\bmaxus\b/i],
    ["Iveco", /\biveco\b/i],
    ["Isuzu", /\bisuzu\b/i],
    ["Fiat", /\bfiat\b/i],
    ["Ford", /\bford\b/i],
    ["MAN", /\bman\b/i],
    ["LDV", /\bldv\b/i],
    ["Hyundai", /\bhyundai\b/i],
    ["Kia", /\bkia\b/i],
    ["Mitsubishi", /\bmitsubishi\b/i],
    ["Suzuki", /\bsuzuki\b/i],
    ["Dacia", /\bdacia\b/i],
  ];
  return candidates.find(([, pattern]) => pattern.test(value))?.[0] || "";
}

function detectModel(make, text) {
  const value = normalizeText(text);
  if (make === "Ford") {
    const lower = value.toLowerCase();
    if (/transit\s+custom|custom/.test(lower)) return "Transit Custom";
    if (/transit\s+connect|\bconnect\b/.test(lower)) return "Transit Connect";
    if (/transit\s+courier|\bcourier\b/.test(lower)) return "Transit Courier";
    if (/tipper/.test(lower)) return "Transit Tipper";
    if (/tourneo\s+custom/.test(lower)) return "Tourneo Custom";
    if (/tourneo\s+connect/.test(lower)) return "Tourneo Connect";
    if (/fiesta\s+van/.test(lower)) return "Fiesta Van";
    if (/ranger/.test(lower)) return "Ranger";
    if (/tourneo/.test(lower)) return "Tourneo";
    if (/transit/.test(lower)) return "Transit";
    return "Transit";
  }

  const rule = MODEL_RULES.find(([ruleMake]) => ruleMake === make);
  if (!rule) return "";
  return rule[1].find((model) => new RegExp(`\\b${model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\ /g, "\\s+")}\\b`, "i").test(value)) || rule[1][0] || "";
}

function convertWixImage(value) {
  const text = normalizeText(value);
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  const match = text.match(/wix:image:\/\/v1\/([^/#?]+)/i);
  return match ? `https://static.wixstatic.com/media/${match[1]}` : text;
}

function uniqueImageUrls(...values) {
  const seen = new Set();
  return values
    .flatMap((value) => String(value || "").split(/[|\n]/))
    .flatMap((value) => value.split(/,(?=\s*(?:https?:|wix:image:))/i))
    .map(convertWixImage)
    .filter(Boolean)
    .filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .slice(0, 10);
}

function cleanFeatures(value) {
  const features = normalizeText(value)
    .split(/[,•|\n]/)
    .map((feature) => normalizeText(feature).replace(/^[-–]+\s*/, ""))
    .filter((feature) => feature.length >= 3 && feature.length <= 80)
    .slice(0, 30);
  return [...new Set(features)].join(",");
}

function onlyVansRow(row) {
  const title = normalizeText(row.title || row.vanDescription || row.weblink || "");
  const combined = [title, row.vanDescription, row.vanSpec, row.weblink].map(normalizeText).join(" ");
  const registration = normalizeRegistration(title || row.weblink || row.vanDescription);
  const make = detectMake(combined);
  const model = detectModel(make, combined);
  const description = [
    titleWithoutReg(title),
    normalizeText(row.vanDescription),
    normalizeText(row.vanSpec),
    normalizeText(row.weblink),
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 5000);
  const images = uniqueImageUrls(row.picture, row.image, row.imageUrl, row.image_urls, row.gallery);

  if (!registration || !make || !model || !SUPPORTED_MAKES.has(make)) return null;

  return {
    title: titleWithoutReg(title) || `${make} ${model}`,
    make,
    model,
    year: extractYear(title, row.vanDescription, row.vanSpec),
    registration,
    mileage: extractMileage(row.vanDescription, row.vanSpec, title),
    price: parseNumber(row.price),
    fuel_type: detectFuel(title, row.vanDescription, row.vanSpec),
    transmission: detectTransmission(title, row.vanDescription, row.vanSpec),
    engine_size_cc: extractEngineSizeCc(title, row.vanDescription, row.vanSpec),
    location: "Southampton",
    postcode: "SO40 2NN",
    description,
    image_urls: images.join(","),
    features: cleanFeatures(row.vanSpec),
    price_includes_vat: "true",
    price_negotiable: "false",
    v5c_logbook_available: "true",
    hpi_clear: "true",
    ulez_compliant: "true",
    seller_type: "trade",
    service_history: "partial",
    condition: "used",
    is_camper_van: "false",
    berths: "",
    seatbelts: "",
    kitchen: "false",
    shower: "false",
    toilet: "false",
    cooker: "false",
    water_tank_size: "",
    electric_power: "",
    height: "",
    pop_top: "false",
    insulation_level: "",
  };
}

function validateRow(row) {
  return ["title", "make", "model", "year", "price", "mileage", "postcode", "condition"].every((field) => normalizeText(row[field]));
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const supabase = getSupabase();
    const limit = Math.min(Math.max(Number(request.query?.limit) || 500, 1), 500);
    const result = await supabase
      .from("facebook_adverts")
      .select("id,title,picture,price,vat,salePrice,vanDescription,vanSpec,weblink,is_active")
      .eq("is_active", true)
      .limit(limit);

    if (result.error) throw result.error;

    const seen = new Set();
    const rows = [];
    const skipped = [];

    for (const sourceRow of result.data || []) {
      const mapped = onlyVansRow(sourceRow);
      if (!mapped) {
        skipped.push({ id: sourceRow.id, title: sourceRow.title, reason: "Unsupported make/model or missing registration" });
        continue;
      }
      if (!validateRow(mapped)) {
        skipped.push({ id: sourceRow.id, registration: mapped.registration, reason: "Missing OnlyVans required field" });
        continue;
      }
      if (seen.has(mapped.registration)) continue;
      seen.add(mapped.registration);
      rows.push(mapped);
    }

    const csv = [
      csvLine(ONLYVANS_COLUMNS),
      ...rows.map((row) => csvLine(ONLYVANS_COLUMNS.map((column) => row[column] ?? ""))),
    ].join("\r\n");

    const filename = `onlyvans-current-stock-${new Date().toISOString().slice(0, 10)}.csv`;
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    response.setHeader("X-OnlyVans-Exported-Rows", String(rows.length));
    response.setHeader("X-OnlyVans-Skipped-Rows", String(skipped.length));
    response.status(200).send(`\uFEFF${csv}`);
  } catch (error) {
    console.error("[onlyvans-export] failed", { message: error?.message || String(error) });
    response.status(500).json({ ok: false, error: error?.message || "Could not export OnlyVans CSV." });
  }
}

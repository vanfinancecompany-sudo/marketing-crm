import { createClient } from "@supabase/supabase-js";

const WIX_FINANCE_CMS_ENDPOINT =
  "https://www.vanfinancecompany.co.uk/_functions/marketingVanFinanceImages";

const ONLYVANS_COLUMNS = [
  "title","make","model","year","registration","mileage","price","fuel_type","transmission",
  "engine_size_cc","location","postcode","description","image_urls","features",
  "price_includes_vat","price_negotiable","v5c_logbook_available","hpi_clear","ulez_compliant",
  "seller_type","service_history","condition","is_camper_van","berths","seatbelts","kitchen",
  "shower","toilet","cooker","water_tank_size","electric_power","height","pop_top","insulation_level",
];

const SUPPORTED_MAKES = new Set([
  "Ford","Mercedes-Benz","Renault","Volkswagen","Fiat","Peugeot","Citroen","Vauxhall","Nissan",
  "Iveco","MAN","MAXUS","Dacia","DFSK","Hyundai","Suzuki","Mitsubishi","Kia","Toyota","LDV",
  "Isuzu","Elddis","Leisuredrive","Auto-Sleepers","Bailey","Dethleffs","Hymer","Knaus",
  "Roller Team","Weinsberg","Adria","Chausson","Pilote","Rapido","Bürstner",
]);

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
  ["MAXUS", ["eDeliver 9", "eDeliver 3", "Deliver 9", "Deliver 3"]],
  ["Toyota", ["Proace", "Hilux"]],
  ["Isuzu", ["D-Max"]],
];

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables.");
  return createClient(url, key, { auth: { persistSession: false } });
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function registrationKey(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function extractRegistration(...values) {
  const text = values.map(clean).join(" ").toUpperCase();
  const match = text.match(/\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/);
  return match ? registrationKey(match[1]) : "";
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvLine(values) {
  return values.map(csvEscape).join(",");
}

function parseMoney(value) {
  const match = String(value || "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? String(Math.round(Number(match[0]))) : "";
}

function extractYear(registration, ...values) {
  const text = values.map(clean).join(" ");
  const explicit = text.match(/\b(20[0-3][0-9])\b/);
  if (explicit) return explicit[1];
  const age = registrationKey(registration).match(/^[A-Z]{2}([0-9]{2})[A-Z]{3}$/);
  if (!age) return "";
  const n = Number(age[1]);
  if (!Number.isFinite(n)) return "";
  return n >= 50 ? String(2000 + n - 50) : String(2000 + n);
}

function extractMileage(...values) {
  const text = values.map(clean).join(" ");
  const explicit = text.match(/(?:MILEAGE|MILES?)\s*[:\-]?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})/i)
    || text.match(/\b([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})\s*(?:MILES?|MLS)\b/i);
  return explicit ? explicit[1].replace(/,/g, "") : "";
}

function extractEngineSizeCc(...values) {
  const text = values.map(clean).join(" ");
  const cc = text.match(/\b([1-9][0-9]{2,4})\s*CC\b/i);
  if (cc) return cc[1];
  const litres = text.match(/\b([1-9](?:\.[0-9])?)\s*(?:L|LITRE|LITER)\b/i);
  return litres ? String(Math.round(Number(litres[1]) * 1000)) : "";
}

function detectFuel(...values) {
  const text = values.map(clean).join(" ").toLowerCase();
  if (/\b(electric|bev|ev)\b|e[-\s]?(transit|deliver)/.test(text)) return "electric";
  if (/\b(hybrid|phev|mhev)\b/.test(text)) return "hybrid";
  if (/\bpetrol\b|\becoboost\b/.test(text)) return "petrol";
  return "diesel";
}

function detectTransmission(...values) {
  const text = values.map(clean).join(" ").toLowerCase();
  if (/semi[-\s]?automatic|semi auto/.test(text)) return "semi-automatic";
  if (/\bautomatic\b|\bauto\b|powershift/.test(text)) return "automatic";
  return "manual";
}

function detectMake(text) {
  const value = clean(text);
  const rules = [
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
  return rules.find(([, pattern]) => pattern.test(value))?.[0] || "";
}

function detectModel(make, text) {
  const value = clean(text);
  if (make === "Ford") {
    const lower = value.toLowerCase();
    if (/transit\s+custom|\bcustom\b/.test(lower)) return "Transit Custom";
    if (/transit\s+connect|\bconnect\b/.test(lower)) return "Transit Connect";
    if (/transit\s+courier|\bcourier\b/.test(lower)) return "Transit Courier";
    if (/\btipper\b/.test(lower)) return "Transit Tipper";
    if (/tourneo\s+custom/.test(lower)) return "Tourneo Custom";
    if (/tourneo\s+connect/.test(lower)) return "Tourneo Connect";
    if (/fiesta\s+van/.test(lower)) return "Fiesta Van";
    if (/\branger\b/.test(lower)) return "Ranger";
    if (/\btourneo\b/.test(lower)) return "Tourneo";
    if (/\btransit\b/.test(lower)) return "Transit";
    return "";
  }
  const rule = MODEL_RULES.find(([ruleMake]) => ruleMake === make);
  if (!rule) return "";
  return rule[1].find((model) => new RegExp(`\\b${model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\ /g, "\\s+")}\\b`, "i").test(value)) || "";
}

function stripRegistration(text, registration) {
  let value = clean(text);
  if (!registration) return value;
  const compact = registrationKey(registration);
  const spaced = compact.replace(/^([A-Z]{2}[0-9]{2})([A-Z]{3})$/, "$1 $2");
  value = value.replace(new RegExp(compact, "ig"), "").replace(new RegExp(spaced, "ig"), "");
  return clean(value.replace(/^[\s\-–|:]+|[\s\-–|:]+$/g, ""));
}

function normalizeImage(value) {
  const text = clean(value);
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  const match = text.match(/wix:image:\/\/v1\/([^/#?]+)/i);
  return match ? `https://static.wixstatic.com/media/${match[1]}` : text;
}

function uniqueImages(values) {
  const seen = new Set();
  const output = [];
  for (const raw of values || []) {
    const url = normalizeImage(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    output.push(url);
    if (output.length === 10) break;
  }
  return output;
}

function cleanFeatures(value) {
  const raw = String(value || "")
    .replace(/\r/g, "\n")
    .split(/\n|,|•|\||\s+-\s+/)
    .map((item) => clean(item).replace(/^[-–]+\s*/, ""))
    .filter((item) => item.length >= 3 && item.length <= 80);
  return [...new Set(raw)].slice(0, 30).join(",");
}

function priceIncludesVat(row, wix) {
  const text = [row?.vat, row?.price, wix?.price].map(clean).join(" ").toLowerCase();
  if (/\+\s*vat|plus vat|ex(?:cluding)?\.?\s*vat|ex vat/.test(text)) return "false";
  if (/inc(?:luding)?\.?\s*vat|includes vat|no vat/.test(text)) return "true";
  return "false";
}

async function loadLiveWixFinanceCms() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(WIX_FINANCE_CMS_ENDPOINT, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Wix CMS feed returned HTTP ${response.status}.`);
    const payload = await response.json();
    const items = Array.isArray(payload?.items) ? payload.items : [];
    return {
      refreshedAt: clean(payload?.refreshedAt),
      byRegistration: new Map(
        items
          .map((item) => [registrationKey(item?.registration), item])
          .filter(([registration]) => registration)
      ),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildOnlyVansRow(row, wix) {
  const registration = extractRegistration(row?.title, row?.weblink, row?.vanDescription);
  if (!registration || !wix) return null;

  const cmsTitle = clean(wix?.title);
  const crmTitle = clean(row?.title);
  const combined = [
    cmsTitle,
    crmTitle,
    row?.vanDescription,
    row?.vanSpec,
    row?.weblink,
  ].map(clean).join(" ");

  const make = detectMake(combined);
  const model = detectModel(make, combined);
  if (!make || !model || !SUPPORTED_MAKES.has(make)) return null;

  const title = stripRegistration(cmsTitle || crmTitle, registration) || `${make} ${model}`;
  const images = uniqueImages([...(Array.isArray(wix?.images) ? wix.images : []), row?.picture]);

  const description = [
    title,
    clean(row?.vanDescription),
    clean(row?.vanSpec),
    clean(row?.weblink),
  ].filter(Boolean).join("\n\n").slice(0, 5000);

  return {
    title,
    make,
    model,
    year: extractYear(registration, cmsTitle, row?.vanDescription, row?.vanSpec),
    registration,
    mileage: extractMileage(row?.vanSpec, row?.vanDescription, cmsTitle),
    price: parseMoney(row?.price || wix?.price),
    fuel_type: detectFuel(cmsTitle, row?.vanDescription, row?.vanSpec),
    transmission: detectTransmission(cmsTitle, row?.vanDescription, row?.vanSpec),
    engine_size_cc: extractEngineSizeCc(cmsTitle, row?.vanDescription, row?.vanSpec),
    location: "Southampton",
    postcode: "SO40 2NN",
    description,
    image_urls: images.join(","),
    features: cleanFeatures(row?.vanSpec),
    price_includes_vat: priceIncludesVat(row, wix),
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

function missingRequired(row) {
  return ["title","make","model","year","price","mileage","postcode","condition"]
    .filter((field) => !clean(row?.[field]));
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    response.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }

  try {
    const limit = Math.min(Math.max(Number(request.query?.limit) || 500, 1), 500);
    const supabase = getSupabase();

    const [stockResult, wixCms] = await Promise.all([
      supabase
        .from("facebook_adverts")
        .select("id,title,picture,price,vat,salePrice,vanDescription,vanSpec,weblink,is_active")
        .eq("is_active", true)
        .limit(limit),
      loadLiveWixFinanceCms(),
    ]);

    if (stockResult.error) throw stockResult.error;

    const rows = [];
    const skipped = [];
    const seen = new Set();

    for (const sourceRow of stockResult.data || []) {
      const registration = extractRegistration(sourceRow?.title, sourceRow?.weblink, sourceRow?.vanDescription);
      if (!registration) {
        skipped.push({ id: sourceRow?.id, reason: "Missing registration in current Marketing CRM stock." });
        continue;
      }

      const wixMatch = wixCms.byRegistration.get(registrationKey(registration));
      if (!wixMatch) {
        skipped.push({ id: sourceRow?.id, registration, reason: "No matching live VANFINANCEPAGES CMS row." });
        continue;
      }

      if (seen.has(registration)) continue;

      const mapped = buildOnlyVansRow(sourceRow, wixMatch);
      if (!mapped) {
        skipped.push({ id: sourceRow?.id, registration, reason: "Unsupported or unresolved OnlyVans make/model." });
        continue;
      }

      const missing = missingRequired(mapped);
      if (missing.length) {
        skipped.push({ id: sourceRow?.id, registration, reason: `Missing required field(s): ${missing.join(", ")}` });
        continue;
      }

      if (!mapped.image_urls) {
        skipped.push({ id: sourceRow?.id, registration, reason: "No live Wix CMS gallery images." });
        continue;
      }

      seen.add(registration);
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
    response.setHeader("X-OnlyVans-Wix-Cms-Rows", String(wixCms.byRegistration.size));
    if (wixCms.refreshedAt) response.setHeader("X-OnlyVans-Wix-Refreshed-At", wixCms.refreshedAt);
    response.status(200).send(`\uFEFF${csv}`);
  } catch (error) {
    console.error("[onlyvans-export] failed", { message: error?.message || String(error) });
    response.status(500).json({
      ok: false,
      error: error?.message || "Could not export OnlyVans CSV.",
    });
  }
}

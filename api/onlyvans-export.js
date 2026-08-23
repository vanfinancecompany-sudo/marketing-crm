import { createClient } from "@supabase/supabase-js";

const WIX_FEED = "https://www.vanfinancecompany.co.uk/_functions/marketingVanFinanceImages";
const COLUMNS = [
  "title","make","model","year","registration","mileage","price","fuel_type","transmission",
  "engine_size_cc","location","postcode","description","image_urls","features","price_includes_vat",
  "price_negotiable","v5c_logbook_available","hpi_clear","ulez_compliant","seller_type","service_history",
  "condition","is_camper_van","berths","seatbelts","kitchen","shower","toilet","cooker",
  "water_tank_size","electric_power","height","pop_top","insulation_level",
];

const SUPPORTED_MAKES = new Set([
  "Ford","Mercedes-Benz","Renault","Volkswagen","Fiat","Peugeot","Citroen","Vauxhall","Nissan",
  "Iveco","MAN","MAXUS","Dacia","DFSK","Hyundai","Suzuki","Mitsubishi","Kia","Toyota","LDV","Isuzu",
]);

const MODEL_RULES = {
  "Mercedes-Benz": ["Sprinter","Vito","Citan"],
  Renault: ["Trafic","Master","Kangoo"],
  Volkswagen: ["Transporter","Caddy","Crafter","Amarok"],
  Fiat: ["Ducato","Doblo","Talento","Scudo"],
  Peugeot: ["Partner","Expert","Boxer"],
  Citroen: ["Berlingo","Dispatch","Relay"],
  Vauxhall: ["Vivaro","Combo","Movano"],
  Nissan: ["Primastar","NV200","NV300","NV400","Interstar","Navara"],
  Iveco: ["Daily"], MAN: ["TGE"],
  MAXUS: ["eDeliver 9","eDeliver 3","Deliver 9","Deliver 3"],
  Toyota: ["Proace","Hilux"], Isuzu: ["D-Max"], Mitsubishi: ["L200"],
  Hyundai: ["iLoad","H350"], LDV: ["V80"],
};

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function regKey(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function registration(...values) {
  const text = values.map(clean).join(" ").toUpperCase();
  const match = text.match(/\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/);
  return match ? regKey(match[1]) : "";
}

function numberFromMoney(value) {
  const match = String(value || "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? String(Math.round(Number(match[0]))) : "";
}

function yearFrom(spec, reg, ...fallbacks) {
  const direct = String(spec || "").match(/YEAR\s*:\s*(20[0-3][0-9])/i);
  if (direct) return direct[1];
  const fallback = fallbacks.map(clean).join(" ").match(/\b(20[0-3][0-9])\b/);
  if (fallback) return fallback[1];
  const plate = regKey(reg).match(/^[A-Z]{2}([0-9]{2})[A-Z]{3}$/);
  if (!plate) return "";
  const age = Number(plate[1]);
  return age >= 50 ? String(1950 + age) : String(2000 + age);
}

function mileageFrom(spec, ...fallbacks) {
  const direct = String(spec || "").match(/MILEAGE\s*:\s*([0-9][0-9,]*)/i);
  if (direct) return direct[1].replace(/,/g, "");
  const fallback = fallbacks.map(clean).join(" ").match(/\b([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{4,6})\s*(?:MILES?|MLS)\b/i);
  return fallback ? fallback[1].replace(/,/g, "") : "";
}

function engineCc(...values) {
  const text = values.map(clean).join(" ");
  const cc = text.match(/\b([1-9][0-9]{2,4})\s*CC\b/i);
  if (cc) return cc[1];
  const litres = text.match(/\b([1-9](?:\.[0-9])?)\s*(?:L|LITRE|LITER)\b/i);
  return litres ? String(Math.round(Number(litres[1]) * 1000)) : "";
}

function fuel(...values) {
  const text = values.map(clean).join(" ").toLowerCase();
  if (/\b(electric|bev|ev)\b|e[-\s]?(transit|deliver)/.test(text)) return "electric";
  if (/\b(hybrid|phev|mhev)\b/.test(text)) return "hybrid";
  if (/\bpetrol\b|\becoboost\b/.test(text)) return "petrol";
  return "diesel";
}

function transmission(...values) {
  const text = values.map(clean).join(" ").toLowerCase();
  if (/semi[-\s]?automatic|semi auto/.test(text)) return "semi-automatic";
  if (/\bautomatic\b|\bauto\b|powershift/.test(text)) return "automatic";
  return "manual";
}

function makeFrom(text) {
  const rules = [
    ["Mercedes-Benz", /\b(mercedes|mercedes-benz|benz)\b/i], ["Volkswagen", /\b(volkswagen|vw)\b/i],
    ["Citroen", /\b(citroen|citroën)\b/i], ["Vauxhall", /\bvauxhall\b/i], ["Peugeot", /\bpeugeot\b/i],
    ["Renault", /\brenault\b/i], ["Nissan", /\bnissan\b/i], ["Toyota", /\btoyota\b/i],
    ["MAXUS", /\bmaxus\b/i], ["Iveco", /\biveco\b/i], ["Isuzu", /\bisuzu\b/i], ["Fiat", /\bfiat\b/i],
    ["Ford", /\bford\b/i], ["MAN", /\bman\b/i], ["LDV", /\bldv\b/i], ["Hyundai", /\bhyundai\b/i],
    ["Kia", /\bkia\b/i], ["Mitsubishi", /\bmitsubishi\b/i], ["Suzuki", /\bsuzuki\b/i],
    ["Dacia", /\bdacia\b/i], ["DFSK", /\bdfsk\b/i],
  ];
  return rules.find(([, pattern]) => pattern.test(clean(text)))?.[0] || "";
}

function modelFrom(make, text) {
  const lower = clean(text).toLowerCase();
  if (make === "Ford") {
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
  return (MODEL_RULES[make] || []).find((model) => lower.includes(model.toLowerCase())) || "";
}

function imageUrl(value) {
  const text = clean(value);
  if (/^https?:\/\//i.test(text)) return text;
  const wix = text.match(/wix:image:\/\/v1\/([^/#?]+)/i);
  return wix ? `https://static.wixstatic.com/media/${wix[1]}` : "";
}

function firstTenImages(wix, fallback) {
  const seen = new Set();
  const result = [];
  for (const raw of [...(Array.isArray(wix?.images) ? wix.images : []), fallback]) {
    const url = imageUrl(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
    if (result.length === 10) break;
  }
  return result;
}

function featureText(spec) {
  return [...new Set(
    String(spec || "").replace(/\r/g, "\n").split(/\n|,|•|\|/)
      .map(clean)
      .filter((value) => value && !/^(REGISTRATION|YEAR|MILEAGE|EURO)\s*:/i.test(value) && !/^_+$/.test(value))
      .filter((value) => value.length >= 3 && value.length <= 80),
  )].slice(0, 30).join(",");
}

function includesVat(row) {
  const text = [row?.vat, row?.price, row?.vanDescription].map(clean).join(" ").toLowerCase();
  if (/\+\s*vat|plus vat|ex(?:cluding)?\.?\s*vat|ex vat/.test(text)) return "false";
  if (/inc(?:luding)?\.?\s*vat|includes vat|no vat/.test(text)) return "true";
  return "false";
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvLine(values) {
  return values.map(csvEscape).join(",");
}

function supabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing Supabase environment variables.");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function wixByRegistration() {
  const response = await fetch(WIX_FEED, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`Wix CMS feed returned HTTP ${response.status}.`);
  const payload = await response.json();
  return new Map((payload.items || []).map((item) => [regKey(item.registration), item]).filter(([reg]) => reg));
}

function mapRow(row, wix) {
  const reg = registration(row.title, row.weblink, row.vanDescription, row.vanSpec);
  if (!reg || !wix) return null;
  const title = clean(wix.title);
  const description = clean(row.vanDescription);
  const spec = String(row.vanSpec || "").trim();
  const combined = [title, description, spec].join(" ");
  const make = makeFrom(combined);
  const model = modelFrom(make, combined);
  if (!SUPPORTED_MAKES.has(make) || !model) return null;
  const images = firstTenImages(wix, row.picture);

  return {
    title: title || `${make} ${model}`, make, model,
    year: yearFrom(spec, reg, title, description), registration: reg,
    mileage: mileageFrom(spec, description, title), price: numberFromMoney(row.price),
    fuel_type: fuel(title, description, spec), transmission: transmission(title, description, spec),
    engine_size_cc: engineCc(title, description, spec), location: "Southampton", postcode: "SO40 2NN",
    description: [title, description, spec, clean(row.weblink)].filter(Boolean).join("\n\n").slice(0, 5000),
    image_urls: images.join(","), features: featureText(spec), price_includes_vat: includesVat(row),
    price_negotiable: "false", v5c_logbook_available: "true", hpi_clear: "true", ulez_compliant: "true",
    seller_type: "trade", service_history: "partial", condition: "used", is_camper_van: "false",
    berths: "", seatbelts: "", kitchen: "false", shower: "false", toilet: "false", cooker: "false",
    water_tank_size: "", electric_power: "", height: "", pop_top: "false", insulation_level: "",
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed." });

  try {
    const limit = Math.min(Math.max(Number(request.query?.limit) || 500, 1), 500);
    const [stock, wixMap] = await Promise.all([
      supabase().from("facebook_adverts")
        .select("id,title,picture,price,vat,salePrice,vanDescription,vanSpec,weblink,is_active")
        .eq("is_active", true).limit(limit),
      wixByRegistration(),
    ]);
    if (stock.error) throw stock.error;

    const rows = [];
    const seen = new Set();
    let skipped = 0;
    for (const source of stock.data || []) {
      const reg = registration(source.title, source.weblink, source.vanDescription, source.vanSpec);
      const mapped = mapRow(source, wixMap.get(regKey(reg)));
      const required = mapped && ["title","make","model","year","price","mileage","postcode","condition","image_urls"]
        .every((key) => clean(mapped[key]));
      if (!mapped || !required || seen.has(mapped.registration)) { skipped += 1; continue; }
      seen.add(mapped.registration);
      rows.push(mapped);
    }

    const csv = [csvLine(COLUMNS), ...rows.map((row) => csvLine(COLUMNS.map((key) => row[key] ?? "")))].join("\r\n");
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="onlyvans-current-stock-${new Date().toISOString().slice(0, 10)}.csv"`);
    response.setHeader("X-OnlyVans-Exported-Rows", String(rows.length));
    response.setHeader("X-OnlyVans-Skipped-Rows", String(skipped));
    return response.status(200).send(`\uFEFF${csv}`);
  } catch (error) {
    console.error("[onlyvans-export] failed", error);
    return response.status(500).json({ ok: false, error: error?.message || "Could not export OnlyVans CSV." });
  }
}

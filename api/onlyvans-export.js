import { createClient } from "@supabase/supabase-js";

const WIX_COLLECTION_ID = "VANFINANCEPAGES";
const WIX_API_BASE_URL = "https://www.wixapis.com";
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

function numberFromMoney(...values) {
  for (const value of values) {
    const match = String(value || "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
    if (match) return String(Math.round(Number(match[0])));
  }
  return "";
}

function numericText(value) {
  const match = String(value || "").replace(/,/g, "").match(/\b\d{1,6}\b/);
  return match ? match[0] : "";
}

function safeSpecification(wix, reg) {
  const spec = String(wix?.vehicleSpecificationText || "").trim();
  if (!spec) return "";
  const embedded = spec.match(/REGISTRATION\s*:\s*([^\r\n]+)/i);
  if (embedded) {
    const embeddedReg = registration(embedded[1]);
    if (embeddedReg && embeddedReg !== regKey(reg)) return "";
  }
  return spec;
}

function yearFrom(wix, reg, safeSpec) {
  const structured = clean(wix?.year).match(/\b(20[0-3][0-9])\b/);
  if (structured) return structured[1];
  const description = clean(wix?.descriptionLine).match(/\b(20[0-3][0-9])\b/);
  if (description) return description[1];
  const spec = String(safeSpec || "").match(/YEAR\s*:\s*(20[0-3][0-9])/i);
  if (spec) return spec[1];
  const plate = regKey(reg).match(/^[A-Z]{2}([0-9]{2})[A-Z]{3}$/);
  if (!plate) return "";
  const age = Number(plate[1]);
  return age >= 50 ? String(1950 + age) : String(2000 + age);
}

function mileageFrom(wix, safeSpec) {
  const structured = numericText(wix?.mileage);
  if (structured) return structured;
  const direct = String(safeSpec || "").match(/MIL(?:E|L)AGE\s*:\s*([0-9][0-9,]*)/i);
  return direct ? direct[1].replace(/,/g, "") : "";
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

function isElectric(...values) {
  const text = values.map(clean).join(" ").toLowerCase();
  return /\belectric\b|\bfully\s+electric\b|\be-tech\b|\bkwh\b|\bevito\b|\be-expert\b|\be-transit\b|\bedeliver\b|\bkangoo\s+(?:maxi\s+)?ze\b/.test(text);
}

function fuelType(title, description, features, safeSpec) {
  if (isElectric(title, description, features, safeSpec)) return "electric";
  const text = [title, description, features, safeSpec].map(clean).join(" ").toLowerCase();
  if (/\bhybrid\b|\bphev\b|\bmhev\b/.test(text)) return "hybrid";
  if (/\bpetrol\b|\becoboost\b/.test(text)) return "petrol";
  if (/\bdiesel\b|\btdci\b|\becoblue\b|\bbluehdi\b|\bdci\b|\bcdti\b|\btdi\b/.test(text)) return "diesel";
  return "diesel";
}

function transmissionType(title, description, features, safeSpec, fuel) {
  if (fuel === "electric") return "automatic";
  const text = [title, description, features, safeSpec].map(clean).join(" ").toLowerCase();
  if (/semi[-\s]?automatic|semi auto/.test(text)) return "semi-automatic";
  if (/\bautomatic\b|\bauto\b|powershift/.test(text)) return "automatic";
  return "manual";
}

function engineCc(safeSpec, title, description, fuel) {
  if (fuel === "electric") return "";
  const labelled = String(safeSpec || "").match(/ENGINE\s+SIZE\s*:\s*([1-9](?:\.[0-9])?)/i);
  if (labelled) return String(Math.round(Number(labelled[1]) * 1000));
  const text = [title, description].map(clean).join(" ");
  const cc = text.match(/\b([1-9][0-9]{2,4})\s*CC\b/i);
  if (cc) return cc[1];
  const litres = text.match(/\b([1-9](?:\.[0-9])?)\s*(?:L|LITRE|LITER)\b/i);
  return litres ? String(Math.round(Number(litres[1]) * 1000)) : "";
}

function imageUrl(value) {
  const raw = typeof value === "object" && value ? (value.src || value.url || value.id || "") : value;
  const text = clean(raw);
  if (/^https?:\/\//i.test(text)) return text;
  const wix = text.match(/wix:image:\/\/v1\/([^/#?]+)/i);
  return wix ? `https://static.wixstatic.com/media/${wix[1]}` : "";
}

function firstTenImages(wix, fallback) {
  const seen = new Set();
  const result = [];
  const gallery = Array.isArray(wix?.mainImages) ? wix.mainImages : [];
  for (const raw of [...gallery, fallback]) {
    const url = imageUrl(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
    if (result.length === 10) break;
  }
  return result;
}

function featureText(value) {
  const excluded = /^(also includes:?|\d+ months? warranty|price checked|service$|101[- ]point check|new 12 months mot|fully valeted|\d+ year aa breakdown)/i;
  return [...new Set(
    String(value || "").replace(/\r/g, "\n").split(/\n|•|\|/)
      .map((item) => clean(item.replace(/^[✓✅✔-]+\s*/, "")))
      .filter((item) => item && !excluded.test(item) && item.length >= 2 && item.length <= 100),
  )].slice(0, 30).join(",");
}

function includesVat(wix, row) {
  const text = [wix?.priceVat, wix?.descriptionLine, wix?.vehicleDescriptionTextClick, row?.vat, row?.price]
    .map(clean).join(" ").toLowerCase();
  if (/no\s*vat|inc(?:luding)?\.?\s*vat|includes vat/.test(text)) return "true";
  if (/\+\s*vat|plus vat|ex(?:cluding)?\.?\s*vat|ex vat/.test(text)) return "false";
  return "false";
}

function euroValue(safeSpec, description) {
  const match = [safeSpec, description].map(clean).join(" ").match(/\bEURO\s*:?[ ]*([0-9])/i);
  return match ? Number(match[1]) : 0;
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

function wixConfiguration() {
  const apiKey = clean(process.env.WIX_API_KEY);
  const siteId = clean(process.env.WIX_SITE_ID);
  if (!apiKey || !siteId) throw new Error("Missing Wix API configuration.");
  return { apiKey, siteId };
}

async function wixQuery(registrations) {
  const { apiKey, siteId } = wixConfiguration();
  const response = await fetch(`${WIX_API_BASE_URL}/wix-data/v2/items/query`, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "wix-site-id": siteId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      dataCollectionId: WIX_COLLECTION_ID,
      query: {
        filter: { title: { $in: registrations } },
        paging: { limit: 100 },
        fields: [
          "title","titleText","year","mileage","priceVat","descriptionLine","vehicleDescriptionTextClick",
          "vehicleSpecificationText","mainImages","applyLink","link-van-finance-title",
        ],
      },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || `Wix CMS query returned HTTP ${response.status}.`);
  return payload.dataItems || [];
}

async function wixByRegistration(registrations) {
  const unique = [...new Set(registrations.map(regKey).filter(Boolean))];
  const chunks = [];
  for (let index = 0; index < unique.length; index += 50) chunks.push(unique.slice(index, index + 50));
  const pages = await Promise.all(chunks.map(wixQuery));
  const map = new Map();
  for (const item of pages.flat()) {
    const data = item?.data || {};
    const reg = regKey(data.title);
    if (reg) map.set(reg, data);
  }
  return map;
}

function mapRow(row, wix, reg) {
  if (!reg || !wix) return null;
  const title = clean(wix.titleText) || clean(wix.title);
  const descriptionLine = clean(wix.descriptionLine);
  const rawFeatures = String(wix.vehicleDescriptionTextClick || "").trim();
  const features = featureText(rawFeatures);
  const safeSpec = safeSpecification(wix, reg);
  const combined = [title, descriptionLine, features, safeSpec].join(" ");
  const make = makeFrom(combined);
  const model = modelFrom(make, combined);
  if (!SUPPORTED_MAKES.has(make) || !model) return null;

  const fuel = fuelType(title, descriptionLine, features, safeSpec);
  const transmission = transmissionType(title, descriptionLine, features, safeSpec, fuel);
  const images = firstTenImages(wix, row.picture);
  const vehicleUrl = `https://www.vanfinancecompany.co.uk/van-finance/${reg}`;
  const description = [title, descriptionLine, rawFeatures, vehicleUrl].filter(Boolean).join("\n\n").slice(0, 5000);
  const euro = euroValue(safeSpec, descriptionLine);

  return {
    title: title || `${make} ${model}`,
    make,
    model,
    year: yearFrom(wix, reg, safeSpec),
    registration: reg,
    mileage: mileageFrom(wix, safeSpec),
    price: numberFromMoney(wix.priceVat, row.salePrice, row.price),
    fuel_type: fuel,
    transmission,
    engine_size_cc: engineCc(safeSpec, title, descriptionLine, fuel),
    location: "Southampton",
    postcode: "SO40 2NN",
    description,
    image_urls: images.join(","),
    features,
    price_includes_vat: includesVat(wix, row),
    price_negotiable: "false",
    v5c_logbook_available: "",
    hpi_clear: "",
    ulez_compliant: fuel === "electric" || euro >= 6 ? "true" : "false",
    seller_type: "trade",
    service_history: "",
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

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed." });

  try {
    const limit = Math.min(Math.max(Number(request.query?.limit) || 500, 1), 500);
    const stock = await supabase().from("facebook_adverts")
      .select("id,title,picture,price,vat,salePrice,vanDescription,vanSpec,weblink,is_active")
      .eq("is_active", true).limit(limit);
    if (stock.error) throw stock.error;

    const sources = stock.data || [];
    const sourceRegistrations = sources.map((source) => registration(source.title, source.weblink, source.vanDescription, source.vanSpec));
    const wixMap = await wixByRegistration(sourceRegistrations);

    const rows = [];
    const seen = new Set();
    let skipped = 0;
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index];
      const reg = regKey(sourceRegistrations[index]);
      const mapped = mapRow(source, wixMap.get(reg), reg);
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

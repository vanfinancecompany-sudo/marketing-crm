import { createClient } from "@supabase/supabase-js";

const CARSLINK_ENDPOINT = "https://api.carslink.ai/api/v1/stock";
const WIX_API_BASE_URL = "https://www.wixapis.com";
const WIX_COLLECTION_ID = "VANFINANCEPAGES";
const DEFAULT_LIMIT = 10;
const MAX_SANDBOX_LIMIT = 25;

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

function moneyValue(value) {
  const text = String(value || "").trim();
  const thousands = text.match(/\b(\d{1,3}(?:[,.]\d{3})+)\b/);
  if (thousands) return Number(thousands[1].replace(/[,.]/g, ""));
  const normal = text.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return normal ? Math.round(Number(normal[0])) : 0;
}

function priceFrom(...values) {
  for (const value of values) {
    const amount = moneyValue(value);
    if (amount >= 500 && amount <= 250000) return amount;
  }
  return 0;
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

function yearFrom(wix, reg, spec) {
  const structured = clean(wix?.year).match(/\b(20[0-3][0-9])\b/);
  if (structured) return Number(structured[1]);

  const plate = regKey(reg).match(/^[A-Z]{2}([0-9]{2})[A-Z]{3}$/);
  if (plate) {
    const age = Number(plate[1]);
    if (age >= 50) return 1950 + age;
    if (age >= 1 && age <= 49) return 2000 + age;
  }

  const specYear = String(spec || "").match(/YEAR\s*:\s*(20[0-3][0-9])/i);
  return specYear ? Number(specYear[1]) : 0;
}

function mileageFrom(wix, spec, description) {
  const structured = Number(String(wix?.mileage || "").replace(/,/g, "").match(/\d{1,6}/)?.[0] || 0);
  if (structured >= 0 && clean(wix?.mileage)) return structured;

  const labelled = String(spec || "").match(/MIL(?:E|L)AGE\s*:\s*([0-9][0-9,]*)/i);
  if (labelled) return Number(labelled[1].replace(/,/g, ""));

  const descriptionMatch = clean(description).match(/\b(?:MILEAGE\s+(?:OF\s+)?|ONLY\s+)([0-9][0-9,]*)\s*(?:MILES?)?\b/i);
  return descriptionMatch ? Number(descriptionMatch[1].replace(/,/g, "")) : -1;
}

const MAKE_RULES = [
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
  ["DFSK", /\bdfsk\b/i],
];

const MODEL_RULES = {
  Ford: ["Transit Custom", "Transit Connect", "Transit Courier", "Transit", "Ranger", "Tourneo Custom", "Tourneo Connect", "Tourneo"],
  "Mercedes-Benz": ["eVito", "Vito", "Sprinter", "Citan", "V-Class", "X-Class"],
  Renault: ["Trafic", "Master", "Kangoo"],
  Volkswagen: ["Transporter", "Crafter", "Caddy", "Amarok", "ID. Buzz", "Caravelle"],
  Fiat: ["Ducato", "Doblo", "Talento", "Scudo"],
  Peugeot: ["Partner", "Expert", "Boxer"],
  Citroen: ["Berlingo", "Dispatch", "Relay"],
  Vauxhall: ["Vivaro", "Combo", "Movano"],
  Nissan: ["Primastar", "Interstar", "NV200", "NV300", "NV400", "Navara"],
  Iveco: ["Daily"],
  MAN: ["TGE"],
  MAXUS: ["eDeliver 9", "eDeliver 3", "Deliver 9", "Deliver 3"],
  Toyota: ["Proace", "Hilux"],
  Isuzu: ["D-Max"],
  Mitsubishi: ["L200"],
  Hyundai: ["iLoad", "H350"],
  LDV: ["V80"],
};

function makeFrom(text) {
  return MAKE_RULES.find(([, pattern]) => pattern.test(clean(text)))?.[0] || "";
}

function modelFrom(make, text) {
  const lower = clean(text).toLowerCase();
  const candidates = MODEL_RULES[make] || [];
  return candidates.find((model) => lower.includes(model.toLowerCase())) || "";
}

function fuelFrom(text, spec) {
  const combined = `${clean(text)} ${clean(spec)}`.toLowerCase();
  if (/\belectric\b|\bevito\b|\be-transit\b|\be-tech\b|\bedeliver\b|\bkwh\b/.test(combined)) return "Electric";
  if (/\bplug[- ]?in hybrid\b|\bphev\b/.test(combined)) return "Plug-in Hybrid";
  if (/\bhybrid\b|\bmhev\b/.test(combined)) return "Hybrid";
  if (/\bpetrol\b|\becoboost\b/.test(combined)) return "Petrol";
  return "Diesel";
}

function transmissionFrom(text, spec, fuel) {
  if (fuel === "Electric") return "Automatic";
  const combined = `${clean(text)} ${clean(spec)}`.toLowerCase();
  if (/\bsemi[- ]?automatic\b|\bsemi auto\b/.test(combined)) return "Semi-Automatic";
  if (/\bcvt\b/.test(combined)) return "CVT";
  if (/\bautomatic\b|\bauto\b/.test(combined)) return "Automatic";
  return "Manual";
}

function vanTypeFrom(text) {
  const lower = clean(text).toLowerCase();
  if (/low\s*loader/.test(lower)) return "Low Loader";
  if (/\bluton\b|box\s*van/.test(lower)) return "Box Van";
  if (/\btipper\b/.test(lower)) return "Tipper";
  if (/\bdropside\b|drop\s*side/.test(lower)) return "Dropside";
  if (/\bminibus\b|9\s*seater|8\s*seater/.test(lower)) return "Minibus";
  if (/\bcrew\b|double\s*cab/.test(lower)) return "Crew Van";
  if (/\bpickup\b|pick-up|\branger\b|\bhilux\b|\bd-max\b|\bl200\b|\bamarok\b/.test(lower)) return "Pickup";
  return "Panel Van";
}

function roofHeightFrom(text) {
  const lower = clean(text).toLowerCase();
  if (/\bh4\b|extra\s*high/.test(lower)) return "Extra High";
  if (/\bh3\b|high\s*roof/.test(lower)) return "High";
  if (/\bh2\b|medium\s*roof/.test(lower)) return "Medium";
  if (/\bh1\b|low\s*roof/.test(lower)) return "Low";
  return "";
}

function loadLengthFrom(text) {
  const lower = clean(text).toLowerCase();
  if (/\bxlwb\b|extra\s*long/.test(lower)) return "XLWB";
  if (/\blwb\b|long\s*wheelbase/.test(lower)) return "LWB";
  if (/\bmwb\b|medium\s*wheelbase/.test(lower)) return "MWB";
  if (/\bswb\b|short\s*wheelbase/.test(lower)) return "SWB";
  return "";
}

function euroStandardFrom(text) {
  const match = clean(text).match(/\bEURO\s*:?[ ]*([4-7])\b/i);
  return match ? `Euro ${match[1]}` : "";
}

function bhpFrom(text) {
  const match = clean(text).match(/\b([0-9]{2,3})\s*BHP\b/i);
  return match ? Number(match[1]) : undefined;
}

function variantFrom(title, make, model) {
  let value = clean(title);
  for (const token of [make, model]) {
    if (!token) continue;
    value = value.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), " ");
  }
  return clean(value).replace(/^\d{4}(?:\/\d{2})?\s*/, "").slice(0, 120);
}

function imageUrl(value) {
  const raw = typeof value === "object" && value ? (value.src || value.url || value.id || "") : value;
  const text = clean(raw);
  if (/^https:\/\//i.test(text)) return text;
  const wix = text.match(/wix:image:\/\/v1\/([^/#?]+)/i);
  return wix ? `https://static.wixstatic.com/media/${wix[1]}` : "";
}

function firstEightImages(wix, fallback) {
  const result = [];
  const seen = new Set();
  const gallery = Array.isArray(wix?.mainImages) ? wix.mainImages : [];
  for (const value of [...gallery, fallback]) {
    const url = imageUrl(value);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
    if (result.length === 8) break;
  }
  return result;
}

function listingUrlFrom(wix, reg) {
  const raw = clean(wix?.["link-van-finance-title"] || wix?.applyLink);
  if (raw) {
    try {
      const parsed = new URL(raw, "https://vanfinance.co");
      return `https://vanfinance.co${parsed.pathname}${parsed.search}`;
    } catch {
      if (raw.startsWith("/")) return `https://vanfinance.co${raw}`;
    }
  }
  return `https://vanfinance.co/van-finance/${encodeURIComponent(regKey(reg).toLowerCase())}`;
}

function cleanFeatureItems(value) {
  return [...new Set(
    String(value || "")
      .replace(/\r/g, "\n")
      .replace(/[✅✔☑☒]/g, " ")
      .split(/\n|•|\|/)
      .map((item) => clean(item.replace(/^[✓\-–—*]+\s*/, "")))
      .map((item) => item.replace(/^also includes\s*:?\s*/i, ""))
      .map((item) => item.replace(/https?:\/\/\S+/gi, "").trim())
      .filter((item) => item && item.length >= 2 && item.length <= 120)
  )];
}

function optionsFrom(value) {
  return cleanFeatureItems(value).slice(0, 30).join(", ");
}

function cleanDescription(title, descriptionLine, rawFeatures) {
  const leadParts = [clean(title), clean(descriptionLine)].filter(Boolean);
  const lead = [...new Set(leadParts)].join(". ");
  const features = cleanFeatureItems(rawFeatures).slice(0, 18);
  const featureText = features.length ? ` Features include ${features.join(", ")}.` : "";
  return `${lead}${lead ? "." : ""}${featureText}`
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2500);
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
          "title",
          "titleText",
          "year",
          "mileage",
          "priceVat",
          "descriptionLine",
          "vehicleDescriptionTextClick",
          "vehicleSpecificationText",
          "mainImages",
          "applyLink",
          "link-van-finance-title",
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
  for (let i = 0; i < unique.length; i += 50) chunks.push(unique.slice(i, i + 50));
  const pages = await Promise.all(chunks.map(wixQuery));
  const map = new Map();
  for (const item of pages.flat()) {
    const data = item?.data || {};
    const reg = regKey(data.title);
    if (reg) map.set(reg, data);
  }
  return map;
}

function mapListing(row, wix, reg) {
  if (!row || !wix || !reg) return { listing: null, reason: "No live Wix CMS match" };

  const title = clean(wix.titleText) || clean(row.title) || reg;
  const descriptionLine = clean(wix.descriptionLine);
  const rawFeatures = String(wix.vehicleDescriptionTextClick || "").trim();
  const spec = safeSpecification(wix, reg);
  const combined = [title, descriptionLine, rawFeatures, spec].join(" ");
  const make = makeFrom(combined);
  const model = modelFrom(make, combined);
  const year = yearFrom(wix, reg, spec);
  const mileage = mileageFrom(wix, spec, `${descriptionLine} ${rawFeatures}`);
  const price = priceFrom(wix.priceVat, row.salePrice, row.price);
  const images = firstEightImages(wix, row.picture);

  const missing = [];
  if (!make) missing.push("make");
  if (!model) missing.push("model");
  if (!year) missing.push("year");
  if (mileage < 0) missing.push("mileage");
  if (!price) missing.push("price");
  if (images.length < 4) missing.push("minimum 4 HTTPS images");
  if (missing.length) return { listing: null, reason: `Missing ${missing.join(", ")}` };

  const fuel = fuelFrom(combined, spec);
  const transmission = transmissionFrom(combined, spec, fuel);
  const optional = {
    variant: variantFrom(title, make, model),
    fuel,
    transmission,
    van_type: vanTypeFrom(combined),
    roof_height: roofHeightFrom(combined),
    load_length: loadLengthFrom(combined),
    wheelbase: loadLengthFrom(combined),
    euro_standard: euroStandardFrom(`${spec} ${descriptionLine}`),
    bhp: bhpFrom(`${spec} ${descriptionLine}`),
    options: optionsFrom(rawFeatures),
    service_history: "Partial",
  };

  const description = cleanDescription(title, descriptionLine, rawFeatures);
  const listing = {
    vehicle_type: "van",
    make,
    model,
    year,
    mileage,
    price,
    registration: regKey(reg),
    source_id: regKey(reg),
    images,
    description,
    listing_url: listingUrlFrom(wix, reg),
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== "" && value !== undefined)),
  };

  return { listing, reason: "" };
}

function dealerObject() {
  const dealer = {
    partner_dealer_id: clean(process.env.CARSLINK_PARTNER_DEALER_ID) || "vanfinance-company",
    name: clean(process.env.CARSLINK_DEALER_NAME) || "Van Finance Company",
    postcode: clean(process.env.CARSLINK_DEALER_POSTCODE) || "SO40 2NN",
    phone: clean(process.env.CARSLINK_DEALER_PHONE),
    email: clean(process.env.CARSLINK_DEALER_EMAIL),
    website: clean(process.env.CARSLINK_DEALER_WEBSITE) || "https://vanfinance.co",
  };
  return Object.fromEntries(Object.entries(dealer).filter(([, value]) => value));
}

async function buildPayload(limit) {
  const stock = await supabase()
    .from("facebook_adverts")
    .select("id,title,picture,price,vat,salePrice,vanDescription,vanSpec,weblink,is_active")
    .eq("is_active", true)
    .limit(limit);

  if (stock.error) throw stock.error;
  const sources = stock.data || [];
  const registrations = sources.map((source) => registration(source.title, source.weblink, source.vanDescription, source.vanSpec));
  const wixMap = await wixByRegistration(registrations);
  const listings = [];
  const skipped = [];
  const seen = new Set();

  for (let index = 0; index < sources.length; index += 1) {
    const reg = regKey(registrations[index]);
    if (!reg || seen.has(reg)) {
      skipped.push({ source_id: reg || sources[index]?.id || `row-${index + 1}`, reason: reg ? "Duplicate registration" : "No registration found" });
      continue;
    }
    seen.add(reg);
    const mapped = mapListing(sources[index], wixMap.get(reg), reg);
    if (!mapped.listing) {
      skipped.push({ source_id: reg, reason: mapped.reason });
      continue;
    }
    listings.push(mapped.listing);
  }

  return {
    payload: {
      mode: "full_replace",
      dealer: dealerObject(),
      listings,
    },
    skipped,
    source_count: sources.length,
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (!["GET", "POST"].includes(request.method)) {
    return response.status(405).json({ ok: false, error: "Method not allowed." });
  }

  try {
    const requestedLimit = Number(request.method === "GET" ? request.query?.limit : request.body?.limit);
    const limit = Math.min(Math.max(requestedLimit || DEFAULT_LIMIT, 1), MAX_SANDBOX_LIMIT);
    const built = await buildPayload(limit);

    if (request.method === "GET") {
      return response.status(200).json({
        ok: true,
        environment: "sandbox-preview",
        source_count: built.source_count,
        ready_count: built.payload.listings.length,
        skipped: built.skipped,
        payload: built.payload,
      });
    }

    if (request.body?.confirmSandbox !== true) {
      return response.status(400).json({
        ok: false,
        error: "Sandbox sync not sent. POST with { confirmSandbox: true } after reviewing the GET preview.",
        ready_count: built.payload.listings.length,
        skipped: built.skipped,
      });
    }

    const apiKey = clean(process.env.CARSLINK_SANDBOX_API_KEY);
    if (!apiKey) {
      return response.status(503).json({
        ok: false,
        error: "CARSLINK_SANDBOX_API_KEY is not configured in the deployment environment.",
      });
    }

    if (built.payload.listings.length < 1) {
      return response.status(422).json({ ok: false, error: "No valid listings were available to send.", skipped: built.skipped });
    }

    const carslink = await fetch(CARSLINK_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(built.payload),
    });

    const result = await carslink.json().catch(() => ({}));
    if (!carslink.ok) {
      return response.status(carslink.status).json({
        ok: false,
        error: result?.message || result?.error || `Carslink returned HTTP ${carslink.status}.`,
        carslink: result,
        local_skipped: built.skipped,
      });
    }

    return response.status(200).json({
      ok: true,
      environment: "sandbox",
      sent_count: built.payload.listings.length,
      local_skipped: built.skipped,
      carslink: result,
    });
  } catch (error) {
    console.error("[carslink-sandbox-sync] failed", error);
    return response.status(500).json({ ok: false, error: error?.message || "Carslink sandbox sync failed." });
  }
}

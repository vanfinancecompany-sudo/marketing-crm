import { londonLocalMinutesToUtcIso } from "./bufferAutomation.js";

export const VANSCO_BRANCHES = Object.freeze({
  vansco333: {
    key: "vansco333",
    label: "Vansco 333 Showroom",
    address: "333 Millbrook Road West, Southampton, SO15 0HW",
    phone: "02380 333 777",
  },
  newForest: {
    key: "newForest",
    label: "Vansco New Forest",
    address: "Senior Service Station, Romsey Road, Cadnam, SO40 2NN",
    phone: "02380 813 119",
  },
  southamptonAirport: {
    key: "southamptonAirport",
    label: "Vansco Southampton Airport",
    address: "201 Wide Lane, Spitfire Roundabout, Southampton, SO18 2RZ",
    phone: "02381 780 300",
  },
});

export const VANSCO_FACEBOOK_MAX_POSTS_PER_DAY = 35;

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function literal(row, key) {
  return clean(row?.[key]);
}

function money(value) {
  const match = clean(value).replace(/,/g, "").match(/(?:£\s*)?([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return "";
  return Number(match[1]).toLocaleString("en-GB", { maximumFractionDigits: 2 });
}

function normalizeUrl(value) {
  const candidate = clean(value);
  if (!/^https:\/\//i.test(candidate)) return "";
  try {
    const parsed = new URL(candidate);
    if (!/(^|\.)vansco\.co\.uk$/i.test(parsed.hostname) && !/(^|\.)cdn\.dealerkit\.uk$/i.test(parsed.hostname)) {
      return candidate;
    }
    return parsed.href;
  } catch {
    return "";
  }
}

export function parseCsvRecords(raw) {
  const text = String(raw || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  if (field || row.length) {
    row.push(field);
    if (row.some((value) => value !== "")) rows.push(row);
  }
  if (!rows.length) return [];

  const headers = rows[0].map((value) => clean(value));
  return rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
  );
}

function branchMatches(text) {
  const value = clean(text).toLowerCase();
  if (!value) return [];
  const matches = [];
  if (
    /this vehicle is situated at our vansco 333 showroom/.test(value)
    || /vansco limited\s*[–-]\s*333\b/.test(value)
    || /vansco\s+333\s*[-–]/.test(value)
  ) matches.push("vansco333");
  if (
    /vansco limited\s*[–-]\s*new forest/.test(value)
    || /vansco\s*[–-]\s*cadnam\s*\/\s*new forest/.test(value)
    || /vansco new forest/.test(value)
  ) matches.push("newForest");
  if (
    /vansco limited\s*[–-]\s*southampton airport/.test(value)
    || /vansco southampton airport/.test(value)
  ) matches.push("southamptonAirport");
  return [...new Set(matches)];
}

function urlBranch(value) {
  const url = clean(value).toLowerCase();
  if (/vansco-(?:333|333-showroom|333-millbrook)/.test(url)) return "vansco333";
  if (/vansco-(?:new-forest|cadnam)/.test(url)) return "newForest";
  if (/vansco-(?:southampton-airport|eastleigh)/.test(url)) return "southamptonAirport";
  return "";
}

export function resolveVanscoBranch({ description = "", vehicleUrl = "", city = "", pageText = "" } = {}) {
  const page = branchMatches(pageText);
  if (page.length === 1) return { branchKey: page[0], source: "page", conflict: false };

  const descriptionMatches = branchMatches(description);
  const fromUrl = urlBranch(vehicleUrl);
  if (descriptionMatches.length === 1) {
    return {
      branchKey: descriptionMatches[0],
      source: "description",
      conflict: Boolean(fromUrl && fromUrl !== descriptionMatches[0]),
    };
  }
  if (!descriptionMatches.length && fromUrl) {
    return { branchKey: fromUrl, source: "url", conflict: false };
  }
  if (!descriptionMatches.length && !fromUrl && clean(city).toLowerCase() === "cadnam") {
    return { branchKey: "newForest", source: "city", conflict: false };
  }
  return {
    branchKey: "",
    source: "none",
    conflict: descriptionMatches.length > 1 || page.length > 1,
  };
}

export function vatLabelFromText(value) {
  const text = clean(value).toUpperCase();
  if (/\bNO\s+VAT\b/.test(text)) return "NO VAT";
  if (/\+\s*VAT\b|PLUS\s+VAT\b/.test(text)) return "+ VAT";
  return "";
}

export function extractUkRegistration(value) {
  const text = clean(value).toUpperCase();
  const matches = text.match(/\b(?:[A-Z]{2}\d{2}\s?[A-Z]{3}|[A-Z]\d{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?\d{1,3}[A-Z]|\d{1,4}\s?[A-Z]{1,3})\b/g) || [];
  return matches.map((item) => item.replace(/\s+/g, "")).find((item) => item.length >= 5 && item.length <= 8) || "";
}

export function normalizeVanscoMetaRow(row) {
  const vehicleUrl = normalizeUrl(row?.url);
  const description = clean(row?.description);
  const branch = resolveVanscoBranch({
    description,
    vehicleUrl,
    city: row?.["address.city"],
  });
  const availability = clean(row?.availability).toUpperCase();
  const imageUrl = normalizeUrl(row?.["image[0].url"]);
  return {
    vehicleKey: literal(row, "vehicle_id") || vehicleUrl,
    vehicleId: literal(row, "vehicle_id"),
    vin: literal(row, "vin"),
    registration: "",
    make: literal(row, "make"),
    model: literal(row, "model"),
    title: literal(row, "title") || [literal(row, "make"), literal(row, "model")].filter(Boolean).join(" "),
    year: literal(row, "year"),
    price: literal(row, "price"),
    mileage: literal(row, "mileage.value"),
    mileageUnit: literal(row, "mileage.unit") || "MI",
    vehicleUrl,
    imageUrl,
    description,
    availability,
    stateOfVehicle: literal(row, "state_of_vehicle"),
    bodyStyle: literal(row, "body_style"),
    city: literal(row, "address.city"),
    region: literal(row, "address.region"),
    country: literal(row, "address.country"),
    branchKey: branch.branchKey,
    branchSource: branch.source,
    branchConflict: branch.conflict,
    vatLabel: vatLabelFromText(description),
  };
}

export function isEligibleVanscoVehicle(vehicle) {
  return Boolean(
    vehicle
    && vehicle.availability === "AVAILABLE"
    && vehicle.vehicleKey
    && vehicle.vehicleUrl
    && vehicle.imageUrl
    && vehicle.title
    && money(vehicle.price),
  );
}

export function buildVanscoFacebookCaption(vehicle) {
  const branch = VANSCO_BRANCHES[vehicle?.branchKey];
  if (!branch) throw new Error("Vansco branch is unresolved.");
  const price = money(vehicle?.price);
  if (!price) throw new Error("Vansco advertised price is unavailable.");
  const rawTitle = clean(vehicle?.title);
  const year = clean(vehicle?.year);
  const title = year && !new RegExp(`^\\b${year}\\b`).test(rawTitle)
    ? clean(`${year} ${rawTitle}`)
    : rawTitle;
  const mileageValue = clean(vehicle?.mileage).replace(/[^0-9.]/g, "");
  const mileage = mileageValue
    ? Number(mileageValue).toLocaleString("en-GB")
    : "";
  const vat = clean(vehicle?.vatLabel);
  const priceLine = `£${price}${vat ? ` ${vat}` : ""}`;

  return `🚐 NOW AVAILABLE AT VANSCO

${title}

${mileage ? `✅ Mileage: ${mileage} miles\n` : ""}💷 Advertised price: ${priceLine}

📍 ${branch.label}
${branch.address}
📞 ${branch.phone}

🌐 View full details, photos and specification:
${vehicle.vehicleUrl}

Vansco | Southampton's Van Specialists

#Vansco #UsedVans #VanSales #Southampton`;
}

export function extractVanscoVehicleUrl(text) {
  return String(text || "").match(/https:\/\/(?:www\.)?vansco\.co\.uk\/[^\s)]+/i)?.[0] || "";
}

export function vanscoDailySlots(dateKey, requestedLimit = VANSCO_FACEBOOK_MAX_POSTS_PER_DAY) {
  const limit = Math.max(0, Math.min(
    VANSCO_FACEBOOK_MAX_POSTS_PER_DAY,
    Number.parseInt(requestedLimit, 10) || 0,
  ));
  const firstSlotMinutes = 30;
  const intervalMinutes = limit === VANSCO_FACEBOOK_MAX_POSTS_PER_DAY
    ? 40
    : Math.max(1, Math.floor((24 * 60 - firstSlotMinutes) / Math.max(1, limit)));
  return Array.from({ length: limit }, (_, index) => {
    const localMinutes = Math.min(23 * 60 + 59, firstSlotMinutes + index * intervalMinutes);
    return {
      index,
      localMinutes,
      localTime: `${String(Math.floor(localMinutes / 60)).padStart(2, "0")}:${String(localMinutes % 60).padStart(2, "0")}`,
      dueAt: londonLocalMinutesToUtcIso(dateKey, localMinutes),
    };
  });
}

export function chooseVanscoCandidate({ vehicles = [], lastPostedByKey = {}, excludedUrls = [] } = {}) {
  const excluded = new Set((excludedUrls || []).map((value) => clean(value)).filter(Boolean));
  return [...vehicles]
    .filter(isEligibleVanscoVehicle)
    .filter((vehicle) => !excluded.has(vehicle.vehicleUrl))
    .sort((first, second) => {
      const firstLast = new Date(lastPostedByKey?.[first.vehicleKey] || 0).getTime() || 0;
      const secondLast = new Date(lastPostedByKey?.[second.vehicleKey] || 0).getTime() || 0;
      if (firstLast !== secondLast) return firstLast - secondLast;
      return String(first.vehicleKey).localeCompare(String(second.vehicleKey));
    })[0] || null;
}

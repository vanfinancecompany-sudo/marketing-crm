import {
  normalizeVanscoMetaRow,
  parseCsvRecords,
  resolveVanscoBranch,
  vatLabelFromText,
  extractUkRegistration,
} from "../lib/vanscoFacebookAutomation.js";

const META_URL = "https://api.dealerkit.uk/meta-catalogue";
const PAGE_TIMEOUT_MS = 8000;
const PAGE_ATTEMPTS = 2;

function text(value) {
  return String(value ?? "");
}

function stripHtml(value) {
  return text(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchVanscoMetaCatalogue() {
  const username = String(process.env.DEALERKIT_META_USERNAME || "").trim();
  const password = String(process.env.DEALERKIT_META_PASSWORD || "").trim();
  if (!username || !password) {
    throw new Error("DealerKit Meta catalogue credentials are not configured.");
  }

  const response = await fetch(META_URL, {
    method: "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      Accept: "text/csv,text/plain;q=0.9,*/*;q=0.5",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) {
    throw new Error(`DealerKit Meta catalogue returned HTTP ${response.status}.`);
  }

  const raw = await response.text();
  const rows = parseCsvRecords(raw);
  if (!rows.length) throw new Error("DealerKit Meta catalogue returned no vehicle rows.");
  return rows.map(normalizeVanscoMetaRow);
}

export async function enrichVanscoVehicleFromPage(vehicle) {
  const vehicleUrl = String(vehicle?.vehicleUrl || "").trim();
  if (!/^https:\/\/(?:www\.)?vansco\.co\.uk\//i.test(vehicleUrl)) {
    return vehicle;
  }

  let pageText = "";
  for (let attempt = 0; attempt < PAGE_ATTEMPTS && !pageText; attempt += 1) {
    try {
      const response = await fetch(vehicleUrl, {
        method: "GET",
        redirect: "follow",
        cache: "no-store",
        headers: {
          "User-Agent": "VanscoMarketingCRM/1.0",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      });
      if (response.ok) pageText = stripHtml(await response.text());
    } catch {
      pageText = "";
    }
  }

  const resolved = resolveVanscoBranch({
    description: vehicle?.description,
    vehicleUrl,
    city: vehicle?.city,
    pageText,
  });
  const vatFromPage = vatLabelFromText(pageText);
  const registration = extractUkRegistration(pageText);

  return {
    ...vehicle,
    branchKey: resolved.branchKey || vehicle?.branchKey || "",
    branchSource: resolved.branchKey ? resolved.source : vehicle?.branchSource || "",
    branchConflict: resolved.branchKey ? resolved.conflict : Boolean(vehicle?.branchConflict),
    vatLabel: vatFromPage || vehicle?.vatLabel || "",
    registration: registration || vehicle?.registration || "",
    pageChecked: Boolean(pageText),
  };
}

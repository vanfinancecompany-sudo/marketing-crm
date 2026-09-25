import {
  normalizeVanscoMetaRow,
  parseCsvRecords,
  resolveVanscoBranch,
  vatLabelFromStatus,
  vatLabelFromText,
  extractUkRegistration,
} from "../lib/vanscoFacebookAutomation.js";
import {
  CACHE_TABLE,
  fetchVanscoDetailHtml,
  getSupabaseServiceAdmin,
  normalizeUrl as normalizeCacheUrl,
  parseDetailHtml,
} from "./_vansco-cache-utils.js";

const META_URL = "https://api.dealerkit.uk/meta-catalogue";
const PAGE_TIMEOUT_MS = 8000;
const VAT_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const VAT_CACHE_BATCH_SIZE = 80;

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
    .replace(/&pound;/gi, "£")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function cacheRowIsFresh(row, now = Date.now()) {
  const checkedAt = new Date(row?.last_successfully_checked_at || 0).getTime();
  return Number.isFinite(checkedAt)
    && checkedAt > 0
    && now - checkedAt <= VAT_CACHE_MAX_AGE_MS;
}

async function hydrateVanscoVatFromCache(vehicles) {
  const urls = [...new Set(
    (vehicles || [])
      .map((vehicle) => normalizeCacheUrl(vehicle?.vehicleUrl))
      .filter(Boolean),
  )];
  if (!urls.length) return vehicles;

  try {
    const supabase = getSupabaseServiceAdmin();
    const rows = [];
    for (let offset = 0; offset < urls.length; offset += VAT_CACHE_BATCH_SIZE) {
      const chunk = urls.slice(offset, offset + VAT_CACHE_BATCH_SIZE);
      const result = await supabase
        .from(CACHE_TABLE)
        .select("stock_url,vat_status,last_successfully_checked_at,is_currently_on_vansco")
        .eq("is_currently_on_vansco", true)
        .in("stock_url", chunk);
      if (result.error) throw result.error;
      rows.push(...(result.data || []));
    }

    const now = Date.now();
    const vatByUrl = new Map();
    for (const row of rows) {
      const label = vatLabelFromStatus(row?.vat_status);
      const url = normalizeCacheUrl(row?.stock_url);
      if (url && label && cacheRowIsFresh(row, now)) vatByUrl.set(url, label);
    }

    return (vehicles || []).map((vehicle) => {
      if (vehicle?.vatLabel) return vehicle;
      const cachedVat = vatByUrl.get(normalizeCacheUrl(vehicle?.vehicleUrl)) || "";
      return cachedVat
        ? { ...vehicle, vatLabel: cachedVat, vatSource: "vansco_detail_cache" }
        : vehicle;
    });
  } catch (error) {
    console.warn("[vansco-facebook] VAT cache lookup deferred", {
      message: error?.message || String(error),
    });
    return vehicles;
  }
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
  const vehicles = rows.map(normalizeVanscoMetaRow);
  return hydrateVanscoVatFromCache(vehicles);
}

export async function enrichVanscoVehicleFromPage(vehicle) {
  const vehicleUrl = String(vehicle?.vehicleUrl || "").trim();
  if (!/^https:\/\/(?:www\.)?vansco\.co\.uk\//i.test(vehicleUrl)) {
    return vehicle;
  }

  let pageText = "";
  let parsed = null;
  let pageChecked = false;

  try {
    const page = await fetchVanscoDetailHtml(vehicleUrl, PAGE_TIMEOUT_MS);
    if (page?.ok && page?.html) {
      pageChecked = true;
      pageText = stripHtml(page.html);
      parsed = parseDetailHtml(vehicleUrl, page.html, vehicle?.title || "");
    }
  } catch {
    pageText = "";
    parsed = null;
  }

  const resolved = resolveVanscoBranch({
    description: vehicle?.description,
    vehicleUrl,
    city: vehicle?.city,
    pageText,
  });
  const vatFromPage = vatLabelFromStatus(parsed?.vat_status) || vatLabelFromText(pageText);
  const registration = parsed?.registration || extractUkRegistration(pageText);

  return {
    ...vehicle,
    branchKey: resolved.branchKey || vehicle?.branchKey || "",
    branchSource: resolved.branchKey ? resolved.source : vehicle?.branchSource || "",
    branchConflict: resolved.branchKey ? resolved.conflict : Boolean(vehicle?.branchConflict),
    vatLabel: vatFromPage || vehicle?.vatLabel || "",
    vatSource: vatFromPage ? "live_vansco_detail" : vehicle?.vatSource || "",
    registration: registration || vehicle?.registration || "",
    pageChecked,
  };
}

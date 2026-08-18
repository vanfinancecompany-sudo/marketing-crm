import { createClient } from "@supabase/supabase-js";
import { del } from "@vercel/blob";
import { londonDateKey } from "../lib/marketingDailyOperations.js";
import {
  DAILY_YOUTUBE_MIN_IMAGES,
  DAILY_YOUTUBE_SOURCE,
  DAILY_YOUTUBE_TARGET_PER_PRODUCT,
  DAILY_YOUTUBE_TEMPLATE_KEY,
  normalizeDailyYouTubeRegistration,
  selectDailyYouTubeCandidates,
} from "../lib/youtubeDailyBatch.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const HISTORY_LOOKBACK_DAYS = 30;
const WIX_FEEDS = {
  vanFinance: "https://www.vanfinancecompany.co.uk/_functions/marketingVanFinanceImages",
  rent2buy: "https://www.vanfinancecompany.co.uk/_functions/marketingRent2BuyImages",
};

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function authorize(request) {
  const expected = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const header = request.headers[API_KEY_HEADER] || "";
  const auth = request.headers.authorization || "";
  return Boolean(
    expected &&
      (header === expected ||
        (auth.startsWith("Bearer ") && auth.slice(7) === expected)),
  );
}

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing server Supabase environment variables.");
  }
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body);
    } catch {
      return {};
    }
  }
  return request.body;
}

function productKey(value) {
  if (value === "vanFinance" || value === "rent2buy") return value;
  throw new ApiError(400, "Product must be vanFinance or rent2buy.");
}

function clean(value) {
  return String(value ?? "").trim();
}

function extractRegistration(value) {
  const text = clean(value).toUpperCase();
  if (!text) return "";
  const match = text.match(
    /\b([A-Z]{2}[0-9]{2}\s?[A-Z]{3}|[A-Z][0-9]{1,3}\s?[A-Z]{3}|[A-Z]{3}\s?[0-9]{1,3}[A-Z]|[0-9]{1,4}\s?[A-Z]{1,3})\b/,
  );
  return normalizeDailyYouTubeRegistration(match?.[1] || "");
}

function eventProduct(row) {
  return row?.metadata?.product_key === "rent2buy" ? "rent2buy" : "vanFinance";
}

function activeRow(row) {
  return Boolean(row?.metadata?.download_url) && !row?.metadata?.deleted_at;
}

function toReadyReel(row) {
  return {
    id: row.id,
    productKey: eventProduct(row),
    registration: normalizeDailyYouTubeRegistration(row?.metadata?.registration),
    title: clean(row?.metadata?.title),
    filename: clean(row?.metadata?.filename),
    downloadUrl: clean(row?.metadata?.download_url),
    blobPathname: clean(row?.metadata?.blob_pathname),
    sizeBytes: Number(row?.metadata?.size_bytes || 0),
    imageCount: Number(row?.metadata?.image_count || DAILY_YOUTUBE_MIN_IMAGES),
    templateKey: clean(row?.metadata?.template_key || DAILY_YOUTUBE_TEMPLATE_KEY),
    generatedAt: row.occurred_at,
  };
}

async function loadHistoryRows(supabase) {
  const since = new Date(Date.now() - HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const result = await supabase
    .from("marketing_daily_activity_events")
    .select("id,activity_date,activity_type,source,source_id,metadata,occurred_at")
    .eq("source", DAILY_YOUTUBE_SOURCE)
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(1000);
  if (result.error) throw result.error;
  return result.data || [];
}

function todayRows(historyRows) {
  const dateKey = londonDateKey();
  return (historyRows || []).filter((row) => row.activity_date === dateKey);
}

function summarizeProduct(historyRows, key) {
  const today = todayRows(historyRows).filter((row) => eventProduct(row) === key);
  return {
    generatedToday: today.length,
    target: DAILY_YOUTUBE_TARGET_PER_PRODUCT,
    ready: today.filter(activeRow).map(toReadyReel),
    clearedToday: today.filter((row) => row?.metadata?.deleted_at).length,
  };
}

async function fetchWixFeed(key) {
  const response = await fetch(WIX_FEEDS[key], {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`${key} live Wix image feed returned HTTP ${response.status}.`);
  }
  const payload = await response.json();
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items
    .map((item) => ({
      registration: normalizeDailyYouTubeRegistration(item?.registration),
      title: clean(item?.title),
      images: [...new Set((Array.isArray(item?.images) ? item.images : []).map(clean).filter(Boolean))],
    }))
    .filter((item) => item.registration && item.images.length >= DAILY_YOUTUBE_MIN_IMAGES);
}

async function loadStockRows(supabase) {
  const [finance, rent2buy] = await Promise.all([
    supabase
      .from("facebook_adverts")
      .select("id,title,picture,price,vat,salePrice,vanDescription,vanSpec,weblink,is_active")
      .eq("is_active", true)
      .limit(500),
    supabase
      .from("rent_vehicles")
      .select("id,registration,picture,monthly,week,initialRental,vanDescription,vanSpec,webLink,is_active")
      .eq("is_active", true)
      .limit(500),
  ]);
  if (finance.error) throw finance.error;
  if (rent2buy.error) throw rent2buy.error;
  return { finance: finance.data || [], rent2buy: rent2buy.data || [] };
}

function buildFinanceCandidates(feedItems, stockRows) {
  const stockByRegistration = new Map();
  for (const row of stockRows || []) {
    const registration = extractRegistration(row?.title);
    if (registration && !stockByRegistration.has(registration)) {
      stockByRegistration.set(registration, row);
    }
  }

  return feedItems.flatMap((feed) => {
    const stock = stockByRegistration.get(feed.registration);
    if (!stock) return [];
    const title = clean(stock.vanDescription || feed.title || stock.title || feed.registration);
    return [
      {
        productKey: "vanFinance",
        registration: feed.registration,
        title,
        images: feed.images.slice(0, DAILY_YOUTUBE_MIN_IMAGES),
        vehicle: {
          id: stock.id,
          reg: feed.registration,
          registration: feed.registration,
          title: stock.title || feed.registration,
          name: stock.title || feed.registration,
          vanDescription: title,
          description: title,
          price: clean(stock.price),
          vat: clean(stock.vat),
          monthly: clean(stock.salePrice),
          salePrice: clean(stock.salePrice),
          vanSpec: clean(stock.vanSpec),
          spec: clean(stock.vanSpec),
          weblink: clean(stock.weblink),
          link: clean(stock.weblink),
          pipeline: "vanFinance",
        },
      },
    ];
  });
}

function buildRent2BuyCandidates(feedItems, stockRows) {
  const stockByRegistration = new Map();
  for (const row of stockRows || []) {
    const registration = normalizeDailyYouTubeRegistration(row?.registration);
    if (registration && !stockByRegistration.has(registration)) {
      stockByRegistration.set(registration, row);
    }
  }

  return feedItems.flatMap((feed) => {
    const stock = stockByRegistration.get(feed.registration);
    if (!stock) return [];
    const title = clean(stock.vanDescription || feed.title || feed.registration);
    return [
      {
        productKey: "rent2buy",
        registration: feed.registration,
        title,
        images: feed.images.slice(0, DAILY_YOUTUBE_MIN_IMAGES),
        vehicle: {
          id: stock.id,
          reg: feed.registration,
          registration: feed.registration,
          title: feed.registration,
          name: feed.registration,
          vanDescription: title,
          description: title,
          price: clean(stock.initialRental),
          monthly: clean(stock.monthly),
          week: clean(stock.week),
          initialRental: clean(stock.initialRental),
          vanSpec: clean(stock.vanSpec),
          spec: clean(stock.vanSpec),
          weblink: clean(stock.webLink),
          link: clean(stock.webLink),
          pipeline: "rent2buy",
        },
      },
    ];
  });
}

async function candidateOverview(supabase, historyRows) {
  const [feeds, stock] = await Promise.all([
    Promise.all([fetchWixFeed("vanFinance"), fetchWixFeed("rent2buy")]),
    loadStockRows(supabase),
  ]);
  const [financeFeed, rentFeed] = feeds;
  const today = todayRows(historyRows);
  const financeToday = today.filter((row) => eventProduct(row) === "vanFinance").length;
  const rentToday = today.filter((row) => eventProduct(row) === "rent2buy").length;

  const finance = selectDailyYouTubeCandidates({
    candidates: buildFinanceCandidates(financeFeed, stock.finance),
    historyRows,
    generatedToday: financeToday,
  });
  const financeRegistrations = finance.map((item) => item.registration);
  const rent2buy = selectDailyYouTubeCandidates({
    candidates: buildRent2BuyCandidates(rentFeed, stock.rent2buy),
    historyRows,
    generatedToday: rentToday,
    reservedRegistrations: financeRegistrations,
  });

  return {
    finance,
    rent2buy,
    financeEligible: finance.length,
    rent2buyEligible: rent2buy.length,
  };
}

async function recordRenderedReel(supabase, body) {
  const key = productKey(body.productKey);
  const registration = normalizeDailyYouTubeRegistration(body.registration);
  const downloadUrl = clean(body.downloadUrl);
  if (!registration || !downloadUrl) {
    throw new ApiError(400, "Registration and rendered download URL are required.");
  }

  const renderedAt = new Date();
  const sourceId = `youtube-daily:${key}:${registration}:${renderedAt.getTime()}`;
  const activityType = key === "rent2buy" ? "rent2buy_reel" : "van_finance_reel";
  const metadata = {
    product_key: key,
    registration,
    title: clean(body.title),
    filename: clean(body.filename) || `${registration.toLowerCase()}-${key}.mp4`,
    download_url: downloadUrl,
    blob_pathname: clean(body.blobPathname),
    size_bytes: Math.max(0, Number(body.sizeBytes || 0)),
    image_count: DAILY_YOUTUBE_MIN_IMAGES,
    template_key: DAILY_YOUTUBE_TEMPLATE_KEY,
    deleted_at: null,
  };

  const inserted = await supabase
    .from("marketing_daily_activity_events")
    .insert({
      activity_date: londonDateKey(renderedAt),
      activity_type: activityType,
      quantity: 1,
      source: DAILY_YOUTUBE_SOURCE,
      source_id: sourceId,
      metadata,
      occurred_at: renderedAt.toISOString(),
    })
    .select("id,activity_date,metadata,occurred_at")
    .single();
  if (inserted.error) throw inserted.error;
  return toReadyReel(inserted.data);
}

async function clearReadyReels(supabase, historyRows, key) {
  const selected = todayRows(historyRows)
    .filter((row) => eventProduct(row) === key && activeRow(row));
  if (!selected.length) return { deleted: 0 };

  const urls = selected.map((row) => clean(row?.metadata?.download_url)).filter(Boolean);
  if (urls.length) await del(urls);

  const deletedAt = new Date().toISOString();
  for (const row of selected) {
    const updated = await supabase
      .from("marketing_daily_activity_events")
      .update({
        metadata: {
          ...(row.metadata || {}),
          deleted_at: deletedAt,
        },
      })
      .eq("id", row.id);
    if (updated.error) throw updated.error;
  }

  return { deleted: selected.length, deletedAt };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") {
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }
  if (!authorize(request)) {
    return response.status(401).json({ ok: false, message: "Marketing access key not recognised." });
  }

  try {
    const body = parseBody(request);
    const action = clean(body.action || "overview");
    const supabase = getSupabase();
    let historyRows = await loadHistoryRows(supabase);

    if (action === "overview") {
      return response.status(200).json({
        ok: true,
        date: londonDateKey(),
        vanFinance: summarizeProduct(historyRows, "vanFinance"),
        rent2buy: summarizeProduct(historyRows, "rent2buy"),
      });
    }

    if (action === "candidates") {
      const candidates = await candidateOverview(supabase, historyRows);
      return response.status(200).json({
        ok: true,
        date: londonDateKey(),
        ...candidates,
        vanFinance: summarizeProduct(historyRows, "vanFinance"),
        rent2buySummary: summarizeProduct(historyRows, "rent2buy"),
      });
    }

    if (action === "record") {
      const reel = await recordRenderedReel(supabase, body);
      historyRows = await loadHistoryRows(supabase);
      return response.status(200).json({
        ok: true,
        reel,
        vanFinance: summarizeProduct(historyRows, "vanFinance"),
        rent2buy: summarizeProduct(historyRows, "rent2buy"),
      });
    }

    if (action === "clear") {
      const key = productKey(body.productKey);
      const result = await clearReadyReels(supabase, historyRows, key);
      historyRows = await loadHistoryRows(supabase);
      return response.status(200).json({
        ok: true,
        ...result,
        vanFinance: summarizeProduct(historyRows, "vanFinance"),
        rent2buy: summarizeProduct(historyRows, "rent2buy"),
      });
    }

    throw new ApiError(400, "Unknown daily YouTube batch action.");
  } catch (error) {
    console.error("YOUTUBE DAILY BATCH ERROR", error);
    return response.status(error.status || 500).json({
      ok: false,
      message: error.message || "Daily YouTube batch request failed.",
    });
  }
}

import { createClient } from "@supabase/supabase-js";
import { londonDateKeyForValue } from "../lib/bufferAutomation.js";
import {
  BUFFER_API_URL,
  BUFFER_AUTOMATION_POSTS_QUERY,
  parseBufferAutomationPostsPayload,
  bufferDestinationForProduct,
  BUFFER_FACEBOOK_CHANNELS,
} from "../lib/bufferPublishing.js";

const WIX_FEEDS = {
  vanFinance: "https://www.vanfinancecompany.co.uk/_functions/marketingVanFinanceImages",
  rent2buy: "https://www.vanfinancecompany.co.uk/_functions/marketingRent2BuyImages",
};

function normaliseReg(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

async function wixHealth(productKey) {
  const response = await fetch(WIX_FEEDS[productKey], { headers: { Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const eligible = items.filter((item) => {
    const images = [...new Set((Array.isArray(item?.images) ? item.images : []).filter((url) => /^https:\/\//i.test(String(url || ""))))];
    return normaliseReg(item?.registration) && images.length >= 10;
  });
  return { ok: response.ok, status: response.status, total: items.length, eligible10: eligible.length };
}

async function supabaseHealth(productKey, dateKey) {
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const activityType = productKey === "rent2buy" ? "rent2buy_reel" : "van_finance_reel";
  const result = await client
    .from("marketing_daily_activity_events")
    .select("id,metadata")
    .eq("activity_date", dateKey)
    .eq("activity_type", activityType)
    .eq("source", "youtube_daily_batch")
    .limit(100);
  if (result.error) return { ok: false, error: String(result.error.message || result.error) };
  const rows = result.data || [];
  return {
    ok: true,
    rows: rows.length,
    ready: rows.filter((row) => row?.metadata?.download_url && !row?.metadata?.deleted_at).length,
    readyWith10: rows.filter((row) => row?.metadata?.download_url && !row?.metadata?.deleted_at && Number(row?.metadata?.image_count || 0) >= 10).length,
  };
}

async function bufferHealth() {
  const response = await fetch(BUFFER_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${String(process.env.BUFFER_API_KEY || "").trim()}` },
    body: JSON.stringify({ query: BUFFER_AUTOMATION_POSTS_QUERY }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, status: response.status };
  let posts = [];
  try { posts = parseBufferAutomationPostsPayload(payload); } catch (error) { return { ok: false, status: response.status, parseError: String(error?.message || error) }; }
  const summary = {};
  for (const productKey of ["vanFinance", "rent2buy"]) {
    const destination = bufferDestinationForProduct(productKey);
    const channelId = BUFFER_FACEBOOK_CHANNELS[destination];
    const channelPosts = posts.filter((post) => post?.channelId === channelId);
    summary[productKey] = {
      totalRecent: channelPosts.length,
      queued: channelPosts.filter((post) => ["draft", "scheduled", "sending"].includes(String(post?.status || "").toLowerCase())).length,
      recentVideos: channelPosts.filter((post) => (post?.assets || []).some((asset) => /^video\//i.test(String(asset?.mimeType || "")))).length,
    };
  }
  return { ok: true, ...summary };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET") return response.status(405).json({ ok: false });
  if (process.env.VERCEL_ENV === "production") return response.status(404).json({ ok: false });
  const dateKey = londonDateKeyForValue();
  try {
    const [vfWix, r2bWix, vfDb, r2bDb, buffer] = await Promise.all([
      wixHealth("vanFinance"),
      wixHealth("rent2buy"),
      supabaseHealth("vanFinance", dateKey),
      supabaseHealth("rent2buy", dateKey),
      bufferHealth(),
    ]);
    return response.status(200).json({ ok: true, date: dateKey, wix: { vanFinance: vfWix, rent2buy: r2bWix }, ready: { vanFinance: vfDb, rent2buy: r2bDb }, buffer });
  } catch (error) {
    return response.status(500).json({ ok: false, error: String(error?.message || error) });
  }
}

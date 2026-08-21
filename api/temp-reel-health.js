import { createClient } from "@supabase/supabase-js";
import { londonDateKeyForValue } from "../lib/bufferAutomation.js";
import { BUFFER_API_URL, BUFFER_AUTOMATION_POSTS_QUERY, parseBufferAutomationPostsPayload, BUFFER_FACEBOOK_CHANNELS } from "../lib/bufferPublishing.js";

async function ready(productKey, dateKey) {
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const type = productKey === "rent2buy" ? "rent2buy_reel" : "van_finance_reel";
  const result = await client.from("marketing_daily_activity_events").select("metadata").eq("activity_date", dateKey).eq("activity_type", type).eq("source", "youtube_daily_batch").limit(100);
  if (result.error) return { ok: false, error: String(result.error.message || result.error) };
  const active = (result.data || []).filter((row) => row?.metadata?.download_url && !row?.metadata?.deleted_at);
  const media = [];
  for (const row of active.slice(0, 3)) {
    try {
      const mediaResponse = await fetch(String(row.metadata.download_url), { method: "HEAD", redirect: "follow" });
      media.push({ status: mediaResponse.status, ok: mediaResponse.ok, imageCount: Number(row?.metadata?.image_count || 0), sizeBytes: Number(row?.metadata?.size_bytes || 0) });
    } catch (error) {
      media.push({ status: 0, ok: false, error: String(error?.message || error), imageCount: Number(row?.metadata?.image_count || 0) });
    }
  }
  return { ok: true, active: active.length, with10: active.filter((row) => Number(row?.metadata?.image_count || 0) >= 10).length, media };
}

async function buffer() {
  const response = await fetch(BUFFER_API_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${String(process.env.BUFFER_API_KEY || "").trim()}` }, body: JSON.stringify({ query: BUFFER_AUTOMATION_POSTS_QUERY }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) return { ok: false, status: response.status };
  try {
    const posts = parseBufferAutomationPostsPayload(payload);
    const out = {};
    for (const [key, channelId] of [["vanFinance", BUFFER_FACEBOOK_CHANNELS["Van Finance Facebook"]], ["rent2buy", BUFFER_FACEBOOK_CHANNELS["Rent2Buy Facebook"]]]) {
      const rows = posts.filter((post) => post?.channelId === channelId);
      out[key] = {
        scheduled: rows.filter((post) => ["scheduled", "sending", "draft"].includes(String(post?.status || "").toLowerCase())).length,
        video: rows.filter((post) => (post?.assets || []).some((asset) => /^video\//i.test(String(asset?.mimeType || "")))).length,
      };
    }
    return { ok: true, ...out };
  } catch (error) { return { ok: false, error: String(error?.message || error) }; }
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET") return response.status(405).json({ ok: false });
  const dateKey = londonDateKeyForValue();
  const [vanFinance, rent2buy, bufferState] = await Promise.all([ready("vanFinance", dateKey), ready("rent2buy", dateKey), buffer()]);
  return response.status(200).json({ ok: true, date: dateKey, ready: { vanFinance, rent2buy }, buffer: bufferState });
}

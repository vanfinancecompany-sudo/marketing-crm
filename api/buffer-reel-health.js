import { createClient } from "@supabase/supabase-js";
import { londonDateKeyForValue } from "../lib/bufferAutomation.js";
import {
  BUFFER_API_URL,
  BUFFER_AUTOMATION_POSTS_QUERY,
  BUFFER_FACEBOOK_CHANNELS,
  parseBufferAutomationPostsPayload,
} from "../lib/bufferPublishing.js";

function hasVideo(post) {
  return (post?.assets || []).some((asset) => /^video\//i.test(String(asset?.mimeType || "")));
}

async function loadReady(productKey, dateKey) {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );
  const activityType = productKey === "rent2buy" ? "rent2buy_reel" : "van_finance_reel";
  const result = await supabase
    .from("marketing_daily_activity_events")
    .select("metadata")
    .eq("activity_date", dateKey)
    .eq("activity_type", activityType)
    .eq("source", "youtube_daily_batch")
    .limit(100);
  if (result.error) throw result.error;
  const active = (result.data || []).filter((row) => row?.metadata?.download_url && !row?.metadata?.deleted_at);
  return {
    active: active.length,
    withTenImages: active.filter((row) => Number(row?.metadata?.image_count || 0) >= 10).length,
  };
}

async function loadBuffer() {
  const response = await fetch(BUFFER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${String(process.env.BUFFER_API_KEY || "").trim()}`,
    },
    body: JSON.stringify({ query: BUFFER_AUTOMATION_POSTS_QUERY }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Buffer HTTP ${response.status}`);
  const posts = parseBufferAutomationPostsPayload(payload);
  const output = {};
  for (const [key, channelId] of [
    ["vanFinance", BUFFER_FACEBOOK_CHANNELS["Van Finance Facebook"]],
    ["rent2buy", BUFFER_FACEBOOK_CHANNELS["Rent2Buy Facebook"]],
  ]) {
    const rows = posts.filter((post) => post?.channelId === channelId);
    output[key] = {
      queued: rows.filter((post) => ["draft", "scheduled", "sending"].includes(String(post?.status || "").toLowerCase())).length,
      queuedVideo: rows.filter((post) => ["draft", "scheduled", "sending"].includes(String(post?.status || "").toLowerCase()) && hasVideo(post)).length,
      sentVideo: rows.filter((post) => String(post?.status || "").toLowerCase() === "sent" && hasVideo(post)).length,
    };
  }
  return output;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "GET") return response.status(405).json({ ok: false });
  try {
    const dateKey = londonDateKeyForValue();
    const [vanFinance, rent2buy, buffer] = await Promise.all([
      loadReady("vanFinance", dateKey),
      loadReady("rent2buy", dateKey),
      loadBuffer(),
    ]);
    return response.status(200).json({ ok: true, dateKey, ready: { vanFinance, rent2buy }, buffer });
  } catch (error) {
    return response.status(500).json({ ok: false, error: String(error?.message || error) });
  }
}

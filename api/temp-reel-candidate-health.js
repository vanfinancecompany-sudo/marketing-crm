import { createClient } from "@supabase/supabase-js";
import { londonDateKeyForValue } from "../lib/bufferAutomation.js";

function safe(value) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

async function run(productKey) {
  const client = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );
  const dateKey = londonDateKeyForValue();
  const activityType = productKey === "rent2buy" ? "rent2buy_reel" : "van_finance_reel";
  const result = await client
    .from("marketing_daily_activity_events")
    .select("id,activity_date,activity_type,source,source_id,metadata,occurred_at")
    .eq("activity_date", dateKey)
    .eq("activity_type", activityType)
    .eq("source", "youtube_daily_batch")
    .order("occurred_at", { ascending: true })
    .limit(100);

  return {
    ok: !result.error,
    error: result.error ? safe(result.error) : "",
    rows: (result.data || []).length,
    active: (result.data || []).filter((row) => row?.metadata?.download_url && !row?.metadata?.deleted_at).length,
    registrations: (result.data || [])
      .filter((row) => row?.metadata?.download_url && !row?.metadata?.deleted_at)
      .map((row) => String(row?.metadata?.registration || ""))
      .filter(Boolean)
      .slice(0, 20),
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(200).json({ ok: false, stage: "config", error: "Supabase config missing" });
    }
    const [vanFinance, rent2buy] = await Promise.all([run("vanFinance"), run("rent2buy")]);
    return res.status(200).json({
      ok: vanFinance.ok && rent2buy.ok,
      stage: "ready-reel-query",
      date: londonDateKeyForValue(),
      vanFinance,
      rent2buy,
    });
  } catch (error) {
    return res.status(200).json({ ok: false, stage: "exception", error: safe(error?.message || error) });
  }
}

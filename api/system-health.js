import { createClient } from "@supabase/supabase-js";
import {
  BUFFER_API_URL,
  BUFFER_AUTOMATION_POSTS_QUERY,
  BUFFER_FACEBOOK_CHANNELS,
  parseBufferAutomationPostsPayload,
} from "../lib/bufferPublishing.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function supabaseClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase server connection is not configured.");
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function issue(key, label, message, extra = {}) {
  return { key, label, status: "failed", message, ...extra };
}

function normaliseRegistration(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

async function checkSupabase() {
  const supabase = supabaseClient();
  const result = await supabase
    .from("marketing_daily_activity_events")
    .select("id,activity_type,source,occurred_at,metadata")
    .order("occurred_at", { ascending: false })
    .limit(1);
  if (result.error) throw result.error;
  return { ok: true };
}

async function checkBuffer() {
  const token = String(process.env.BUFFER_API_KEY || "").trim();
  if (!token) throw new Error("Buffer API key is not configured.");

  const response = await fetch(BUFFER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query: BUFFER_AUTOMATION_POSTS_QUERY }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.errors?.[0]?.message || `Buffer returned HTTP ${response.status}.`);

  const posts = parseBufferAutomationPostsPayload(payload);
  const channelIds = new Set([
    BUFFER_FACEBOOK_CHANNELS["Van Finance Facebook"],
    BUFFER_FACEBOOK_CHANNELS["Rent2Buy Facebook"],
  ].filter(Boolean));
  const relevant = posts.filter((post) => channelIds.has(post?.channelId));
  const failed = relevant.filter((post) => ["failed", "error"].includes(String(post?.status || "").toLowerCase()));

  if (failed.length) {
    return {
      ok: false,
      issue: issue(
        "buffer-publishing",
        "Buffer publishing",
        `${failed.length} Facebook post${failed.length === 1 ? " is" : "s are"} currently marked failed in Buffer.`,
      ),
    };
  }
  return { ok: true };
}

async function checkRecentAutomationActivity() {
  const supabase = supabaseClient();
  const since = new Date(Date.now() - 2 * DAY).toISOString();
  const result = await supabase
    .from("marketing_daily_activity_events")
    .select("activity_type,source,occurred_at,metadata")
    .gte("occurred_at", since)
    .in("activity_type", [
      "van_finance_facebook_post",
      "rent2buy_facebook_post",
      "van_finance_reel",
      "rent2buy_reel",
    ])
    .order("occurred_at", { ascending: false })
    .limit(1000);
  if (result.error) throw result.error;

  const rows = result.data || [];
  const published = rows.filter((row) => row?.source === "buffer_publish" || row?.metadata?.facebook_live === true);
  const latest = published[0]?.occurred_at || null;

  // This is deliberately a wide threshold. The watchdog should catch a silent halt,
  // not complain merely because there was no suitable stock to publish for a few hours.
  if (!latest || Date.now() - new Date(latest).getTime() > 48 * HOUR) {
    return {
      ok: false,
      issue: issue(
        "facebook-automation-stale",
        "Facebook automation",
        "No confirmed Finance or Rent2Buy Facebook publish has been recorded for more than 48 hours.",
        { last_success_at: latest },
      ),
    };
  }

  return { ok: true };
}

async function checkDuplicateReels() {
  const supabase = supabaseClient();
  const since = new Date(Date.now() - DAY).toISOString();
  const result = await supabase
    .from("marketing_daily_activity_events")
    .select("activity_type,source,occurred_at,metadata")
    .gte("occurred_at", since)
    .in("activity_type", ["van_finance_reel", "rent2buy_reel"])
    .order("occurred_at", { ascending: false })
    .limit(1000);
  if (result.error) throw result.error;

  const seen = new Map();
  const duplicates = new Set();
  for (const row of result.data || []) {
    if (!(row?.source === "buffer_publish" || row?.metadata?.facebook_live === true)) continue;
    const registration = normaliseRegistration(row?.metadata?.registration || row?.metadata?.reg);
    if (!registration) continue;
    const product = row.activity_type === "rent2buy_reel" ? "Rent2Buy" : "Van Finance";
    const key = `${product}:${registration}`;
    if (seen.has(key)) duplicates.add(key);
    else seen.set(key, row.occurred_at);
  }

  if (duplicates.size) {
    return {
      ok: false,
      issue: issue(
        "duplicate-reels",
        "Reel duplicate protection",
        `Possible duplicate reel publishing detected in the last 24 hours: ${Array.from(duplicates).join(", ")}.`,
      ),
    };
  }
  return { ok: true };
}

async function runCheck(name, task) {
  try {
    return await task();
  } catch (error) {
    return {
      ok: false,
      issue: issue(name, name, error?.message || String(error)),
    };
  }
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const checks = await Promise.all([
    runCheck("Supabase", checkSupabase),
    runCheck("Buffer", checkBuffer),
    runCheck("Facebook automation", checkRecentAutomationActivity),
    runCheck("Reel duplicate protection", checkDuplicateReels),
  ]);
  const issues = checks.filter((check) => !check.ok && check.issue).map((check) => check.issue);

  return response.status(200).json({
    ok: issues.length === 0,
    status: issues.length ? "red" : "green",
    checked_at: new Date().toISOString(),
    checks: {
      supabase: checks[0].ok,
      buffer: checks[1].ok,
      facebook_automation: checks[2].ok,
      reel_duplicate_protection: checks[3].ok,
    },
    issues,
  });
}

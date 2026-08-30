import { createClient } from "@supabase/supabase-js";
import {
  BUFFER_API_URL,
  BUFFER_AUTOMATION_POSTS_QUERY,
  BUFFER_FACEBOOK_CHANNELS,
  parseBufferAutomationPostsPayload,
} from "../lib/bufferPublishing.js";
import {
  guardedBufferGraphql,
  isBufferRateLimitCooldownError,
} from "../lib/bufferRuntimeGuard.js";

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

function ageMs(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) && timestamp > 0 ? Date.now() - timestamp : Number.POSITIVE_INFINITY;
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

  let payload;
  try {
    payload = await guardedBufferGraphql({
      url: BUFFER_API_URL,
      token,
      query: BUFFER_AUTOMATION_POSTS_QUERY,
    });
  } catch (error) {
    if (isBufferRateLimitCooldownError(error)) {
      return {
        ok: true,
        degraded: true,
        reason: "buffer_rate_limit_cooldown",
        retry_after_ms: error.retryAfterMs,
      };
    }
    throw error;
  }

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
  const since = new Date(Date.now() - 3 * DAY).toISOString();
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
    .limit(1500);
  if (result.error) throw result.error;

  const rows = (result.data || []).filter(
    (row) => row?.source === "buffer_publish" || row?.metadata?.facebook_live === true,
  );
  const latestByProduct = {
    vanFinance: rows.find((row) => String(row.activity_type || "").startsWith("van_finance_"))?.occurred_at || null,
    rent2buy: rows.find((row) => String(row.activity_type || "").startsWith("rent2buy_"))?.occurred_at || null,
  };

  const stale = [];
  if (!latestByProduct.vanFinance || ageMs(latestByProduct.vanFinance) > 48 * HOUR) stale.push("Van Finance");
  if (!latestByProduct.rent2buy || ageMs(latestByProduct.rent2buy) > 48 * HOUR) stale.push("Rent2Buy");

  if (stale.length) {
    return {
      ok: false,
      issue: issue(
        "facebook-automation-stale",
        "Facebook automation",
        `No confirmed Facebook publish has been recorded for more than 48 hours for: ${stale.join(", ")}.`,
        {
          last_success_at: [latestByProduct.vanFinance, latestByProduct.rent2buy]
            .filter(Boolean)
            .sort()
            .at(-1) || null,
        },
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

async function checkEmailCampaigns() {
  const supabase = supabaseClient();
  const since = new Date(Date.now() - 2 * DAY).toISOString();
  const result = await supabase
    .from("marketing_email_sends")
    .select("id,status,created_at,updated_at,started_at,completed_at,error_summary,failed_count,sent_count,metadata")
    .eq("send_type", "production")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(100);
  if (result.error) throw result.error;

  const rows = result.data || [];
  const attention = rows.find((row) => String(row?.metadata?.queue_state || "") === "attention");
  if (attention) {
    return {
      ok: false,
      issue: issue(
        "email-queue-attention",
        "Email campaign worker",
        attention.error_summary || "An email campaign queue requires reconciliation before retrying.",
        { last_success_at: attention.updated_at || attention.started_at || null },
      ),
    };
  }

  const staleSending = rows.find((row) => {
    if (String(row.status || "") !== "sending") return false;
    const heartbeat = row?.metadata?.worker_last_run_at || row.updated_at || row.started_at || row.created_at;
    return ageMs(heartbeat) > 20 * 60 * 1000;
  });
  if (staleSending) {
    return {
      ok: false,
      issue: issue(
        "email-worker-stale",
        "Email campaign worker",
        "A production email campaign is still marked sending but its worker has not updated for more than 20 minutes.",
        { last_success_at: staleSending?.metadata?.worker_last_run_at || staleSending.updated_at || null },
      ),
    };
  }

  const failedSend = rows.find((row) => String(row.status || "") === "failed" && ageMs(row.updated_at || row.completed_at || row.created_at) < DAY);
  if (failedSend) {
    return {
      ok: false,
      issue: issue(
        "email-send-failed",
        "Email campaigns",
        failedSend.error_summary || "A production email campaign has failed within the last 24 hours.",
        { last_success_at: failedSend.updated_at || failedSend.completed_at || null },
      ),
    };
  }

  return { ok: true };
}

async function checkUnknownEmailSubmissions() {
  const supabase = supabaseClient();
  const since = new Date(Date.now() - DAY).toISOString();
  const result = await supabase
    .from("marketing_email_send_recipients")
    .select("id,last_event_at,failure_reason")
    .eq("send_type", "production")
    .eq("status", "submission_unknown")
    .gte("last_event_at", since)
    .order("last_event_at", { ascending: false })
    .limit(20);
  if (result.error) throw result.error;
  const rows = result.data || [];
  if (rows.length) {
    return {
      ok: false,
      issue: issue(
        "email-submission-unknown",
        "Email delivery",
        `${rows.length} email submission${rows.length === 1 ? " has" : "s have"} an unknown provider outcome and need checking before retry.`,
        { last_success_at: rows[0]?.last_event_at || null },
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
    runCheck("Email campaign worker", checkEmailCampaigns),
    runCheck("Email delivery", checkUnknownEmailSubmissions),
  ]);
  const issues = checks.filter((check) => !check.ok && check.issue).map((check) => check.issue);

  const degraded = checks
    .map((check, index) => ({ check, index }))
    .filter(({ check }) => check?.degraded)
    .map(({ check, index }) => ({
      key: ["Supabase", "Buffer", "Facebook automation", "Reel duplicate protection", "Email campaign worker", "Email delivery"][index],
      reason: check.reason || "temporarily_degraded",
      retry_after_ms: check.retry_after_ms || null,
    }));

  return response.status(200).json({
    ok: issues.length === 0,
    status: issues.length ? "red" : "green",
    checked_at: new Date().toISOString(),
    degraded,
    checks: {
      supabase: checks[0].ok,
      buffer: checks[1].ok,
      facebook_automation: checks[2].ok,
      reel_duplicate_protection: checks[3].ok,
      email_campaign_worker: checks[4].ok,
      email_delivery: checks[5].ok,
    },
    issues,
  });
}

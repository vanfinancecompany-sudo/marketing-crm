import { createClient } from "@supabase/supabase-js";
import { loadBufferAutomationConfig } from "../lib/bufferAutomationConfig.js";
import { extractBufferRegistration } from "../lib/bufferAutomation.js";
import {
  BUFFER_API_URL,
  BUFFER_FACEBOOK_CHANNELS,
  BUFFER_ORGANIZATION_ID,
  parseBufferAutomationPostsPayload,
} from "../lib/bufferPublishing.js";
import {
  guardedBufferGraphql,
  isBufferRateLimitCooldownError,
} from "../lib/bufferRuntimeGuard.js";
import { loadCarslinkSyncStatus } from "../lib/carslinkSyncState.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function bufferHealthPostsQuery(channelIds) {
  const ids = [...new Set((channelIds || []).map((value) => String(value || "").trim()).filter(Boolean))];
  const channelList = ids.map((value) => JSON.stringify(value)).join(", ");
  return `
    query GetSystemHealthBufferPosts {
      posts(
        first: 100
        input: {
          organizationId: ${JSON.stringify(BUFFER_ORGANIZATION_ID)}
          sort: [{ field: createdAt, direction: desc }]
          filter: {
            status: [draft, scheduled, sending, sent, error]
            channelIds: [${channelList}]
          }
        }
      ) {
        edges {
          node {
            id
            text
            status
            schedulingType
            createdAt
            dueAt
            sentAt
            channelId
            metadata {
              ... on FacebookPostMetadata { type }
            }
            assets { id mimeType source }
          }
        }
      }
    }
  `;
}

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

function durationMs(start, end) {
  const startMs = new Date(start || 0).getTime();
  const endMs = new Date(end || 0).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !startMs || !endMs || endMs < startMs) return null;
  return endMs - startMs;
}

function nextHourlyAt(minute, now = new Date()) {
  const next = new Date(now);
  next.setUTCSeconds(0, 0);
  if (next.getUTCMinutes() >= minute) next.setUTCHours(next.getUTCHours() + 1);
  next.setUTCMinutes(minute);
  return next.toISOString();
}

function nextMinuteAt(now = new Date()) {
  const next = new Date(now);
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(next.getUTCMinutes() + 1);
  return next.toISOString();
}

function nextDailyAt(hour, minute = 0, now = new Date()) {
  const next = new Date(now);
  next.setUTCSeconds(0, 0);
  next.setUTCHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

function automationItem({
  key,
  label,
  cadence,
  status = "scheduled",
  lastAttemptAt = null,
  lastSuccessAt = null,
  duration = null,
  nextExpectedAt = null,
  lastError = "",
  telemetry = "live",
  detail = "",
}) {
  return {
    key,
    label,
    cadence,
    status,
    last_attempt_at: lastAttemptAt,
    last_success_at: lastSuccessAt,
    duration_ms: duration,
    next_expected_at: nextExpectedAt,
    last_error: lastError || "",
    telemetry,
    detail,
  };
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

function bufferFailureLabel(post, channelLabels) {
  const channel = channelLabels.get(String(post?.channelId || "")) || "Buffer channel";
  const registration = extractBufferRegistration(post?.text);
  return `${channel}${registration ? ` ${registration}` : ""}`;
}

async function checkBuffer() {
  const startedAt = Date.now();
  const checkedAt = () => new Date().toISOString();
  const token = String(process.env.BUFFER_API_KEY || "").trim();
  if (!token) throw new Error("Buffer API key is not configured.");

  const config = await loadBufferAutomationConfig({ useDailyTargets: false });
  const instagramEnabled = config?.vanFinanceInstagramEnabled !== false;
  const instagramChannelId = String(config?.vanFinanceInstagramChannelId || "").trim();
  if (instagramEnabled && !instagramChannelId) {
    const timestamp = checkedAt();
    return {
      ok: false,
      facebook_ok: true,
      instagram_ok: false,
      instagram_issue: "Van Finance Instagram is enabled but its Buffer channel ID has not been persisted, so failures cannot be monitored safely.",
      checked_at: timestamp,
      duration_ms: Date.now() - startedAt,
      issue: issue(
        "buffer-instagram-monitoring",
        "Buffer Instagram monitoring",
        "Van Finance Instagram is enabled but its Buffer channel ID has not been persisted, so failures cannot be monitored safely.",
      ),
    };
  }

  const financeFacebook = BUFFER_FACEBOOK_CHANNELS["Van Finance Facebook"];
  const rentFacebook = BUFFER_FACEBOOK_CHANNELS["Rent2Buy Facebook"];
  const channelIds = [financeFacebook, rentFacebook, instagramEnabled ? instagramChannelId : ""].filter(Boolean);
  const channelLabels = new Map([
    [financeFacebook, "Van Finance Facebook"],
    [rentFacebook, "Rent2Buy Facebook"],
    ...(instagramEnabled && instagramChannelId ? [[instagramChannelId, "Van Finance Instagram"]] : []),
  ]);

  let payload;
  try {
    payload = await guardedBufferGraphql({
      url: BUFFER_API_URL,
      token,
      query: bufferHealthPostsQuery(channelIds),
    });
  } catch (error) {
    if (isBufferRateLimitCooldownError(error)) {
      return {
        ok: true,
        facebook_ok: true,
        instagram_ok: true,
        checked_at: checkedAt(),
        duration_ms: Date.now() - startedAt,
        degraded: true,
        reason: "buffer_rate_limit_cooldown",
        retry_after_ms: error.retryAfterMs,
      };
    }
    throw error;
  }

  const posts = parseBufferAutomationPostsPayload(payload);
  const failed = posts.filter((post) => ["failed", "error"].includes(String(post?.status || "").toLowerCase()));
  const facebookFailed = failed.filter((post) => post?.channelId === financeFacebook || post?.channelId === rentFacebook);
  const instagramFailed = instagramEnabled
    ? failed.filter((post) => post?.channelId === instagramChannelId)
    : [];
  const timestamp = checkedAt();
  const base = {
    facebook_ok: facebookFailed.length === 0,
    instagram_ok: instagramFailed.length === 0,
    instagram_issue: instagramFailed.length
      ? `${instagramFailed.length} Van Finance Instagram post${instagramFailed.length === 1 ? " is" : "s are"} currently marked failed in Buffer.`
      : "",
    checked_at: timestamp,
    duration_ms: Date.now() - startedAt,
  };

  if (failed.length) {
    const descriptions = failed.slice(0, 5).map((post) => bufferFailureLabel(post, channelLabels));
    const extra = failed.length > descriptions.length ? `, plus ${failed.length - descriptions.length} more` : "";
    return {
      ...base,
      ok: false,
      issue: issue(
        "buffer-publishing",
        "Buffer publishing",
        `${failed.length} Buffer publish failure${failed.length === 1 ? " is" : "s are"} currently marked failed: ${descriptions.join(", ")}${extra}.`,
      ),
    };
  }
  return { ...base, ok: true };
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
      latestByProduct,
    };
  }

  return { ok: true, latestByProduct };
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

async function checkCarslink() {
  const configured = Boolean(String(process.env.CARSLINK_PRODUCTION_API_KEY || "").trim());
  if (!configured) {
    return {
      ok: false,
      issue: issue(
        "carslink-not-configured",
        "CarsLink stock sync",
        "CarsLink production is not configured.",
      ),
    };
  }

  const status = await loadCarslinkSyncStatus();
  const lastSuccessAt = status?.lastSuccessAt || null;

  if (status?.automaticEnabled === false) {
    return {
      ok: false,
      issue: issue(
        "carslink-automatic-disabled",
        "CarsLink stock sync",
        "CarsLink automatic stock checking is disabled.",
        { last_success_at: lastSuccessAt },
      ),
      status,
    };
  }

  if (status?.state === "error" || status?.lastError) {
    return {
      ok: false,
      issue: issue(
        "carslink-error",
        "CarsLink stock sync",
        status?.lastError || "CarsLink is reporting a stock sync error.",
        { last_success_at: lastSuccessAt },
      ),
      status,
    };
  }

  if (ageMs(status?.lastCheckedAt) > 3 * HOUR) {
    return {
      ok: false,
      issue: issue(
        "carslink-check-stale",
        "CarsLink stock sync",
        "CarsLink automatic stock checking has not completed for more than 3 hours.",
        { last_success_at: lastSuccessAt },
      ),
      status,
    };
  }

  if (ageMs(lastSuccessAt) > 18 * HOUR) {
    return {
      ok: false,
      issue: issue(
        "carslink-sync-stale",
        "CarsLink stock sync",
        "CarsLink has not completed a successful production stock sync for more than 18 hours.",
        { last_success_at: lastSuccessAt },
      ),
      status,
    };
  }

  return { ok: true, status };
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
      latest: rows[0] || null,
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
      latest: rows[0] || null,
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
      latest: rows[0] || null,
    };
  }

  return { ok: true, latest: rows[0] || null };
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

async function loadAutomationEvidence() {
  const supabase = supabaseClient();
  const [vanscoResult, editorialResult, activityResult, emailResult, carslink] = await Promise.all([
    supabase
      .from("vansco_refresh_runs")
      .select("status,stage,started_at,updated_at,completed_at,last_error,success_count,failure_count")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("knowledge_automation_runs")
      .select("status,started_at,completed_at,duration_ms,error_message,jobs_claimed,jobs_succeeded,jobs_failed")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("marketing_daily_activity_events")
      .select("activity_type,source,occurred_at,metadata")
      .gte("occurred_at", new Date(Date.now() - 7 * DAY).toISOString())
      .order("occurred_at", { ascending: false })
      .limit(2000),
    supabase
      .from("marketing_email_sends")
      .select("status,created_at,updated_at,started_at,completed_at,error_summary,metadata")
      .eq("send_type", "production")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    loadCarslinkSyncStatus(),
  ]);

  if (vanscoResult.error) throw vanscoResult.error;
  if (editorialResult.error) throw editorialResult.error;
  if (activityResult.error) throw activityResult.error;
  if (emailResult.error) throw emailResult.error;

  return {
    vansco: vanscoResult.data || null,
    editorial: editorialResult.data || null,
    activity: activityResult.data || [],
    email: emailResult.data || null,
    carslink,
  };
}

function latestActivity(rows, predicate) {
  return (rows || []).find(predicate)?.occurred_at || null;
}

function buildAutomationCentre(evidence, checkMap) {
  const now = new Date();
  const activity = evidence?.activity || [];
  const facebookLast = latestActivity(
    activity,
    (row) => row?.source === "buffer_publish" && ["van_finance_facebook_post", "rent2buy_facebook_post", "van_finance_reel", "rent2buy_reel"].includes(String(row?.activity_type || "")),
  );
  const instagramLast = latestActivity(activity, (row) => /instagram/i.test(`${row?.activity_type || ""} ${row?.source || ""}`));
  const storyLast = latestActivity(activity, (row) => /story/i.test(`${row?.activity_type || ""} ${row?.source || ""}`));
  const priceSyncLast = latestActivity(activity, (row) => /rent2buy.*price|price.*rent2buy/i.test(`${row?.activity_type || ""} ${row?.source || ""}`));

  const vansco = evidence?.vansco || {};
  const vanscoStatus = String(vansco.status || "").toLowerCase();
  const vanscoOk = !["failed", "error"].includes(vanscoStatus) && ageMs(vansco.started_at) < 36 * HOUR;
  const editorial = evidence?.editorial || {};
  const editorialStatus = String(editorial.status || "").toLowerCase();
  const editorialOk = !["failed", "error"].includes(editorialStatus) && (!editorial.started_at || ageMs(editorial.started_at) < 4 * HOUR);
  const carslink = evidence?.carslink || {};
  const email = evidence?.email || {};

  return [
    automationItem({
      key: "vansco_stock_refresh",
      label: "Vansco overnight stock refresh",
      cadence: "Daily at 02:00 UTC",
      status: vansco.started_at ? (vanscoOk ? (vanscoStatus === "running" ? "running" : "healthy") : "failed") : "waiting",
      lastAttemptAt: vansco.started_at || null,
      lastSuccessAt: vanscoStatus === "complete" ? (vansco.completed_at || vansco.updated_at || null) : null,
      duration: durationMs(vansco.started_at, vansco.completed_at),
      nextExpectedAt: nextDailyAt(2, 0, now),
      lastError: vansco.last_error || "",
      detail: "Current Dragon/Vansco cache refresh. Advisory stock comparison only.",
    }),
    automationItem({
      key: "facebook_automation",
      label: "Facebook publishing automation",
      cadence: "Hourly at :05",
      status: checkMap.facebook ? "healthy" : "failed",
      lastSuccessAt: facebookLast,
      nextExpectedAt: nextHourlyAt(5, now),
      lastError: checkMap.facebookIssue || "",
      detail: "Van Finance and Rent2Buy Facebook publishing via Buffer.",
    }),
    automationItem({
      key: "instagram_mirror",
      label: "Instagram mirror",
      cadence: "Hourly at :14",
      status: checkMap.instagram ? "healthy" : "failed",
      lastAttemptAt: checkMap.bufferCheckedAt || null,
      lastSuccessAt: checkMap.instagram ? (instagramLast || checkMap.bufferCheckedAt || null) : instagramLast,
      duration: checkMap.bufferDuration,
      nextExpectedAt: nextHourlyAt(14, now),
      lastError: checkMap.instagramIssue || "",
      telemetry: "live",
      detail: checkMap.instagram
        ? "Van Finance Instagram Buffer outcomes are checked live; failed mirrors are surfaced here."
        : "Buffer is reporting a Van Finance Instagram publishing or monitoring failure.",
    }),
    automationItem({
      key: "editorial_automation",
      label: "Editorial automation",
      cadence: "Hourly at :17",
      status: editorial.started_at ? (editorialOk ? (editorialStatus === "running" ? "running" : "healthy") : "failed") : "waiting",
      lastAttemptAt: editorial.started_at || null,
      lastSuccessAt: editorialStatus === "complete" || editorialStatus === "completed" || editorialStatus === "success" ? (editorial.completed_at || null) : null,
      duration: editorial.duration_ms || durationMs(editorial.started_at, editorial.completed_at),
      nextExpectedAt: nextHourlyAt(17, now),
      lastError: editorial.error_message || "",
      detail: `Latest run: ${editorial.jobs_succeeded || 0} succeeded, ${editorial.jobs_failed || 0} failed.`,
    }),
    automationItem({
      key: "rent2buy_price_sync",
      label: "Rent2Buy monthly-price sync",
      cadence: "Hourly at :23",
      status: priceSyncLast ? "healthy" : "scheduled",
      lastSuccessAt: priceSyncLast,
      nextExpectedAt: nextHourlyAt(23, now),
      telemetry: priceSyncLast ? "live" : "schedule_only",
      detail: priceSyncLast ? "Recent price-sync activity found." : "Schedule is monitored; dedicated heartbeat telemetry will be added only if this sync becomes operationally critical.",
    }),
    automationItem({
      key: "facebook_story",
      label: "Facebook Story automation",
      cadence: "Hourly at :25",
      status: storyLast ? "healthy" : "scheduled",
      lastSuccessAt: storyLast,
      nextExpectedAt: nextHourlyAt(25, now),
      telemetry: storyLast ? "live" : "schedule_only",
      detail: storyLast ? "Recent Story activity found." : "Schedule is monitored; this worker does not yet emit its own heartbeat record.",
    }),
    automationItem({
      key: "buffer_status",
      label: "Buffer channel health",
      cadence: "Live health check",
      status: checkMap.buffer ? "healthy" : "failed",
      lastAttemptAt: checkMap.bufferCheckedAt || null,
      lastSuccessAt: checkMap.buffer ? (checkMap.bufferCheckedAt || null) : null,
      duration: checkMap.bufferDuration,
      nextExpectedAt: nextHourlyAt(35, now),
      lastError: checkMap.bufferIssue || "",
      detail: "Checks current Facebook and Instagram Buffer outcomes; publish-status reconciliation still runs hourly at :35.",
    }),
    automationItem({
      key: "carslink_stock_sync",
      label: "CarsLink production stock sync",
      cadence: "Hourly at :47",
      status: checkMap.carslink ? "healthy" : "failed",
      lastAttemptAt: carslink.lastAttemptAt || carslink.lastCheckedAt || null,
      lastSuccessAt: carslink.lastSuccessAt || null,
      nextExpectedAt: nextHourlyAt(47, now),
      lastError: carslink.lastError || checkMap.carslinkIssue || "",
      detail: "Change-detection sync with a forced refresh at least every 12 hours.",
    }),
    automationItem({
      key: "email_campaign_worker",
      label: "Email campaign worker",
      cadence: "Every minute",
      status: checkMap.email ? "healthy" : "failed",
      lastAttemptAt: email?.metadata?.worker_last_run_at || email.updated_at || email.started_at || null,
      lastSuccessAt: String(email.status || "").toLowerCase() === "completed" ? (email.completed_at || email.updated_at || null) : null,
      duration: durationMs(email.started_at, email.completed_at),
      nextExpectedAt: nextMinuteAt(now),
      lastError: email.error_summary || checkMap.emailIssue || "",
      detail: "Production campaign queue and worker state.",
    }),
    automationItem({
      key: "email_orphan_worker",
      label: "Email orphan recovery worker",
      cadence: "Every minute",
      status: checkMap.email ? "healthy" : "failed",
      nextExpectedAt: nextMinuteAt(now),
      lastError: checkMap.emailIssue || "",
      telemetry: "shared",
      detail: "Shares campaign queue health until a dedicated orphan-worker heartbeat is needed.",
    }),
  ];
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
    runCheck("CarsLink stock sync", checkCarslink),
    runCheck("Email campaign worker", checkEmailCampaigns),
    runCheck("Email delivery", checkUnknownEmailSubmissions),
  ]);
  const issues = checks.filter((check) => !check.ok && check.issue).map((check) => check.issue);

  const degraded = checks
    .map((check, index) => ({ check, index }))
    .filter(({ check }) => check?.degraded)
    .map(({ check, index }) => ({
      key: ["Supabase", "Buffer", "Facebook automation", "Reel duplicate protection", "CarsLink stock sync", "Email campaign worker", "Email delivery"][index],
      reason: check.reason || "temporarily_degraded",
      retry_after_ms: check.retry_after_ms || null,
    }));

  let automations = [];
  try {
    const evidence = await loadAutomationEvidence();
    automations = buildAutomationCentre(evidence, {
      buffer: checks[1].ok,
      bufferIssue: checks[1]?.issue?.message || "",
      bufferCheckedAt: checks[1]?.checked_at || null,
      bufferDuration: checks[1]?.duration_ms ?? null,
      instagram: checks[1]?.instagram_ok !== false,
      instagramIssue: checks[1]?.instagram_issue || "",
      facebook: checks[2].ok,
      facebookIssue: checks[2]?.issue?.message || "",
      carslink: checks[4].ok,
      carslinkIssue: checks[4]?.issue?.message || "",
      email: checks[5].ok && checks[6].ok,
      emailIssue: checks[5]?.issue?.message || checks[6]?.issue?.message || "",
    });
  } catch (error) {
    automations = [
      automationItem({
        key: "automation_centre",
        label: "Automation Health Centre",
        cadence: "Live",
        status: "failed",
        lastError: error?.message || "Could not assemble automation telemetry.",
        detail: "Core System Health checks still continue independently.",
      }),
    ];
  }

  return response.status(200).json({
    ok: issues.length === 0,
    status: issues.length ? "red" : "green",
    checked_at: new Date().toISOString(),
    degraded,
    checks: {
      supabase: checks[0].ok,
      buffer: checks[1].ok,
      instagram_mirror: checks[1]?.instagram_ok !== false,
      facebook_automation: checks[2].ok,
      reel_duplicate_protection: checks[3].ok,
      carslink_stock_sync: checks[4].ok,
      email_campaign_worker: checks[5].ok,
      email_delivery: checks[6].ok,
    },
    automations,
    issues,
  });
}

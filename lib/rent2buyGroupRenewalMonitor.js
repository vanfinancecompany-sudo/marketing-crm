import { londonDay, nextRunAt, RENEWAL_SCAN_INTERVAL_MS } from "./rent2buyGroupRenewals.js";

export const RENEWAL_MONITOR_CHANNEL = "rent2buy_group_renewal";
export const RENEWAL_HEARTBEAT_INTERVAL_MS = 5 * 60_000;
const BROWSER_GRACE_MS = 20 * 60_000;
const RUN_GRACE_MS = 30 * 60_000;
const STALL_MS = 25 * 60_000;
const PUBLICATION_WINDOW_MS = 60 * 60_000;

export function renewalHeartbeatChannel(environment = process.env) {
  return environment.VERCEL_ENV === "preview" ? RENEWAL_MONITOR_CHANNEL + "_preview" : RENEWAL_MONITOR_CHANNEL;
}

export function describeRenewalAgent({ settings, run, heartbeat, now = new Date() }) {
  const checkedAt = run?.plan?.lastScanAt || run?.checked_at || null;
  const lastHeartbeatAt = heartbeat?.last_heartbeat_at || null;
  const state = heartbeat?.status?.state || "";
  const timestamp = (x) => Date.parse(x || "");
  const past = (x, ms) => Number.isFinite(timestamp(x)) && now.getTime() - timestamp(x) > ms;
  const activeRun = run?.run_date === londonDay(now) ? run : null;
  const restriction = activeRun?.stopped?.reason ||
    (state === "restricted" ? heartbeat.status.reason || "Facebook requires account or security review." : "");
  const scheduled = Date.parse(nextRunAt(now)) - RENEWAL_SCAN_INTERVAL_MS;
  const expected = now.getTime() - scheduled > RUN_GRACE_MS ? scheduled : scheduled - RENEWAL_SCAN_INTERVAL_MS;
  const expectedSinceEnable = timestamp(settings.updatedAt) <= expected;
  const missed = expectedSinceEnable && (!Number.isFinite(timestamp(checkedAt)) || timestamp(checkedAt) < expected);
  const disconnected = lastHeartbeatAt ? past(lastHeartbeatAt, BROWSER_GRACE_MS) : expectedSinceEnable;
  const outcomes = Object.values(activeRun?.outcomes || {});
  const queued = (activeRun?.plan?.groups || []).filter((group) => !activeRun.outcomes?.[group.groupKey]);
  const progressedAt = Math.max(timestamp(activeRun?.checked_at) || 0, ...outcomes.map((item) => timestamp(item.at) || 0));
  const stalled = Boolean(activeRun && lastHeartbeatAt && !restriction && !disconnected && state !== "paused" &&
    (outcomes.some((item) => item.status === "preparing" && item.mode === "automatic" && past(item.at, STALL_MS)) ||
      queued.some((group) => now.getTime() - Math.max(progressedAt, timestamp(group.queuedAt) || 0) > STALL_MS)));
  const publicationFailures = Object.values(run?.outcomes || {}).filter((item) => item.failureStage === "publication" &&
    ["failed", "needs_attention"].includes(item.status) && timestamp(item.at) <= now.getTime() &&
    now.getTime() - timestamp(item.at) <= PUBLICATION_WINDOW_MS);
  const lastOutcomes = Object.values(run?.outcomes || {});
  const reviews = run?.plan?.reviews || {};
  const held = Object.entries(run?.outcomes || {}).filter(([key, item]) => item.status === "needs_attention" &&
    !["accepted", "pending", "declined"].includes(reviews[key]?.result));
  const unmatchedReviews = Object.entries(reviews).filter(([key, review]) => review.result === "unknown" && !run.outcomes?.[key]);
  const unconfirmed = held.filter(([, item]) => item.duplicateRisk || item.failureStage === "publication");
  const failed = lastOutcomes.filter(item => item.status === "failed");
  const confirmed = lastOutcomes.filter(item => item.status === "submitted").length + Object.entries(reviews).filter(([key, review]) =>
    run.outcomes?.[key]?.status !== "submitted" && review.runDate === run.run_date && ["accepted", "pending", "declined"].includes(review.result)).length;
  const due = run?.plan?.groups?.length ?? 0;

  const issues = [];
  function issue(key, title, detail, severity = "critical") {
    issues.push({ fingerprint: "rent2buy-renewal:" + key, channel: RENEWAL_MONITOR_CHANNEL, severity, title, detail });
  }
  if (settings.enabled) {
    if (missed) issue("missed-run", "Rent2Buy group renewal missed its hourly check", "The CRM did not record the scheduled scan for newly due groups.");
    if (restriction) issue("account-restriction", "Rent2Buy group renewals stopped for account review", restriction);
    else if (state !== "paused" && disconnected) issue("browser-disconnected", "Rent2Buy group renewal browser stopped reporting",
      lastHeartbeatAt ? "The signed-in Edge workflow has not reported for over 20 minutes." : "The enabled queue has not received a heartbeat from its Edge profile.");
    if (stalled) issue("stalled", "Rent2Buy group renewals have stalled", "The browser is connected but a claimed advert or remaining queue has made no progress for over 25 minutes.");
    if (publicationFailures.length >= 3) issue("publication-failures", "Repeated Rent2Buy group publication failures",
      publicationFailures.length + " distinct group submissions failed or could not be confirmed in the last hour.");
    if (held.length || unmatchedReviews.length || failed.length) issue("unresolved-outcomes", "Rent2Buy renewal outcomes need attention",
      `${unconfirmed.length} unconfirmed publications, ${held.length - unconfirmed.length + unmatchedReviews.length} other held groups, ${failed.length} failed attempts. Review the latest advert history before retrying.`, "warning");
  }
  const health = !settings.enabled ? "disabled" : restriction ? "restricted" : missed ? "missed_run" :
    state === "paused" ? "paused" : disconnected ? "disconnected" : stalled ? "stalled" :
      publicationFailures.length >= 3 ? "publication_failures" : !lastHeartbeatAt ? "waiting" :
        held.length || unmatchedReviews.length || failed.length ? "outcomes_need_attention" : state === "processing" ? "processing" :
          !run || (due > 0 && !confirmed) ? "waiting" : due === 0 ? "idle" : "healthy";
  return { health, lastHeartbeatAt, checkedAt, restriction, issues, due, confirmed,
    approvalMonitor: heartbeat?.status?.approvalMonitor || null };
}

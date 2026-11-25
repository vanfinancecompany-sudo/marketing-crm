import { londonDay, nextRunAt } from "./rent2buyGroupRenewals.js";

export const RENEWAL_MONITOR_CHANNEL = "rent2buy_group_renewal";
export const RENEWAL_HEARTBEAT_INTERVAL_MS = 5 * 60_000;
const BROWSER_GRACE_MS = 20 * 60_000;
const RUN_GRACE_MS = 30 * 60_000;
const STALL_MS = 25 * 60_000;
const PUBLICATION_WINDOW_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export function renewalHeartbeatChannel(environment = process.env) {
  return environment.VERCEL_ENV === "preview" ? RENEWAL_MONITOR_CHANNEL + "_preview" : RENEWAL_MONITOR_CHANNEL;
}

export function describeRenewalAgent({ settings, run, heartbeat, now = new Date() }) {
  const checkedAt = run?.checked_at || null;
  const lastHeartbeatAt = heartbeat?.last_heartbeat_at || null;
  const state = heartbeat?.status?.state || "";
  const timestamp = (x) => Date.parse(x || "");
  const past = (x, ms) => Number.isFinite(timestamp(x)) && now.getTime() - timestamp(x) > ms;
  const activeRun = run?.run_date === londonDay(now) ? run : null;
  const restriction = activeRun?.stopped?.reason ||
    (state === "restricted" ? heartbeat.status.reason || "Facebook requires account or security review." : "");
  const scheduled = Date.parse(nextRunAt(now)) - DAY_MS;
  const expected = new Date(now.getTime() - scheduled > RUN_GRACE_MS ? scheduled : scheduled - DAY_MS);
  const expectedSinceEnable = timestamp(settings.updatedAt) <= expected.getTime();
  const missed = expectedSinceEnable && (!run || run.run_date < londonDay(expected));
  const disconnected = lastHeartbeatAt ? past(lastHeartbeatAt, BROWSER_GRACE_MS) : expectedSinceEnable;
  const outcomes = Object.values(activeRun?.outcomes || {});
  const queued = (activeRun?.plan?.groups || []).some((group) => !activeRun.outcomes?.[group.groupKey]);
  const progressedAt = Math.max(timestamp(checkedAt) || 0, ...outcomes.map((item) => timestamp(item.at) || 0));
  const stalled = Boolean(activeRun && lastHeartbeatAt && !restriction && !disconnected && state !== "paused" &&
    (outcomes.some((item) => item.status === "preparing" && item.mode === "automatic" && past(item.at, STALL_MS)) ||
      (queued && now.getTime() - progressedAt > STALL_MS)));
  const publicationFailures = Object.values(run?.outcomes || {}).filter((item) => item.failureStage === "publication" &&
    ["failed", "needs_attention"].includes(item.status) && timestamp(item.at) <= now.getTime() &&
    now.getTime() - timestamp(item.at) <= PUBLICATION_WINDOW_MS);

  const issues = [];
  function issue(key, title, detail) {
    issues.push({ fingerprint: "rent2buy-renewal:" + key, channel: RENEWAL_MONITOR_CHANNEL, severity: "critical", title, detail });
  }
  if (settings.enabled) {
    if (missed) issue("missed-run", "Rent2Buy group renewal missed its daily check", "The CRM has no run for the scheduled 07:00 GMT check.");
    if (restriction) issue("account-restriction", "Rent2Buy group renewals stopped for account review", restriction);
    else if (state !== "paused" && disconnected) issue("browser-disconnected", "Rent2Buy group renewal browser stopped reporting",
      lastHeartbeatAt ? "The signed-in Edge workflow has not reported for over 20 minutes." : "The enabled queue has not received a heartbeat from its Edge profile.");
    if (stalled) issue("stalled", "Rent2Buy group renewals have stalled", "The browser is connected but a claimed advert or remaining queue has made no progress for over 25 minutes.");
    if (publicationFailures.length >= 3) issue("publication-failures", "Repeated Rent2Buy group publication failures",
      publicationFailures.length + " distinct group submissions failed or could not be confirmed in the last hour.");
  }
  const health = !settings.enabled ? "disabled" : restriction ? "restricted" : missed ? "missed_run" :
    state === "paused" ? "paused" : disconnected ? "disconnected" : stalled ? "stalled" :
      publicationFailures.length >= 3 ? "publication_failures" : !lastHeartbeatAt ? "waiting" :
        state === "processing" ? "processing" : "healthy";
  return { health, lastHeartbeatAt, checkedAt, restriction, issues };
}

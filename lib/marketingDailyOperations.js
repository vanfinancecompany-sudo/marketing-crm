export const DAILY_ACTIVITY_TYPES = Object.freeze([
  "van_finance_facebook_post",
  "rent2buy_facebook_post",
  "van_finance_reel",
  "rent2buy_reel",
  "emails_sent",
]);

export const SOCIAL_ACTIVITY_TYPES = Object.freeze(DAILY_ACTIVITY_TYPES.filter((type) => type !== "emails_sent"));

export const DEFAULT_DAILY_TARGETS = Object.freeze({
  van_finance_facebook_post: 10,
  rent2buy_facebook_post: 10,
  van_finance_reel: 10,
  rent2buy_reel: 10,
  emails_sent: 200,
  off_day: false,
});

export const ACTIVITY_LABELS = Object.freeze({
  van_finance_facebook_post: "Van Finance Facebook posts",
  rent2buy_facebook_post: "Rent2Buy Facebook posts",
  van_finance_reel: "Van Finance reels",
  rent2buy_reel: "Rent2Buy reels",
  emails_sent: "Marketing emails",
});

export function cleanTargetValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(10000, Math.floor(number))) : fallback;
}

export function normalizeTargets(value = {}) {
  return DAILY_ACTIVITY_TYPES.reduce((targets, type) => {
    targets[type] = cleanTargetValue(value[type], DEFAULT_DAILY_TARGETS[type]);
    return targets;
  }, { off_day: Boolean(value.off_day) });
}

export function londonDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value).reduce((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function londonWeekday(value = new Date()) {
  const label = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" }).format(value);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(label);
}

function londonMidnight(dateKey) {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);
  if (!year || !month || !day) throw new Error("Invalid UK activity date.");
  const targetUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  let start = new Date(targetUtc);
  for (let index = 0; index < 3; index += 1) {
    const displayed = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(start).reduce((result, part) => {
      if (part.type !== "literal") result[part.type] = part.value;
      return result;
    }, {});
    const displayedUtc = Date.UTC(Number(displayed.year), Number(displayed.month) - 1, Number(displayed.day), Number(displayed.hour), Number(displayed.minute), Number(displayed.second));
    start = new Date(start.getTime() - (displayedUtc - targetUtc));
  }
  return start;
}

export function londonDateRange(dateKey) {
  const [year, month, day] = String(dateKey || "").split("-").map(Number);
  if (!year || !month || !day) throw new Error("Invalid UK activity date.");
  const nextDateKey = new Date(Date.UTC(year, month - 1, day + 1, 12)).toISOString().slice(0, 10);
  return { start: londonMidnight(dateKey).toISOString(), end: londonMidnight(nextDateKey).toISOString() };
}

export function resolveTargetsForDate({ dateKey, weekday, schedules = [], overrides = [] }) {
  const override = overrides.find((row) => row.activity_date === dateKey);
  if (override) return { ...normalizeTargets(override), source: "override", effective_from: dateKey };
  const eligible = schedules
    .filter((row) => Number(row.weekday) === Number(weekday) && String(row.effective_from || "") <= dateKey)
    .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0];
  return { ...normalizeTargets(eligible || DEFAULT_DAILY_TARGETS), source: eligible ? "schedule" : "default", effective_from: eligible?.effective_from || null };
}

export function isProviderSubmittedRecipient(recipient = {}) {
  if (recipient.send_type && recipient.send_type !== "production") return false;
  if (recipient.first_sent_at || recipient.provider_message_id) return true;
  return ["accepted", "sent", "delivered", "opened", "clicked", "soft_bounce", "hard_bounce", "blocked", "deferred", "complaint", "unsubscribed"]
    .includes(String(recipient.status || "").toLowerCase());
}

export function summarizeDailyActivity({ targets, events = [], emailRecipients = [], emailSends = [], generatedReels = [] }) {
  const normalizedTargets = normalizeTargets(targets);
  const actual = Object.fromEntries(DAILY_ACTIVITY_TYPES.map((type) => [type, 0]));
  events.forEach((event) => {
    if (["van_finance_facebook_post", "rent2buy_facebook_post"].includes(event.activity_type)) {
      actual[event.activity_type] += Math.max(0, Number(event.quantity || 0));
    }
  });
  const reelIds = new Set();
  generatedReels.forEach((reel) => {
    const identity = reel.id || `${reel.created_at || ""}:${reel.registration || ""}:${reel.pipeline || ""}`;
    if (reelIds.has(identity)) return;
    reelIds.add(identity);
    const type = String(reel.pipeline || "").toLowerCase() === "rent2buy" ? "rent2buy_reel" : "van_finance_reel";
    actual[type] += 1;
  });
  if (emailSends.length) {
    const sendIds = new Set();
    emailSends.forEach((send) => {
      if (send.send_type && send.send_type !== "production") return;
      if (!["completed", "partially_failed"].includes(String(send.status || "").toLowerCase())) return;
      const identity = send.id || `${send.completed_at || ""}:${send.sent_count || 0}`;
      if (sendIds.has(identity)) return;
      sendIds.add(identity);
      actual.emails_sent += Math.max(0, Number(send.sent_count || 0));
    });
  } else {
    const emailIdentities = new Set();
    emailRecipients.filter(isProviderSubmittedRecipient).forEach((row) => emailIdentities.add(row.id || row.provider_message_id || `${row.send_id || ""}:${row.email || row.email_normalized || ""}`));
    actual.emails_sent = emailIdentities.size;
  }
  const metrics = Object.fromEntries(DAILY_ACTIVITY_TYPES.map((type) => {
    const target = normalizedTargets.off_day ? 0 : normalizedTargets[type];
    const completed = actual[type];
    return [type, { type, target, completed, remaining: Math.max(0, target - completed), percentage: target === 0 ? 100 : Math.min(100, Math.round((completed / target) * 100)) }];
  }));
  const activeMetrics = DAILY_ACTIVITY_TYPES.map((type) => metrics[type]).filter((metric) => metric.target > 0);
  const remainingTotal = DAILY_ACTIVITY_TYPES.reduce((sum, type) => sum + metrics[type].remaining, 0);
  return {
    targets: normalizedTargets,
    metrics,
    completion_percentage: activeMetrics.length
      ? Math.round(activeMetrics.reduce((sum, metric) => sum + metric.percentage, 0) / activeMetrics.length)
      : 100,
    remaining_total: remainingTotal,
    complete: remainingTotal === 0,
    off_day: normalizedTargets.off_day,
  };
}

export function aggregatePeriod(days = []) {
  const totals = Object.fromEntries(DAILY_ACTIVITY_TYPES.map((type) => [type, { completed: 0, target: 0, shortfall: 0, daily_average: 0, completion_percentage: 100 }]));
  days.forEach((day) => DAILY_ACTIVITY_TYPES.forEach((type) => {
    totals[type].completed += Number(day.metrics?.[type]?.completed || 0);
    totals[type].target += Number(day.metrics?.[type]?.target || 0);
  }));
  DAILY_ACTIVITY_TYPES.forEach((type) => {
    const item = totals[type];
    item.shortfall = Math.max(0, item.target - item.completed);
    item.daily_average = days.length ? Number((item.completed / days.length).toFixed(1)) : 0;
    item.completion_percentage = item.target ? Math.min(100, Math.round((item.completed / item.target) * 100)) : 100;
  });
  return totals;
}

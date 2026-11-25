// Conversations & AI monitoring centre: pure logic shared by the report,
// dashboard and monitor endpoints (and their tests).

export const CHANNELS = ["facebook_marketplace", "facebook_page", "whatsapp", "ask_me"];
const KINDS = ["received", "answered", "manual_answered", "needs_human", "send_failed", "ai_failed"];
export const HEARTBEAT_STALE_MS = 10 * 60_000;

const clean = (value, limit = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);

// Short, protected excerpts: email addresses, phone numbers, postcodes and long
// digit runs (card or account numbers) are removed before anything is stored.
export function redactExcerpt(value, limit = 280) {
  return clean(value, 2000)
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/(?:\+?44\s?|0)(?:\d[\s-]?){9,10}\b/g, "[phone]")
    .replace(/\b\d{8,}\b/g, "[number]")
    .replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/gi, "[postcode]")
    .slice(0, limit);
}

const iso = (value) => {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

// Validates a push from the local Facebook assistant. Unknown fields are dropped.
export function normaliseReport(body = {}) {
  const hb = body.heartbeat && typeof body.heartbeat === "object" ? body.heartbeat : null;
  const status = hb ? {
    monitoring: hb.monitoring === true,
    reasons: (Array.isArray(hb.reasons) ? hb.reasons : []).slice(0, 5).map((r) => clean(r, 240)),
    mode: clean(hb.mode, 20),
    list: clean(hb.list, 40),
    tabVisibility: clean(hb.tabVisibility, 20),
    tabReportedAt: iso(hb.tabReportedAt),
    extension: clean(hb.extension, 20),
    accountLocked: hb.accountLocked === true,
    accountProblem: hb.accountProblem ? clean(hb.accountProblem, 240) : null,
    safetyStop: hb.safetyStop ? clean(hb.safetyStop, 240) : null,
    openerHold: hb.openerHold ? clean(hb.openerHold, 240) : null,
    autoRepliesToday: Number.isFinite(hb.autoRepliesToday) ? hb.autoRepliesToday : null,
    needsHuman: Number.isFinite(hb.needsHuman) ? hb.needsHuman : null,
    serviceVersion: clean(hb.serviceVersion, 40),
  } : null;
  const events = (Array.isArray(body.events) ? body.events : []).slice(0, 200).map((e) => ({
    channel: "facebook_marketplace",
    source_id: clean(e?.id, 200),
    kind: KINDS.includes(e?.kind) ? e.kind : null,
    occurred_at: iso(e?.at),
    product: ["finance", "rent2buy"].includes(e?.product) ? e.product : null,
    conversation_ref: clean(e?.conversation, 64) || null,
    question_excerpt: e?.question ? redactExcerpt(e.question) : null,
    reply_excerpt: e?.reply ? redactExcerpt(e.reply, 600) : null,
    reason: e?.reason ? clean(e.reason, 240) : null,
  })).filter((e) => e.source_id && e.kind && e.occurred_at);
  return { status, events };
}

// Test entries remain in storage for audit but must never trigger customer-facing
// incident alerts, counts or activity. A test may have a benign 503 reason.
export function isMonitorTestEvent(event) {
  return /^TEST[-_:]/i.test(String(event?.source_id || "")) ||
    /^TEST\s*\(monitor check, not a customer\)/i.test(String(event?.reason || ""));
}

// Monitor rules. Each issue has a stable fingerprint, so an ongoing problem is
// one alert (and one email), and its disappearance is a recovery.
export function buildMonitorIssues({ facebook = null, events = [], outstanding = null, now = new Date() } = {}) {
  const issues = [];
  const nowMs = now.getTime();
  const add = (fingerprint, channel, severity, title, detail) => issues.push({ fingerprint, channel, severity, title, detail });
  const hbAt = Date.parse(facebook?.last_heartbeat_at || "");
  const s = facebook?.status || {};
  if (!facebook || !Number.isFinite(hbAt)) {
    add("facebook:no-heartbeat", "facebook_marketplace", "warning", "Facebook assistant has never reported to the CRM", "The local assistant service has not pushed a heartbeat yet. Check its CRM reporting configuration.");
  } else if (nowMs - hbAt > HEARTBEAT_STALE_MS) {
    add("facebook:heartbeat-stale", "facebook_marketplace", "critical", "Facebook assistant stopped reporting", `No heartbeat for ${Math.round((nowMs - hbAt) / 60000)} minutes. The PC, the local service or its internet connection may be down.`);
  } else {
    const tabAt = Date.parse(s.tabReportedAt || "");
    if (!Number.isFinite(tabAt) || nowMs - tabAt > HEARTBEAT_STALE_MS) add("facebook:browser-silent", "facebook_marketplace", "critical", "Dedicated browser or extension is not reporting", "The local service is running, but the Edge assistant tab has not reported recently.");
    else if (s.mode === "auto" && s.monitoring === false) add("facebook:not-monitoring", "facebook_marketplace", "critical", "Facebook Marketplace monitoring is not working", (s.reasons || []).join(" ") || "The Marketplace list is not open.");
    if (s.accountProblem) add("facebook:account", "facebook_marketplace", "critical", "Facebook account problem", s.accountProblem);
    if (s.safetyStop || s.openerHold) add("facebook:safety", "facebook_marketplace", "warning", "Facebook assistant safety stop or opener hold", s.safetyStop || s.openerHold);
    if (s.mode && s.mode !== "auto") add("facebook:auto-off", "facebook_marketplace", "warning", `Automatic replies are not on (mode: ${s.mode})`, "Facebook enquiries are not being answered automatically.");
  }
  // Self-healing first: the on-PC watchdog already reopens the dedicated
  // browser; our cloud monitor automatically closes incidents on a healthy
  // heartbeat. Never treat test events as customer incidents.
  const recent = events.filter((e) => !isMonitorTestEvent(e) &&
    nowMs >= Date.parse(e.occurred_at) && nowMs - Date.parse(e.occurred_at) <= 60 * 60_000);
  const fresh = recent.filter((e) => nowMs - Date.parse(e.occurred_at) <= 15 * 60_000);
  const failedSends = recent.filter((e) => e.kind === "send_failed");
  if (failedSends.length) {
    const freshFailures = fresh.filter((e) => e.kind === "send_failed").length;
    add("facebook:send-failed", "facebook_marketplace", freshFailures >= 2 ? "critical" : "warning",
      `${failedSends.length} Facebook repl${failedSends.length === 1 ? "y" : "ies"} could not be sent or confirmed in the last hour`,
      failedSends[0].reason || "Delivery was not confirmed. Review the affected conversation in the CRM.");
  }
  for (const channel of ["facebook_marketplace", "ask_me"]) {
    const isFailure = (e) => e.channel === channel && (e.kind === "ai_failed" ||
      /ask me (?:unavailable|could not)|http 5\d\d|429|rate limit|credit|quota/i.test(e.reason || ""));
    const aiFails = recent.filter(isFailure);
    const repeated = fresh.filter(isFailure).length >= 3;
    if (aiFails.length) add(`${channel}:ai-failed`, channel, repeated ? "critical" : "warning",
      `Ask Me failed ${aiFails.length} time${aiFails.length === 1 ? "" : "s"} in the last hour (${channel === "ask_me" ? "website" : "Facebook"})`,
      (aiFails[0].reason || "The AI service returned an error.") +
      (repeated ? " Repeated failures detected; check Ask Me service and provider." : " Isolated failure, monitoring for recurrence; no email unless repeated."));
  }
  const human = recent.filter((e) => e.kind === "needs_human" && !marketplaceThreadKey(e));
  if (human.length) add("conversations:needs-human", "all", "info",
    `${human.length} conversation${human.length === 1 ? "" : "s"} need a person (last hour)`,
    human.slice(0, 3).map((e) => e.reason).filter(Boolean).join("; "));
  if (Array.isArray(outstanding)) {
    for (const product of ["finance","rent2buy","unknown"]) {
      const pending = outstanding.filter(e => e.product === product && nowMs - Date.parse(e.at) >= 10 * 60_000);
      if (pending.length) add("facebook:outstanding:"+product,"facebook_marketplace","warning",
        `${pending.length} ${product === "finance" ? "Van Finance" : product === "rent2buy" ? "Rent2Buy" : "unclassified"} Marketplace conversation(s) without a recorded reply`,
        "Recorded enquiries remain outstanding until a later confirmed reply is reported. Manual replies not observed by the assistant may still need reconciliation.");
    }
  }
  return issues;
}

// Counts for the dashboard from stored events.
export function countEvents(events = []) {
  const out = {};
  for (const e of events) {
    if (isMonitorTestEvent(e)) continue;
    const c = (out[e.channel] ||= { received: 0, answered: 0, needs_human: 0, send_failed: 0, ai_failed: 0 });
    if (c[e.kind] !== undefined) c[e.kind]++;
  }
  return out;
}

// Ask Me website conversations: questions and replies retained in session history.
export function summariseAskMeSessions(sessions = []) {
  const recent = [];
  let questions = 0, answers = 0;
  const byProduct = { finance: 0, rent2buy: 0, unknown: 0 };
  for (const session of sessions) {
    const history = Array.isArray(session.conversation_history) ? session.conversation_history : [];
    const users = history.filter((m) => m?.role === "user");
    const assistants = history.filter((m) => m?.role === "assistant");
    questions += users.length;
    answers += assistants.length;
    byProduct[session.product_lock || "unknown"] = (byProduct[session.product_lock || "unknown"] || 0) + 1;
    const lastUser = users.at(-1);
    if (lastUser) recent.push({
      at: session.last_activity_at,
      product: session.product_lock || null,
      question: redactExcerpt(lastUser.content),
      reply: assistants.length ? redactExcerpt(assistants.at(-1).content, 600) : null,
      messages: history.length,
    });
  }
  recent.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { conversations: sessions.length, questions, answers, byProduct, recent: recent.slice(0, 25) };
}

// The Facebook assistant asks Ask Me through the website endpoint, so its
// questions also create Ask Me sessions. Those are counted under Facebook only:
// a session whose question matches a Facebook question within 10 minutes.
export function withoutFacebookSessions(sessions = [], facebookEvents = []) {
  const norm = (v) => redactExcerpt(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const fb = facebookEvents.filter((e) => e.question_excerpt).map((e) => ({ q: norm(e.question_excerpt), at: Date.parse(e.occurred_at) }));
  if (!fb.length) return sessions;
  return sessions.filter((session) => {
    const at = Date.parse(session.last_activity_at);
    const users = (Array.isArray(session.conversation_history) ? session.conversation_history : []).filter((m) => m?.role === "user").map((m) => norm(m.content));
    return !fb.some((e) => Math.abs(e.at - at) <= 600_000 && users.includes(e.q));
  });
}

// Use the full ledger thread ID embedded in the source event ID, not the
// six-character display reference, which can collide across conversations.
export function marketplaceThreadKey(event) {
  if (event?.channel !== "facebook_marketplace" || isMonitorTestEvent(event)) return null;
  const match = /^fbm:[^:]+:.*:(\d{1,32})$/.exec(String(event.source_id || ""));
  return match ? match[1] : null;
}
export function marketplaceOutstanding(events = []) {
  const latest = new Map();
  const order = { received: 0, needs_human: 1, ai_failed: 1, send_failed: 1, answered: 2, manual_answered: 2 };
  for (const event of events) {
    const key = marketplaceThreadKey(event), time = Date.parse(event.occurred_at);
    if (!key || !Number.isFinite(time) || order[event.kind] === undefined) continue;
    const previous = latest.get(key);
    if (!previous || time > Date.parse(previous.occurred_at) || (time === Date.parse(previous.occurred_at) && order[event.kind] > order[previous.kind])) latest.set(key, event);
  }
  return [...latest.values()].filter(e => !["answered","manual_answered"].includes(e.kind))
    .map(e => ({product: ["finance","rent2buy"].includes(e.product) ? e.product : "unknown", at:e.occurred_at, kind:e.kind, reference: e.conversation_ref || null, reason:e.reason || null}))
    .sort((a,b) => String(a.at).localeCompare(String(b.at)));
}
export function marketplaceProductCounts(events = [], outstanding = []) {
  const result = Object.fromEntries(["finance","rent2buy","unknown"].map(product => [product,{received:0,answered:0,manual_answered:0,needs_human:0,outstanding:0}]));
  for (const e of events) {
    if (e.channel !== "facebook_marketplace" || isMonitorTestEvent(e)) continue;
    const c = result[e.product] || result.unknown;
    if (["received","answered","manual_answered","needs_human"].includes(e.kind)) c[e.kind]++;
  }
  for (const e of outstanding) (result[e.product] || result.unknown).outstanding++;
  return result;
}
// Full retained ledger, independent of the UI date filter. A failed or capped
// scan must never be interpreted as a cleared backlog.
export async function readMarketplaceOutstanding(db) {
  const all = [], size = 500;
  for (let i = 0; i < 40; i++) {
    const response = await db.from("conversation_events").select("source_id,channel,kind,occurred_at,product,conversation_ref,reason")
      .eq("channel","facebook_marketplace").order("occurred_at",{ascending:true}).order("source_id",{ascending:true}).range(i*size,(i+1)*size-1);
    if (response.error) throw response.error;
    const rows = response.data || [];
    all.push(...rows);
    if (rows.length < size) return marketplaceOutstanding(all);
  }
  throw new Error("Marketplace backlog exceeds monitoring scan limit");
}

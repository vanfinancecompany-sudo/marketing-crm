// Meta Muse read-only connector: pure helpers shared by api/muse/[resource].js
// and its tests. Muse gets aggregated or redacted marketing data only: no
// customer names, contact details, addresses, application/finance details or
// conversation text.
import { timingSafeEqual } from "node:crypto";
import { redactExcerpt } from "./conversationsMonitor.js";

export const MUSE_KEY_HEADER = "x-muse-api-key";
export const RATE_LIMIT_PER_MINUTE = 60;

// Auth: dedicated MUSE_API_KEY (never the CRM's internal customer database key).
export function museAuthorised(request, environment = process.env) {
  const expected = String(environment.MUSE_API_KEY || "");
  const headers = request?.headers || {};
  const bearer = String(headers.authorization || "").replace(/^Bearer\s+/i, "");
  const given = String(headers[MUSE_KEY_HEADER] || bearer || "");
  if (expected.length < 32 || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

// Simple fixed-window limiter per client (per serverless instance). Enough to
// stop a runaway agent loop; not a security boundary on its own.
const windows = new Map();
export function rateLimited(clientId, now = Date.now(), limit = RATE_LIMIT_PER_MINUTE) {
  const minute = Math.floor(now / 60_000);
  const current = windows.get(clientId);
  if (!current || current.minute !== minute) {
    windows.set(clientId, { minute, count: 1 });
    if (windows.size > 1000) windows.clear();
    return false;
  }
  current.count += 1;
  return current.count > limit;
}

// Any field with one of these names is dropped wherever it appears.
const SENSITIVE_KEY = /^(e?-?mail|email_?address|phone|phone_?number|mobile|telephone|tel|first_?name|last_?name|full_?name|surname|customer_?name|contact_?name|company|postcode|post_?code|zip|address|address_?line_?\d*|street|town|dob|date_?of_?birth|customer_?id|contact_?id|application_?id|visitor_?hash|session_?id|customer_?session_?id|conversation_?ref|conversation_?history|question|reply|question_?excerpt|reply_?excerpt|transcript|ip|ip_?address|user_?agent|bank|sort_?code|account_?number|income|salary|created_by|internal_?notes|confirmation_?token_?hash|error_?summary)$/i;

// Deep copy that drops sensitive keys and scrubs emails, phone numbers,
// postcodes and long digit runs from every string. Applied to every response.
export function scrubForMuse(value, depth = 0) {
  if (depth > 12) return null;
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => scrubForMuse(item, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) continue;
      out[key] = scrubForMuse(item, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") return value.length ? redactExcerpt(value, 2000) : value;
  return value;
}

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
const PHONE = /(?:\+?44\s?|\b0)7\d{3}[\s-]?\d{6}\b|(?:\+?44\s?|\b0)\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}\b/;
// Last-line check used by tests and before sending: true if the payload still
// looks like it contains contact details.
export function containsPii(payload) {
  const text = JSON.stringify(payload ?? null);
  return EMAIL.test(text) || PHONE.test(text);
}

export const clampInt = (value, fallback, min, max) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const groupCount = (rows, field) => rows.reduce((acc, row) => {
  const key = String(row?.[field] ?? "unknown") || "unknown";
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const regKey = (v) => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// Stock with 30-day page views, so Muse can spot high-interest or slow stock.
export function buildStock({ finance = [], rent2buy = [], views = [], limit = 50 } = {}) {
  const viewCounts = new Map();
  for (const row of views) {
    const key = regKey(row?.registration);
    if (key) viewCounts.set(key, (viewCounts.get(key) || 0) + 1);
  }
  const financeVehicles = finance.map((v) => ({
    product: "finance",
    title: v.title || null,
    price: num(v.price),
    sale_price: num(v.salePrice),
    vat: v.vat ?? null,
    description: v.vanDescription || null,
    spec: v.vanSpec || null,
    url: v.weblink || null,
  }));
  const rentVehicles = rent2buy.map((v) => ({
    product: "rent2buy",
    registration: v.registration || null,
    listed_at: v.created_at || null,
    monthly: num(v.monthly),
    weekly: num(v.week),
    initial_rental: num(v.initialRental),
    description: v.vanDescription || null,
    spec: v.vanSpec || null,
    url: v.webLink || null,
    views_30d: viewCounts.get(regKey(v.registration)) || 0,
  }));
  const topViewed = [...viewCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
    .map(([registration, views30d]) => ({ registration, views_30d: views30d }));
  return {
    counts: { finance: finance.length, rent2buy: rent2buy.length },
    top_viewed_30d: topViewed,
    vehicles: { finance: financeVehicles.slice(0, limit), rent2buy: rentVehicles.slice(0, limit) },
    note: "Advertised stock only. Registrations are public vehicle identifiers, not customer data.",
  };
}

// Conversation volumes by channel, kind, product and day. No message text.
export function buildConversationVolumes({ events = [], sessions = [], days = 30 } = {}) {
  const byDay = {};
  const byChannel = {};
  for (const e of events) {
    if (/^TEST[-_:]/i.test(String(e?.source_id || ""))) continue;
    const day = String(e.occurred_at || "").slice(0, 10);
    const channel = e.channel || "unknown";
    const c = (byChannel[channel] ||= { received: 0, answered: 0, needs_human: 0, send_failed: 0, ai_failed: 0, by_product: {} });
    if (c[e.kind] !== undefined) c[e.kind] += 1;
    if (e.kind === "received") c.by_product[e.product || "unknown"] = (c.by_product[e.product || "unknown"] || 0) + 1;
    if (day && e.kind === "received") byDay[day] = (byDay[day] || 0) + 1;
  }
  const askMeByDay = {};
  let askMeMessages = 0;
  for (const s of sessions) {
    const day = String(s.last_activity_at || "").slice(0, 10);
    if (day) askMeByDay[day] = (askMeByDay[day] || 0) + 1;
    askMeMessages += Number(s.message_count) || 0;
  }
  return {
    days,
    channels: byChannel,
    facebook_enquiries_by_day: byDay,
    ask_me_website: {
      conversations: sessions.length,
      messages: askMeMessages,
      by_product: groupCount(sessions, "product_lock"),
      conversations_by_day: askMeByDay,
    },
    note: "Counts only. Conversation text is never shared with Muse.",
  };
}

// Customer demand themes learned by Ask Me (aggregated intents, not transcripts).
export function buildOpportunities(rows = []) {
  return {
    count: rows.length,
    by_product: groupCount(rows, "product"),
    by_priority: groupCount(rows, "priority_level"),
    items: rows.map((r) => ({
      product: r.product,
      topic: r.title,
      category: r.category,
      status: r.status,
      priority_level: r.priority_level,
      priority_score: r.priority_score,
      questions: r.question_count,
      unanswered: r.unanswered_count,
      weak_answers: r.weak_answer_count,
      first_seen_at: r.first_seen_at,
      last_seen_at: r.last_seen_at,
      recommended_action: r.recommended_action || null,
      suggested_article_title: r.suggested_article_title || null,
    })),
    note: "Themes from customer questions, aggregated by Ask Me. Individual questions are not shared.",
  };
}

// Campaigns with production email send totals (no recipients).
export function buildCampaigns({ campaigns = [], sends = [] } = {}) {
  const totals = new Map();
  for (const s of sends) {
    if (s.send_type !== "production") continue;
    const t = totals.get(s.campaign_id) || { sends: 0, requested: 0, eligible: 0, suppressed: 0, sent: 0, failed: 0, last_sent_at: null };
    t.sends += 1;
    t.requested += Number(s.requested_count) || 0;
    t.eligible += Number(s.eligible_count) || 0;
    t.suppressed += Number(s.suppressed_count) || 0;
    t.sent += Number(s.sent_count) || 0;
    t.failed += Number(s.failed_count) || 0;
    const at = s.completed_at || s.started_at || s.created_at;
    if (at && (!t.last_sent_at || at > t.last_sent_at)) t.last_sent_at = at;
    totals.set(s.campaign_id, t);
  }
  return {
    count: campaigns.length,
    by_status: groupCount(campaigns, "status"),
    by_channel: groupCount(campaigns, "channel"),
    by_objective: groupCount(campaigns, "objective"),
    campaigns: campaigns.map((c) => ({
      name: c.name,
      description: c.description || null,
      channel: c.channel,
      objective: c.objective,
      status: c.status,
      type: c.campaign_type || null,
      subject_line: c.subject_line || null,
      tags: c.tags || [],
      created_at: c.created_at,
      updated_at: c.updated_at,
      email_production_totals: totals.get(c.id) || null,
    })),
  };
}

export const RESOURCES = {
  overview: "Snapshot counts across stock, contacts (counts only), campaigns, email, content, knowledge, AI visibility and Vansco stock watch.",
  stock: "Advertised Finance and Rent2Buy vans with prices, specs, links and 30-day page views. Query: q, limit.",
  "website-analytics": "Website traffic for the last 7 settled days versus the previous 7, plus today's finance application funnel (step counts only).",
  "ask-me": "Ask Me assistant engagement: opens, conversations, CTA clicks, knowledge gaps, Knowledge Hub searches. Query: days.",
  conversations: "Enquiry volumes by channel (Facebook Marketplace, Ask Me website), product and day. Query: days.",
  opportunities: "Customer demand themes and content gaps learned by Ask Me, with priority. Query: product, limit.",
  campaigns: "Marketing campaigns and production email send totals. Query: limit.",
  capabilities: "What the Marketing CRM can do today (channels, automations, content tools), for planning only.",
};

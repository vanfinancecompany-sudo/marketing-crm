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

// Theme titles shown to Muse come ONLY from this fixed, business-written list.
// Customer-typed words never pass through: an intent outside the list (the
// learning engine builds those from words in the question) becomes "Other".
const FIXED_THEMES = {
  coverage_collection: { finance: "Finance delivery and nationwide coverage", rent2buy: "Rent2Buy coverage, distance and collection" },
  upfront_costs: { finance: "Finance deposits and upfront costs", rent2buy: "Rent2Buy initial rental and upfront costs" },
  product_explanation: { finance: "How van finance works", rent2buy: "What Rent2Buy is and how it works" },
  credit_eligibility: { finance: "Finance applications with credit difficulties", rent2buy: "Rent2Buy eligibility and affordability" },
  application_next_steps: { finance: "Finance application and next steps", rent2buy: "Rent2Buy application and next steps" },
  documents: { finance: "Finance documents and evidence", rent2buy: "Rent2Buy documents and evidence" },
  monthly_costs: { finance: "Finance monthly costs and pricing", rent2buy: "Rent2Buy monthly costs and pricing" },
  vehicle_eligibility: { finance: "Finance vehicle choice and eligibility", rent2buy: "Rent2Buy vehicle choice and eligibility" },
};
export const FIXED_THEME_KEYS = Object.keys(FIXED_THEMES);
const PRODUCTS = ["finance", "rent2buy"];
const ACTIONS = ["create_faq", "create_article", "improve_existing_article", "improve_business_brain", "improve_retrieval", "covered_existing", "review_later"];
const STATUSES = ["new", "reviewing", "covered_existing", "improve_business_brain", "improve_existing_article", "create_faq", "create_article", "completed"];
const LEVELS = ["critical", "high", "medium", "low"];
const pick = (value, allowed) => (allowed.includes(value) ? value : null);
const count = (v) => Math.max(0, Number(v) || 0);

export function fixedTheme(key, product) {
  const p = pick(product, PRODUCTS) || "finance";
  const theme = FIXED_THEMES[key];
  return theme ? { key, title: theme[p] } : { key: "other", title: `${p === "rent2buy" ? "Rent2Buy" : "Finance"}: other customer questions` };
}

// Customer demand themes learned by Ask Me (aggregated intents, not transcripts).
export function buildOpportunities(rows = []) {
  const merged = new Map();
  for (const r of rows) {
    const product = pick(r.product, PRODUCTS) || "unknown";
    const theme = fixedTheme(r.normalised_intent, product);
    const id = `${product}:${theme.key}`;
    const item = merged.get(id) || {
      product, theme: theme.key, topic: theme.title, priority_level: null, priority_score: 0,
      questions: 0, unanswered: 0, weak_answers: 0, first_seen_at: null, last_seen_at: null, recommended_actions: [], statuses: [],
    };
    item.questions += count(r.question_count);
    item.unanswered += count(r.unanswered_count);
    item.weak_answers += count(r.weak_answer_count);
    const score = Math.min(100, count(r.priority_score));
    if (score >= item.priority_score) { item.priority_score = score; item.priority_level = pick(r.priority_level, LEVELS); }
    const first = iso(r.first_seen_at);
    const last = iso(r.last_seen_at);
    if (first && (!item.first_seen_at || first < item.first_seen_at)) item.first_seen_at = first;
    if (last && (!item.last_seen_at || last > item.last_seen_at)) item.last_seen_at = last;
    const action = pick(r.recommended_action, ACTIONS);
    if (action && !item.recommended_actions.includes(action)) item.recommended_actions.push(action);
    const status = pick(r.status, STATUSES);
    if (status && !item.statuses.includes(status)) item.statuses.push(status);
    merged.set(id, item);
  }
  const items = [...merged.values()].sort((a, b) => b.priority_score - a.priority_score || b.questions - a.questions);
  return {
    count: items.length,
    items,
    note: "Themes use a fixed list of business-written titles. Customer questions, and any words taken from them, are never shared.",
  };
}

const iso = (value) => {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

// Knowledge Hub searches with no result, mapped to fixed themes (query text dropped).
export function searchGapThemes(queries = [], classify) {
  const totals = new Map();
  for (const q of Array.isArray(queries) ? queries : []) {
    let key = "other";
    try { key = classify(String(q?.query || "")) || "other"; } catch { key = "other"; }
    const theme = fixedTheme(key, "finance");
    const label = theme.key === "other" ? "Other searches" : theme.title.replace(/^Finance /, "").replace(/^\w/, (c) => c.toUpperCase());
    const t = totals.get(theme.key) || { theme: theme.key, topic: label, searches: 0 };
    t.searches += count(q?.count);
    totals.set(theme.key, t);
  }
  return [...totals.values()].sort((a, b) => b.searches - a.searches);
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

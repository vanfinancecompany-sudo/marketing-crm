// On-demand, server-side search and pagination for Conversations & AI.
// Unlike the dashboard's quick preview, this scans the retained history in
// date range; the React page only renders 20 matches at a time.
import { createClient } from "@supabase/supabase-js";
import { isMonitorTestEvent, redactExcerpt, withoutFacebookSessions, marketplaceDisplayKind } from "../lib/conversationsMonitor.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const PAGE_SIZE = 20;
const BATCH_SIZE = 500;
const MAX_BATCHES = 100; // Safety bound. Explicitly label incomplete results.

const authorised = (req, env) => {
  const expected = env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const given = req.headers?.[API_KEY_HEADER] ||
    String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  return Boolean(expected && given === expected);
};

async function getRetained(db, table, columns, after, dateField) {
  const out = [];
  for (let n = 0; n < MAX_BATCHES; n++) {
    const start = n * BATCH_SIZE;
    const { data, error } = await db.from(table)
      .select(columns).gte(dateField, after).order(dateField, { ascending: false })
      .range(start, start + BATCH_SIZE - 1);
    if (error) throw new Error(`History query failed for ${table}`);
    out.push(...(data || []));
    if (!data || data.length < BATCH_SIZE) return { rows: out, truncated: false };
  }
  return { rows: out, truncated: true };
}

export function buildActivityEntries(sessions, rawEvents) {
  const events = rawEvents.filter((e) => !isMonitorTestEvent(e));
  const entries = events.map((e) => ({
    channel: e.channel, kind: marketplaceDisplayKind(e), occurred_at: e.occurred_at,
    product: e.product, question_excerpt: redactExcerpt(e.question_excerpt),
    reply_excerpt: redactExcerpt(e.reply_excerpt, 600),
    reason: redactExcerpt(e.reason), sequence: 0,
  }));
  const websiteSessions = withoutFacebookSessions(sessions, events);
  for (const session of websiteSessions) {
    const history = Array.isArray(session.conversation_history) ? session.conversation_history : [];
    let previous = null;
    for (let i = 0; i < history.length; i++) {
      const turn = history[i];
      if (turn?.role === "user") {
        previous = {
          channel: "ask_me", kind: "answered", occurred_at: session.last_activity_at,
          product: session.product_lock || null, question_excerpt: redactExcerpt(turn.content),
          reply_excerpt: "", reason: "", sequence: i,
        };
        entries.push(previous);
      } else if (turn?.role === "assistant" && previous && !previous.reply_excerpt) {
        previous.reply_excerpt = redactExcerpt(turn.content, 600);
        previous = null;
      }
    }
  }
  entries.sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)) ||
    b.sequence - a.sequence);
  return entries;
}

export async function getConversationsActivity(db, { days = 7, page = 1, search = "", channel = "all", product = "all", now = new Date() } = {}) {
  const since = new Date(now.getTime() - Math.min(30, Math.max(1, days)) * 86400000).toISOString();
  const [facebook, askMe] = await Promise.all([
    getRetained(db, "conversation_events", "source_id,channel,kind,occurred_at,product,question_excerpt,reply_excerpt,reason", since, "occurred_at"),
    getRetained(db, "ai_customer_sessions", "product_lock,conversation_history,last_activity_at", since, "last_activity_at"),
  ]);
  const all = buildActivityEntries(askMe.rows, facebook.rows);
  const term = search.toLocaleLowerCase().trim().slice(0, 120);
  const filtered = all.filter((e) => (channel === "all" || e.channel === channel) && (product === "all" || e.product === product) &&
    (!term || [e.question_excerpt, e.reply_excerpt, e.reason].some((v) => String(v || "").toLocaleLowerCase().includes(term))));
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  return {
    entries: filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    page: currentPage, pageSize: PAGE_SIZE, total, totalPages,
    truncated: facebook.truncated || askMe.truncated,
  };
}

export default async function handler(req, res) {
  res.setHeader?.("Cache-Control", "no-store");
  if (!authorised(req, process.env)) return res.status(401).json({ error: "Unauthorised" });
  try {
    const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } });
    const days = Math.min(30, Math.max(1, Number.parseInt(req.query?.days, 10) || 7));
    const page = Math.max(1, Number.parseInt(req.query?.page, 10) || 1);
    const channel = ["all", "ask_me", "facebook_marketplace"].includes(req.query?.channel) ? req.query.channel : "all";
    const search = String(req.query?.search || "").slice(0, 120);
    const product = ["finance","rent2buy"].includes(req.query?.product) ? req.query.product : "all";
    return res.status(200).json(await getConversationsActivity(db, { days, page, channel, product, search }));
  } catch (error) {
    console.error("CONVERSATIONS_ACTIVITY_FAILED", String(error?.message || error).slice(0, 200));
    return res.status(500).json({ error: "Conversation history could not be loaded" });
  }
}

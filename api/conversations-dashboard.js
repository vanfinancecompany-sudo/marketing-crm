// Data for the Conversations & AI page. Protected by the CRM access key.
import { createClient } from "@supabase/supabase-js";
import { countEvents, summariseAskMeSessions, withoutFacebookSessions, isMonitorTestEvent, HEARTBEAT_STALE_MS, readMarketplaceOutstanding, marketplaceProductCounts, marketplaceDisplayKind } from "../lib/conversationsMonitor.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";

function authorised(request, environment) {
  const expected = environment.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const header = request.headers?.[API_KEY_HEADER] || "";
  const bearer = String(request.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  return Boolean(expected && (header === expected || bearer === expected));
}

const missing = (error) => error && (error.code === "42P01" || /does not exist/i.test(error.message || ""));

export async function buildConversationsDashboard(db, { days = 7, now = new Date() } = {}) {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const [statusRes, eventsRes, alertsRes, sessionsRes] = await Promise.all([
    db.from("conversation_channel_status").select("*"),
    db.from("conversation_events").select("source_id,channel,kind,occurred_at,product,conversation_ref,question_excerpt,reply_excerpt,reason").gte("occurred_at", since).order("occurred_at", { ascending: false }).limit(2000),
    db.from("conversation_monitor_alerts").select("*").order("last_seen_at", { ascending: false }).limit(50),
    db.from("ai_customer_sessions").select("product_lock,conversation_history,message_count,last_activity_at,created_at").gte("last_activity_at", since).order("last_activity_at", { ascending: false }).limit(1000),
  ]);
  const monitoringReady = !missing(statusRes.error) && !missing(eventsRes.error) && !missing(alertsRes.error);
  const facebook = (statusRes.data || []).find((row) => row.channel === "facebook_marketplace") || null;
  const hbAge = facebook?.last_heartbeat_at ? now.getTime() - Date.parse(facebook.last_heartbeat_at) : null;
  const events = (eventsRes.data || []).filter((e) => !isMonitorTestEvent(e));
  const counts = countEvents(events);
  const outstanding = await readMarketplaceOutstanding(db).catch(() => null);
  const askMe = sessionsRes.error ? null : summariseAskMeSessions(withoutFacebookSessions(sessionsRes.data || [], events.filter((e) => e.channel === "facebook_marketplace")));
  const fbStatus = !monitoringReady ? "not_configured"
    : !facebook ? "never_reported"
    : hbAge > HEARTBEAT_STALE_MS ? "offline"
    : facebook.status?.monitoring && facebook.status?.mode === "auto" ? "healthy" : "degraded";
  return {
    generatedAt: now.toISOString(),
    days,
    monitoringReady,
    channels: {
      ask_me: {
        status: askMe === null ? "unavailable" : (counts.ask_me?.ai_failed ? "degraded" : "healthy"),
        conversations: askMe?.conversations ?? null,
        questions: askMe?.questions ?? null,
        answers: askMe?.answers ?? null,
        byProduct: askMe?.byProduct ?? null,
        failures: counts.ask_me?.ai_failed ?? 0,
        recent: askMe?.recent ?? [],
        note: "Website conversations retained by Ask Me sessions (both sites), excluding the Facebook assistant's own Ask Me calls. Human hand-offs are not recorded separately by Ask Me.",
      },
      facebook_marketplace: {
        status: fbStatus,
        lastHeartbeatAt: facebook?.last_heartbeat_at || null,
        detail: facebook?.status || null,
        outstanding,
        byProduct: eventsRes.error ? null : marketplaceProductCounts(events, outstanding || []),
        counts: counts.facebook_marketplace || { received: 0, answered: 0, needs_human: 0, send_failed: 0, ai_failed: 0 },
      },
      facebook_page: { status: "not_connected", note: "Business Page Messenger integration is planned." },
      whatsapp: { status: "not_connected", note: "WhatsApp is not connected yet." },
    },
    activity: events.slice(0, 100).map(e => ({...e,kind:marketplaceDisplayKind(e)})),
    alerts: alertsRes.data || [],
  };
}

export default async function handler(request, response) {
  response.setHeader?.("Cache-Control", "no-store");
  if (!authorised(request, process.env)) return response.status(401).json({ error: "Unauthorised" });
  try {
    const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const days = Math.min(30, Math.max(1, Number.parseInt(request.query?.days, 10) || 7));
    return response.status(200).json(await buildConversationsDashboard(db, { days }));
  } catch (error) {
    return response.status(500).json({ error: "Dashboard data could not be loaded" });
  }
}

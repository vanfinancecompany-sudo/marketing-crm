// Independent cloud monitor for Conversations & AI (Vercel cron, every 10
// minutes; no AI calls). Opens one alert per problem, emails significant new
// problems and recoveries once, and resolves alerts when problems clear.
import { createClient } from "@supabase/supabase-js";
import { buildMonitorIssues } from "../lib/conversationsMonitor.js";
import { sendSendGridEmail } from "../lib/emailProviders/sendgrid.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function allowed(request, environment) {
  // Vercel cron calls carry "Authorization: Bearer <CRON_SECRET>"; the x-vercel-cron
  // header alone is not trusted (anyone can send it).
  const expected = environment.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const given = request.headers?.[API_KEY_HEADER] || String(request.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  return Boolean((expected && given === expected) || (environment.CRON_SECRET && given === environment.CRON_SECRET));
}

async function email(environment, subject, lines) {
  // Existing SendGrid set-up: the alert address, else the configured SendGrid recipient.
  const to = environment.CONVERSATIONS_ALERT_EMAIL || environment.SENDGRID_TEST_RECIPIENT_EMAIL;
  if (!to || !environment.SENDGRID_API_KEY) return false;
  await sendSendGridEmail({
    apiKey: environment.SENDGRID_API_KEY, to, subject: `[Conversations & AI] ${subject}`,
    html: `<p>${lines.map(esc).join("</p><p>")}</p><p><a href="https://${esc(environment.VERCEL_PROJECT_PRODUCTION_URL || "marketing-crm-six.vercel.app")}/conversations-ai">Open Conversations &amp; AI</a></p>`,
    text: lines.join("\n"), categories: ["conversations-monitor"],
  });
  return true;
}

export async function runConversationsMonitor(db, { environment = process.env, now = new Date(), sendEmail = email } = {}) {
  const since = new Date(now.getTime() - 2 * 3_600_000).toISOString();
  const [statusRes, eventsRes, alertsRes] = await Promise.all([
    db.from("conversation_channel_status").select("*").eq("channel", "facebook_marketplace").maybeSingle(),
    db.from("conversation_events").select("channel,kind,occurred_at,reason").gte("occurred_at", since).limit(2000),
    db.from("conversation_monitor_alerts").select("*").eq("status", "open"),
  ]);
  if (statusRes.error || eventsRes.error || alertsRes.error) throw new Error("Monitoring tables are not available");
  const issues = buildMonitorIssues({ facebook: statusRes.data, events: eventsRes.data || [], now });
  const open = new Map((alertsRes.data || []).map((row) => [row.fingerprint, row]));
  const stamp = now.toISOString();
  const opened = [], recovered = [];
  for (const item of issues) {
    const previous = open.get(item.fingerprint);
    const row = {
      fingerprint: item.fingerprint, channel: item.channel, severity: item.severity, title: item.title, detail: item.detail,
      status: "open", last_seen_at: stamp, resolved_at: null,
      first_seen_at: previous?.first_seen_at || stamp, occurrences: (previous?.occurrences || 0) + 1,
      emailed_at: previous?.emailed_at || null, recovery_emailed_at: null,
    };
    // Email significant problems once, after they persist for a second check
    // (avoids alerts for momentary blips such as a page reload).
    if (item.severity === "critical" && !row.emailed_at && previous) {
      if (await sendEmail(environment, `Problem: ${item.title}`, [item.title, item.detail || "", `First seen ${row.first_seen_at}`]).catch(() => false)) row.emailed_at = stamp;
      opened.push(item.fingerprint);
    }
    await db.from("conversation_monitor_alerts").upsert(row, { onConflict: "fingerprint" });
    open.delete(item.fingerprint);
  }
  for (const row of open.values()) {
    const update = { status: "resolved", resolved_at: stamp };
    if (row.emailed_at && !row.recovery_emailed_at) {
      if (await sendEmail(environment, `Recovered: ${row.title}`, [`Back to normal: ${row.title}`, `Problem lasted from ${row.first_seen_at} to ${stamp}`]).catch(() => false)) update.recovery_emailed_at = stamp;
      recovered.push(row.fingerprint);
    }
    await db.from("conversation_monitor_alerts").update(update).eq("fingerprint", row.fingerprint);
  }
  return { checkedAt: stamp, issues: issues.length, emailedProblems: opened, emailedRecoveries: recovered };
}

export default async function handler(request, response) {
  response.setHeader?.("Cache-Control", "no-store");
  if (!allowed(request, process.env)) return response.status(401).json({ error: "Unauthorised" });
  try {
    const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    return response.status(200).json(await runConversationsMonitor(db));
  } catch (error) {
    return response.status(500).json({ error: String(error?.message || "Monitor failed").slice(0, 200) });
  }
}

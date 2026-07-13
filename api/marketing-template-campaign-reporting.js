import { createClient } from "@supabase/supabase-js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const TEMPLATE_CAMPAIGN_SOURCE = "template_campaign_foundation";
const CAMPAIGN_COLUMNS = "id,name,status,metadata,created_at,updated_at";
const SEND_COLUMNS = "id,campaign_id,send_type,status,requested_count,eligible_count,suppressed_count,sent_count,failed_count,skipped_duplicate_count,created_at,started_at,completed_at,error_summary,metadata";
const RECIPIENT_COLUMNS = "id,send_id,campaign_id,send_type,customer_id,email,status,provider_message_id,failure_reason,first_sent_at,last_event_at,created_at,updated_at,delivered_at,opened_at,clicked_at,soft_bounced_at,hard_bounced_at,complained_at,unsubscribed_at,blocked_at,deferred_at,failed_at,last_event_type,last_event_reason";
const EVENT_COLUMNS = "id,campaign_id,send_id,recipient_id,customer_id,email_normalized,event_type,event_at,link_url,reason,created_at";
const PAGE_SIZE = 1000;

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function json(response, status, payload) {
  response.status(status).json(payload);
}

function getSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing server Supabase environment variables.");
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

function authorize(request) {
  const expectedSecret = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  if (!expectedSecret) return false;
  const headerSecret = request.headers[API_KEY_HEADER] || "";
  const authHeader = request.headers.authorization || "";
  const bearerSecret = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  return headerSecret === expectedSecret || bearerSecret === expectedSecret;
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") {
    try { return JSON.parse(request.body); } catch { return {}; }
  }
  return request.body;
}

function assertSupabase(result, fallbackMessage) {
  if (result.error) throw new Error(result.error.message || fallbackMessage);
  return result;
}

function isMissingReportingInfrastructure(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("marketing_email_events")
    || message.includes("delivered_at")
    || message.includes("last_event_type")
    || message.includes("schema cache")
    || message.includes("does not exist");
}

function cleanText(value, limit = 500) {
  return String(value || "").trim().slice(0, limit);
}

function maskEmail(value) {
  const email = cleanText(value, 254).toLowerCase();
  const [user, domain] = email.split("@");
  if (!user || !domain) return "";
  const visible = user.length <= 2 ? user[0] || "" : `${user.slice(0, 2)}...`;
  return `${visible}@${domain}`;
}

function percent(part, total) {
  const left = Number(part || 0);
  const right = Number(total || 0);
  if (!right) return 0;
  return Math.round((left / right) * 1000) / 10;
}

async function loadOwnedTemplateCampaign(supabase, id) {
  if (!id) throw new ApiError(400, "Campaign ID is required.");
  const result = await supabase
    .from("marketing_campaigns")
    .select(CAMPAIGN_COLUMNS)
    .eq("id", id)
    .eq("metadata->>source", TEMPLATE_CAMPAIGN_SOURCE)
    .maybeSingle();
  assertSupabase(result, "Could not load template campaign.");
  if (!result.data) throw new ApiError(404, "Template campaign was not found.");
  return result.data;
}

async function loadAllRows(queryFactory) {
  const rows = [];
  let from = 0;
  while (true) {
    const result = await queryFactory().range(from, from + PAGE_SIZE - 1);
    assertSupabase(result, "Could not load reporting rows.");
    rows.push(...(result.data || []));
    if (!result.data || result.data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

function aggregateRecipients(recipients = []) {
  const uniqueDelivered = new Set();
  const uniqueOpened = new Set();
  const uniqueClicked = new Set();
  const counts = {
    recipients: recipients.length,
    accepted: 0,
    delivered: 0,
    opened: 0,
    clicked: 0,
    soft_bounced: 0,
    hard_bounced: 0,
    blocked: 0,
    complained: 0,
    unsubscribed: 0,
    failed: 0,
    submission_unknown: 0,
    skipped_suppressed: 0,
    skipped_duplicate: 0,
  };
  for (const row of recipients) {
    const identity = row.id || row.customer_id || row.email;
    if (["accepted", "sent", "delivered", "opened", "clicked"].includes(row.status)) counts.accepted += 1;
    if (row.delivered_at || ["delivered", "opened", "clicked"].includes(row.status)) uniqueDelivered.add(identity);
    if (row.opened_at || ["opened", "clicked"].includes(row.status)) uniqueOpened.add(identity);
    if (row.clicked_at || row.status === "clicked") uniqueClicked.add(identity);
    if (row.status === "soft_bounced") counts.soft_bounced += 1;
    if (row.status === "hard_bounced") counts.hard_bounced += 1;
    if (row.status === "blocked") counts.blocked += 1;
    if (row.status === "complained") counts.complained += 1;
    if (row.status === "unsubscribed") counts.unsubscribed += 1;
    if (row.status === "failed") counts.failed += 1;
    if (row.status === "submission_unknown") counts.submission_unknown += 1;
    if (row.status === "skipped_suppressed") counts.skipped_suppressed += 1;
    if (row.status === "skipped_duplicate") counts.skipped_duplicate += 1;
  }
  counts.delivered = uniqueDelivered.size;
  counts.opened = uniqueOpened.size;
  counts.clicked = uniqueClicked.size;
  return {
    ...counts,
    delivery_rate: percent(counts.delivered, counts.accepted),
    open_rate: percent(counts.opened, counts.delivered || counts.accepted),
    click_rate: percent(counts.clicked, counts.delivered || counts.accepted),
    click_to_open_rate: percent(counts.clicked, counts.opened),
    bounce_rate: percent(counts.soft_bounced + counts.hard_bounced + counts.blocked, counts.accepted),
    unsubscribe_rate: percent(counts.unsubscribed, counts.accepted),
  };
}

function aggregateProductionSends(sends = []) {
  return sends.reduce((acc, send) => {
    if (send.send_type !== "production") return acc;
    acc.production_batches += 1;
    acc.requested += Number(send.requested_count || 0);
    acc.accepted += Number(send.sent_count || 0);
    acc.failed += Number(send.failed_count || 0);
    acc.duplicates += Number(send.skipped_duplicate_count || 0);
    if (send.status === "completed") acc.completed += 1;
    if (send.status === "partially_failed") acc.partially_failed += 1;
    if (send.status === "failed") acc.failed_batches += 1;
    return acc;
  }, { production_batches: 0, requested: 0, accepted: 0, failed: 0, duplicates: 0, completed: 0, partially_failed: 0, failed_batches: 0 });
}

function testSendSummary(sends = []) {
  const tests = sends.filter((send) => send.send_type === "test").sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  const latest = tests[0] || null;
  return {
    count: tests.length,
    latest_status: latest?.status || "",
    latest_created_at: latest?.created_at || null,
    latest_completed_at: latest?.completed_at || null,
  };
}

function statusBreakdown(recipients = []) {
  const map = new Map();
  recipients.forEach((row) => map.set(row.status || "unknown", (map.get(row.status || "unknown") || 0) + 1));
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).map(([status, count]) => ({ status, count }));
}

function topClickedLinks(events = []) {
  const map = new Map();
  events.filter((event) => event.event_type === "clicked" && event.link_url).forEach((event) => {
    const url = cleanText(event.link_url, 2000);
    const entry = map.get(url) || { url, clicks: 0, unique_recipients: new Set() };
    entry.clicks += 1;
    if (event.recipient_id || event.email_normalized) entry.unique_recipients.add(event.recipient_id || event.email_normalized);
    map.set(url, entry);
  });
  return Array.from(map.values())
    .map((entry) => ({ url: entry.url, clicks: entry.clicks, unique_recipients: entry.unique_recipients.size }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 10);
}

function recentTimeline(events = []) {
  return events
    .slice()
    .sort((a, b) => new Date(b.event_at).getTime() - new Date(a.event_at).getTime())
    .slice(0, 25)
    .map((event) => ({
      event_type: event.event_type,
      event_at: event.event_at,
      customer_id: event.customer_id || "",
      email: maskEmail(event.email_normalized),
      link_url: event.link_url || "",
      reason: event.reason || "",
    }));
}

function recipientRows(recipients = []) {
  return recipients
    .slice()
    .sort((a, b) => new Date(b.last_event_at || b.first_sent_at || b.created_at || 0).getTime() - new Date(a.last_event_at || a.first_sent_at || a.created_at || 0).getTime())
    .slice(0, 100)
    .map((recipient) => ({
      customer_id: recipient.customer_id || "",
      email: maskEmail(recipient.email),
      send_type: recipient.send_type,
      status: recipient.status,
      first_sent_at: recipient.first_sent_at,
      last_event_at: recipient.last_event_at,
      last_event_type: recipient.last_event_type || "",
      last_event_reason: recipient.last_event_reason || recipient.failure_reason || "",
    }));
}

async function campaignReporting(supabase, body = {}) {
  const campaign = await loadOwnedTemplateCampaign(supabase, body.id || body.campaign?.id);
  try {
    const sends = await loadAllRows(() => supabase
      .from("marketing_email_sends")
      .select(SEND_COLUMNS)
      .eq("campaign_id", campaign.id)
      .order("created_at", { ascending: false }));
    const productionSendIds = new Set(sends.filter((send) => send.send_type === "production").map((send) => send.id));
    const recipients = await loadAllRows(() => supabase
      .from("marketing_email_send_recipients")
      .select(RECIPIENT_COLUMNS)
      .eq("campaign_id", campaign.id)
      .eq("send_type", "production")
      .order("created_at", { ascending: false }));
    const allEvents = await loadAllRows(() => supabase
      .from("marketing_email_events")
      .select(EVENT_COLUMNS)
      .eq("campaign_id", campaign.id)
      .order("event_at", { ascending: false }));
    const events = allEvents.filter((event) => productionSendIds.has(event.send_id));

    const recipientAggregate = aggregateRecipients(recipients);
    return {
      reporting: {
        migration_required: false,
        campaign_id: campaign.id,
        generated_at: new Date().toISOString(),
        sends: aggregateProductionSends(sends),
        tests: testSendSummary(sends),
        recipients: recipientAggregate,
        status_breakdown: statusBreakdown(recipients),
        top_links: topClickedLinks(events),
        recent_events: recentTimeline(events),
        recent_recipients: recipientRows(recipients),
      },
    };
  } catch (error) {
    if (isMissingReportingInfrastructure(error)) {
      return {
        reporting: {
          migration_required: true,
          campaign_id: campaign.id,
          generated_at: new Date().toISOString(),
          sends: aggregateProductionSends([]),
          tests: testSendSummary([]),
          recipients: aggregateRecipients([]),
          status_breakdown: [],
          top_links: [],
          recent_events: [],
          recent_recipients: [],
        },
      };
    }
    throw error;
  }
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") {
    json(response, 405, { ok: false, message: "Method not allowed." });
    return;
  }
  if (!authorize(request)) {
    json(response, 401, { ok: false, message: "Campaign Reporting API access denied." });
    return;
  }
  try {
    const supabase = getSupabase();
    const body = parseBody(request);
    const action = body.action || "campaignReporting";
    let result;
    if (action === "validateAccess") result = {};
    else if (action === "campaignReporting") result = await campaignReporting(supabase, body);
    else throw new ApiError(400, "Unknown Campaign Reporting API action.");
    json(response, 200, { ok: true, ...result });
  } catch (error) {
    json(response, error?.statusCode || 500, { ok: false, message: error?.message || "Campaign Reporting API error." });
  }
}
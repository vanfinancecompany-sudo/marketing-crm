import { createClient } from "@supabase/supabase-js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const TEMPLATE_CAMPAIGN_SOURCE = "template_campaign_foundation";
const PAGE_SIZE = 1000;
const MAX_ROWS = 20000;
const SEND_COLUMNS = "id,campaign_id,send_type,status,requested_count,eligible_count,suppressed_count,sent_count,failed_count,skipped_duplicate_count,created_at,started_at,completed_at,error_summary,metadata";
const RECIPIENT_COLUMNS = "id,send_id,campaign_id,send_type,customer_id,email,status,first_sent_at,last_event_at,created_at,delivered_at,opened_at,clicked_at,soft_bounced_at,hard_bounced_at,complained_at,unsubscribed_at,blocked_at,deferred_at,failed_at,last_event_type,last_event_reason";
const EVENT_COLUMNS = "id,campaign_id,send_id,recipient_id,customer_id,email_normalized,event_type,event_at,link_url,reason,created_at";
const CAMPAIGN_COLUMNS = "id,name,status,campaign_type,template_name,template_snapshot,selected_vehicle_count,metadata,created_at,updated_at,archived_at";

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

function cleanText(value, limit = 500) {
  return String(value || "").trim().slice(0, limit);
}

function maskEmail(value) {
  const email = cleanText(value, 254).toLowerCase();
  const [user, domain] = email.split("@");
  if (!user || !domain) return "";
  const visible = user.length <= 2 ? user.slice(0, 1) : `${user.slice(0, 2)}...`;
  return `${visible}@${domain}`;
}

function percent(part, total) {
  const numerator = Number(part || 0);
  const denominator = Number(total || 0);
  if (!denominator || !Number.isFinite(numerator) || !Number.isFinite(denominator)) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function chunk(values, size = 200) {
  const rows = Array.from(values || []).filter(Boolean);
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}

async function loadAllRows(queryFactory, maxRows = MAX_ROWS) {
  const rows = [];
  for (let from = 0; from < maxRows; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE - 1, maxRows - 1);
    const result = await queryFactory().range(from, to);
    if (result.error) throw new Error(result.error.message || "Could not load dashboard data.");
    rows.push(...(result.data || []));
    if (!result.data || result.data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadRowsByChunks(supabase, table, columns, field, values, extra = (query) => query) {
  const rows = [];
  for (const valuesChunk of chunk(values)) {
    const result = await extra(supabase.from(table).select(columns).in(field, valuesChunk));
    if (result.error) throw new Error(result.error.message || `Could not load ${table}.`);
    rows.push(...(result.data || []));
  }
  return rows;
}

function londonDateParts(date = new Date()) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).reduce((parts, part) => {
    if (part.type !== "literal") parts[part.type] = part.value;
    return parts;
  }, {});
}

function londonMidnightIso(date = new Date()) {
  const target = londonDateParts(date);
  const targetUtc = Date.UTC(Number(target.year), Number(target.month) - 1, Number(target.day), 0, 0, 0);
  let guess = new Date(targetUtc);
  for (let index = 0; index < 3; index += 1) {
    const displayed = londonDateParts(guess);
    const displayedUtc = Date.UTC(
      Number(displayed.year),
      Number(displayed.month) - 1,
      Number(displayed.day),
      Number(displayed.hour),
      Number(displayed.minute),
      Number(displayed.second)
    );
    guess = new Date(guess.getTime() - (displayedUtc - targetUtc));
  }
  return guess.toISOString();
}

function periodRange(periodValue) {
  const period = ["today", "last7", "last30", "all"].includes(periodValue) ? periodValue : "last30";
  const now = new Date();
  if (period === "today") return { period, started_at: londonMidnightIso(now), ended_at: now.toISOString() };
  if (period === "last7") return { period, started_at: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(), ended_at: now.toISOString() };
  if (period === "last30") return { period, started_at: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(), ended_at: now.toISOString() };
  return { period, started_at: null, ended_at: now.toISOString() };
}

function isMissingTable(error, tableName) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes(tableName.toLowerCase())
    || message.includes("schema cache")
    || message.includes("does not exist")
    || message.includes("could not find");
}

async function safeHeadCount(supabase, table, filter = (query) => query) {
  try {
    const result = await filter(supabase.from(table).select("id", { count: "exact", head: true }));
    if (result.error) throw result.error;
    return { ok: true, count: result.count || 0 };
  } catch (error) {
    return { ok: false, count: 0, message: cleanText(error?.message || "Unavailable.", 200) };
  }
}

async function checkBrevoConnection() {
  const brevoApiKey = String(process.env.BREVO_API_KEY || "").trim();
  if (!brevoApiKey) return { state: "not_configured", label: "Not configured" };
  try {
    const response = await fetch("https://api.brevo.com/v3/account", { headers: { "api-key": brevoApiKey } });
    if (response.ok) return { state: "authorised", label: "Authorised", status_code: response.status };
    return { state: "rejected", label: "Rejected", status_code: response.status };
  } catch {
    return { state: "unreachable", label: "Unreachable" };
  }
}

function productionSendsOnly(rows = []) {
  return rows.filter((send) => send.send_type === "production");
}

function uniqueCount(rows, field, predicate = () => true) {
  const values = new Set();
  rows.forEach((row) => {
    if (predicate(row) && row[field]) values.add(row[field]);
  });
  return values.size;
}

function aggregateRecipients(recipients = []) {
  const acceptedStatuses = new Set(["accepted", "sent", "delivered", "opened", "clicked", "soft_bounced", "hard_bounced", "blocked", "complained", "unsubscribed"]);
  const deliveredStatuses = new Set(["delivered", "opened", "clicked"]);
  const openedStatuses = new Set(["opened", "clicked"]);
  const clickedStatuses = new Set(["clicked"]);
  const accepted = recipients.filter((row) => acceptedStatuses.has(row.status)).length;
  const delivered = uniqueCount(recipients, "id", (row) => deliveredStatuses.has(row.status) || Boolean(row.delivered_at));
  const opened = uniqueCount(recipients, "id", (row) => openedStatuses.has(row.status) || Boolean(row.opened_at));
  const clicked = uniqueCount(recipients, "id", (row) => clickedStatuses.has(row.status) || Boolean(row.clicked_at));
  const hardBounced = uniqueCount(recipients, "id", (row) => row.status === "hard_bounced" || Boolean(row.hard_bounced_at));
  const softBounced = uniqueCount(recipients, "id", (row) => row.status === "soft_bounced" || Boolean(row.soft_bounced_at));
  const blocked = uniqueCount(recipients, "id", (row) => row.status === "blocked" || Boolean(row.blocked_at));
  const complained = uniqueCount(recipients, "id", (row) => row.status === "complained" || Boolean(row.complained_at));
  const unsubscribed = uniqueCount(recipients, "id", (row) => row.status === "unsubscribed" || Boolean(row.unsubscribed_at));
  const submissionUnknown = recipients.filter((row) => row.status === "submission_unknown").length;
  const failed = recipients.filter((row) => row.status === "failed").length;
  return {
    accepted,
    delivered,
    opened,
    clicked,
    hard_bounced: hardBounced,
    soft_bounced: softBounced,
    blocked,
    complained,
    unsubscribed,
    submission_unknown: submissionUnknown,
    failed,
    delivery_rate: percent(delivered, accepted),
    open_rate: percent(opened, delivered || accepted),
    click_rate: percent(clicked, delivered || accepted),
    click_to_open_rate: percent(clicked, opened),
    bounce_rate: percent(hardBounced + softBounced + blocked, accepted),
    unsubscribe_rate: percent(unsubscribed, accepted),
  };
}

function aggregateProductionSends(sends = []) {
  return sends.reduce((acc, send) => {
    acc.production_batches += 1;
    acc.requested += Number(send.requested_count || 0);
    acc.accepted += Number(send.sent_count || 0);
    acc.failed += Number(send.failed_count || 0);
    acc.duplicates += Number(send.skipped_duplicate_count || 0);
    if (send.status === "completed") acc.completed += 1;
    if (send.status === "partially_failed") acc.partially_failed += 1;
    if (send.status === "failed") acc.failed_batches += 1;
    if (send.status === "submission_unknown") acc.submission_unknown_batches += 1;
    return acc;
  }, { production_batches: 0, requested: 0, accepted: 0, failed: 0, duplicates: 0, completed: 0, partially_failed: 0, failed_batches: 0, submission_unknown_batches: 0 });
}

function testSendSummary(sends = []) {
  const tests = sends.filter((send) => send.send_type === "test").sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  const latest = tests[0] || null;
  return {
    count: tests.length,
    completed: tests.filter((send) => send.status === "completed").length,
    failed: tests.filter((send) => send.status === "failed").length,
    latest_status: latest?.status || "",
    latest_created_at: latest?.created_at || null,
    latest_completed_at: latest?.completed_at || null,
  };
}

function campaignPerformance(campaigns = [], productionSends = [], recipients = []) {
  const campaignMap = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  const sendsByCampaign = new Map();
  productionSends.forEach((send) => {
    const rows = sendsByCampaign.get(send.campaign_id) || [];
    rows.push(send);
    sendsByCampaign.set(send.campaign_id, rows);
  });
  const recipientsByCampaign = new Map();
  recipients.forEach((recipient) => {
    const rows = recipientsByCampaign.get(recipient.campaign_id) || [];
    rows.push(recipient);
    recipientsByCampaign.set(recipient.campaign_id, rows);
  });
  const campaignIds = new Set([...campaignMap.keys(), ...sendsByCampaign.keys()]);
  return Array.from(campaignIds).map((id) => {
    const campaign = campaignMap.get(id) || { id, name: "Unknown campaign" };
    const sends = sendsByCampaign.get(id) || [];
    const latestSendAt = sends.map((send) => send.completed_at || send.started_at || send.created_at).filter(Boolean).sort().pop() || null;
    const aggregate = aggregateRecipients(recipientsByCampaign.get(id) || []);
    return {
      id,
      name: campaign.name || "Untitled campaign",
      status: campaign.status || "",
      campaign_type: campaign.campaign_type || "",
      template_name: campaign.template_name || "",
      production_batches: sends.length,
      last_production_send_at: latestSendAt,
      requested: sends.reduce((total, send) => total + Number(send.requested_count || 0), 0),
      accepted: aggregate.accepted,
      delivered: aggregate.delivered,
      opened: aggregate.opened,
      clicked: aggregate.clicked,
      delivery_rate: aggregate.delivery_rate,
      open_rate: aggregate.open_rate,
      click_rate: aggregate.click_rate,
    };
  }).sort((a, b) => new Date(b.last_production_send_at || b.updated_at || 0).getTime() - new Date(a.last_production_send_at || a.updated_at || 0).getTime()).slice(0, 50);
}

function isUnsubscribeUrl(url) {
  const value = cleanText(url, 2000).toLowerCase();
  return value.includes("unsubscribe") || value.includes("marketing-unsubscribe");
}

function safeUrl(value) {
  const url = cleanText(value, 2000);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function collectVehiclesFromSnapshot(snapshot) {
  const vehicles = [];
  const seen = new Set();
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const title = cleanText(value.title || value.name || value.vehicle_title || "", 250);
    const registration = cleanText(value.registration || value.reg || value.vrm || "", 80).toUpperCase();
    const urls = [
      value.destination_url,
      value.url,
      value.finance_url,
      value.rent2buy_url,
      value.advert_url,
      value.link_url,
      value.cta_url,
    ].map(safeUrl).filter(Boolean);
    if ((title || registration) && urls.length) {
      urls.forEach((url) => {
        const key = `${url}|${title}|${registration}`;
        if (!seen.has(key)) {
          seen.add(key);
          vehicles.push({ title: title || registration || "Selected vehicle", registration, url });
        }
      });
    }
    Object.entries(value).forEach(([key, child]) => {
      if (["selected_vehicles", "vehicles", "items", "content_blocks", "blocks", "settings"].includes(key)) visit(child);
    });
  }
  visit(snapshot || {});
  return vehicles;
}

function topClickedDestinations(events = [], campaigns = []) {
  const campaignsById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  const vehicleLookup = new Map();
  campaigns.forEach((campaign) => {
    collectVehiclesFromSnapshot(campaign.template_snapshot).forEach((vehicle) => {
      const url = safeUrl(vehicle.url);
      if (!url) return;
      vehicleLookup.set(`${campaign.id}|${url}`, { ...vehicle, campaign_id: campaign.id, campaign_name: campaign.name || "" });
      if (!vehicleLookup.has(`any|${url}`)) vehicleLookup.set(`any|${url}`, { ...vehicle, campaign_id: campaign.id, campaign_name: campaign.name || "" });
    });
  });
  const vehicleMap = new Map();
  const otherMap = new Map();
  events.filter((event) => event.event_type === "clicked" && event.link_url && !isUnsubscribeUrl(event.link_url)).forEach((event) => {
    const url = safeUrl(event.link_url);
    if (!url) return;
    const vehicle = vehicleLookup.get(`${event.campaign_id}|${url}`) || vehicleLookup.get(`any|${url}`);
    const targetMap = vehicle ? vehicleMap : otherMap;
    const key = vehicle ? `${vehicle.campaign_id}|${url}` : url;
    const entry = targetMap.get(key) || {
      url,
      title: vehicle?.title || "Other link",
      registration: vehicle?.registration || "",
      campaign_id: vehicle?.campaign_id || event.campaign_id || "",
      campaign_name: vehicle?.campaign_name || campaignsById.get(event.campaign_id)?.name || "",
      clicks: 0,
      unique_recipients: new Set(),
    };
    entry.clicks += 1;
    if (event.recipient_id || event.email_normalized) entry.unique_recipients.add(event.recipient_id || event.email_normalized);
    targetMap.set(key, entry);
  });
  const serialize = (entry) => ({ ...entry, unique_recipients: entry.unique_recipients.size });
  return {
    vehicles: Array.from(vehicleMap.values()).map(serialize).sort((a, b) => b.clicks - a.clicks).slice(0, 10),
    other: Array.from(otherMap.values()).map(serialize).sort((a, b) => b.clicks - a.clicks).slice(0, 10),
  };
}

function eventSummary(events = []) {
  const map = new Map();
  events.forEach((event) => map.set(event.event_type || "unknown", (map.get(event.event_type || "unknown") || 0) + 1));
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).map(([event_type, count]) => ({ event_type, count }));
}

function recentActivity({ sends = [], events = [], campaigns = [], suppressions = [] }) {
  const items = [];
  sends.slice(0, 30).forEach((send) => {
    const type = send.send_type === "test" ? "Test send" : "Production batch";
    items.push({ type, detail: send.status || "", occurred_at: send.completed_at || send.started_at || send.created_at, campaign_id: send.campaign_id || "" });
  });
  events.slice(0, 30).forEach((event) => {
    if (!["hard_bounce", "soft_bounce", "complaint", "unsubscribed", "clicked", "opened", "delivered"].includes(event.event_type)) return;
    items.push({ type: `Webhook ${event.event_type.replace(/_/g, " ")}`, detail: event.customer_id || maskEmail(event.email_normalized) || "", occurred_at: event.event_at, campaign_id: event.campaign_id || "" });
  });
  campaigns.slice(0, 20).forEach((campaign) => {
    items.push({ type: "Campaign activity", detail: `${campaign.name || "Untitled"} · ${campaign.status || ""}`, occurred_at: campaign.updated_at || campaign.created_at, campaign_id: campaign.id });
  });
  suppressions.slice(0, 20).forEach((row) => {
    items.push({ type: "Suppression activity", detail: cleanText(row.type || row.reason || row.action || "Suppression changed", 140), occurred_at: row.date_added || row.added_at || row.occurred_at || row.created_at, campaign_id: "" });
  });
  return items.filter((item) => item.occurred_at).sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()).slice(0, 35);
}

async function loadSuppressionHealth(supabase) {
  const empty = {
    available: false,
    total_suppressed: 0,
    totals: {},
    reason_breakdown: [],
    recent: [],
    history: [],
    message: "Suppression summary unavailable.",
  };
  try {
    const result = await supabase.rpc("marketing_suppression_overview", { p_recent_limit: 10, p_history_limit: 30 });
    if (result.error) throw result.error;
    const data = result.data || {};
    const overview = data.overview || data.totals || data || {};
    return {
      available: true,
      total_suppressed: Number(overview.suppressed_customers || overview.total_suppressed || overview.suppressed || 0),
      totals: {
        email_unsubscribed: Number(overview.email_unsubscribed || 0),
        email_bounced: Number(overview.email_bounced || overview.hard_bounced || 0),
        sms_opt_out: Number(overview.sms_opt_out || 0),
        facebook_excluded: Number(overview.facebook_excluded || 0),
        manual_suppression: Number(overview.manual_suppression || 0),
        global_do_not_contact: Number(overview.global_do_not_contact || overview.complaints || 0),
        other: Number(overview.other || 0),
      },
      reason_breakdown: data.reason_breakdown || data.reasons || [],
      recent: (data.recent || data.recent_suppressions || []).slice(0, 10).map((row) => ({
        customer_id: row.customer_id || row.contact_customer_id || "",
        email: maskEmail(row.email || row.email_normalized || ""),
        type: row.type || row.suppression_type || row.action || "",
        reason: row.reason || "",
        date_added: row.date_added || row.added_at || row.occurred_at || row.created_at || null,
        source: row.source || row.added_by || "",
      })),
      history: (data.history || []).slice(0, 30),
      message: "",
    };
  } catch (error) {
    return { ...empty, message: cleanText(error?.message || empty.message, 200) };
  }
}

async function loadDashboard(supabase, body = {}) {
  const range = periodRange(body.period);
  const brevo = await checkBrevoConnection();
  const sender = {
    configured: Boolean(String(process.env.BREVO_SENDER_EMAIL || "").trim() && String(process.env.BREVO_SENDER_NAME || "").trim()),
    email_configured: Boolean(String(process.env.BREVO_SENDER_EMAIL || "").trim()),
    name_configured: Boolean(String(process.env.BREVO_SENDER_NAME || "").trim()),
    email: String(process.env.BREVO_SENDER_EMAIL || "").trim() || "",
    name: String(process.env.BREVO_SENDER_NAME || "").trim() || "",
    provider_sender_status: "not_checked",
  };
  const unsubscribe = {
    configured: Boolean(String(process.env.MARKETING_PUBLIC_BASE_URL || "").trim() && String(process.env.MARKETING_UNSUBSCRIBE_TOKEN_SECRET || "").trim()),
    public_base_url_configured: Boolean(String(process.env.MARKETING_PUBLIC_BASE_URL || "").trim()),
    secret_configured: Boolean(String(process.env.MARKETING_UNSUBSCRIBE_TOKEN_SECRET || "").trim()),
  };

  const sendingCount = await safeHeadCount(supabase, "marketing_email_sends");
  const reportingCount = await safeHeadCount(supabase, "marketing_email_events");
  const activeTemplateCount = await safeHeadCount(supabase, "marketing_email_templates", (query) => query.eq("status", "active"));

  let sends = [];
  let productionSends = [];
  let recipients = [];
  let events = [];
  let campaigns = [];
  let webhook = { configured: Boolean(String(process.env.BREVO_WEBHOOK_SECRET || "").trim()), latest_event_at: null, events_last_24h: 0, events_last_7d: 0, state: "awaiting_first_event" };
  let infrastructureMessage = "";

  try {
    sends = await loadAllRows(() => {
      let query = supabase.from("marketing_email_sends").select(SEND_COLUMNS).order("created_at", { ascending: false });
      if (range.started_at) query = query.gte("created_at", range.started_at);
      return query;
    });
    productionSends = productionSendsOnly(sends);
    const productionSendIds = productionSends.map((send) => send.id);
    recipients = await loadRowsByChunks(supabase, "marketing_email_send_recipients", RECIPIENT_COLUMNS, "send_id", productionSendIds, (query) => query.eq("send_type", "production"));
    events = await loadRowsByChunks(supabase, "marketing_email_events", EVENT_COLUMNS, "send_id", productionSendIds, (query) => query.order("event_at", { ascending: false }));

    const campaignIds = new Set(productionSends.map((send) => send.campaign_id).filter(Boolean));
    const recentCampaigns = await loadAllRows(() => supabase
      .from("marketing_campaigns")
      .select(CAMPAIGN_COLUMNS)
      .eq("metadata->>source", TEMPLATE_CAMPAIGN_SOURCE)
      .order("updated_at", { ascending: false }), 100);
    recentCampaigns.forEach((campaign) => campaignIds.add(campaign.id));
    campaigns = campaignIds.size
      ? await loadRowsByChunks(supabase, "marketing_campaigns", CAMPAIGN_COLUMNS, "id", Array.from(campaignIds), (query) => query)
      : recentCampaigns;
    const latestEvent = await supabase.from("marketing_email_events").select("event_at").order("event_at", { ascending: false }).limit(1).maybeSingle();
    const last24 = await safeHeadCount(supabase, "marketing_email_events", (query) => query.gte("event_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()));
    const last7 = await safeHeadCount(supabase, "marketing_email_events", (query) => query.gte("event_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()));
    webhook = {
      ...webhook,
      latest_event_at: latestEvent.error ? null : latestEvent.data?.event_at || null,
      events_last_24h: last24.count || 0,
      events_last_7d: last7.count || 0,
      state: webhook.configured ? (latestEvent.data?.event_at ? "active" : "awaiting_first_event") : "not_configured",
    };
  } catch (error) {
    if (isMissingTable(error, "marketing_email_sends") || isMissingTable(error, "marketing_email_events")) {
      infrastructureMessage = cleanText(error.message || "Sending or reporting infrastructure is unavailable.", 300);
    } else {
      throw error;
    }
  }

  const suppression = await loadSuppressionHealth(supabase);
  const productionMetrics = aggregateRecipients(recipients);
  const productionSendMetrics = aggregateProductionSends(productionSends);
  const topClicks = topClickedDestinations(events, campaigns);
  const recent = recentActivity({ sends, events, campaigns, suppressions: suppression.history || suppression.recent || [] });
  const essentialReadiness = {
    brevo_authorised: brevo.state === "authorised",
    sender_configured: sender.configured,
    unsubscribe_configured: unsubscribe.configured,
    sending_infra_available: sendingCount.ok,
    reporting_infra_available: reportingCount.ok,
    webhook_secret_configured: webhook.configured,
    active_template_available: (activeTemplateCount.count || 0) > 0,
    campaign_builder_accessible: true,
    suppression_system_accessible: suppression.available,
  };
  const readyForControlledSending = Object.values(essentialReadiness).every(Boolean);

  return {
    dashboard: {
      generated_at: new Date().toISOString(),
      period: range,
      health: {
        brevo,
        sender,
        unsubscribe,
        sending_database: { available: sendingCount.ok, record_count: sendingCount.count || 0, message: sendingCount.message || "" },
        reporting_database: { available: reportingCount.ok, record_count: reportingCount.count || 0, message: reportingCount.message || "" },
        webhook,
        infrastructure_message: infrastructureMessage,
      },
      launch_readiness: { ready_for_controlled_email_sending: readyForControlledSending, checks: essentialReadiness },
      production: {
        sends: productionSendMetrics,
        recipients: productionMetrics,
        production_campaigns_with_send_activity: new Set(productionSends.map((send) => send.campaign_id).filter(Boolean)).size,
      },
      tests: testSendSummary(sends),
      campaigns: campaignPerformance(campaigns, productionSends, recipients),
      event_breakdown: eventSummary(events),
      top_clicked_vehicles: topClicks.vehicles,
      top_clicked_links: topClicks.other,
      suppression,
      recent_activity: recent,
      privacy_note: "Open rates can be affected by privacy proxy and prefetch behaviour. Clicks are generally a stronger engagement signal.",
    },
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") {
    json(response, 405, { ok: false, message: "Method not allowed." });
    return;
  }
  if (!authorize(request)) {
    json(response, 401, { ok: false, message: "Marketing Dashboard API access denied." });
    return;
  }
  try {
    const body = parseBody(request);
    const action = body.action || "dashboard";
    const supabase = getSupabase();
    if (action === "validateAccess") {
      json(response, 200, { ok: true });
      return;
    }
    if (action !== "dashboard") throw new ApiError(400, "Unknown Marketing Dashboard API action.");
    const result = await loadDashboard(supabase, body);
    json(response, 200, { ok: true, ...result });
  } catch (error) {
    json(response, error?.statusCode || 500, { ok: false, message: error?.message || "Marketing Dashboard API error." });
  }
}

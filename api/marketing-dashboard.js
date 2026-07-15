import { createClient } from "@supabase/supabase-js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const TEMPLATE_CAMPAIGN_SOURCE = "template_campaign_foundation";
const PAGE_SIZE = 1000;
const SEND_ROW_CAP = 10000;
const EVENT_ROW_CAP = 50000;
const CAMPAIGN_ROW_CAP = 5000;
const SEND_COLUMNS = "id,campaign_id,send_type,status,requested_count,eligible_count,suppressed_count,sent_count,failed_count,skipped_duplicate_count,created_at,started_at,completed_at,error_summary,metadata";
const EVENT_COLUMNS = "id,campaign_id,send_id,recipient_id,customer_id,email_normalized,provider_event_id,provider_message_id,event_type,event_at,link_url,reason,metadata,created_at";
const RECIPIENT_CORRELATION_COLUMNS = "id,send_id,campaign_id,customer_id,email,provider_message_id,first_sent_at,created_at";
const CAMPAIGN_COLUMNS = "id,name,status,campaign_type,template_name,template_snapshot,selected_vehicle_count,metadata,created_at,updated_at,archived_at";

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function json(response, status, payload) { response.status(status).json(payload); }

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

function cleanText(value, limit = 500) { return String(value || "").trim().slice(0, limit); }

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

async function loadAllRows(queryFactory, options = {}) {
  const limit = options.limit || 5000;
  const dataset = options.dataset || "data";
  const rows = [];
  let totalCount = null;
  for (let from = 0; from < limit; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE - 1, limit - 1);
    const result = await queryFactory().range(from, to);
    if (result.error) throw new Error(result.error.message || `Could not load ${dataset}.`);
    if (typeof result.count === "number") totalCount = result.count;
    rows.push(...(result.data || []));
    if (!result.data || result.data.length < PAGE_SIZE) break;
  }
  return {
    rows,
    total_count: totalCount === null ? rows.length : totalCount,
    partial: totalCount !== null ? totalCount > rows.length : rows.length >= limit,
    dataset,
    limit,
  };
}

async function loadRowsByChunks(supabase, table, columns, field, values, extra = (query) => query, options = {}) {
  const rows = [];
  const partials = [];
  for (const valuesChunk of chunk(values)) {
    const result = await loadAllRows(
      () => extra(supabase.from(table).select(columns, { count: "exact" }).in(field, valuesChunk)),
      { dataset: options.dataset || table, limit: options.limit || EVENT_ROW_CAP }
    );
    rows.push(...result.rows);
    if (result.partial) partials.push(result);
  }
  return { rows, partials };
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
    const displayedUtc = Date.UTC(Number(displayed.year), Number(displayed.month) - 1, Number(displayed.day), Number(displayed.hour), Number(displayed.minute), Number(displayed.second));
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

function applyPeriod(query, column, range) {
  let next = query.lte(column, range.ended_at);
  if (range.started_at) next = next.gte(column, range.started_at);
  return next;
}

function isMissingTable(error, tableName) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes(tableName.toLowerCase()) || message.includes("schema cache") || message.includes("does not exist") || message.includes("could not find");
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

function eventMetadataCorrelation(event = {}) {
  const ids = event.metadata?.correlation_ids || {};
  return {
    campaign_id: cleanText(ids.campaign_id, 80),
    send_id: cleanText(ids.send_id, 80),
    recipient_id: cleanText(ids.recipient_id, 80),
  };
}

function recipientForEventEmail(event, recipientsByEmail = new Map()) {
  const email = cleanText(event.email_normalized, 320).toLowerCase();
  const candidates = recipientsByEmail.get(email) || [];
  if (!candidates.length) return null;
  const eventTime = new Date(event.event_at || 0).getTime();
  const eligible = candidates
    .filter((recipient) => {
      const sentTime = new Date(recipient.first_sent_at || recipient.created_at || 0).getTime();
      return Number.isFinite(sentTime) && (!Number.isFinite(eventTime) || sentTime <= eventTime);
    })
    .sort((left, right) => new Date(right.first_sent_at || right.created_at || 0).getTime() - new Date(left.first_sent_at || left.created_at || 0).getTime());
  if (eligible.length) return eligible[0];
  return candidates.length === 1 ? candidates[0] : null;
}

function reconcileEventCorrelation(event, recipientsByMessageId = new Map(), recipientsByEmail = new Map()) {
  const metadataIds = eventMetadataCorrelation(event);
  const recipient = (event.provider_message_id ? recipientsByMessageId.get(event.provider_message_id) : null)
    || recipientForEventEmail(event, recipientsByEmail);
  return {
    ...event,
    campaign_id: event.campaign_id || metadataIds.campaign_id || recipient?.campaign_id || null,
    send_id: event.send_id || metadataIds.send_id || recipient?.send_id || null,
    recipient_id: event.recipient_id || metadataIds.recipient_id || recipient?.id || null,
    customer_id: event.customer_id || recipient?.customer_id || null,
  };
}

function dashboardEmailProviderConfig() {
  const smtp2go = Boolean(process.env.SMTP2GO_API_KEY || process.env.SMTP2GO_SENDER_EMAIL || process.env.SMTP2GO_SENDER_NAME);
  return {
    provider: smtp2go ? "SMTP2GO" : "Brevo",
    apiKey: String(smtp2go ? process.env.SMTP2GO_API_KEY || "" : process.env.BREVO_API_KEY || "").trim(),
    senderEmail: String(smtp2go ? process.env.SMTP2GO_SENDER_EMAIL || "" : process.env.BREVO_SENDER_EMAIL || "").trim(),
    senderName: String(smtp2go ? process.env.SMTP2GO_SENDER_NAME || "" : process.env.BREVO_SENDER_NAME || "").trim(),
  };
}

async function checkEmailProviderConnection(config) {
  if (!config.apiKey) return { provider: config.provider, state: "not_configured", label: "Not configured" };
  try {
    const smtp2go = config.provider === "SMTP2GO";
    const response = await fetch(smtp2go ? "https://api.smtp2go.com/v3/api_keys/permissions" : "https://api.brevo.com/v3/account", {
      method: smtp2go ? "POST" : "GET",
      headers: smtp2go ? { "Content-Type": "application/json", "X-Smtp2go-Api-Key": config.apiKey } : { "api-key": config.apiKey },
      body: smtp2go ? "{}" : undefined,
    });
    if (response.ok) return { provider: config.provider, state: "authorised", label: "Authorised", status_code: response.status };
    return { provider: config.provider, state: "rejected", label: "Rejected", status_code: response.status };
  } catch {
    return { provider: config.provider, state: "unreachable", label: "Unreachable" };
  }
}

function productionSendsOnly(rows = []) { return rows.filter((send) => send.send_type === "production"); }

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

function uniqueEventCount(events = [], eventTypes = []) {
  const types = new Set(eventTypes);
  const ids = new Set();
  events.forEach((event) => {
    if (!types.has(event.event_type) || !event.recipient_id) return;
    ids.add(event.recipient_id);
  });
  return ids.size;
}

function aggregateEventActivity(events = [], submissionDenominator = 0) {
  const delivered = uniqueEventCount(events, ["delivered"]);
  const opens = events.filter((event) => event.event_type === "opened").length;
  const uniqueOpens = uniqueEventCount(events, ["opened"]);
  const clicked = uniqueEventCount(events, ["clicked"]);
  const hardBounced = uniqueEventCount(events, ["hard_bounce", "invalid_email"]);
  const softBounced = uniqueEventCount(events, ["soft_bounce"]);
  const deferred = uniqueEventCount(events, ["deferred"]);
  const blocked = uniqueEventCount(events, ["blocked"]);
  const complained = uniqueEventCount(events, ["complaint"]);
  const unsubscribed = uniqueEventCount(events, ["unsubscribed"]);
  return {
    delivered,
    opens: Math.max(opens, uniqueOpens),
    unique_opens: uniqueOpens,
    opened: uniqueOpens,
    clicked,
    hard_bounced: hardBounced,
    soft_bounced: softBounced,
    deferred,
    blocked,
    complained,
    unsubscribed,
    delivery_rate: percent(delivered, submissionDenominator),
    open_rate: percent(uniqueOpens, delivered || submissionDenominator),
    click_rate: percent(clicked, delivered || submissionDenominator),
    click_to_open_rate: percent(clicked, uniqueOpens),
    bounce_rate: percent(hardBounced + softBounced + blocked, submissionDenominator),
    unsubscribe_rate: percent(unsubscribed, submissionDenominator),
    submission_unknown: 0,
    failed: 0,
  };
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

function campaignPerformance(campaigns = [], periodProductionSends = [], periodProductionEvents = []) {
  const campaignMap = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  const sendsByCampaign = new Map();
  periodProductionSends.forEach((send) => {
    if (!send.campaign_id) return;
    const rows = sendsByCampaign.get(send.campaign_id) || [];
    rows.push(send);
    sendsByCampaign.set(send.campaign_id, rows);
  });
  const eventsByCampaign = new Map();
  periodProductionEvents.forEach((event) => {
    if (!event.campaign_id) return;
    const rows = eventsByCampaign.get(event.campaign_id) || [];
    rows.push(event);
    eventsByCampaign.set(event.campaign_id, rows);
  });
  const campaignIds = new Set([...campaignMap.keys(), ...sendsByCampaign.keys(), ...eventsByCampaign.keys()]);
  return Array.from(campaignIds).map((id) => {
    const campaign = campaignMap.get(id) || { id, name: "Unknown campaign" };
    const sends = sendsByCampaign.get(id) || [];
    const events = eventsByCampaign.get(id) || [];
    const latestActivityAt = [
      ...sends.map((send) => send.completed_at || send.started_at || send.created_at),
      ...events.map((event) => event.event_at),
      campaign.updated_at,
      campaign.created_at,
    ].filter(Boolean).sort().pop() || null;
    const sendMetrics = aggregateProductionSends(sends);
    const eventMetrics = aggregateEventActivity(events, sendMetrics.accepted);
    return {
      id,
      name: campaign.name || "Untitled campaign",
      status: campaign.status || "",
      campaign_type: campaign.campaign_type || "",
      template_name: campaign.template_name || "",
      updated_at: campaign.updated_at || null,
      created_at: campaign.created_at || null,
      period_activity_at: latestActivityAt,
      last_production_send_at: latestActivityAt,
      production_batches: sends.length,
      requested: sendMetrics.requested,
      accepted: sendMetrics.accepted,
      delivered: eventMetrics.delivered,
      opens: eventMetrics.opens,
      unique_opens: eventMetrics.unique_opens,
      opened: eventMetrics.opened,
      clicked: eventMetrics.clicked,
      bounces: eventMetrics.hard_bounced + eventMetrics.soft_bounced + eventMetrics.blocked,
      delivery_rate: eventMetrics.delivery_rate,
      open_rate: eventMetrics.open_rate,
      click_rate: eventMetrics.click_rate,
      bounce_rate: eventMetrics.bounce_rate,
    };
  }).sort((a, b) => new Date(b.period_activity_at || 0).getTime() - new Date(a.period_activity_at || 0).getTime()).slice(0, 50);
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
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const title = cleanText(value.title || value.name || value.vehicle_title || "", 250);
    const registration = cleanText(value.registration || value.reg || value.vrm || "", 80).toUpperCase();
    const urls = [value.destination_url, value.url, value.finance_url, value.rent2buy_url, value.advert_url, value.link_url, value.cta_url].map(safeUrl).filter(Boolean);
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
      if (url) vehicleLookup.set(`${campaign.id}|${url}`, { ...vehicle, campaign_id: campaign.id, campaign_name: campaign.name || "" });
    });
  });
  const vehicleMap = new Map();
  const otherMap = new Map();
  events.filter((event) => event.event_type === "clicked" && event.link_url && !isUnsubscribeUrl(event.link_url)).forEach((event) => {
    const url = safeUrl(event.link_url);
    if (!url) return;
    const vehicle = vehicleLookup.get(`${event.campaign_id}|${url}`);
    const targetMap = vehicle ? vehicleMap : otherMap;
    const key = vehicle ? `${event.campaign_id}|${url}` : url;
    const entry = targetMap.get(key) || {
      url,
      title: vehicle?.title || "Other link",
      registration: vehicle?.registration || "",
      campaign_id: event.campaign_id || "",
      campaign_name: vehicle?.campaign_name || campaignsById.get(event.campaign_id)?.name || "",
      clicks: 0,
      unique_recipients: new Set(),
    };
    entry.clicks += 1;
    if (event.recipient_id) entry.unique_recipients.add(event.recipient_id);
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
    if (!["hard_bounce", "soft_bounce", "deferred", "blocked", "complaint", "unsubscribed", "clicked", "opened", "delivered"].includes(event.event_type)) return;
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
  const empty = { available: false, total_suppressed: 0, totals: {}, reason_breakdown: [], recent: [], history: [], message: "Suppression summary unavailable." };
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

function partialWarning(partials = []) {
  const affected = partials.filter(Boolean);
  return {
    partial_data: affected.length > 0,
    affected_datasets: affected.map((item) => ({ dataset: item.dataset, loaded_rows: item.rows?.length || 0, total_count: item.total_count, limit: item.limit })),
  };
}

function dashboardNote(partial) {
  const base = "Send totals use production sends created in the selected period. Engagement uses verified production webhook events whose event_at is inside the selected period, so a click today from an older send counts today. Open rates can be affected by privacy proxy and prefetch behaviour; clicks are generally stronger.";
  if (!partial.partial_data) return base;
  const affected = partial.affected_datasets.map((item) => `${item.dataset}: loaded ${item.loaded_rows} of ${item.total_count}`).join("; ");
  return `Partial data warning: one or more datasets reached a safety cap (${affected}). Totals for affected datasets are not authoritative. ${base}`;
}

async function loadDashboard(supabase, body = {}) {
  const range = periodRange(body.period);
  const providerConfig = dashboardEmailProviderConfig();
  const brevo = await checkEmailProviderConnection(providerConfig);
  const sender = {
    provider: providerConfig.provider,
    configured: Boolean(providerConfig.senderEmail && providerConfig.senderName),
    email_configured: Boolean(providerConfig.senderEmail),
    name_configured: Boolean(providerConfig.senderName),
    email: providerConfig.senderEmail,
    name: providerConfig.senderName,
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
  let periodProductionSends = [];
  let periodEvents = [];
  let periodProductionEvents = [];
  let campaigns = [];
  const webhookProvider = providerConfig.provider;
  const webhookSecret = webhookProvider === "SMTP2GO" ? process.env.SMTP2GO_WEBHOOK_SECRET : process.env.BREVO_WEBHOOK_SECRET;
  let webhook = { provider: webhookProvider, configured: Boolean(String(webhookSecret || "").trim()), latest_event_at: null, events_last_24h: 0, events_last_7d: 0, state: "awaiting_first_event" };
  let infrastructureMessage = "";
  const partials = [];

  try {
    const sendResult = await loadAllRows(() => applyPeriod(supabase.from("marketing_email_sends").select(SEND_COLUMNS, { count: "exact" }).order("created_at", { ascending: false }), "created_at", range), { dataset: "period sends", limit: SEND_ROW_CAP });
    sends = sendResult.rows;
    if (sendResult.partial) partials.push(sendResult);
    periodProductionSends = productionSendsOnly(sends);

    const eventResult = await loadAllRows(() => applyPeriod(supabase.from("marketing_email_events").select(EVENT_COLUMNS, { count: "exact" }).order("event_at", { ascending: false }), "event_at", range), { dataset: "period webhook events", limit: EVENT_ROW_CAP });
    periodEvents = eventResult.rows;
    if (eventResult.partial) partials.push(eventResult);

    const unresolvedEvents = periodEvents.filter((event) => !event.campaign_id || !event.send_id || !event.recipient_id);
    const unresolvedMessageIds = new Set(unresolvedEvents.map((event) => event.provider_message_id).filter(Boolean));
    const unresolvedEmails = new Set(unresolvedEvents.map((event) => cleanText(event.email_normalized, 320).toLowerCase()).filter(Boolean));
    const recipientCorrelationResult = unresolvedMessageIds.size
      ? await loadRowsByChunks(
        supabase,
        "marketing_email_send_recipients",
        RECIPIENT_CORRELATION_COLUMNS,
        "provider_message_id",
        Array.from(unresolvedMessageIds),
        (query) => query.eq("send_type", "production"),
        { dataset: "event recipient correlation", limit: EVENT_ROW_CAP }
      )
      : { rows: [], partials: [] };
    const recipientEmailResult = unresolvedEmails.size
      ? await loadRowsByChunks(
        supabase,
        "marketing_email_send_recipients",
        RECIPIENT_CORRELATION_COLUMNS,
        "email",
        Array.from(unresolvedEmails),
        (query) => query.eq("send_type", "production"),
        { dataset: "event email correlation", limit: EVENT_ROW_CAP }
      )
      : { rows: [], partials: [] };
    partials.push(...recipientCorrelationResult.partials, ...recipientEmailResult.partials);
    const recipientsByMessageId = new Map(recipientCorrelationResult.rows.map((recipient) => [recipient.provider_message_id, recipient]));
    const recipientsByEmail = new Map();
    recipientEmailResult.rows.forEach((recipient) => {
      const email = cleanText(recipient.email, 320).toLowerCase();
      const rows = recipientsByEmail.get(email) || [];
      rows.push(recipient);
      recipientsByEmail.set(email, rows);
    });
    periodEvents = periodEvents.map((event) => reconcileEventCorrelation(event, recipientsByMessageId, recipientsByEmail));

    const eventSendIds = new Set(periodEvents.map((event) => event.send_id).filter(Boolean));
    const eventSendResult = await loadRowsByChunks(supabase, "marketing_email_sends", SEND_COLUMNS, "id", Array.from(eventSendIds), (query) => query, { dataset: "event send lookup", limit: SEND_ROW_CAP });
    partials.push(...eventSendResult.partials);
    const sendsById = new Map(eventSendResult.rows.map((send) => [send.id, send]));
    periodEvents = periodEvents.map((event) => {
      const send = sendsById.get(event.send_id);
      return event.campaign_id || !send?.campaign_id ? event : { ...event, campaign_id: send.campaign_id };
    });
    periodProductionEvents = periodEvents.filter((event) => sendsById.get(event.send_id)?.send_type === "production");

    const campaignIds = new Set([...periodProductionSends.map((send) => send.campaign_id).filter(Boolean), ...periodProductionEvents.map((event) => event.campaign_id).filter(Boolean)]);
    const recentCampaigns = await loadAllRows(() => supabase.from("marketing_campaigns").select(CAMPAIGN_COLUMNS, { count: "exact" }).eq("metadata->>source", TEMPLATE_CAMPAIGN_SOURCE).order("updated_at", { ascending: false }), { dataset: "recent campaigns", limit: 100 });
    recentCampaigns.rows.forEach((campaign) => campaignIds.add(campaign.id));
    const campaignResult = campaignIds.size
      ? await loadRowsByChunks(supabase, "marketing_campaigns", CAMPAIGN_COLUMNS, "id", Array.from(campaignIds), (query) => query, { dataset: "campaign lookup", limit: CAMPAIGN_ROW_CAP })
      : { rows: recentCampaigns.rows, partials: [] };
    campaigns = campaignResult.rows;
    partials.push(...campaignResult.partials);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const webhookWindowResult = await loadAllRows(
      () => supabase.from("marketing_email_events")
        .select("event_at,event_type", { count: "exact" })
        .gte("event_at", sevenDaysAgo)
        .order("event_at", { ascending: false }),
      { dataset: "webhook health events", limit: EVENT_ROW_CAP }
    );
    if (webhookWindowResult.partial) partials.push(webhookWindowResult);
    const isTrackedEvent = (event) => !["", "unknown", "error"].includes(cleanText(event.event_type, 80).toLowerCase());
    const trackedWebhookEvents = webhookWindowResult.rows.filter(isTrackedEvent);
    let latestEventAt = trackedWebhookEvents[0]?.event_at || null;
    if (!latestEventAt && reportingCount.count > 0) {
      const latestCandidates = await supabase.from("marketing_email_events")
        .select("event_at,event_type")
        .order("event_at", { ascending: false })
        .limit(1000);
      if (latestCandidates.error) throw new Error(latestCandidates.error.message || "Could not load webhook health.");
      latestEventAt = (latestCandidates.data || []).find(isTrackedEvent)?.event_at || null;
    }
    const eventsLast24h = trackedWebhookEvents.filter((event) => event.event_at >= oneDayAgo).length;
    const eventsLast7d = trackedWebhookEvents.length;
    const hasTrackedEvents = Boolean(latestEventAt || (reportingCount.ok && reportingCount.count > 0));
    webhook = {
      ...webhook,
      latest_event_at: latestEventAt,
      events_last_24h: eventsLast24h,
      events_last_7d: eventsLast7d,
      state: webhook.configured ? (hasTrackedEvents ? "active" : "awaiting_first_event") : "not_configured",
    };
  } catch (error) {
    if (isMissingTable(error, "marketing_email_sends") || isMissingTable(error, "marketing_email_events")) infrastructureMessage = cleanText(error.message || "Sending or reporting infrastructure is unavailable.", 300);
    else throw error;
  }

  const suppression = await loadSuppressionHealth(supabase);
  const productionSendMetrics = aggregateProductionSends(periodProductionSends);
  const productionEventMetrics = aggregateEventActivity(periodProductionEvents, productionSendMetrics.accepted);
  const topClicks = topClickedDestinations(periodProductionEvents, campaigns);
  const recent = recentActivity({ sends, events: periodProductionEvents, campaigns, suppressions: suppression.history || suppression.recent || [] });
  const partial = partialWarning(partials);
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

  return {
    dashboard: {
      generated_at: new Date().toISOString(),
      period: range,
      semantics: {
        campaign_table: "Period performance: send rows are counted by send created_at in the selected period; engagement is counted by production webhook event_at in the selected period.",
        send_activity: "Production batch/requested/accepted/failed/skipped figures use production sends created within the selected period.",
        engagement_activity: "Delivered, opens, clicks, bounces, complaints and unsubscribes use verified production webhook events whose event_at is inside the selected period, even if the original send was earlier.",
      },
      health: {
        brevo,
        sender,
        unsubscribe,
        sending_database: { available: sendingCount.ok, record_count: sendingCount.count || 0, message: sendingCount.message || "" },
        reporting_database: { available: reportingCount.ok, record_count: reportingCount.count || 0, message: reportingCount.message || "" },
        webhook,
        infrastructure_message: infrastructureMessage,
      },
      launch_readiness: { ready_for_controlled_email_sending: Object.values(essentialReadiness).every(Boolean), checks: essentialReadiness },
      production: {
        sends: productionSendMetrics,
        events: productionEventMetrics,
        recipients: productionEventMetrics,
        production_campaigns_with_send_activity: new Set(periodProductionSends.map((send) => send.campaign_id).filter(Boolean)).size,
        production_campaigns_with_event_activity: new Set(periodProductionEvents.map((event) => event.campaign_id).filter(Boolean)).size,
      },
      tests: testSendSummary(sends),
      campaigns: campaignPerformance(campaigns, periodProductionSends, periodProductionEvents),
      event_breakdown: eventSummary(periodProductionEvents),
      top_clicked_vehicles: topClicks.vehicles,
      top_clicked_links: topClicks.other,
      suppression,
      recent_activity: recent,
      partial_data: partial.partial_data,
      partial_data_details: partial.affected_datasets,
      privacy_note: dashboardNote(partial),
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

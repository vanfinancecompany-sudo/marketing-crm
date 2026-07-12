import { createClient } from "@supabase/supabase-js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const CONTACT_COLUMNS = "id,customer_id,first_name,last_name,company,email,phone,postcode,pipeline,source,marketing_status,email_ready,sms_ready,facebook_ready,suppression,suppression_history,created_at,updated_at";
const HISTORY_LIMIT = 100;
const SUPPRESSION_TYPES = new Set([
  "email_unsubscribed",
  "email_bounced",
  "sms_opt_out",
  "facebook_excluded",
  "manual_suppression",
  "global_do_not_contact",
]);

const SUPPRESSION_LABELS = {
  email_unsubscribed: "Email Unsubscribed",
  email_bounced: "Email Bounced",
  sms_opt_out: "SMS Opt-out",
  facebook_excluded: "Facebook Excluded",
  manual_suppression: "Manual Suppression",
  global_do_not_contact: "Global Do Not Contact",
};

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

function fullName(row = {}) {
  return [row.first_name, row.last_name].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
}

function normalizeSuppression(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeHistory(value) {
  return Array.isArray(value) ? value : [];
}

function hasActiveSuppression(row = {}) {
  const suppression = normalizeSuppression(row.suppression);
  return row.marketing_status !== "active" || Object.values(suppression).some((entry) => entry?.active !== false);
}

function normalizeContact(row = {}) {
  const suppression = normalizeSuppression(row.suppression);
  return {
    id: row.id || "",
    customer_id: row.customer_id || "",
    name: fullName(row) || row.company || row.customer_id || "",
    first_name: row.first_name || "",
    last_name: row.last_name || "",
    company: row.company || "",
    email: row.email || "",
    phone: row.phone || "",
    postcode: row.postcode || "",
    pipeline: row.pipeline || "unknown",
    source: row.source || "other",
    marketing_status: row.marketing_status || "active",
    email_ready: Boolean(row.email_ready),
    sms_ready: Boolean(row.sms_ready),
    facebook_ready: Boolean(row.facebook_ready),
    suppression,
    suppression_history: normalizeHistory(row.suppression_history),
    is_suppressed: hasActiveSuppression(row),
    updated_at: row.updated_at || "",
    created_at: row.created_at || "",
  };
}

function normalizeType(type) {
  const value = String(type || "").trim().toLowerCase();
  if (!SUPPRESSION_TYPES.has(value)) throw new Error("Unsupported suppression type.");
  return value;
}

function cleanText(value, fallback = "") {
  return String(value || fallback).trim().slice(0, 500);
}

function customerSearchQuery(query, search) {
  const term = String(search || "").trim().replace(/[,%]/g, "");
  if (!term) return query;
  const pattern = `%${term}%`;
  return query.or([
    `customer_id.ilike.${pattern}`,
    `first_name.ilike.${pattern}`,
    `last_name.ilike.${pattern}`,
    `email.ilike.${pattern}`,
    `phone.ilike.${pattern}`,
    `company.ilike.${pattern}`,
    `postcode.ilike.${pattern}`,
  ].join(","));
}

function channelFlagsAfterSuppress(type, contact) {
  const payload = {};
  if (type === "email_unsubscribed" || type === "email_bounced") payload.email_ready = false;
  if (type === "sms_opt_out") payload.sms_ready = false;
  if (type === "facebook_excluded") payload.facebook_ready = false;
  if (type === "manual_suppression" || type === "global_do_not_contact") payload.marketing_status = "suppressed";
  return payload;
}

function channelFlagsAfterRemove(type, nextSuppression, contact) {
  const emailSuppressed = Boolean(nextSuppression.email_unsubscribed || nextSuppression.email_bounced);
  const smsSuppressed = Boolean(nextSuppression.sms_opt_out);
  const facebookSuppressed = Boolean(nextSuppression.facebook_excluded);
  const globallySuppressed = Boolean(nextSuppression.manual_suppression || nextSuppression.global_do_not_contact);
  const hasEmail = Boolean(contact.email);
  const hasPhone = Boolean(contact.phone);

  const payload = {
    marketing_status: globallySuppressed ? "suppressed" : "active",
  };
  if (type === "email_unsubscribed" || type === "email_bounced") payload.email_ready = hasEmail && !emailSuppressed;
  if (type === "sms_opt_out") payload.sms_ready = hasPhone && !smsSuppressed;
  if (type === "facebook_excluded") payload.facebook_ready = (hasEmail || hasPhone) && !facebookSuppressed;
  if (!globallySuppressed && !emailSuppressed && !smsSuppressed && !facebookSuppressed) {
    payload.email_ready = hasEmail;
    payload.sms_ready = hasPhone;
    payload.facebook_ready = hasEmail || hasPhone;
  }
  return payload;
}

async function getOverview(supabase) {
  const [totalSuppressed, activeTotal, recentRows] = await Promise.all([
    supabase.from("marketing_contacts").select("id", { count: "exact", head: true }).neq("marketing_status", "active"),
    supabase.from("marketing_contacts").select("id", { count: "exact", head: true }),
    supabase.from("marketing_contacts").select(CONTACT_COLUMNS).neq("marketing_status", "active").order("updated_at", { ascending: false }).limit(10),
  ]);
  assertSupabase(totalSuppressed, "Could not count suppressed contacts.");
  assertSupabase(activeTotal, "Could not count contacts.");
  assertSupabase(recentRows, "Could not load recent suppressions.");

  const contacts = (recentRows.data || []).map(normalizeContact);
  const breakdown = Object.fromEntries(Object.keys(SUPPRESSION_LABELS).map((key) => [key, 0]));
  contacts.forEach((contact) => {
    Object.keys(contact.suppression || {}).forEach((key) => {
      if (breakdown[key] !== undefined) breakdown[key] += 1;
    });
    if (contact.marketing_status !== "active" && !Object.keys(contact.suppression || {}).length) breakdown.manual_suppression += 1;
  });

  return {
    overview: {
      total_contacts: activeTotal.count || 0,
      suppressed_contacts: totalSuppressed.count || 0,
      active_contacts: Math.max(0, (activeTotal.count || 0) - (totalSuppressed.count || 0)),
    },
    totals: breakdown,
    recent: contacts,
    history: contacts.flatMap((contact) => contact.suppression_history.map((entry) => ({ ...entry, customer: contact.name, customer_id: contact.customer_id }))).slice(0, HISTORY_LIMIT),
    labels: SUPPRESSION_LABELS,
  };
}

async function searchContacts(supabase, body) {
  const query = customerSearchQuery(
    supabase.from("marketing_contacts").select(CONTACT_COLUMNS).order("updated_at", { ascending: false }).limit(25),
    body.search
  );
  const { data } = assertSupabase(await query, "Could not search contacts.");
  return { contacts: (data || []).map(normalizeContact) };
}

async function loadContact(supabase, id) {
  if (!id) throw new Error("Contact ID is required.");
  const { data } = assertSupabase(
    await supabase.from("marketing_contacts").select(CONTACT_COLUMNS).eq("id", id).single(),
    "Could not load contact."
  );
  return normalizeContact(data);
}

async function applySuppression(supabase, body) {
  const contact = await loadContact(supabase, body.contact?.id || body.contactId || body.id);
  const type = normalizeType(body.type);
  const now = new Date().toISOString();
  const entry = {
    type,
    label: SUPPRESSION_LABELS[type],
    reason: cleanText(body.reason, SUPPRESSION_LABELS[type]),
    added_at: now,
    added_by: cleanText(body.addedBy || body.user, "Marketing CRM"),
    notes: cleanText(body.notes),
    active: true,
  };
  const suppression = { ...normalizeSuppression(contact.suppression), [type]: entry };
  const history = [{ action: "suppressed", ...entry }, ...normalizeHistory(contact.suppression_history)].slice(0, HISTORY_LIMIT);
  const payload = {
    suppression,
    suppression_history: history,
    ...channelFlagsAfterSuppress(type, contact),
  };

  const { data } = assertSupabase(
    await supabase.from("marketing_contacts").update(payload).eq("id", contact.id).select(CONTACT_COLUMNS).single(),
    "Could not apply suppression."
  );
  return { contact: normalizeContact(data), overview: await getOverview(supabase) };
}

async function removeSuppression(supabase, body) {
  const contact = await loadContact(supabase, body.contact?.id || body.contactId || body.id);
  const type = normalizeType(body.type);
  const suppression = { ...normalizeSuppression(contact.suppression) };
  const removed = suppression[type];
  delete suppression[type];
  const now = new Date().toISOString();
  const history = [{
    action: "removed",
    type,
    label: SUPPRESSION_LABELS[type],
    reason: cleanText(body.reason, "Suppression removed"),
    added_at: now,
    added_by: cleanText(body.addedBy || body.user, "Marketing CRM"),
    notes: cleanText(body.notes),
    previous_reason: removed?.reason || "",
  }, ...normalizeHistory(contact.suppression_history)].slice(0, HISTORY_LIMIT);
  const payload = {
    suppression,
    suppression_history: history,
    ...channelFlagsAfterRemove(type, suppression, contact),
  };

  const { data } = assertSupabase(
    await supabase.from("marketing_contacts").update(payload).eq("id", contact.id).select(CONTACT_COLUMNS).single(),
    "Could not remove suppression."
  );
  return { contact: normalizeContact(data), overview: await getOverview(supabase) };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");

  if (request.method !== "POST") {
    json(response, 405, { ok: false, message: "Method not allowed." });
    return;
  }

  if (!authorize(request)) {
    json(response, 401, { ok: false, message: "Suppression Centre API access denied." });
    return;
  }

  try {
    const supabase = getSupabase();
    const body = parseBody(request);
    const action = body.action || "overview";
    let result;

    if (action === "validateAccess") result = {};
    else if (action === "overview") result = await getOverview(supabase);
    else if (action === "search") result = await searchContacts(supabase, body);
    else if (action === "suppress") result = await applySuppression(supabase, body);
    else if (action === "remove") result = await removeSuppression(supabase, body);
    else throw new Error("Unknown Suppression Centre API action.");

    json(response, 200, { ok: true, ...result });
  } catch (error) {
    json(response, 500, { ok: false, message: error?.message || "Suppression Centre API error." });
  }
}

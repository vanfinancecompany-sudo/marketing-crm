import { createClient } from "@supabase/supabase-js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const CONTACT_COLUMNS = "id,customer_id,first_name,last_name,company,email,phone,postcode,pipeline,source,marketing_status,lifecycle_status,lifecycle_changed_at,email_ready,sms_ready,facebook_ready,suppression,suppression_history,created_at,updated_at";
const SUPPRESSION_TYPES = new Set([
  "email_unsubscribed",
  "email_bounced",
  "sms_opt_out",
  "facebook_excluded",
  "manual_suppression",
  "global_do_not_contact",
]);
const PERMANENT_EMAIL_SUPPRESSION_TYPES = new Set([
  "email_unsubscribed",
  "email_bounced",
  "manual_suppression",
  "global_do_not_contact",
]);

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
    lifecycle_status: row.lifecycle_status || "active",
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

async function getOverview(supabase) {
  const { data } = assertSupabase(
    await supabase.rpc("marketing_suppression_overview", { p_recent_limit: 10, p_history_limit: 100 }),
    "Could not load suppression overview."
  );
  const overview = data || {};
  const countLifecycle = async (status) => Number(assertSupabase(
    await supabase.from("marketing_contacts").select("id", { count: "exact", head: true }).eq("lifecycle_status", status),
    `Could not count ${status} contacts.`
  ).count || 0);
  const [verifiedActive, awaitingVerification, suppressed] = await Promise.all([
    countLifecycle("active"),
    countLifecycle("awaiting_verification"),
    countLifecycle("suppressed"),
  ]);
  return { ...overview, verified_active_contacts: verifiedActive, awaiting_verification_contacts: awaitingVerification, suppressed_contacts: suppressed };
}

async function searchContacts(supabase, body) {
  const query = customerSearchQuery(
    supabase.from("marketing_contacts").select(CONTACT_COLUMNS).order("updated_at", { ascending: false }).limit(25),
    body.search
  );
  const { data } = assertSupabase(await query, "Could not search contacts.");
  return { contacts: (data || []).map(normalizeContact) };
}

function getContactId(body) {
  const id = body.contact?.id || body.contactId || body.id;
  if (!id) throw new Error("Contact ID is required.");
  return id;
}

async function applySuppression(supabase, body) {
  const type = normalizeType(body.type);
  const { data } = assertSupabase(
    await supabase.rpc("marketing_apply_suppression", {
      p_contact_id: getContactId(body),
      p_type: type,
      p_reason: cleanText(body.reason, type),
      p_added_by: cleanText(body.addedBy || body.user, "Marketing CRM"),
      p_notes: cleanText(body.notes),
    }),
    "Could not apply suppression."
  );
  const contact = Array.isArray(data) ? data[0] : data;
  return { contact: normalizeContact(contact), overview: await getOverview(supabase) };
}

async function removeSuppression(supabase, body) {
  const type = normalizeType(body.type);
  if (PERMANENT_EMAIL_SUPPRESSION_TYPES.has(type)) {
    throw new Error("Permanent email suppression identities cannot be removed. The address must remain ineligible for future campaigns.");
  }
  const { data } = assertSupabase(
    await supabase.rpc("marketing_remove_suppression", {
      p_contact_id: getContactId(body),
      p_type: type,
      p_reason: cleanText(body.reason, "Suppression removed"),
      p_added_by: cleanText(body.addedBy || body.user, "Marketing CRM"),
      p_notes: cleanText(body.notes),
    }),
    "Could not remove suppression."
  );
  const contact = Array.isArray(data) ? data[0] : data;
  return { contact: normalizeContact(contact), overview: await getOverview(supabase) };
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

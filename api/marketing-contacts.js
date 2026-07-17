import { createClient } from "@supabase/supabase-js";
import {
  buildCustomerExports,
  cleanEmail,
  cleanPostcode,
  cleanUkMobile,
  updateContactRecord,
  withAutoTags,
} from "../utils/contactCleaning.js";
import {
  cleanImportRow,
  customerUpsert,
} from "../lib/marketingCustomerUpsert.js";
import { normalizeEmailIdentity } from "../lib/customerDatabaseCleanse.js";

const CONTACT_COLUMNS = "id,customer_id,first_name,last_name,company,email,email_normalized,phone,phone_normalized,postcode,pipeline,source,sources,tags,notes,marketing_status,lifecycle_status,lifecycle_changed_at,email_ready,sms_ready,facebook_ready,duplicate_count,suppression,suppression_history,first_seen_at,last_seen_at,created_at,updated_at";
const PAGE_SIZE = 50;
const EXPORT_PAGE_SIZE = 1000;
const API_KEY_HEADER = "x-marketing-customer-database-key";
const MARKETING_PIPELINES = new Set(["finance", "rent2buy", "both", "unknown"]);

function json(response, status, payload) {
  response.status(status).json(payload);
}

function getSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing server Supabase environment variables.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
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
    try {
      return JSON.parse(request.body);
    } catch {
      return {};
    }
  }
  return request.body;
}

function assertSupabase(result, fallbackMessage) {
  if (result.error) {
    throw new Error(result.error.message || fallbackMessage);
  }
  return result;
}

function normalizeContact(row = {}) {
  return {
    id: row.id || "",
    customer_id: row.customer_id || "",
    first_name: row.first_name || "",
    last_name: row.last_name || "",
    company: row.company || "",
    email: row.email || "",
    phone: row.phone || "",
    postcode: row.postcode || "",
    pipeline: row.pipeline || "unknown",
    source: row.source || "other",
    sources: Array.isArray(row.sources) ? row.sources : [],
    tags: Array.isArray(row.tags) ? row.tags : [],
    notes: row.notes || "",
    marketing_status: row.marketing_status || "active",
    lifecycle_status: row.lifecycle_status || "active",
    lifecycle_changed_at: row.lifecycle_changed_at || "",
    email_ready: Boolean(row.email_ready),
    sms_ready: Boolean(row.sms_ready),
    facebook_ready: Boolean(row.facebook_ready),
    duplicate_count: Number(row.duplicate_count || 0),
    first_seen_at: row.first_seen_at || row.created_at || "",
    last_seen_at: row.last_seen_at || row.updated_at || "",
    created_at: row.created_at || "",
    updated_at: row.updated_at || "",
    timeline: [],
  };
}

async function assertEmailNotSuppressed(supabase, emailValue) {
  const email = normalizeEmailIdentity(emailValue);
  if (!email) return;
  const result = await supabase.from("marketing_suppression_identities").select("id").eq("email_normalized", email).maybeSingle();
  assertSupabase(result, "Could not check permanent suppression identities.");
  if (result.data) throw new Error("This email is permanently suppressed and cannot be added or restored.");
}

function createMarketingCustomerId() {
  return `VFC${Date.now()}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

function cleanDbContact(values = {}, existingContact = {}) {
  const email = cleanEmail(values.email);
  const phone = cleanUkMobile(values.phone);
  const base = withAutoTags({
    customer_id: existingContact.customer_id || values.customer_id || createMarketingCustomerId(),
    first_name: values.first_name || "",
    last_name: values.last_name || "",
    company: String(values.company || "").trim(),
    email,
    phone,
    postcode: cleanPostcode(values.postcode),
    pipeline: values.pipeline || "unknown",
    source: values.source || existingContact.source || "manual",
    notes: String(values.notes || "").trim(),
    tags: Array.isArray(values.tags) ? values.tags : [],
    duplicate_count: existingContact.duplicate_count || values.duplicate_count || 0,
  });

  if (!base.email && !base.phone) {
    throw new Error("Add a valid email or UK mobile.");
  }

  return base;
}

function toDbPayload(contact) {
  const emailNormalized = cleanEmail(contact.email) || null;
  const phoneNormalized = cleanUkMobile(contact.phone) || null;
  const tags = Array.isArray(contact.tags) ? contact.tags : [];
  const source = contact.source || "manual";

  return {
    customer_id: contact.customer_id,
    first_name: contact.first_name || "",
    last_name: contact.last_name || "",
    company: contact.company || "",
    email: contact.email || null,
    email_normalized: emailNormalized,
    phone: contact.phone || null,
    phone_normalized: phoneNormalized,
    postcode: contact.postcode || "",
    pipeline: contact.pipeline || "unknown",
    source,
    sources: Array.from(new Set([...(contact.sources || []), source].filter(Boolean))),
    tags,
    notes: contact.notes || "",
    marketing_status: contact.marketing_status || "active",
    lifecycle_status: contact.lifecycle_status || "active",
    lifecycle_changed_at: contact.lifecycle_changed_at || new Date().toISOString(),
    email_ready: Boolean(emailNormalized),
    sms_ready: Boolean(phoneNormalized),
    facebook_ready: Boolean(emailNormalized || phoneNormalized),
    duplicate_count: Number(contact.duplicate_count || 0),
    last_seen_at: new Date().toISOString(),
  };
}

function applyFilters(query, filters = {}, options = {}) {
  if (!options.includeInactive) query = query.eq("lifecycle_status", "active");
  if (Array.isArray(filters.pipeline)) query = query.in("pipeline", filters.pipeline);
  else if (filters.pipeline && filters.pipeline !== "all") query = query.eq("pipeline", filters.pipeline);
  if (filters.source && filters.source !== "all") query = query.eq("source", filters.source);
  if (filters.tag && filters.tag !== "all") query = query.contains("tags", [filters.tag]);
  if (filters.readiness === "email_ready") query = query.eq("email_ready", true);
  if (filters.readiness === "sms_ready") query = query.eq("sms_ready", true);
  if (filters.readiness === "facebook_ready") query = query.eq("facebook_ready", true);
  if (filters.postcode === "has_postcode") query = query.neq("postcode", "");
  if (filters.unknownPipeline) query = query.eq("pipeline", "unknown");
  if (filters.search) {
    const term = String(filters.search).trim().replace(/[,%]/g, "");
    if (term) {
      const pattern = `%${term}%`;
      query = query.or([
        `first_name.ilike.${pattern}`,
        `last_name.ilike.${pattern}`,
        `email.ilike.${pattern}`,
        `phone.ilike.${pattern}`,
        `postcode.ilike.${pattern}`,
        `company.ilike.${pattern}`,
      ].join(","));
    }
  }
  return query;
}

async function countContacts(supabase, filters = {}) {
  const query = applyFilters(
    supabase.from("marketing_contacts").select("id", { count: "exact", head: true }),
    filters
  );
  const { count } = assertSupabase(await query, "Could not count marketing contacts.");
  return count || 0;
}

async function countByLifecycle(supabase, lifecycleStatus) {
  const { count } = assertSupabase(await supabase.from("marketing_contacts").select("id", { count: "exact", head: true }).eq("lifecycle_status", lifecycleStatus), "Could not count customer lifecycle status.");
  return count || 0;
}

async function countContactsSince(supabase, field, since, includeNew = true) {
  let query = supabase
    .from("marketing_contacts")
    .select("id", { count: "exact", head: true })
    .eq("lifecycle_status", "active")
    .gte(field, since);

  if (!includeNew) query = query.lt("created_at", since);

  const { count } = assertSupabase(await query, "Could not count marketing customer activity.");
  return count || 0;
}

function getLondonDateParts(date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function getLondonOffsetMs(date) {
  const parts = getLondonDateParts(date);
  const londonAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return londonAsUtc - date.getTime();
}

function startOfLondonToday(now = new Date()) {
  const parts = getLondonDateParts(now);
  const utcApproximation = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0));
  const offset = getLondonOffsetMs(utcApproximation);
  return new Date(utcApproximation.getTime() - offset).toISOString();
}

async function getStats(supabase, filters = {}) {
  const [total, matched, finance, rent2buy, both, unknown, emailReady, smsReady, facebookReady, awaitingVerification, archived, suppressed] = await Promise.all([
    countContacts(supabase, {}),
    countContacts(supabase, filters),
    countContacts(supabase, { pipeline: "finance" }),
    countContacts(supabase, { pipeline: "rent2buy" }),
    countContacts(supabase, { pipeline: "both" }),
    countContacts(supabase, { pipeline: "unknown" }),
    countContacts(supabase, { readiness: "email_ready" }),
    countContacts(supabase, { readiness: "sms_ready" }),
    countContacts(supabase, { readiness: "facebook_ready" }),
    countByLifecycle(supabase, "awaiting_verification"),
    countByLifecycle(supabase, "archived"),
    countByLifecycle(supabase, "suppressed"),
  ]);

  return { total, matched, finance, rent2buy, both, unknown, emailReady, smsReady, facebookReady, awaitingVerification, archived, suppressed };
}

async function getActivityStats(supabase) {
  const now = Date.now();
  const periods = {
    today: startOfLondonToday(new Date(now)),
    last24Hours: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    last7Days: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
    last30Days: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
  };

  const [totalContacts, latestRows, todayCreated, todayUpdated, dayCreated, dayUpdated, weekCreated, weekUpdated, monthCreated, monthUpdated] = await Promise.all([
    countContacts(supabase, {}),
    supabase.from("marketing_contacts").select("created_at,updated_at").eq("lifecycle_status", "active").order("updated_at", { ascending: false }).limit(1),
    countContactsSince(supabase, "created_at", periods.today),
    countContactsSince(supabase, "updated_at", periods.today, false),
    countContactsSince(supabase, "created_at", periods.last24Hours),
    countContactsSince(supabase, "updated_at", periods.last24Hours, false),
    countContactsSince(supabase, "created_at", periods.last7Days),
    countContactsSince(supabase, "updated_at", periods.last7Days, false),
    countContactsSince(supabase, "created_at", periods.last30Days),
    countContactsSince(supabase, "updated_at", periods.last30Days, false),
  ]);

  assertSupabase(latestRows, "Could not load latest customer activity.");
  const latest = latestRows.data?.[0] || null;
  const lastCustomerActivity = latest
    ? new Date(Math.max(new Date(latest.created_at || 0).getTime(), new Date(latest.updated_at || 0).getTime())).toISOString()
    : null;

  function period(created, updated) {
    return { created, updated, totalActivity: created + updated };
  }

  return {
    today: period(todayCreated, todayUpdated),
    last24Hours: period(dayCreated, dayUpdated),
    last7Days: period(weekCreated, weekUpdated),
    last30Days: period(monthCreated, monthUpdated),
    lastCustomerActivity,
    totalContacts,
  };
}

async function listContacts(supabase, body) {
  const page = Math.max(1, Number(body.page || 1));
  const pageSize = Math.min(Math.max(1, Number(body.pageSize || PAGE_SIZE)), PAGE_SIZE);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const filters = body.filters || {};
  const query = applyFilters(
    supabase
      .from("marketing_contacts")
      .select(CONTACT_COLUMNS, { count: "exact" })
      .order("updated_at", { ascending: false })
      .range(from, to),
    filters
  );
  const { data, count } = assertSupabase(await query, "Could not load marketing contacts.");
  const stats = await getStats(supabase, filters);

  return {
    contacts: (data || []).map(normalizeContact),
    total: count || 0,
    stats,
  };
}

async function createContact(supabase, body) {
  const payload = toDbPayload(cleanDbContact(body.values || {}));
  await assertEmailNotSuppressed(supabase, payload.email_normalized);
  const { data } = assertSupabase(
    await supabase.from("marketing_contacts").insert(payload).select(CONTACT_COLUMNS).single(),
    "Could not create marketing contact."
  );
  return { contact: normalizeContact(data) };
}

async function updateContact(supabase, body) {
  const existingContact = body.contact || {};
  const { contact, error } = updateContactRecord(existingContact, body.values || {});
  if (error) throw new Error(error);
  const payload = toDbPayload(cleanDbContact(contact, existingContact));
  await assertEmailNotSuppressed(supabase, payload.email_normalized);
  const { data } = assertSupabase(
    await supabase.from("marketing_contacts").update(payload).eq("id", existingContact.id).select(CONTACT_COLUMNS).single(),
    "Could not update marketing contact."
  );
  return { contact: normalizeContact(data) };
}

async function deleteContact(supabase, body) {
  const id = body.contact?.id || body.id;
  if (!id) throw new Error("Contact ID is required.");
  assertSupabase(await supabase.from("marketing_contacts").update({ lifecycle_status: "archived", lifecycle_changed_at: new Date().toISOString() }).eq("id", id), "Could not archive marketing contact.");
  return { ok: true };
}

async function bulkUpdate(supabase, body) {
  const contacts = Array.isArray(body.contacts) ? body.contacts : [];
  const action = body.bulkAction;
  const ids = contacts.map((contact) => contact.id).filter(Boolean);
  if (!ids.length) return { ok: true };

  if (action === "addTag") {
    await Promise.all(contacts.map((contact) => {
      const tag = body.tag;
      if (!tag || (contact.tags || []).includes(tag)) return Promise.resolve();
      return supabase.from("marketing_contacts").update({ tags: [...(contact.tags || []), tag].sort() }).eq("id", contact.id);
    }));
    return { ok: true };
  }

  if (action === "removeTag") {
    await Promise.all(contacts.map((contact) => {
      const tag = body.tag;
      if (!tag || !(contact.tags || []).includes(tag)) return Promise.resolve();
      return supabase.from("marketing_contacts").update({ tags: (contact.tags || []).filter((item) => item !== tag) }).eq("id", contact.id);
    }));
    return { ok: true };
  }

  if (action === "changePipeline") {
    const pipeline = body.pipeline || "unknown";
    assertSupabase(await supabase.from("marketing_contacts").update({ pipeline, last_seen_at: new Date().toISOString() }).in("id", ids), "Could not update selected contacts.");
    return { ok: true };
  }

  if (action === "delete") {
    assertSupabase(await supabase.from("marketing_contacts").update({ lifecycle_status: "archived", lifecycle_changed_at: new Date().toISOString() }).in("id", ids), "Could not archive selected contacts.");
    return { ok: true };
  }

  throw new Error("Unknown bulk action.");
}

async function getAllExportContacts(supabase, body) {
  const key = body.key;
  const scope = body.scope || "all";
  const filters = { ...(body.filters || {}) };
  const contacts = [];
  let page = 0;

  if (key === "financeFacebook" || key === "financeEmail" || key === "financeSms") filters.pipeline = ["finance", "both"];
  else if (key === "rent2buyFacebook" || key === "rent2buyEmail" || key === "rent2buySms") filters.pipeline = ["rent2buy", "both"];
  else if (key === "fullFacebook") filters.pipeline = "all";
  else filters.pipeline = scope;

  while (true) {
    const from = page * EXPORT_PAGE_SIZE;
    const to = from + EXPORT_PAGE_SIZE - 1;
    const query = applyFilters(
      supabase
        .from("marketing_contacts")
        .select(CONTACT_COLUMNS)
        .order("updated_at", { ascending: false })
        .range(from, to),
      filters
    );
    const { data } = assertSupabase(await query, "Could not retrieve export contacts.");
    const rows = (data || []).map(normalizeContact);
    contacts.push(...rows);
    if (rows.length < EXPORT_PAGE_SIZE) break;
    page += 1;
  }

  return contacts;
}

async function exportContacts(supabase, body) {
  const contacts = await getAllExportContacts(supabase, body);
  const csvExports = buildCustomerExports(contacts, [], [], body.scope || "all");
  return { csv: csvExports[body.key] || "" };
}

function normalizeMarketingPipeline(value) {
  const pipeline = String(value || "unknown").trim().toLowerCase();
  return MARKETING_PIPELINES.has(pipeline) ? pipeline : "unknown";
}

function buildUpsertImportRow(values = {}) {
  return {
    "first name": values.first_name || values.firstName || "",
    "last name": values.last_name || values.lastName || "",
    name: values.name || "",
    email: values.email || "",
    phone: values.phone || "",
    postcode: values.postcode || values.postCode || values.postalCode || "",
    source: values.source || "other",
    tags: Array.isArray(values.tags) ? values.tags.join(",") : values.tags || "",
    company: values.company || "",
    notes: values.notes || "",
    pipeline: values.pipeline || "",
    customer_id: values.customer_id || values.customerId || "",
  };
}

async function upsertContact(supabase, body) {
  const values = body.values || {};
  const pipeline = normalizeMarketingPipeline(values.pipeline);
  const { contact, reason, pipelineExplicit, sourceCustomerId } = cleanImportRow(buildUpsertImportRow(values), pipeline);

  if (!contact) {
    throw new Error(reason || "Add a valid email or UK mobile.");
  }

  await assertEmailNotSuppressed(supabase, contact.email_normalized);
  const result = await customerUpsert(supabase, contact, { pipelineExplicit, sourceCustomerId });
  return {
    ...result,
    eventType: result.mode === "created" ? "customer_created" : "customer_updated",
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");

  if (request.method !== "POST") {
    json(response, 405, { ok: false, message: "Method not allowed." });
    return;
  }

  if (!authorize(request)) {
    json(response, 401, { ok: false, message: "Customer Database API access denied." });
    return;
  }

  try {
    const supabase = getSupabase();
    const body = parseBody(request);
    const action = body.action || "list";
    let result;

    if (action === "list") result = await listContacts(supabase, body);
    else if (action === "stats") result = { stats: await getStats(supabase, body.filters || {}) };
    else if (action === "activityStats") result = { activity: await getActivityStats(supabase) };
    else if (action === "create") result = await createContact(supabase, body);
    else if (action === "update") result = await updateContact(supabase, body);
    else if (action === "delete") result = await deleteContact(supabase, body);
    else if (action === "bulk") result = await bulkUpdate(supabase, body);
    else if (action === "export") result = await exportContacts(supabase, body);
    else if (action === "upsert") result = await upsertContact(supabase, body);
    else throw new Error("Unknown Customer Database API action.");

    json(response, 200, { ok: true, ...result });
  } catch (error) {
    json(response, 500, { ok: false, message: error?.message || "Customer Database API error." });
  }
}

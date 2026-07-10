import { supabase } from "./supabase.js";
import {
  buildCustomerExports,
  cleanEmail,
  cleanPostcode,
  cleanUkMobile,
  updateContactRecord,
  withAutoTags,
} from "../utils/contactCleaning.js";

export const MARKETING_CONTACTS_PAGE_SIZE = 50;

const CONTACT_COLUMNS = "id,customer_id,first_name,last_name,company,email,phone,postcode,pipeline,source,sources,tags,notes,marketing_status,email_ready,sms_ready,facebook_ready,duplicate_count,first_seen_at,last_seen_at,created_at,updated_at";
const EXPORT_PAGE_SIZE = 1000;

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
    email_ready: Boolean(emailNormalized),
    sms_ready: Boolean(phoneNormalized),
    facebook_ready: Boolean(emailNormalized || phoneNormalized),
    duplicate_count: Number(contact.duplicate_count || 0),
    last_seen_at: new Date().toISOString(),
  };
}

function applyFilters(query, filters = {}) {
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

async function countContacts(filters = {}) {
  const query = applyFilters(
    supabase.from("marketing_contacts").select("id", { count: "exact", head: true }),
    filters
  );
  const { count } = assertSupabase(await query, "Could not count marketing contacts.");
  return count || 0;
}

export async function getMarketingContactStats(filters = {}) {
  const [total, matched, finance, rent2buy, both, unknown, emailReady, smsReady, facebookReady] = await Promise.all([
    countContacts({}),
    countContacts(filters),
    countContacts({ pipeline: "finance" }),
    countContacts({ pipeline: "rent2buy" }),
    countContacts({ pipeline: "both" }),
    countContacts({ pipeline: "unknown" }),
    countContacts({ readiness: "email_ready" }),
    countContacts({ readiness: "sms_ready" }),
    countContacts({ readiness: "facebook_ready" }),
  ]);

  return { total, matched, finance, rent2buy, both, unknown, emailReady, smsReady, facebookReady };
}

export async function listMarketingContacts({ page = 1, pageSize = MARKETING_CONTACTS_PAGE_SIZE, filters = {} } = {}) {
  const from = (Math.max(1, page) - 1) * pageSize;
  const to = from + pageSize - 1;
  const query = applyFilters(
    supabase
      .from("marketing_contacts")
      .select(CONTACT_COLUMNS, { count: "exact" })
      .order("updated_at", { ascending: false })
      .range(from, to),
    filters
  );
  const { data, count } = assertSupabase(await query, "Could not load marketing contacts.");
  const stats = await getMarketingContactStats(filters);
  return {
    contacts: (data || []).map(normalizeContact),
    total: count || 0,
    stats,
  };
}

export async function createMarketingContact(values) {
  const cleaned = cleanDbContact(values);
  const payload = toDbPayload(cleaned);
  const { data } = assertSupabase(
    await supabase.from("marketing_contacts").insert(payload).select(CONTACT_COLUMNS).single(),
    "Could not create marketing contact."
  );
  return normalizeContact(data);
}

export async function updateMarketingContact(existingContact, values) {
  const { contact, error } = updateContactRecord(existingContact, values);
  if (error) throw new Error(error);
  const payload = toDbPayload(cleanDbContact(contact, existingContact));
  const { data } = assertSupabase(
    await supabase.from("marketing_contacts").update(payload).eq("id", existingContact.id).select(CONTACT_COLUMNS).single(),
    "Could not update marketing contact."
  );
  return normalizeContact(data);
}

export async function deleteMarketingContact(contact) {
  assertSupabase(
    await supabase.from("marketing_contacts").delete().eq("id", contact.id),
    "Could not delete marketing contact."
  );
}

export async function bulkAddMarketingTag(contacts, tag) {
  await Promise.all((contacts || []).map((contact) => {
    if ((contact.tags || []).includes(tag)) return Promise.resolve();
    const tags = [...(contact.tags || []), tag].sort();
    return supabase.from("marketing_contacts").update({ tags }).eq("id", contact.id);
  }));
}

export async function bulkRemoveMarketingTag(contacts, tag) {
  await Promise.all((contacts || []).map((contact) => {
    if (!(contact.tags || []).includes(tag)) return Promise.resolve();
    const tags = (contact.tags || []).filter((item) => item !== tag);
    return supabase.from("marketing_contacts").update({ tags }).eq("id", contact.id);
  }));
}

export async function bulkChangeMarketingPipeline(contacts, pipeline) {
  await Promise.all((contacts || []).map((contact) => {
    if (contact.pipeline === pipeline) return Promise.resolve();
    return supabase.from("marketing_contacts").update({ pipeline, last_seen_at: new Date().toISOString() }).eq("id", contact.id);
  }));
}

export async function bulkDeleteMarketingContacts(contacts) {
  const ids = (contacts || []).map((contact) => contact.id).filter(Boolean);
  if (!ids.length) return;
  assertSupabase(
    await supabase.from("marketing_contacts").delete().in("id", ids),
    "Could not delete selected marketing contacts."
  );
}

async function getAllExportContacts(key, scope = "all", filters = {}) {
  const contacts = [];
  let page = 0;
  while (true) {
    const from = page * EXPORT_PAGE_SIZE;
    const to = from + EXPORT_PAGE_SIZE - 1;
    const queryFilters = { ...filters };
    if (key === "financeFacebook" || key === "financeEmail" || key === "financeSms") queryFilters.pipeline = ["finance", "both"];
    else if (key === "rent2buyFacebook" || key === "rent2buyEmail" || key === "rent2buySms") queryFilters.pipeline = ["rent2buy", "both"];
    else if (key === "fullFacebook") queryFilters.pipeline = "all";
    else queryFilters.pipeline = scope;

    const query = applyFilters(
      supabase
        .from("marketing_contacts")
        .select(CONTACT_COLUMNS)
        .order("updated_at", { ascending: false })
        .range(from, to),
      queryFilters
    );
    const { data } = assertSupabase(await query, "Could not retrieve export contacts.");
    const rows = (data || []).map(normalizeContact);
    contacts.push(...rows);
    if (rows.length < EXPORT_PAGE_SIZE) break;
    page += 1;
  }
  return contacts;
}

export async function getMarketingExportCsv(key, scope = "all", filters = {}) {
  const contacts = await getAllExportContacts(key, scope, filters);
  const csvExports = buildCustomerExports(contacts, [], [], scope);
  return csvExports[key];
}

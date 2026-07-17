import { createClient } from "@supabase/supabase-js";
import { buildPreviouslyDeliveredRows, normalizeEmailIdentity } from "../lib/customerDatabaseCleanse.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const PAGE_SIZE = 1000;
const CONFIRMATION_PHRASE = "CLEAR ACTIVE CUSTOMER DATABASE";
const FULL_EXPORT_COLUMNS = [
  "id", "customer_id", "first_name", "last_name", "company", "email", "email_normalized", "phone", "phone_normalized",
  "postcode", "pipeline", "source", "sources", "tags", "notes", "marketing_status", "lifecycle_status",
  "lifecycle_changed_at", "email_ready", "sms_ready", "facebook_ready", "duplicate_count", "suppression",
  "suppression_history", "first_seen_at", "last_seen_at", "created_at", "updated_at",
];
const DELIVERED_EXPORT_COLUMNS = [
  "customer_id", "first_name", "last_name", "email", "phone", "company", "postcode", "customer_type", "classification",
  "pipeline", "delivered_date", "campaign_name", "last_email_status",
];
const SUPPRESSION_EXPORT_COLUMNS = ["email", "suppression_type", "reason", "provider", "campaign", "suppressed_date"];

function json(response, status, payload) { response.status(status).json(payload); }
function parseBody(request) { if (!request.body) return {}; if (typeof request.body === "string") { try { return JSON.parse(request.body); } catch { return {}; } } return request.body; }
function assertSupabase(result, fallbackMessage) { if (result.error) throw new Error(result.error.message || fallbackMessage); return result; }
function getSupabase() { const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!url || !key) throw new Error("Missing server Supabase environment variables."); return createClient(url, key, { auth: { persistSession: false } }); }
function authorize(request) { const expected = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY; if (!expected) return false; const header = request.headers[API_KEY_HEADER] || ""; const auth = request.headers.authorization || ""; return header === expected || (auth.startsWith("Bearer ") && auth.slice(7) === expected); }
function csvEscape(value) { const normalized = value && typeof value === "object" ? JSON.stringify(value) : String(value ?? ""); return /[",\n\r]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized; }
function toCsv(rows, columns, includeHeader = true) { return [...(includeHeader ? [columns.join(",")] : []), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))].join("\n"); }

async function loadAll(queryFactory, message) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = assertSupabase(await queryFactory().range(from, from + PAGE_SIZE - 1), message);
    rows.push(...(result.data || []));
    if (!result.data || result.data.length < PAGE_SIZE) break;
  }
  return rows;
}

async function loadByChunks(values, loader) {
  const rows = [];
  const uniqueValues = [...new Set(values.filter(Boolean))];
  for (let index = 0; index < uniqueValues.length; index += 250) rows.push(...await loader(uniqueValues.slice(index, index + 250)));
  return rows;
}

async function fullDatabaseExport(supabase, requestedPage = 0) {
  const page = Math.max(0, Math.floor(Number(requestedPage) || 0));
  const from = page * PAGE_SIZE;
  const result = assertSupabase(
    await supabase.from("marketing_contacts").select(FULL_EXPORT_COLUMNS.join(","), { count: "exact" }).order("customer_id", { ascending: true }).range(from, from + PAGE_SIZE - 1),
    "Could not export the full Customer Database."
  );
  const rows = result.data || [];
  const count = Number(result.count || 0);
  return { filename: `customer-database-full-${new Date().toISOString().slice(0, 10)}.csv`, count, csv: toCsv(rows, FULL_EXPORT_COLUMNS, page === 0), page, done: from + rows.length >= count };
}

async function suppressionExport(supabase) {
  const identities = await loadAll(
    () => supabase.from("marketing_suppression_identities").select("email_normalized,suppression_type,reason,provider,campaign_id,suppressed_at").order("suppressed_at", { ascending: false }),
    "Could not export permanent suppression identities."
  );
  const campaignRows = await loadByChunks(identities.map((row) => row.campaign_id), async (ids) => {
    const result = assertSupabase(await supabase.from("marketing_campaigns").select("id,name").in("id", ids), "Could not load suppression campaign names.");
    return result.data || [];
  });
  const campaignNames = new Map(campaignRows.map((row) => [row.id, row.name]));
  const rows = identities.map((row) => ({ email: row.email_normalized, suppression_type: row.suppression_type, reason: row.reason || "", provider: row.provider || "", campaign: campaignNames.get(row.campaign_id) || "", suppressed_date: row.suppressed_at || "" }));
  return { filename: `suppression-list-${new Date().toISOString().slice(0, 10)}.csv`, count: rows.length, csv: toCsv(rows, SUPPRESSION_EXPORT_COLUMNS) };
}

async function previouslyDeliveredExport(supabase) {
  const recipients = await loadAll(
    () => supabase.from("marketing_email_send_recipients").select("id,send_id,campaign_id,send_type,customer_id,email,status,provider_message_id,delivered_at,last_event_at,last_event_type").eq("send_type", "production"),
    "Could not load production campaign recipients."
  );
  const events = await loadAll(
    () => supabase.from("marketing_email_events").select("id,campaign_id,send_id,recipient_id,customer_id,email_normalized,provider_message_id,event_type,event_at").order("event_at", { ascending: true }),
    "Could not load confirmed email delivery events."
  );
  const campaigns = await loadByChunks(recipients.map((row) => row.campaign_id), async (ids) => {
    const result = assertSupabase(await supabase.from("marketing_campaigns").select("id,name").in("id", ids), "Could not load delivered campaign names.");
    return result.data || [];
  });
  const contactsById = await loadByChunks(recipients.map((row) => String(row.customer_id || "").toUpperCase()), async (ids) => {
    const result = assertSupabase(await supabase.from("marketing_contacts").select("id,customer_id,first_name,last_name,company,email,email_normalized,phone,postcode,pipeline,lifecycle_status,suppression").in("customer_id", ids), "Could not load delivered customer details.");
    return result.data || [];
  });
  const knownEmails = new Set(contactsById.map((row) => normalizeEmailIdentity(row.email_normalized || row.email)).filter(Boolean));
  const missingEmails = recipients.map((row) => normalizeEmailIdentity(row.email)).filter((email) => email && !knownEmails.has(email));
  const contactsByEmail = await loadByChunks(missingEmails, async (emails) => {
    const result = assertSupabase(await supabase.from("marketing_contacts").select("id,customer_id,first_name,last_name,company,email,email_normalized,phone,postcode,pipeline,lifecycle_status,suppression").in("email_normalized", emails), "Could not match delivered email identities.");
    return result.data || [];
  });
  const identities = await loadAll(() => supabase.from("marketing_suppression_identities").select("email_normalized"), "Could not check permanent suppressions.");
  const rows = buildPreviouslyDeliveredRows({ events, recipients, campaigns, contacts: [...contactsById, ...contactsByEmail], suppressedEmails: new Set(identities.map((row) => normalizeEmailIdentity(row.email_normalized))) });
  return { filename: `previously-delivered-no-recorded-bounce-${new Date().toISOString().slice(0, 10)}.csv`, count: rows.length, csv: toCsv(rows, DELIVERED_EXPORT_COLUMNS) };
}

async function lifecycleCounts(supabase) {
  const count = async (status) => assertSupabase(await supabase.from("marketing_contacts").select("id", { count: "exact", head: true }).eq("lifecycle_status", status), `Could not count ${status} customers.`).count || 0;
  const [active, awaitingVerification, archived, suppressed] = await Promise.all([count("active"), count("awaiting_verification"), count("archived"), count("suppressed")]);
  return { active, awaitingVerification, archived, suppressed };
}

async function prepareClear(supabase, body) {
  const confirmations = new Set(Array.isArray(body.confirmedExports) ? body.confirmedExports : []);
  if (!["full", "delivered", "suppression"].every((item) => confirmations.has(item))) throw new Error("Download all three safety exports before preparing the clear action.");
  const [counts, delivered, suppressions] = await Promise.all([lifecycleCounts(supabase), previouslyDeliveredExport(supabase), suppressionExport(supabase)]);
  const fullCount = counts.active + counts.awaitingVerification + counts.archived + counts.suppressed;
  const result = assertSupabase(await supabase.from("marketing_database_clear_audit").insert({ active_count: counts.active, awaiting_verification_count: counts.awaitingVerification, suppressed_count: counts.suppressed, full_export_count: fullCount, delivered_export_count: delivered.count, suppression_export_count: suppressions.count, created_by: "Customer Database Tools", metadata: { exports_confirmed: ["full", "delivered", "suppression"] } }).select("id,prepared_at").single(), "Could not prepare the protected clear operation.");
  return { operation: result.data, counts: { ...counts, fullExport: fullCount, deliveredExport: delivered.count, suppressionExport: suppressions.count } };
}

async function clearActive(supabase, body) {
  if (body.confirmation !== CONFIRMATION_PHRASE) throw new Error(`Type ${CONFIRMATION_PHRASE} exactly.`);
  if (!body.operationId) throw new Error("Prepare the safety exports before clearing the database.");
  const result = assertSupabase(await supabase.rpc("marketing_clear_active_customer_database", { p_operation_id: body.operationId, p_confirmation: body.confirmation }), "Could not clear the active Customer Database.");
  return { clearResult: result.data, counts: await lifecycleCounts(supabase) };
}

async function contactCampaignHistory(supabase, body) {
  const customerId = String(body.customerId || "").trim().toUpperCase();
  const email = normalizeEmailIdentity(body.email);
  if (!customerId && !email) return { history: [] };
  const select = "id,campaign_id,send_id,customer_id,email,status,first_sent_at,last_event_at,created_at,marketing_campaigns(name,status)";
  const queries = [];
  if (customerId) queries.push(supabase.from("marketing_email_send_recipients").select(select).eq("send_type", "production").eq("customer_id", customerId).order("created_at", { ascending: false }));
  if (email) queries.push(supabase.from("marketing_email_send_recipients").select(select).eq("send_type", "production").ilike("email", email).order("created_at", { ascending: false }));
  const results = await Promise.all(queries);
  results.forEach((result) => assertSupabase(result, "Could not load customer campaign history."));
  const unique = new Map(results.flatMap((result) => result.data || []).map((row) => [row.id, row]));
  return { history: [...unique.values()].map((row) => ({ id: row.id, campaign_id: row.campaign_id, campaign_name: (Array.isArray(row.marketing_campaigns) ? row.marketing_campaigns[0] : row.marketing_campaigns)?.name || "Campaign", status: row.status, email: row.email, sent_at: row.first_sent_at || row.created_at, last_event_at: row.last_event_at || "" })).sort((a, b) => new Date(b.sent_at || 0) - new Date(a.sent_at || 0)) };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return json(response, 405, { ok: false, message: "Method not allowed." });
  if (!authorize(request)) return json(response, 401, { ok: false, message: "Customer Database Tools access denied." });
  try {
    const supabase = getSupabase();
    const body = parseBody(request);
    let result;
    if (body.action === "overview") result = { counts: await lifecycleCounts(supabase) };
    else if (body.action === "exportFull") result = { export: await fullDatabaseExport(supabase, body.page) };
    else if (body.action === "exportPreviouslyDelivered") result = { export: await previouslyDeliveredExport(supabase) };
    else if (body.action === "exportSuppression") result = { export: await suppressionExport(supabase) };
    else if (body.action === "prepareClear") result = await prepareClear(supabase, body);
    else if (body.action === "clearActive") result = await clearActive(supabase, body);
    else if (body.action === "contactCampaignHistory") result = await contactCampaignHistory(supabase, body);
    else throw new Error("Unknown Customer Database Tools action.");
    return json(response, 200, { ok: true, ...result });
  } catch (error) {
    return json(response, 500, { ok: false, message: error?.message || "Customer Database Tools error." });
  }
}

import { createClient } from "@supabase/supabase-js";
import {
  CONTACT_COLUMNS,
  cleanImportRow,
  findExactContact,
  findPossibleDuplicate,
  insertContact,
  mergeContactPayload,
} from "../lib/marketingCustomerUpsert.js";
import { normalizeEmailIdentity } from "../lib/customerDatabaseCleanse.js";
import {
  addCleanedImportCounts,
  buildImportResult,
  buildPossibleDuplicateResult,
  decideCleanedImportAction,
  emptyCleanedImportCounts,
  importResultsToCsv,
} from "../lib/cleanedCustomerImport.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 1000;
const EXPORT_PAGE_SIZE = 1000;
const REPORT_LIMIT = 10000;

function json(response, status, payload) { response.status(status).json(payload); }
function getSupabase() { const supabaseUrl = process.env.SUPABASE_URL; const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing server Supabase environment variables."); return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } }); }
function authorize(request) { const expectedSecret = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY; if (!expectedSecret) return false; const headerSecret = request.headers[API_KEY_HEADER] || ""; const authHeader = request.headers.authorization || ""; const bearerSecret = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""; return headerSecret === expectedSecret || bearerSecret === expectedSecret; }
function parseBody(request) { if (!request.body) return {}; if (typeof request.body === "string") { try { return JSON.parse(request.body); } catch { return {}; } } return request.body; }
function assertSupabase(result, fallbackMessage) { if (result.error) throw new Error(result.error.message || fallbackMessage); return result; }
function csvEscape(value) { const text = String(value ?? ""); return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
function toCsv(rows, columns) { return [columns.join(","), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))].join("\n"); }
function compactRawData(row) { const copy = { ...row }; delete copy.raw_data; delete copy.rawData; return Object.fromEntries(Object.entries(copy).slice(0, 30)); }
function rawEmailFromRow(row = {}) { const entry = Object.entries(row).find(([key]) => /^(e-?mail([ _]?address)?|email_address|entry|input[ _]?email)$/i.test(String(key || "").trim())); return String(entry?.[1] || "").trim(); }
function safeBatchSize(value) { return Math.min(Math.max(Number(value) || DEFAULT_BATCH_SIZE, 1), MAX_BATCH_SIZE); }
function buildFingerprint({ filename, fileSize, totalRows, pipeline, checksum }) { return [filename || "", fileSize || 0, totalRows || 0, pipeline || "", checksum || ""].join(":"); }
function batchKey(importFingerprint, batchIndex) { return `${importFingerprint}:batch:${batchIndex}`; }
function durationSeconds(startedAt) { const start = startedAt ? new Date(startedAt).getTime() : Date.now(); return Math.max(0, Math.round((Date.now() - start) / 1000)); }

async function logImportRow(supabase, importId, row, result) {
  await supabase.from("marketing_import_rows").insert({ import_id: importId, source_row: Number(row._rowNumber || row.sourceRow || 0) || null, customer_id: result.existing_customer_id || null, status: result.result, rejection_reason: result.reason || null, raw_data: { ...compactRawData(row), _import_result: result } });
}

async function createBackup(supabase) {
  const columns = ["customer_id", "first_name", "last_name", "company", "email", "email_normalized", "phone", "phone_normalized", "postcode", "pipeline", "source", "notes", "marketing_status", "lifecycle_status", "lifecycle_changed_at", "suppression", "suppression_history", "created_at", "updated_at", "last_seen_at", "duplicate_count"];
  const rows = [];
  let page = 0;
  while (true) {
    const from = page * EXPORT_PAGE_SIZE;
    const to = from + EXPORT_PAGE_SIZE - 1;
    const { data } = assertSupabase(await supabase.from("marketing_contacts").select(columns.join(",")).order("customer_id", { ascending: true }).range(from, to), "Could not create pre-import backup.");
    rows.push(...(data || []));
    if ((data || []).length < EXPORT_PAGE_SIZE) break;
    page += 1;
  }
  const now = new Date();
  const stamp = now.toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
  const filename = `marketing_contacts_backup_${stamp}.csv`;
  const csv = toCsv(rows, columns);
  assertSupabase(await supabase.from("marketing_exports").insert({ export_type: "pre_import_backup", audience_name: "Marketing contacts backup", pipeline: "all", filters: {}, contact_count: rows.length, filename, metadata: { generated_at: now.toISOString(), reason: "pre_import_backup" } }), "Could not record backup export.");
  return { filename, contactCount: rows.length, csv };
}

async function updateImport(supabase, importId, patch, metadataPatch = {}) {
  const { data: current } = assertSupabase(await supabase.from("marketing_imports").select("metadata").eq("id", importId).single(), "Could not load import metadata.");
  const metadata = { ...(current?.metadata || {}), ...metadataPatch };
  assertSupabase(await supabase.from("marketing_imports").update({ ...patch, metadata }).eq("id", importId), "Could not update import.");
}

function addCounts(a, b) {
  const cleaned = addCleanedImportCounts(a, b);
  return { ...cleaned, contactsCreated: cleaned.newActiveContacts, contactsUpdated: 0, restoredCustomers: cleaned.restoredContacts, duplicatesMerged: 0, possibleDuplicates: Number(a.possibleDuplicates || 0) + Number(b.possibleDuplicates || 0), suppressedEmails: cleaned.suppressedContacts, invalidEmails: cleaned.invalidRows, rejectedRows: cleaned.invalidRows + cleaned.otherRejectedRows };
}

async function loadSuppressedEmails(supabase, emails) {
  const uniqueEmails = [...new Set(emails.map(normalizeEmailIdentity).filter(Boolean))];
  if (!uniqueEmails.length) return new Set();
  const suppressed = new Set();
  for (let index = 0; index < uniqueEmails.length; index += 200) {
    const { data } = assertSupabase(await supabase.from("marketing_suppression_identities").select("email_normalized").in("email_normalized", uniqueEmails.slice(index, index + 200)), "Could not check permanent suppression identities.");
    (data || []).forEach((row) => suppressed.add(normalizeEmailIdentity(row.email_normalized)));
  }
  return suppressed;
}

async function startImport(supabase, body) {
  const pipeline = ["finance", "rent2buy", "both", "unknown"].includes(body.pipeline) ? body.pipeline : "";
  if (!pipeline) throw new Error("Choose an import classification before importing.");
  const filename = String(body.filename || "").trim();
  const totalRows = Number(body.totalRows || 0);
  const batchSize = safeBatchSize(body.batchSize);
  const fileSize = Number(body.fileSize || 0);
  const checksum = String(body.checksum || "");
  if (!filename || !totalRows) throw new Error("Import filename and row count are required.");
  const importFingerprint = buildFingerprint({ filename, fileSize, totalRows, pipeline, checksum });
  const existing = await supabase.from("marketing_imports").select("*").eq("metadata->>import_fingerprint", importFingerprint).order("created_at", { ascending: false }).limit(1);
  if (existing.error) throw existing.error;
  if (existing.data?.[0] && existing.data[0].status !== "completed") return { import: existing.data[0], batchSize, resume: true };
  const totalBatches = Math.ceil(totalRows / batchSize);
  const metadata = { total_rows: totalRows, batch_size: batchSize, total_batches: totalBatches, last_completed_batch: -1, processed_rows: 0, pipeline, filename, file_size: fileSize, checksum, import_fingerprint: importFingerprint, completed_batches: [], batch_results: {}, seen_emails: [], cleaned_import_counts: emptyCleanedImportCounts(), failed_batch: null, active_batch: null, backup: body.backup || null };
  const { data } = assertSupabase(await supabase.from("marketing_imports").insert({ filename, source: pipeline, status: "pending", rows_imported: 0, started_at: new Date().toISOString(), metadata }).select("*").single(), "Could not start import.");
  return { import: data, batchSize, resume: false };
}

async function processBatch(supabase, body) {
  const importId = body.importId;
  const pipeline = ["finance", "rent2buy", "both", "unknown"].includes(body.pipeline) ? body.pipeline : "";
  const batchIndex = Number(body.batchIndex || 0);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!importId || !pipeline) throw new Error("Import ID and pipeline are required.");
  const { data: importRecord } = assertSupabase(await supabase.from("marketing_imports").select("*").eq("id", importId).single(), "Could not load import.");
  const metadata = importRecord.metadata || {};
  const importFingerprint = metadata.import_fingerprint || body.importFingerprint || importId;
  const key = body.batchKey || batchKey(importFingerprint, batchIndex);
  const completed = Array.isArray(metadata.completed_batches) ? metadata.completed_batches : [];
  const batchResults = metadata.batch_results || {};
  if (completed.includes(key)) return { counts: batchResults[key] || {}, import: importRecord, skipped: true };
  if (metadata.active_batch !== null && metadata.active_batch !== undefined && metadata.active_batch !== batchIndex) throw new Error(`Import batch ${metadata.active_batch + 1} is already active.`);

  await updateImport(supabase, importId, { status: "processing" }, { active_batch: batchIndex, failed_batch: null });
  const cleanedRows = rows.map((row) => ({ row, cleaned: cleanImportRow(row, pipeline) }));
  const suppressedEmails = await loadSuppressedEmails(supabase, cleanedRows.map(({ cleaned }) => cleaned.contact?.email_normalized));
  const counts = { ...emptyCleanedImportCounts(rows.length), contactsCreated: 0, contactsUpdated: 0, restoredCustomers: 0, duplicatesMerged: 0, possibleDuplicates: 0, suppressedEmails: 0, invalidEmails: 0, rejectedRows: 0 };
  const seenEmails = new Set((metadata.seen_emails || []).map(normalizeEmailIdentity).filter(Boolean));

  for (const { row, cleaned } of cleanedRows) {
    const { contact, reason, invalidEmail, pipelineExplicit, sourceCustomerId } = cleaned;
    if (!contact) { const action = { result: "invalid", reason, countKey: invalidEmail ? "invalidRows" : "otherRejectedRows", nextLifecycle: "" }; counts[action.countKey] += 1; await logImportRow(supabase, importId, row, buildImportResult({ email: rawEmailFromRow(row), action })); continue; }
    const email = contact.email_normalized;
    if (seenEmails.has(email)) { const action = { result: "duplicate_upload", reason: "Duplicate normalised email later in the uploaded CSV; first row was processed", countKey: "duplicateUploadRows", nextLifecycle: "" }; counts.duplicateUploadRows += 1; await logImportRow(supabase, importId, row, buildImportResult({ email, action })); continue; }
    seenEmails.add(email);
    const exact = await findExactContact(supabase, contact, sourceCustomerId);
    if (suppressedEmails.has(email)) { const previousLifecycle = exact.contact?.lifecycle_status || "suppressed"; const action = { result: "suppressed", reason: "Permanent suppression identity preserved; contact was not reactivated", countKey: "suppressedContacts", nextLifecycle: previousLifecycle }; counts.suppressedContacts += 1; await logImportRow(supabase, importId, row, buildImportResult({ email, action, previousLifecycle, customerId: exact.contact?.customer_id })); continue; }
    if (exact.contact) {
      const previousLifecycle = exact.contact.lifecycle_status || "active";
      const action = decideCleanedImportAction(exact.contact);
      counts[action.countKey] += 1;
      if (["promoted", "restored"].includes(action.result)) {
        const payload = mergeContactPayload(exact.contact, contact, { pipelineExplicit, matchedOn: exact.matchedOn, fillMissingOnly: true, incrementDuplicate: false });
        assertSupabase(await supabase.from("marketing_contacts").update(payload).eq("id", exact.contact.id).select(CONTACT_COLUMNS).single(), "Could not activate cleaned contact.");
        await supabase.from("marketing_merge_log").insert({ primary_contact_id: exact.contact.id, merged_contact_id: null, merge_reason: `Cleaned import ${action.result} by normalised email`, matched_on: "email", merged_snapshot: { import_id: importId, batch_key: key, source_row: row._rowNumber || null, verification_source: "cleaned_import", incoming: compactRawData(row) } });
      }
      await logImportRow(supabase, importId, row, buildImportResult({ email, action, previousLifecycle, customerId: exact.contact.customer_id }));
      continue;
    }
    const possible = await findPossibleDuplicate(supabase, contact);
    if (possible) { counts.possibleDuplicates += 1; await logImportRow(supabase, importId, row, buildPossibleDuplicateResult(email, possible)); }
    const inserted = await insertContact(supabase, contact);
    const action = decideCleanedImportAction(null);
    counts.newActiveContacts += 1;
    await logImportRow(supabase, importId, row, buildImportResult({ email, action, customerId: inserted?.customer_id }));
  }

  counts.contactsCreated = counts.newActiveContacts;
  counts.restoredCustomers = counts.restoredContacts;
  counts.suppressedEmails = counts.suppressedContacts;
  counts.invalidEmails = counts.invalidRows;
  counts.rejectedRows = counts.invalidRows + counts.otherRejectedRows;

  const previousTotals = { ...emptyCleanedImportCounts(), ...(metadata.cleaned_import_counts || {}), rowsImported: Number(metadata.processed_rows || importRecord.rows_imported || 0), possibleDuplicates: Number(importRecord.possible_duplicates || 0) };
  const totals = addCounts(previousTotals, counts);
  const nextCompleted = [...completed, key];
  const metadataPatch = { processed_rows: totals.rowsImported, last_completed_batch: batchIndex, completed_batches: nextCompleted, batch_results: { ...batchResults, [key]: counts }, seen_emails: [...seenEmails], cleaned_import_counts: totals, failed_batch: null, active_batch: null };
  assertSupabase(await supabase.from("marketing_imports").update({ rows_imported: totals.rowsImported, contacts_created: totals.contactsCreated, contacts_updated: totals.contactsUpdated, restored_customers: totals.restoredCustomers, duplicates_merged: totals.duplicatesMerged, possible_duplicates: totals.possibleDuplicates, suppressed_emails: totals.suppressedEmails, invalid_emails: totals.invalidEmails, rejected_rows: totals.rejectedRows, status: "processing", metadata: { ...metadata, ...metadataPatch } }).eq("id", importId), "Could not update import totals.");
  const { data: updatedImport } = assertSupabase(await supabase.from("marketing_imports").select("*").eq("id", importId).single(), "Could not reload import.");
  return { counts, import: updatedImport, skipped: false };
}

async function completeImport(supabase, body) {
  const importId = body.importId;
  if (!importId) throw new Error("Import ID is required.");
  const { data: importRecord } = assertSupabase(await supabase.from("marketing_imports").select("*").eq("id", importId).single(), "Could not load import.");
  const status = body.failed ? "failed" : "completed";
  const duration = durationSeconds(importRecord.started_at);
  const metadata = { ...(importRecord.metadata || {}), completed_client_at: new Date().toISOString(), failure_message: body.error || "", duration_seconds: duration, active_batch: null };
  assertSupabase(await supabase.from("marketing_imports").update({ status, completed_at: new Date().toISOString(), duration_seconds: duration, metadata }).eq("id", importId), "Could not complete import.");
  const { data } = assertSupabase(await supabase.from("marketing_imports").select("*").eq("id", importId).single(), "Could not reload import.");
  return { import: data };
}

async function markBatchFailed(supabase, body, error) {
  if (!body.importId) return;
  const { data: importRecord } = await supabase.from("marketing_imports").select("metadata").eq("id", body.importId).single();
  const metadata = { ...(importRecord?.metadata || {}), failed_batch: Number(body.batchIndex || 0), active_batch: null, failure_message: error?.message || "Batch failed" };
  await supabase.from("marketing_imports").update({ status: "partially_failed", metadata }).eq("id", body.importId);
}

async function getHistory(supabase) { const { data } = assertSupabase(await supabase.from("marketing_imports").select("*").order("created_at", { ascending: false }).limit(12), "Could not load import history."); return { imports: data || [] }; }
async function getReports(supabase, body) { const importId = body.importId; let query = supabase.from("marketing_import_rows").select("*").order("created_at", { ascending: true }).limit(REPORT_LIMIT); if (importId) query = query.eq("import_id", importId); const { data } = assertSupabase(await query, "Could not load import reports."); const rows = data || []; const importResults = rows.map((row) => row.raw_data?._import_result).filter(Boolean); return { importResults, importResultsCsv: importResultsToCsv(importResults), rejectedRows: rows.filter((row) => ["rejected", "error"].includes(row.status)), duplicateRows: rows.filter((row) => row.status === "duplicate_upload"), promotedRows: rows.filter((row) => row.status === "promoted"), restoredRows: rows.filter((row) => row.status === "restored"), alreadyActiveRows: rows.filter((row) => row.status === "already_active"), newActiveRows: rows.filter((row) => row.status === "new_active"), suppressedRows: rows.filter((row) => row.status === "suppressed"), invalidEmailRows: rows.filter((row) => row.status === "invalid"), possibleDuplicates: rows.filter((row) => row.status === "possible_duplicate") }; }

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") { json(response, 405, { ok: false, message: "Method not allowed." }); return; }
  if (!authorize(request)) { json(response, 401, { ok: false, message: "Customer import API access denied." }); return; }
  const body = parseBody(request);
  try {
    const supabase = getSupabase();
    const action = body.action || "history";
    let result;
    if (action === "backup") result = { backup: await createBackup(supabase) };
    else if (action === "start") result = await startImport(supabase, body);
    else if (action === "batch") result = await processBatch(supabase, body);
    else if (action === "complete") result = await completeImport(supabase, body);
    else if (action === "history") result = await getHistory(supabase);
    else if (action === "reports") result = await getReports(supabase, body);
    else throw new Error("Unknown import API action.");
    json(response, 200, { ok: true, ...result });
  } catch (error) {
    console.error("Marketing contact import API error", error);
    if (body.action === "batch") await markBatchFailed(getSupabase(), body, error).catch(() => {});
    json(response, 500, { ok: false, message: error?.message || "Import API error." });
  }
}

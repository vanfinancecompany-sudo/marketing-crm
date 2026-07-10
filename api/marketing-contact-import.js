import { createClient } from "@supabase/supabase-js";
import {
  CONTACT_COLUMNS,
  cleanImportRow,
  findExactContact,
  findPossibleDuplicate,
  insertContact,
  mergeContactPayload,
} from "../lib/marketingCustomerUpsert.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 1000;
const EXPORT_PAGE_SIZE = 1000;
const REPORT_LIMIT = 200;

function json(response, status, payload) { response.status(status).json(payload); }
function getSupabase() { const supabaseUrl = process.env.SUPABASE_URL; const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing server Supabase environment variables."); return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } }); }
function authorize(request) { const expectedSecret = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY; if (!expectedSecret) return false; const headerSecret = request.headers[API_KEY_HEADER] || ""; const authHeader = request.headers.authorization || ""; const bearerSecret = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : ""; return headerSecret === expectedSecret || bearerSecret === expectedSecret; }
function parseBody(request) { if (!request.body) return {}; if (typeof request.body === "string") { try { return JSON.parse(request.body); } catch { return {}; } } return request.body; }
function assertSupabase(result, fallbackMessage) { if (result.error) throw new Error(result.error.message || fallbackMessage); return result; }
function csvEscape(value) { const text = String(value ?? ""); return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
function toCsv(rows, columns) { return [columns.join(","), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))].join("\n"); }
function compactRawData(row) { const copy = { ...row }; delete copy.raw_data; delete copy.rawData; return Object.fromEntries(Object.entries(copy).slice(0, 30)); }
function safeBatchSize(value) { return Math.min(Math.max(Number(value) || DEFAULT_BATCH_SIZE, 1), MAX_BATCH_SIZE); }
function buildFingerprint({ filename, fileSize, totalRows, pipeline, checksum }) { return [filename || "", fileSize || 0, totalRows || 0, pipeline || "", checksum || ""].join(":"); }
function batchKey(importFingerprint, batchIndex) { return `${importFingerprint}:batch:${batchIndex}`; }
function durationSeconds(startedAt) { const start = startedAt ? new Date(startedAt).getTime() : Date.now(); return Math.max(0, Math.round((Date.now() - start) / 1000)); }

async function logImportRow(supabase, importId, row, status, reason, customerId = "") {
  await supabase.from("marketing_import_rows").insert({ import_id: importId, source_row: Number(row._rowNumber || row.sourceRow || 0) || null, customer_id: customerId || null, status, rejection_reason: reason || null, raw_data: compactRawData(row) });
}

async function createBackup(supabase) {
  const columns = ["customer_id", "first_name", "last_name", "company", "email", "phone", "postcode", "pipeline", "source", "notes", "created_at", "updated_at", "last_seen_at", "duplicate_count"];
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

function addCounts(a, b) { return { rowsImported: Number(a.rowsImported || 0) + Number(b.rowsImported || 0), contactsCreated: Number(a.contactsCreated || 0) + Number(b.contactsCreated || 0), contactsUpdated: Number(a.contactsUpdated || 0) + Number(b.contactsUpdated || 0), duplicatesMerged: Number(a.duplicatesMerged || 0) + Number(b.duplicatesMerged || 0), possibleDuplicates: Number(a.possibleDuplicates || 0) + Number(b.possibleDuplicates || 0), rejectedRows: Number(a.rejectedRows || 0) + Number(b.rejectedRows || 0) }; }

async function startImport(supabase, body) {
  const pipeline = body.pipeline === "rent2buy" ? "rent2buy" : body.pipeline === "finance" ? "finance" : "";
  if (!pipeline) throw new Error("Choose Finance or Rent2Buy before importing.");
  const filename = String(body.filename || "").trim();
  const totalRows = Number(body.totalRows || 0);
  const batchSize = safeBatchSize(body.batchSize);
  const fileSize = Number(body.fileSize || 0);
  const checksum = String(body.checksum || "");
  if (!filename || !totalRows) throw new Error("Import filename and row count are required.");
  const importFingerprint = buildFingerprint({ filename, fileSize, totalRows, pipeline, checksum });
  const existing = await supabase.from("marketing_imports").select("*").eq("metadata->>import_fingerprint", importFingerprint).order("created_at", { ascending: false }).limit(1);
  if (existing.error) throw existing.error;
  if (existing.data?.[0]) return { import: existing.data[0], batchSize, resume: true };
  const totalBatches = Math.ceil(totalRows / batchSize);
  const metadata = { total_rows: totalRows, batch_size: batchSize, total_batches: totalBatches, last_completed_batch: -1, processed_rows: 0, pipeline, filename, file_size: fileSize, checksum, import_fingerprint: importFingerprint, completed_batches: [], batch_results: {}, failed_batch: null, active_batch: null, backup: body.backup || null };
  const { data } = assertSupabase(await supabase.from("marketing_imports").insert({ filename, source: pipeline, status: "pending", rows_imported: 0, started_at: new Date().toISOString(), metadata }).select("*").single(), "Could not start import.");
  return { import: data, batchSize, resume: false };
}

async function processBatch(supabase, body) {
  const importId = body.importId;
  const pipeline = body.pipeline === "rent2buy" ? "rent2buy" : body.pipeline === "finance" ? "finance" : "";
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
  const counts = { rowsImported: rows.length, contactsCreated: 0, contactsUpdated: 0, duplicatesMerged: 0, possibleDuplicates: 0, rejectedRows: 0 };

  for (const row of rows) {
    const { contact, reason } = cleanImportRow(row, pipeline);
    if (!contact) { counts.rejectedRows += 1; await logImportRow(supabase, importId, row, "rejected", reason); continue; }
    const exact = await findExactContact(supabase, contact);
    if (exact.contact) {
      const payload = mergeContactPayload(exact.contact, contact);
      const { data: updated } = assertSupabase(await supabase.from("marketing_contacts").update(payload).eq("id", exact.contact.id).select(CONTACT_COLUMNS).single(), "Could not update duplicate contact.");
      counts.contactsUpdated += 1;
      counts.duplicatesMerged += 1;
      await supabase.from("marketing_merge_log").insert({ primary_contact_id: exact.contact.id, merged_contact_id: null, merge_reason: `Import duplicate matched by ${exact.matchedOn}`, matched_on: exact.matchedOn, merged_snapshot: { import_id: importId, batch_key: key, source_row: row._rowNumber || null, incoming: compactRawData(row) } });
      if (updated?.customer_id) await logImportRow(supabase, importId, row, "merged", `Matched by ${exact.matchedOn}`, updated.customer_id);
      continue;
    }
    const possible = await findPossibleDuplicate(supabase, contact);
    if (possible) { counts.possibleDuplicates += 1; await logImportRow(supabase, importId, row, "possible_duplicate", "Same normalized name and postcode", possible.customer_id); }
    const inserted = await insertContact(supabase, contact);
    counts.contactsCreated += 1;
    if (inserted?.customer_id && possible) await logImportRow(supabase, importId, row, "created_with_possible_duplicate", "Created but possible duplicate exists", inserted.customer_id);
  }

  const previousTotals = { rowsImported: Number(metadata.processed_rows || importRecord.rows_imported || 0), contactsCreated: Number(importRecord.contacts_created || 0), contactsUpdated: Number(importRecord.contacts_updated || 0), duplicatesMerged: Number(importRecord.duplicates_merged || 0), possibleDuplicates: Number(importRecord.possible_duplicates || 0), rejectedRows: Number(importRecord.rejected_rows || 0) };
  const totals = addCounts(previousTotals, counts);
  const nextCompleted = [...completed, key];
  const metadataPatch = { processed_rows: totals.rowsImported, last_completed_batch: batchIndex, completed_batches: nextCompleted, batch_results: { ...batchResults, [key]: counts }, failed_batch: null, active_batch: null };
  assertSupabase(await supabase.from("marketing_imports").update({ rows_imported: totals.rowsImported, contacts_created: totals.contactsCreated, contacts_updated: totals.contactsUpdated, duplicates_merged: totals.duplicatesMerged, possible_duplicates: totals.possibleDuplicates, rejected_rows: totals.rejectedRows, status: "processing", metadata: { ...metadata, ...metadataPatch } }).eq("id", importId), "Could not update import totals.");
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
async function getReports(supabase, body) { const importId = body.importId; let query = supabase.from("marketing_import_rows").select("*").order("created_at", { ascending: false }).limit(REPORT_LIMIT); if (importId) query = query.eq("import_id", importId); const { data } = assertSupabase(await query, "Could not load import reports."); const rows = data || []; return { rejectedRows: rows.filter((row) => row.status === "rejected" || row.status === "error"), duplicateRows: rows.filter((row) => row.status === "merged" || row.status === "created_with_possible_duplicate"), possibleDuplicates: rows.filter((row) => row.status === "possible_duplicate" || row.status === "created_with_possible_duplicate") }; }

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

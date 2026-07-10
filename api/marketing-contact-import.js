import { createClient } from "@supabase/supabase-js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const CONTACT_COLUMNS = "id,customer_id,first_name,last_name,company,email,email_normalized,phone,phone_normalized,postcode,pipeline,source,sources,tags,notes,marketing_status,email_ready,sms_ready,facebook_ready,duplicate_count,first_seen_at,last_seen_at,created_at,updated_at";
const IMPORT_BATCH_SIZE = 750;
const REPORT_LIMIT = 200;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UK_MOBILE_PATTERN = /^(\+447|447|07)\d{9}$/;
const TITLE_PATTERN = /^(mr|mrs|miss|ms|dr)\.?\s+/i;

const FIELD_ALIASES = {
  first_name: ["first name", "firstname", "first_name", "forename", "given name"],
  last_name: ["last name", "lastname", "last_name", "surname", "family name"],
  full_name: ["name", "full name", "fullname", "customer name"],
  email: ["email", "email address", "e-mail", "e-mail address"],
  phone: ["phone", "telephone", "mobile", "mobile number", "tel", "contact number"],
  postcode: ["postcode", "post code", "zip", "postal code"],
  company: ["company", "business", "business name", "company name", "organisation", "organization"],
  source: ["source", "lead source", "lead_source", "origin", "import source"],
  notes: ["notes", "note", "comments", "comment"],
  tags: ["tags", "tag"],
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

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function getField(row, aliases) {
  for (const alias of aliases) {
    const match = Object.keys(row || {}).find((key) => normalizeHeader(key) === alias);
    if (match) return String(row[match] || "").trim();
  }
  return "";
}

function cleanEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : "";
}

function cleanUkMobile(value) {
  const digits = String(value || "").replace(/[^\d+]/g, "");
  const normalized = digits.startsWith("+") ? digits : digits.replace(/^00/, "+");
  if (!UK_MOBILE_PATTERN.test(normalized)) return "";
  if (normalized.startsWith("+447")) return normalized;
  if (normalized.startsWith("447")) return `+${normalized}`;
  if (normalized.startsWith("07")) return `+44${normalized.slice(1)}`;
  return "";
}

function cleanPostcode(value) {
  const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length < 5 || compact.length > 7) return String(value || "").trim().toUpperCase();
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

function stripTitle(value) {
  return String(value || "").trim().replace(TITLE_PATTERN, "").trim();
}

function properCase(value) {
  return String(value || "").trim().toLowerCase().replace(/\b([a-z])/g, (match) => match.toUpperCase()).replace(/\b(Mc)([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`).replace(/\b(O')([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`);
}

function parseTags(value) {
  if (Array.isArray(value)) return value.map((tag) => String(tag || "").trim().toLowerCase().replace(/\s+/g, "_")).filter(Boolean);
  return String(value || "").split(/[;,]/).map((tag) => tag.trim().toLowerCase().replace(/\s+/g, "_")).filter(Boolean);
}

function mergePipeline(current, next) {
  if (current === next) return current;
  if (current === "both" || next === "both") return "both";
  if ((current === "finance" && next === "rent2buy") || (current === "rent2buy" && next === "finance")) return "both";
  if (current === "unknown") return next || "unknown";
  if (next === "unknown") return current || "unknown";
  return current || next || "unknown";
}

function compactRawData(row) {
  const copy = { ...row };
  delete copy.raw_data;
  delete copy.rawData;
  return Object.fromEntries(Object.entries(copy).slice(0, 30));
}

function cleanNameParts(row) {
  let firstName = stripTitle(getField(row, FIELD_ALIASES.first_name));
  let lastName = stripTitle(getField(row, FIELD_ALIASES.last_name));
  const fullName = stripTitle(getField(row, FIELD_ALIASES.full_name));
  if (!firstName && fullName) firstName = fullName;
  if (firstName && !lastName && firstName.includes(" ")) {
    const parts = firstName.split(/\s+/).filter(Boolean);
    firstName = parts.shift() || "";
    lastName = parts.join(" ");
  }
  if (EMAIL_PATTERN.test(firstName.toLowerCase())) firstName = "";
  if (EMAIL_PATTERN.test(lastName.toLowerCase())) lastName = "";
  return { first_name: properCase(firstName), last_name: properCase(lastName) };
}

function cleanImportRow(row, pipeline) {
  const { first_name, last_name } = cleanNameParts(row);
  const email = cleanEmail(getField(row, FIELD_ALIASES.email));
  const phone = cleanUkMobile(getField(row, FIELD_ALIASES.phone));
  if (!email && !phone) return { contact: null, reason: "No valid email or UK mobile" };

  const source = getField(row, FIELD_ALIASES.source) || "csv";
  const tags = new Set(parseTags(getField(row, FIELD_ALIASES.tags)));
  if (email) tags.add("email_ready"); else tags.add("no_email");
  if (phone) tags.add("sms_ready"); else tags.add("no_mobile");
  tags.add("facebook_ready");

  return {
    contact: {
      first_name,
      last_name,
      company: String(getField(row, FIELD_ALIASES.company) || "").trim(),
      email,
      email_normalized: email || null,
      phone,
      phone_normalized: phone || null,
      postcode: cleanPostcode(getField(row, FIELD_ALIASES.postcode)),
      pipeline,
      source,
      sources: [source],
      tags: [...tags].sort(),
      notes: String(getField(row, FIELD_ALIASES.notes) || "").trim(),
      marketing_status: "active",
      email_ready: Boolean(email),
      sms_ready: Boolean(phone),
      facebook_ready: Boolean(email || phone),
    },
    reason: "",
  };
}

function possibleDuplicateKey(contact) {
  const name = `${contact.first_name || ""} ${contact.last_name || ""}`.trim().toLowerCase();
  const postcode = String(contact.postcode || "").replace(/\s+/g, "").toLowerCase();
  return name && postcode ? { name, postcode } : null;
}

async function findExactContact(supabase, contact) {
  if (contact.email_normalized) {
    const result = await supabase.from("marketing_contacts").select(CONTACT_COLUMNS).eq("email_normalized", contact.email_normalized).maybeSingle();
    if (result.error) throw result.error;
    if (result.data) return { contact: result.data, matchedOn: "email" };
  }
  if (contact.phone_normalized) {
    const result = await supabase.from("marketing_contacts").select(CONTACT_COLUMNS).eq("phone_normalized", contact.phone_normalized).maybeSingle();
    if (result.error) throw result.error;
    if (result.data) return { contact: result.data, matchedOn: "phone" };
  }
  return { contact: null, matchedOn: "" };
}

async function findPossibleDuplicate(supabase, contact) {
  const key = possibleDuplicateKey(contact);
  if (!key) return null;
  const result = await supabase
    .from("marketing_contacts")
    .select("id,customer_id,first_name,last_name,postcode")
    .ilike("first_name", contact.first_name || "")
    .ilike("last_name", contact.last_name || "")
    .eq("postcode", contact.postcode || "")
    .limit(1);
  if (result.error) throw result.error;
  return result.data?.[0] || null;
}

function mergeContactPayload(existing, incoming) {
  const sources = new Set([...(existing.sources || []), ...(incoming.sources || []), existing.source, incoming.source].filter(Boolean));
  const tags = new Set([...(existing.tags || []), ...(incoming.tags || [])].filter(Boolean));
  return {
    first_name: existing.first_name || incoming.first_name || "",
    last_name: existing.last_name || incoming.last_name || "",
    company: existing.company || incoming.company || "",
    email: existing.email || incoming.email || null,
    email_normalized: existing.email_normalized || incoming.email_normalized || null,
    phone: existing.phone || incoming.phone || null,
    phone_normalized: existing.phone_normalized || incoming.phone_normalized || null,
    postcode: existing.postcode || incoming.postcode || "",
    pipeline: mergePipeline(existing.pipeline || "unknown", incoming.pipeline || "unknown"),
    source: existing.source || incoming.source || "csv",
    sources: [...sources],
    tags: [...tags].sort(),
    notes: [existing.notes, incoming.notes].filter(Boolean).join("\n"),
    email_ready: Boolean(existing.email_normalized || incoming.email_normalized),
    sms_ready: Boolean(existing.phone_normalized || incoming.phone_normalized),
    facebook_ready: Boolean(existing.email_normalized || incoming.email_normalized || existing.phone_normalized || incoming.phone_normalized),
    duplicate_count: Number(existing.duplicate_count || 0) + 1,
    last_seen_at: new Date().toISOString(),
  };
}

async function nextCustomerId(supabase) {
  const result = await supabase
    .from("marketing_contacts")
    .select("customer_id")
    .like("customer_id", "VFC%")
    .order("customer_id", { ascending: false })
    .limit(1);
  if (result.error) throw result.error;
  const last = result.data?.[0]?.customer_id || "VFC000000";
  const number = Number(String(last).replace(/\D/g, "")) || 0;
  return `VFC${String(number + 1).padStart(6, "0")}`;
}

async function insertContactWithRetry(supabase, contact) {
  let attempt = 0;
  while (attempt < 8) {
    const customerId = await nextCustomerId(supabase);
    const payload = { ...contact, customer_id: customerId };
    const result = await supabase.from("marketing_contacts").insert(payload).select(CONTACT_COLUMNS).single();
    if (!result.error) return result.data;
    if (result.error.code === "23505" && String(result.error.message || "").includes("customer_id")) {
      attempt += 1;
      continue;
    }
    throw result.error;
  }
  throw new Error("Could not allocate a unique customer ID after multiple retries.");
}

async function logImportRow(supabase, importId, row, status, reason, customerId = "") {
  await supabase.from("marketing_import_rows").insert({
    import_id: importId,
    source_row: Number(row._rowNumber || row.sourceRow || 0) || null,
    customer_id: customerId || null,
    status,
    rejection_reason: reason || null,
    raw_data: compactRawData(row),
  });
}

async function updateImportTotals(supabase, importId, totals, status, metadataPatch = {}) {
  const { data: current, error } = await supabase.from("marketing_imports").select("metadata").eq("id", importId).single();
  if (error) throw error;
  const metadata = { ...(current?.metadata || {}), ...metadataPatch };
  const payload = {
    rows_imported: totals.rowsImported,
    contacts_created: totals.contactsCreated,
    contacts_updated: totals.contactsUpdated,
    duplicates_merged: totals.duplicatesMerged,
    possible_duplicates: totals.possibleDuplicates,
    rejected_rows: totals.rejectedRows,
    status,
    metadata,
  };
  if (status === "completed" || status === "failed") payload.completed_at = new Date().toISOString();
  assertSupabase(await supabase.from("marketing_imports").update(payload).eq("id", importId), "Could not update import totals.");
}

function addCounts(a, b) {
  return {
    rowsImported: Number(a.rowsImported || 0) + Number(b.rowsImported || 0),
    contactsCreated: Number(a.contactsCreated || 0) + Number(b.contactsCreated || 0),
    contactsUpdated: Number(a.contactsUpdated || 0) + Number(b.contactsUpdated || 0),
    duplicatesMerged: Number(a.duplicatesMerged || 0) + Number(b.duplicatesMerged || 0),
    possibleDuplicates: Number(a.possibleDuplicates || 0) + Number(b.possibleDuplicates || 0),
    rejectedRows: Number(a.rejectedRows || 0) + Number(b.rejectedRows || 0),
  };
}

async function startImport(supabase, body) {
  const pipeline = body.pipeline === "rent2buy" ? "rent2buy" : body.pipeline === "finance" ? "finance" : "";
  if (!pipeline) throw new Error("Choose Finance or Rent2Buy before importing.");
  const filename = String(body.filename || "").trim();
  const totalRows = Number(body.totalRows || 0);
  if (!filename || !totalRows) throw new Error("Import filename and row count are required.");
  const { data } = assertSupabase(await supabase.from("marketing_imports").insert({
    filename,
    source: pipeline,
    status: "pending",
    rows_imported: totalRows,
    started_at: new Date().toISOString(),
    metadata: { pipeline, totalRows, batchSize: IMPORT_BATCH_SIZE, processedBatches: [], batchResults: {} },
  }).select("*").single(), "Could not start import.");
  return { import: data, batchSize: IMPORT_BATCH_SIZE };
}

async function processBatch(supabase, body) {
  const importId = body.importId;
  const pipeline = body.pipeline === "rent2buy" ? "rent2buy" : body.pipeline === "finance" ? "finance" : "";
  const batchIndex = Number(body.batchIndex || 0);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!importId || !pipeline) throw new Error("Import ID and pipeline are required.");

  const { data: importRecord, error: importError } = await supabase.from("marketing_imports").select("*").eq("id", importId).single();
  if (importError) throw importError;
  const metadata = importRecord.metadata || {};
  const processedBatches = Array.isArray(metadata.processedBatches) ? metadata.processedBatches : [];
  const batchResults = metadata.batchResults || {};
  if (processedBatches.includes(batchIndex)) {
    return { counts: batchResults[String(batchIndex)] || {}, import: importRecord, skipped: true };
  }

  await supabase.from("marketing_imports").update({ status: "processing" }).eq("id", importId);
  const counts = { rowsImported: rows.length, contactsCreated: 0, contactsUpdated: 0, duplicatesMerged: 0, possibleDuplicates: 0, rejectedRows: 0 };

  for (const row of rows) {
    const { contact, reason } = cleanImportRow(row, pipeline);
    if (!contact) {
      counts.rejectedRows += 1;
      await logImportRow(supabase, importId, row, "rejected", reason);
      continue;
    }

    const exact = await findExactContact(supabase, contact);
    if (exact.contact) {
      const payload = mergeContactPayload(exact.contact, contact);
      const { data: updated } = assertSupabase(await supabase.from("marketing_contacts").update(payload).eq("id", exact.contact.id).select(CONTACT_COLUMNS).single(), "Could not update duplicate contact.");
      counts.contactsUpdated += 1;
      counts.duplicatesMerged += 1;
      await supabase.from("marketing_merge_log").insert({
        primary_contact_id: exact.contact.id,
        merged_contact_id: null,
        merge_reason: `Import duplicate matched by ${exact.matchedOn}`,
        matched_on: exact.matchedOn,
        merged_snapshot: { import_id: importId, source_row: row._rowNumber || null, incoming: compactRawData(row) },
      });
      if (updated?.customer_id) await logImportRow(supabase, importId, row, "merged", `Matched by ${exact.matchedOn}`, updated.customer_id);
      continue;
    }

    const possible = await findPossibleDuplicate(supabase, contact);
    if (possible) {
      counts.possibleDuplicates += 1;
      await logImportRow(supabase, importId, row, "possible_duplicate", "Same normalized name and postcode", possible.customer_id);
    }

    const inserted = await insertContactWithRetry(supabase, contact);
    counts.contactsCreated += 1;
    if (inserted?.customer_id && possible) {
      await logImportRow(supabase, importId, row, "created_with_possible_duplicate", "Created but possible duplicate exists", inserted.customer_id);
    }
  }

  const previousTotals = {
    rowsImported: Number(importRecord.metadata?.processedRows || 0),
    contactsCreated: Number(importRecord.contacts_created || 0),
    contactsUpdated: Number(importRecord.contacts_updated || 0),
    duplicatesMerged: Number(importRecord.duplicates_merged || 0),
    possibleDuplicates: Number(importRecord.possible_duplicates || 0),
    rejectedRows: Number(importRecord.rejected_rows || 0),
  };
  const totals = addCounts(previousTotals, counts);
  const nextMetadata = {
    ...metadata,
    processedRows: totals.rowsImported,
    processedBatches: [...processedBatches, batchIndex],
    batchResults: { ...batchResults, [String(batchIndex)]: counts },
  };
  await updateImportTotals(supabase, importId, totals, "processing", nextMetadata);
  const { data: updatedImport } = assertSupabase(await supabase.from("marketing_imports").select("*").eq("id", importId).single(), "Could not reload import.");
  return { counts, import: updatedImport, skipped: false };
}

async function completeImport(supabase, body) {
  const importId = body.importId;
  if (!importId) throw new Error("Import ID is required.");
  const { data: importRecord, error } = await supabase.from("marketing_imports").select("*").eq("id", importId).single();
  if (error) throw error;
  const status = body.failed ? "failed" : "completed";
  const metadata = { ...(importRecord.metadata || {}), completedClientAt: new Date().toISOString(), failureMessage: body.error || "" };
  assertSupabase(await supabase.from("marketing_imports").update({ status, completed_at: new Date().toISOString(), metadata }).eq("id", importId), "Could not complete import.");
  const { data } = assertSupabase(await supabase.from("marketing_imports").select("*").eq("id", importId).single(), "Could not reload import.");
  return { import: data };
}

async function getHistory(supabase) {
  const { data } = assertSupabase(await supabase.from("marketing_imports").select("*").order("created_at", { ascending: false }).limit(12), "Could not load import history.");
  return { imports: data || [] };
}

async function getReports(supabase, body) {
  const importId = body.importId;
  let query = supabase.from("marketing_import_rows").select("*").order("created_at", { ascending: false }).limit(REPORT_LIMIT);
  if (importId) query = query.eq("import_id", importId);
  const { data } = assertSupabase(await query, "Could not load import reports.");
  const rows = data || [];
  return {
    rejectedRows: rows.filter((row) => row.status === "rejected" || row.status === "error"),
    duplicateRows: rows.filter((row) => row.status === "merged" || row.status === "created_with_possible_duplicate"),
    possibleDuplicates: rows.filter((row) => row.status === "possible_duplicate" || row.status === "created_with_possible_duplicate"),
  };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") {
    json(response, 405, { ok: false, message: "Method not allowed." });
    return;
  }
  if (!authorize(request)) {
    json(response, 401, { ok: false, message: "Customer import API access denied." });
    return;
  }

  try {
    const supabase = getSupabase();
    const body = parseBody(request);
    const action = body.action || "history";
    let result;
    if (action === "start") result = await startImport(supabase, body);
    else if (action === "batch") result = await processBatch(supabase, body);
    else if (action === "complete") result = await completeImport(supabase, body);
    else if (action === "history") result = await getHistory(supabase);
    else if (action === "reports") result = await getReports(supabase, body);
    else throw new Error("Unknown import API action.");
    json(response, 200, { ok: true, ...result });
  } catch (error) {
    console.error("Marketing contact import API error", error);
    json(response, 500, { ok: false, message: error?.message || "Import API error." });
  }
}

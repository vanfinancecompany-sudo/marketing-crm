import { contactHasPermanentSuppression } from "./customerDatabaseCleanse.js";

export const CONTACT_COLUMNS = "id,customer_id,first_name,last_name,company,email,email_normalized,phone,phone_normalized,postcode,pipeline,source,sources,tags,notes,marketing_status,lifecycle_status,lifecycle_changed_at,email_ready,sms_ready,facebook_ready,duplicate_count,suppression,suppression_history,first_seen_at,last_seen_at,created_at,updated_at";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UK_MOBILE_PATTERN = /^(\+447|447|07)\d{9}$/;
const TITLE_PATTERN = /^(mr|mrs|miss|ms|dr)\.?\s+/i;

const FIELD_ALIASES = {
  first_name: ["first name", "firstname", "first_name", "forename", "given name"],
  last_name: ["last name", "lastname", "last_name", "surname", "family name"],
  full_name: ["name", "full name", "fullname", "customer name"],
  email: ["email", "email address", "email_address", "emailaddress", "e-mail", "e-mail address", "entry", "input email", "input_email"],
  phone: ["phone", "telephone", "mobile", "mobile number", "tel", "contact number"],
  postcode: ["postcode", "post code", "zip", "postal code"],
  company: ["company", "business", "business name", "company name", "organisation", "organization"],
  source: ["source", "lead source", "lead_source", "origin", "import source"],
  notes: ["notes", "note", "comments", "comment"],
  tags: ["tags", "tag"],
  pipeline: ["pipeline", "customer type", "customer_type", "classification", "finance / rent2buy / both"],
  customer_id: ["customer id", "customer_id", "existing customer id"],
};

function assertSupabase(result, fallbackMessage) { if (result.error) throw new Error(result.error.message || fallbackMessage); return result; }
function normalizeHeader(value) { return String(value || "").trim().toLowerCase().replace(/\s+/g, " "); }
function getField(row, aliases) { for (const alias of aliases) { const match = Object.keys(row || {}).find((key) => normalizeHeader(key) === alias); if (match) return String(row[match] || "").trim(); } return ""; }
export function cleanEmail(value) { const email = String(value || "").trim().toLowerCase(); return EMAIL_PATTERN.test(email) ? email : ""; }
export function cleanUkMobile(value) { const digits = String(value || "").replace(/[^\d+]/g, ""); const normalized = digits.startsWith("+") ? digits : digits.replace(/^00/, "+"); if (!UK_MOBILE_PATTERN.test(normalized)) return ""; if (normalized.startsWith("+447")) return normalized; if (normalized.startsWith("447")) return `+${normalized}`; if (normalized.startsWith("07")) return `+44${normalized.slice(1)}`; return ""; }
export function cleanPostcode(value) { const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); if (compact.length < 5 || compact.length > 7) return String(value || "").trim().toUpperCase(); return `${compact.slice(0, -3)} ${compact.slice(-3)}`; }
function stripTitle(value) { return String(value || "").trim().replace(TITLE_PATTERN, "").trim(); }
function properCase(value) { return String(value || "").trim().toLowerCase().replace(/\b([a-z])/g, (match) => match.toUpperCase()).replace(/\b(Mc)([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`).replace(/\b(O')([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`); }
export function parseTags(value) { if (Array.isArray(value)) return value.map((tag) => String(tag || "").trim().toLowerCase().replace(/\s+/g, "_")).filter(Boolean); return String(value || "").split(/[;,]/).map((tag) => tag.trim().toLowerCase().replace(/\s+/g, "_")).filter(Boolean); }
export function mergePipeline(current, next) { if (current === next) return current; if (current === "both" || next === "both") return "both"; if ((current === "finance" && next === "rent2buy") || (current === "rent2buy" && next === "finance")) return "both"; if (current === "unknown") return next || "unknown"; if (next === "unknown") return current || "unknown"; return current || next || "unknown"; }
function importedPipeline(value) { const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, ""); if (["finance", "vanfinance"].includes(normalized)) return "finance"; if (["rent2buy", "r2b"].includes(normalized)) return "rent2buy"; if (normalized === "both" || (normalized.includes("finance") && normalized.includes("rent2buy"))) return "both"; if (normalized === "unknown") return "unknown"; return ""; }

export function cleanNameParts(row) {
  let firstName = stripTitle(getField(row, FIELD_ALIASES.first_name));
  let lastName = stripTitle(getField(row, FIELD_ALIASES.last_name));
  const fullName = stripTitle(getField(row, FIELD_ALIASES.full_name));
  if (!firstName && fullName) firstName = fullName;
  if (firstName && !lastName && firstName.includes(" ")) { const parts = firstName.split(/\s+/).filter(Boolean); firstName = parts.shift() || ""; lastName = parts.join(" "); }
  if (EMAIL_PATTERN.test(firstName.toLowerCase())) firstName = "";
  if (EMAIL_PATTERN.test(lastName.toLowerCase())) lastName = "";
  return { first_name: properCase(firstName), last_name: properCase(lastName) };
}

export function cleanImportRow(row, pipeline) {
  const { first_name, last_name } = cleanNameParts(row);
  const rawEmail = getField(row, FIELD_ALIASES.email);
  const email = cleanEmail(rawEmail);
  const phone = cleanUkMobile(getField(row, FIELD_ALIASES.phone));
  if (rawEmail && !email) return { contact: null, reason: "Invalid email address", invalidEmail: true, pipelineExplicit: false, sourceCustomerId: "" };
  if (!email) return { contact: null, reason: "Missing email address", invalidEmail: true, pipelineExplicit: false, sourceCustomerId: "" };
  const explicitPipeline = importedPipeline(getField(row, FIELD_ALIASES.pipeline));
  const resolvedPipeline = explicitPipeline || importedPipeline(pipeline) || "unknown";
  const originalSource = getField(row, FIELD_ALIASES.source) || "csv";
  const source = "cleaned_import";
  const tags = new Set(parseTags(getField(row, FIELD_ALIASES.tags)));
  if (email) tags.add("email_ready"); else tags.add("no_email");
  if (phone) tags.add("sms_ready"); else tags.add("no_mobile");
  tags.add("facebook_ready");
  tags.add("verified_cleaned_import");
  return { contact: { first_name, last_name, company: String(getField(row, FIELD_ALIASES.company) || "").trim(), email, email_normalized: email || null, phone, phone_normalized: phone || null, postcode: cleanPostcode(getField(row, FIELD_ALIASES.postcode)), pipeline: resolvedPipeline, source, sources: [...new Set([originalSource, source])], tags: [...tags].sort(), notes: String(getField(row, FIELD_ALIASES.notes) || "").trim(), marketing_status: "active", lifecycle_status: "active", lifecycle_changed_at: new Date().toISOString(), email_ready: true, sms_ready: Boolean(phone), facebook_ready: true }, reason: "", invalidEmail: false, pipelineExplicit: Boolean(explicitPipeline), sourceCustomerId: String(getField(row, FIELD_ALIASES.customer_id) || "").trim().toUpperCase() };
}

export async function findExactContact(supabase, contact, sourceCustomerId = "") {
  if (contact.email_normalized) { const result = await supabase.from("marketing_contacts").select(CONTACT_COLUMNS).eq("email_normalized", contact.email_normalized).maybeSingle(); if (result.error) throw result.error; if (result.data) return { contact: result.data, matchedOn: "email" }; }
  if (sourceCustomerId) { const result = await supabase.from("marketing_contacts").select(CONTACT_COLUMNS).eq("customer_id", sourceCustomerId).maybeSingle(); if (result.error) throw result.error; if (result.data) return { contact: result.data, matchedOn: "customer_id" }; }
  if (contact.phone_normalized) { const result = await supabase.from("marketing_contacts").select(CONTACT_COLUMNS).eq("phone_normalized", contact.phone_normalized).maybeSingle(); if (result.error) throw result.error; if (result.data) return { contact: result.data, matchedOn: "phone" }; }
  return { contact: null, matchedOn: "" };
}

export async function findPossibleDuplicate(supabase, contact) {
  const name = `${contact.first_name || ""} ${contact.last_name || ""}`.trim();
  if (!name || !contact.postcode) return null;
  const result = await supabase.from("marketing_contacts").select("id,customer_id,first_name,last_name,postcode,lifecycle_status").ilike("first_name", contact.first_name || "").ilike("last_name", contact.last_name || "").eq("postcode", contact.postcode || "").limit(1);
  if (result.error) throw result.error;
  return result.data?.[0] || null;
}

export function mergeContactPayload(existing, incoming, options = {}) {
  const sources = new Set([...(existing.sources || []), ...(incoming.sources || []), existing.source, incoming.source].filter(Boolean));
  const tags = new Set([...(existing.tags || []), ...(incoming.tags || [])].filter(Boolean));
  const matchedOn = options.matchedOn || "";
  const canReplaceEmail = matchedOn === "email" || matchedOn === "customer_id" || !existing.email_normalized;
  const emailNormalized = canReplaceEmail ? (incoming.email_normalized || existing.email_normalized || null) : (existing.email_normalized || null);
  const phoneNormalized = incoming.phone_normalized || existing.phone_normalized || null;
  const preferExisting = options.fillMissingOnly === true;
  const value = (current, next, fallback = "") => preferExisting ? (current || next || fallback) : (next || current || fallback);
  return { first_name: value(existing.first_name, incoming.first_name), last_name: value(existing.last_name, incoming.last_name), company: value(existing.company, incoming.company), email: canReplaceEmail ? value(existing.email, incoming.email, null) : (existing.email || null), email_normalized: emailNormalized, phone: value(existing.phone, incoming.phone, null), phone_normalized: phoneNormalized, postcode: value(existing.postcode, incoming.postcode), pipeline: options.pipelineExplicit && !preferExisting ? (incoming.pipeline || existing.pipeline || "unknown") : (existing.pipeline || incoming.pipeline || "unknown"), source: existing.source || incoming.source || "csv", sources: [...sources], tags: [...tags].sort(), notes: value(existing.notes, incoming.notes), marketing_status: "active", lifecycle_status: "active", lifecycle_changed_at: new Date().toISOString(), email_ready: Boolean(emailNormalized), sms_ready: Boolean(phoneNormalized), facebook_ready: Boolean(emailNormalized || phoneNormalized), duplicate_count: Number(existing.duplicate_count || 0) + (options.incrementDuplicate === false ? 0 : 1), last_seen_at: new Date().toISOString() };
}

export function assertContactCanBeRestored(existing = {}) {
  if (contactHasPermanentSuppression(existing) || String(existing.marketing_status || "active") !== "active") {
    throw new Error("Existing customer is permanently suppressed and cannot be restored.");
  }
}

export async function allocateCustomerId(supabase) {
  const { data, error } = await supabase.rpc("next_marketing_customer_id");
  if (error) throw new Error(`Customer ID allocation failed. Apply migration 003 first. ${error.message || ""}`.trim());
  return data;
}

export async function insertContact(supabase, contact) {
  const customerId = await allocateCustomerId(supabase);
  const { data } = assertSupabase(await supabase.from("marketing_contacts").insert({ ...contact, customer_id: customerId }).select(CONTACT_COLUMNS).single(), "Could not insert imported contact.");
  return data;
}

export async function customerUpsert(supabase, contact, options = {}) {
  const exact = await findExactContact(supabase, contact, options.sourceCustomerId);
  if (exact.contact) {
    assertContactCanBeRestored(exact.contact);
    const payload = mergeContactPayload(exact.contact, contact, { ...options, matchedOn: exact.matchedOn });
    const { data } = assertSupabase(await supabase.from("marketing_contacts").update(payload).eq("id", exact.contact.id).select(CONTACT_COLUMNS).single(), "Could not update contact.");
    const restored = exact.contact.lifecycle_status && exact.contact.lifecycle_status !== "active";
    return { contact: data, mode: restored ? "restored" : "updated", matchedOn: exact.matchedOn, pipelineChangedToBoth: payload.pipeline === "both" && exact.contact.pipeline !== "both", customerId: data?.customer_id || exact.contact.customer_id || "" };
  }

  const data = await insertContact(supabase, contact);
  return { contact: data, mode: "created", matchedOn: "", pipelineChangedToBoth: false, customerId: data?.customer_id || "" };
}

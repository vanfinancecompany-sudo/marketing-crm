export const CONTACT_COLUMNS = "id,customer_id,first_name,last_name,company,email,email_normalized,phone,phone_normalized,postcode,pipeline,source,sources,tags,notes,marketing_status,email_ready,sms_ready,facebook_ready,duplicate_count,first_seen_at,last_seen_at,created_at,updated_at";

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
  const email = cleanEmail(getField(row, FIELD_ALIASES.email));
  const phone = cleanUkMobile(getField(row, FIELD_ALIASES.phone));
  if (!email && !phone) return { contact: null, reason: "No valid email or UK mobile" };
  const source = getField(row, FIELD_ALIASES.source) || "csv";
  const tags = new Set(parseTags(getField(row, FIELD_ALIASES.tags)));
  if (email) tags.add("email_ready"); else tags.add("no_email");
  if (phone) tags.add("sms_ready"); else tags.add("no_mobile");
  tags.add("facebook_ready");
  return { contact: { first_name, last_name, company: String(getField(row, FIELD_ALIASES.company) || "").trim(), email, email_normalized: email || null, phone, phone_normalized: phone || null, postcode: cleanPostcode(getField(row, FIELD_ALIASES.postcode)), pipeline, source, sources: [source], tags: [...tags].sort(), notes: String(getField(row, FIELD_ALIASES.notes) || "").trim(), marketing_status: "active", email_ready: Boolean(email), sms_ready: Boolean(phone), facebook_ready: Boolean(email || phone) }, reason: "" };
}

export async function findExactContact(supabase, contact) {
  if (contact.email_normalized) { const result = await supabase.from("marketing_contacts").select(CONTACT_COLUMNS).eq("email_normalized", contact.email_normalized).maybeSingle(); if (result.error) throw result.error; if (result.data) return { contact: result.data, matchedOn: "email" }; }
  if (contact.phone_normalized) { const result = await supabase.from("marketing_contacts").select(CONTACT_COLUMNS).eq("phone_normalized", contact.phone_normalized).maybeSingle(); if (result.error) throw result.error; if (result.data) return { contact: result.data, matchedOn: "phone" }; }
  return { contact: null, matchedOn: "" };
}

export async function findPossibleDuplicate(supabase, contact) {
  const name = `${contact.first_name || ""} ${contact.last_name || ""}`.trim();
  if (!name || !contact.postcode) return null;
  const result = await supabase.from("marketing_contacts").select("id,customer_id,first_name,last_name,postcode").ilike("first_name", contact.first_name || "").ilike("last_name", contact.last_name || "").eq("postcode", contact.postcode || "").limit(1);
  if (result.error) throw result.error;
  return result.data?.[0] || null;
}

export function mergeContactPayload(existing, incoming) {
  const sources = new Set([...(existing.sources || []), ...(incoming.sources || []), existing.source, incoming.source].filter(Boolean));
  const tags = new Set([...(existing.tags || []), ...(incoming.tags || [])].filter(Boolean));
  return { first_name: existing.first_name || incoming.first_name || "", last_name: existing.last_name || incoming.last_name || "", company: existing.company || incoming.company || "", email: existing.email || incoming.email || null, email_normalized: existing.email_normalized || incoming.email_normalized || null, phone: existing.phone || incoming.phone || null, phone_normalized: existing.phone_normalized || incoming.phone_normalized || null, postcode: existing.postcode || incoming.postcode || "", pipeline: mergePipeline(existing.pipeline || "unknown", incoming.pipeline || "unknown"), source: existing.source || incoming.source || "csv", sources: [...sources], tags: [...tags].sort(), notes: [existing.notes, incoming.notes].filter(Boolean).join("\n"), email_ready: Boolean(existing.email_normalized || incoming.email_normalized), sms_ready: Boolean(existing.phone_normalized || incoming.phone_normalized), facebook_ready: Boolean(existing.email_normalized || incoming.email_normalized || existing.phone_normalized || incoming.phone_normalized), duplicate_count: Number(existing.duplicate_count || 0) + 1, last_seen_at: new Date().toISOString() };
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

export async function customerUpsert(supabase, contact) {
  const exact = await findExactContact(supabase, contact);
  if (exact.contact) {
    const payload = mergeContactPayload(exact.contact, contact);
    const { data } = assertSupabase(await supabase.from("marketing_contacts").update(payload).eq("id", exact.contact.id).select(CONTACT_COLUMNS).single(), "Could not update contact.");
    return { contact: data, mode: "updated", matchedOn: exact.matchedOn, pipelineChangedToBoth: payload.pipeline === "both" && exact.contact.pipeline !== "both", customerId: data?.customer_id || exact.contact.customer_id || "" };
  }

  const data = await insertContact(supabase, contact);
  return { contact: data, mode: "created", matchedOn: "", pipelineChangedToBoth: false, customerId: data?.customer_id || "" };
}

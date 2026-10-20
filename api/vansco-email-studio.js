import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { fetchVanscoMetaCatalogue } from "./_vansco-facebook-source.js";
import { isEligibleVanscoVehicle, isVanscoCar } from "../lib/vanscoFacebookAutomation.js";

// Dedicated, manual, draft-only Vansco email studio. NEVER invokes an email provider.
// Existing VFC/Rent2Buy campaign sends and transactional mail are unaffected.
export const config = { maxDuration: 60 };
const API_HEADER = "x-marketing-customer-database-key";
const THEMES = new Set(["standard", "halloween", "black_friday", "christmas"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MASTER_TABLE = "marketing_vansco_email_master";
const CONTACTS_TABLE = "marketing_vansco_email_contacts";
const CAMPAIGNS_TABLE = "marketing_vansco_email_campaigns";

function clean(value, max = 500) { return String(value ?? "").trim().slice(0, max); }
function failure(message, status = 400) { const error = new Error(message); error.statusCode = status; throw error; }
function checkResult(result, message) {
  if (result.error) {
    if (/schema cache|does not exist|relation .* not found/i.test(String(result.error.message || ""))) {
      failure("Vansco email data tables are not provisioned yet.", 503);
    }
    failure(message + ": " + clean(result.error.message, 220), 500);
  }
  return result.data;
}
function authorised(request) {
  const expected = clean(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY, 10000);
  const supplied = clean(request.headers?.[API_HEADER], 10000);
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected), b = Buffer.from(supplied);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function db() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) failure("Database connection not configured.", 503);
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}
function defaultSettings() {
  return {
    theme: "halloween",
    subject: "Vansco Halloween Sale | Great Savings on Used Vans",
    preview_text: "Browse our latest vans and seasonal offers.",
    heading: "HALLOWEEN VAN SALE",
    introduction: "Explore a selection of vans available now at Vansco.",
    offer: "Fantastic vans. Great seasonal savings.",
    cta_label: "VIEW ALL VANS",
    cta_url: "https://www.vansco.co.uk/all-stock/",
    selected_keys: [],
  };
}
function vanscoUrl(value) {
  const url = clean(value, 1000);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !["www.vansco.co.uk", "vansco.co.uk"].includes(parsed.hostname)) failure("Only Vansco website links are permitted.");
    return parsed.href;
  } catch { failure("Please enter a valid https://www.vansco.co.uk link."); }
}
function normaliseSettings(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) failure("Template settings must be an object.");
  const theme = clean(value.theme, 40);
  if (!THEMES.has(theme)) failure("Unknown Vansco email theme.");
  const selectedKeys = Array.isArray(value.selected_keys) ? value.selected_keys.map(v => clean(v, 260)).filter(Boolean) : [];
  if (selectedKeys.length > 6 || new Set(selectedKeys).size !== selectedKeys.length) failure("Select up to six different Vansco vans.");
  const settings = {
    theme,
    subject: clean(value.subject, 250),
    preview_text: clean(value.preview_text, 300),
    heading: clean(value.heading, 160),
    introduction: clean(value.introduction, 2000),
    offer: clean(value.offer, 300),
    cta_label: clean(value.cta_label, 75),
    cta_url: vanscoUrl(value.cta_url || "https://www.vansco.co.uk/all-stock/"),
    selected_keys: selectedKeys,
  };
  if (!settings.subject || !settings.heading || !settings.cta_label) failure("Subject, headline and call to action are required.");
  return settings;
}
function mappedVehicle(row) {
  if (!isEligibleVanscoVehicle(row) || isVanscoCar(row)) return null;
  try {
    const url = new URL(row.vehicleUrl);
    if (url.protocol !== "https:" || !["www.vansco.co.uk", "vansco.co.uk"].includes(url.hostname)) return null;
    return {
      key: clean(row.vehicleKey, 260),
      registration: clean(row.registration, 20),
      title: clean(row.title, 180),
      price: clean(row.price, 60),
      image: clean(row.imageUrl, 1000),
      url: url.href,
      mileage: clean(row.mileage, 40),
      branch: clean(row.branchKey, 50),
    };
  } catch { return null; }
}
async function liveStock() {
  const catalogue = await fetchVanscoMetaCatalogue({ preferLiveMetaImages: true });
  const seen = new Set();
  return catalogue.map(mappedVehicle).filter(vehicle => {
    if (!vehicle || seen.has(vehicle.key)) return false;
    seen.add(vehicle.key);
    return true;
  });
}
async function overview(supabase) {
  const [ready, review, suppressed, campaigns] = await Promise.all([
    supabase.from(CONTACTS_TABLE).select("id", { count: "exact", head: true }).eq("status", "ready"),
    supabase.from(CONTACTS_TABLE).select("id", { count: "exact", head: true }).eq("status", "pending_review"),
    supabase.from(CONTACTS_TABLE).select("id", { count: "exact", head: true }).eq("status", "suppressed"),
    supabase.from(CAMPAIGNS_TABLE).select("id", { count: "exact", head: true }),
  ]);
  for (const r of [ready, review, suppressed, campaigns]) checkResult(r, "Could not load Vansco counts");
  return {
    contacts: { total: (ready.count || 0) + (review.count || 0) + (suppressed.count || 0), ready: ready.count || 0, pending_review: review.count || 0, suppressed: suppressed.count || 0 },
    campaigns: campaigns.count || 0,
    // Manual sending is intentionally NOT enabled: zero is authoritative for this isolated system.
    reporting: { submitted: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, unsubscribed: 0 },
    sending_enabled: false,
  };
}
async function loadMaster(supabase) {
  const data = checkResult(await supabase.from(MASTER_TABLE).select("settings,updated_at").eq("id", 1).maybeSingle(), "Could not open Vansco master");
  return { settings: data?.settings || defaultSettings(), updated_at: data?.updated_at || null };
}
async function saveMaster(supabase, payload) {
  const settings = normaliseSettings(payload);
  const data = checkResult(await supabase.from(MASTER_TABLE).upsert({ id: 1, settings, updated_at: new Date().toISOString() }, { onConflict: "id" }).select("settings,updated_at").single(), "Could not save Vansco master");
  return { settings: data.settings, updated_at: data.updated_at };
}
async function listCampaigns(supabase) {
  const data = checkResult(await supabase.from(CAMPAIGNS_TABLE)
    .select("id,name,theme,subject,status,selected_vehicles,created_at")
    .order("created_at", { ascending: false }).limit(80), "Could not list Vansco drafts");
  return { campaigns: (data || []).map(({ selected_vehicles, ...item }) => ({ ...item, vehicle_count: Array.isArray(selected_vehicles) ? selected_vehicles.length : 0 })) };
}
async function saveDraft(supabase, payload) {
  const settings = normaliseSettings(payload.settings);
  const name = clean(payload.name, 150);
  if (!name) failure("Enter a campaign name.");
  if (!settings.selected_keys.length) failure("Select at least one Vansco van before saving a campaign draft.");
  const current = await liveStock();
  const stockMap = new Map(current.map(vehicle => [vehicle.key, vehicle]));
  const selected = settings.selected_keys.map(key => stockMap.get(key));
  if (selected.some(vehicle => !vehicle)) failure("A selected van is no longer available in Vansco stock. Refresh your selection.");
  const data = checkResult(await supabase.from(CAMPAIGNS_TABLE).insert({
    name, theme: settings.theme, subject: settings.subject, settings, selected_vehicles: selected, status: "draft",
  }).select("id,name,theme,subject,status,created_at").single(), "Could not save Vansco draft");
  return { campaign: data };
}
function emailKey(value) {
  const email = clean(value, 254).toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : "";
}
async function importContacts(supabase, payload) {
  const source = clean(payload.source, 160);
  const marketingBasis = clean(payload.marketing_basis, 40);
  const rows = payload.contacts;
  if (!source || !["consent", "legitimate_interest"].includes(marketingBasis)) failure("Record the mailing-list source and lawful marketing basis.");
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) failure("Upload 1 to 100 contacts per batch.");
  const unique = new Map();
  for (const raw of rows) {
    const email = emailKey(raw?.email);
    if (!email) continue;
    if (!unique.has(email)) unique.set(email, {
      email_normalized: email,
      first_name: clean(raw.first_name, 100),
      last_name: clean(raw.last_name, 100),
      source,
      marketing_basis: marketingBasis,
      status: "pending_review",
    });
  }
  if (!unique.size) failure("No valid email addresses found.");
  const emails = [...unique.keys()];
  // Global suppression identities and legacy VFC opt-outs must never be bypassed.
  const [suppressionRows, sharedRows] = await Promise.all([
    supabase.from("marketing_suppression_identities").select("email_normalized").in("email_normalized", emails),
    supabase.from("marketing_contacts").select("email_normalized,marketing_status,suppression").in("email_normalized", emails),
  ]);
  checkResult(suppressionRows, "Global suppressions could not be checked");
  checkResult(sharedRows, "Shared contact suppressions could not be checked");
  const blocked = new Set((suppressionRows.data || []).map(row => emailKey(row.email_normalized)));
  for (const row of sharedRows.data || []) {
    const sup = row.suppression && typeof row.suppression === "object" ? row.suppression : {};
    if (row.marketing_status !== "active" || ["email_unsubscribed", "email_bounced", "manual_suppression", "global_do_not_contact"].some(type => sup[type] && sup[type].active !== false)) {
      blocked.add(emailKey(row.email_normalized));
    }
  }
  const contacts = [...unique.values()].map(row => blocked.has(row.email_normalized)
    ? { ...row, status: "suppressed", suppression_reason: "Existing shared email suppression" }
    : row);
  // Ignore duplicates rather than overwriting existing suppression, permission or other brand records.
  const inserted = checkResult(await supabase.from(CONTACTS_TABLE)
    .upsert(contacts, { onConflict: "email_normalized", ignoreDuplicates: true })
    .select("id,status"), "Could not import Vansco mailing list");
  return { accepted: contacts.length, newly_added: (inserted || []).length, suppressed_in_batch: contacts.filter(r => r.status === "suppressed").length, pending_review: contacts.filter(r => r.status === "pending_review").length };
}
export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorised(request)) return response.status(401).json({ ok: false, message: "Vansco studio access denied." });
  try {
    const body = typeof request.body === "string" ? JSON.parse(request.body) : (request.body || {});
    const action = clean(body.action, 60);
    if (action === "validateAccess") return response.status(200).json({ ok: true });
    const supabase = db();
    let data;
    if (action === "stock") data = { vehicles: await liveStock() };
    else if (action === "overview") data = await overview(supabase);
    else if (action === "loadMaster") data = await loadMaster(supabase);
    else if (action === "saveMaster") data = await saveMaster(supabase, body.settings);
    else if (action === "listCampaigns") data = await listCampaigns(supabase);
    else if (action === "saveDraft") data = await saveDraft(supabase, body);
    else if (action === "importContacts") data = await importContacts(supabase, body);
    else failure("Unknown Vansco studio action.");
    return response.status(200).json({ ok: true, ...data });
  } catch (error) {
    console.error("[Vansco email studio]", clean(error?.message, 180));
    return response.status(error.statusCode || 500).json({ ok: false, message: error.message || "Vansco email studio request failed." });
  }
}

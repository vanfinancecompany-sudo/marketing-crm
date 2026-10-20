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
    subject: "Vansco Halloween Giveaway | At Least £300 Off Every Van",
    preview_text: "At least £300 off every van, average savings of £500, a free 1-year AutoGuard warranty and FREE nationwide delivery.",
    heading: "HALLOWEEN VAN SALE",
    introduction: "The Vansco Halloween Giveaway is here! Discover quality used vans with spookily good savings, FREE nationwide delivery and low-deposit van finance options.",
    eyebrow: "HALLOWEEN EDITION",
    subheading: "Big savings on quality used vans this Halloween",
    brand_description: "Hunting for your next work van? Vansco has a wide selection of quality used commercial vehicles across our three Hampshire locations. Our Halloween Giveaway includes at least £300 off every vehicle, with average savings of £500 per van. Every vehicle also comes with a FREE 1-year AutoGuard warranty.",
    extra_text: "Need a small van, a Transit Custom or a larger commercial vehicle? Browse our featured stock, or speak to the Vansco team about availability, part exchange and low-deposit finance options. We also offer FREE nationwide delivery, making it easy to buy wherever you are in the UK.",
    footer_note: "Vehicle prices and availability are subject to confirmation. Warranty cover is subject to AutoGuard terms. Finance is subject to status and lender terms. Savings may vary by vehicle.",
    logo_url: "",
    sale_prices: {},
    stock_count: "278",
    stock_location: "Used Vehicles in Southampton, Hampshire",
    offer: "AT LEAST £300 OFF EVERY VAN • AVERAGE SAVING £500 • FREE 1-YEAR AUTOGUARD WARRANTY",
    cta_label: "VIEW HALLOWEEN OFFERS",
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

export function normalisePrice(value, label = "Sale price") {
  const raw = clean(value, 40);
  if (!raw) return "";
  if (!/^(?:£\s*)?\d{1,8}(?:,\d{3})*(?:\.\d{1,2})?$/.test(raw) && !/^(?:£\s*)?\d{1,8}(?:\.\d{1,2})?$/.test(raw)) {
    failure(label + " must be a valid amount in pounds.");
  }
  const numeric = Number(raw.replace(/[£,\s]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 10000000) failure(label + " is outside the permitted range.");
  return numeric.toFixed(2);
}
function normaliseLogoUrl(value) {
  const raw = clean(value, 1600);
  if (!raw) return "";
  let parsed;
  try { parsed = new URL(raw); } catch { failure("Enter a valid HTTPS logo image URL."); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) failure("Logo must use HTTPS.");
  const hostname = parsed.hostname.toLowerCase();
  let ownStorageHost = "";
  try { ownStorageHost = new URL(process.env.SUPABASE_URL || "").hostname.toLowerCase(); } catch {}
  const isOwnUpload = Boolean(ownStorageHost && hostname === ownStorageHost && parsed.pathname.startsWith("/storage/v1/object/public/template-files/vansco-email-studio/logos/"));
  const allowed = hostname === "vansco.co.uk" || hostname.endsWith(".vansco.co.uk")
    || hostname === "static.wixstatic.com" || isOwnUpload;
  if (!allowed) failure("Logo must use Vansco, Wixstatic or the CRM's hosted logo storage.");
  return parsed.href;
}
export function normaliseSalePrices(value, keys = []) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) failure("Vehicle sale prices must be a keyed object.");
  const output = {};
  for (const key of keys) {
    const row = value[key] || {};
    if (!row || typeof row !== "object" || Array.isArray(row)) failure("Vehicle sale prices must be editable fields.");
    const was = normalisePrice(row.was, "Was price");
    const now = normalisePrice(row.now, "Now price");
    let save = normalisePrice(row.save, "Save price");
    if (!was && !now && !save) continue;
    if (!was || !now) failure("Enter both Was and Now prices for a sale vehicle.");
    const difference = Math.round((Number(was) - Number(now)) * 100);
    if (difference <= 0) failure("Was price must exceed Now price.");
    if (!save) save = (difference / 100).toFixed(2);
    if (Math.round(Number(save) * 100) !== difference) failure("Save price must equal Was minus Now.");
    output[key] = { was, now, save };
  }
  return output;
}
export function normaliseSettings(value = {}) {
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
    eyebrow: clean(value.eyebrow, 120),
    subheading: clean(value.subheading, 240),
    brand_description: clean(value.brand_description, 2400),
    extra_text: clean(value.extra_text, 2400),
    footer_note: clean(value.footer_note, 800),
    logo_url: normaliseLogoUrl(value.logo_url),
    sale_prices: normaliseSalePrices(value.sale_prices, selectedKeys),
    stock_count: clean(value.stock_count, 6),
    stock_location: clean(value.stock_location, 120),
    offer: clean(value.offer, 300),
    cta_label: clean(value.cta_label, 75),
    cta_url: vanscoUrl(value.cta_url || "https://www.vansco.co.uk/all-stock/"),
    selected_keys: selectedKeys,
  };
  if (settings.stock_count && (!/^[1-9]\d{0,5}$/.test(settings.stock_count))) failure("Vehicle stock count must be a positive whole number.");
  if (!settings.subject || !settings.heading || !settings.cta_label) failure("Subject, headline and call to action are required.");
  return settings;
}
export function mappedVehicle(row) {
  if (!isEligibleVanscoVehicle(row) || isVanscoCar(row)) return null;
  try {
    const url = new URL(row.vehicleUrl);
    if (url.protocol !== "https:" || !["www.vansco.co.uk", "vansco.co.uk"].includes(url.hostname)) return null;
    return {
      key: clean(row.vehicleKey, 260),
      registration: clean(row.registration, 20),
      title: clean(row.title, 180),
      detail: clean([row.bodyStyle, row.description].filter(Boolean).join(" · ").replace(/\s+/g, " "), 190),
      price: clean(row.price, 60),
      image: clean(row.imageUrl, 1000),
      url: url.href,
      mileage: clean(row.mileage, 40),
      branch: clean(row.branchKey, 50),
      vat_label: clean(row.vatLabel, 100),
    };
  } catch { return null; }
}
export async function liveStock() {
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
async function loadCampaignDraft(supabase, body) {
  const id=clean(body.id,80);
  if(!/^[0-9a-f-]{36}$/i.test(id)) failure("Choose a saved Vansco draft.");
  const data=checkResult(await supabase.from(CAMPAIGNS_TABLE).select("id,name,settings,selected_vehicles,status").eq("id",id).maybeSingle(),"Could not load Vansco draft");
  if(!data||data.status!=="draft")failure("Vansco draft not found.");
  return {campaign:data};
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
  const priceSnapshots = selected.map(vehicle => ({ ...vehicle, sale_prices: settings.sale_prices[vehicle.key] || null }));
  const data = checkResult(await supabase.from(CAMPAIGNS_TABLE).insert({
    name, theme: settings.theme, subject: settings.subject, settings, selected_vehicles: priceSnapshots, status: "draft",
  }).select("id,name,theme,subject,status,created_at").single(), "Could not save Vansco draft");
  return { campaign: data };
}
function emailKey(value) {
  const email = clean(value, 254).toLowerCase();
  return EMAIL_PATTERN.test(email) ? email : "";
}

const IMPORT_JOBS = "marketing_vansco_email_import_jobs";
const CSV_FIELDS = ["first_name","last_name","display_name","company","pipeline","tags","notes","brand","verifalia_classification","verifalia_status"];
function importMetadata(raw) {
  const result = {};
  for (const field of CSV_FIELDS) result[field] = clean(field === "display_name" ? raw?.name || [raw?.first_name,raw?.last_name].filter(Boolean).join(" ") : raw?.[field], field==="notes" ? 4000 : field==="tags" ? 1200 : 255);
  return result;
}
async function importContacts(supabase, payload) {
  const source = clean(payload.source, 160);
  const basis = clean(payload.marketing_basis || "unverified", 40);
  const rows = payload.contacts;
  if (!source || !["unverified", "consent", "legitimate_interest"].includes(basis)) {
    failure("Choose a customer source and a marketing-permission assessment state.");
  }
  if (!Array.isArray(rows) || !rows.length || rows.length > 100) failure("Upload 1 to 100 contacts per batch.");
  const fingerprint = clean(payload.fingerprint, 64);
  const totalRows = Number(payload.total_rows);
  const offset = Number(payload.row_offset);
  const tracked = /^[a-f0-9]{64}$/.test(fingerprint);
  if (tracked && (!Number.isSafeInteger(totalRows) || totalRows < 1 || !Number.isSafeInteger(offset) || offset < 0 || offset + rows.length > totalRows)) {
    failure("Invalid CSV import progress. Please select the original file again.");
  }
  let job = null;
  if (tracked) {
    const filename = clean(payload.filename || "Vansco customer import.csv", 200);
    checkResult(await supabase.from(IMPORT_JOBS).upsert({
      fingerprint, filename, total_rows: totalRows
    }, { onConflict: "fingerprint", ignoreDuplicates: true }), "Could not create import session");
    job = checkResult(await supabase.from(IMPORT_JOBS).select("*").eq("fingerprint", fingerprint).single(), "Could not resume import session");
    if (job.total_rows !== totalRows) failure("This file has a different row count from its existing import session.", 409);
    if (offset < job.processed_rows) return {
      import_job: job, accepted: 0, newly_added: 0, already_existing: 0,
      suppressed_in_batch: 0, invalid: 0, skipped_completed_segment: true
    };
    if (offset > job.processed_rows) failure("Import batches must be processed in order. Resume at row " + job.processed_rows + ".", 409);
  }
  const unique = new Map();
  let invalid = 0, repeated = 0;
  for (const raw of rows) {
    const email = emailKey(raw?.email);
    if (!email) { invalid++; continue; }
    if (unique.has(email)) { repeated++; continue; }
    unique.set(email, { email_normalized: email, ...importMetadata(raw),
      source: clean(raw?.source || source, 160),
      marketing_basis: basis,
      status: "pending_review",
    });
  }
  const emails = [...unique.keys()];
  let inserted = [], blocked = new Set();
  if (emails.length) {
    const [global, legacy, existing] = await Promise.all([
      supabase.from("marketing_suppression_identities").select("email_normalized").in("email_normalized", emails),
      supabase.from("marketing_contacts").select("email_normalized,marketing_status,lifecycle_status,suppression").in("email_normalized", emails),
      supabase.from(CONTACTS_TABLE).select("id,email_normalized,first_name,last_name,display_name,company,pipeline,tags,notes,brand,verifalia_classification,verifalia_status,updated_at").in("email_normalized", emails),
    ]);
    checkResult(global, "Could not inspect global suppressions");
    checkResult(legacy, "Could not inspect shared customer suppressions");
    checkResult(existing, "Could not inspect existing Vansco customers");
    blocked = new Set((global.data || []).map(r=>emailKey(r.email_normalized)));
    for (const row of legacy.data || []) {
      const flags = row.suppression || {};
      if (row.marketing_status !== "active" || (row.lifecycle_status && row.lifecycle_status !== "active")
        || ["email_unsubscribed","email_bounced","manual_suppression","global_do_not_contact"].some(x=>flags[x] && flags[x].active !== false)) {
        blocked.add(emailKey(row.email_normalized));
      }
    }
    const already = new Map((existing.data || []).map(r=>[r.email_normalized,r]));
    const fresh = [...unique.values()].filter(r=>!already.has(r.email_normalized)).map(r=>blocked.has(r.email_normalized)
      ? { ...r, status: "suppressed", suppression_reason: "Existing shared email suppression" } : r);
    if (fresh.length) {
      inserted = checkResult(await supabase.from(CONTACTS_TABLE)
        .upsert(fresh, { onConflict: "email_normalized", ignoreDuplicates: true })
        .select("email_normalized"), "Could not safely insert Vansco contacts");
    }
    // Reconcile missing CSV metadata only: never update status, marketing basis, permission or reviews.
    const changes = [];
    for (const row of unique.values()) {
      const old = already.get(row.email_normalized);
      if (!old) continue;
      const missing = {};
      for (const field of CSV_FIELDS) if (!old[field] && row[field]) missing[field] = row[field];
      if (Object.keys(missing).length) changes.push({ old, missing });
    }
    for (let i=0; i<changes.length; i+=10) {
      await Promise.all(changes.slice(i,i+10).map(async({old,missing})=>{
        checkResult(await supabase.from(CONTACTS_TABLE).update(missing)
          .eq("id",old.id).eq("updated_at",old.updated_at), "Could not reconcile imported contact metadata");
      }));
    }
  }
  const added = inserted.length, existingCount = unique.size - added;
  const result = {
    accepted: unique.size, newly_added: added, already_existing: existingCount,
    suppressed_in_batch: [...unique.keys()].filter(k=>blocked.has(k)).length,
    invalid, repeated_in_file: repeated,
  };
  if (job) {
    const next = offset + rows.length;
    const progress = checkResult(await supabase.from(IMPORT_JOBS).update({
      processed_rows: next,
      newly_imported: job.newly_imported + added,
      already_existing: job.already_existing + existingCount,
      suppressed_rows: job.suppressed_rows + result.suppressed_in_batch,
      invalid_rows: job.invalid_rows + invalid,
      status: next === totalRows ? "complete" : "in_progress",
      updated_at: new Date().toISOString(),
    }).eq("id",job.id).eq("processed_rows",offset).select("*").maybeSingle(), "Could not persist import progress");
    if (!progress) failure("The import session changed. Recheck progress before retrying.",409);
    result.import_job = progress;
  }
  return result;
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
    else if (action === "loadCampaign") data = await loadCampaignDraft(supabase, body);
    else if (action === "saveDraft") data = await saveDraft(supabase, body);
    else if (action === "importStatus") {
      const fingerprint = clean(body.fingerprint,64);
      if (!/^[a-f0-9]{64}$/.test(fingerprint)) failure("Choose a valid CSV to inspect progress.");
      const job = checkResult(await supabase.from(IMPORT_JOBS).select("*").eq("fingerprint",fingerprint).maybeSingle(),"Could not load import progress");
      data = { import_job: job };
    }
    else if (action === "importContacts") data = await importContacts(supabase, body);
    else failure("Unknown Vansco studio action.");
    return response.status(200).json({ ok: true, ...data });
  } catch (error) {
    console.error("[Vansco email studio]", clean(error?.message, 180));
    return response.status(error.statusCode || 500).json({ ok: false, message: error.message || "Vansco email studio request failed." });
  }
}

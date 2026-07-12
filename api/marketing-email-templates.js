import { createClient } from "@supabase/supabase-js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const TEMPLATE_COLUMNS = "id,name,description,category,default_subject,preview_text,header_logo,hero_heading,intro_text,main_body,cta_text,cta_url,footer,brand_colour,status,created_by,created_at,updated_at,archived_at";
const CATEGORIES = new Set(["new_stock", "finance_offer", "rent2buy", "weekend_offer", "re_engagement", "custom"]);
const STATUSES = new Set(["draft", "active", "archived"]);
const EDITABLE_STATUSES = new Set(["draft", "active"]);

const SAMPLE_DATA = {
  campaign_name: "July New Stock",
  first_name: "Alex",
  company: "Van Finance Company",
  vehicle_count: "3",
  vehicle_grid: "",
};

const SAMPLE_VEHICLES = [
  { name: "Ford Transit Custom Limited", price: "16995", mileage: "42,000 miles" },
  { name: "Volkswagen Transporter Highline", price: "18995", mileage: "36,500 miles" },
  { name: "Mercedes-Benz Vito Premium", price: "21995", mileage: "29,000 miles" },
];

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

function templateInput(body = {}) {
  return body.values || body.template || {};
}

function assertSupabase(result, fallbackMessage) {
  if (result.error) throw new Error(result.error.message || fallbackMessage);
  return result;
}

function cleanText(value, limit = 5000) {
  return String(value || "").trim().slice(0, limit);
}

function cleanColour(value) {
  const colour = cleanText(value || "#2563eb", 20);
  return /^#[0-9a-fA-F]{6}$/.test(colour) ? colour : "#2563eb";
}

function normalizeCategory(value) {
  const category = cleanText(value || "custom", 40);
  if (!CATEGORIES.has(category)) throw new Error("Unsupported template category.");
  return category;
}

function normalizeStatus(value) {
  const status = cleanText(value || "draft", 40);
  if (!STATUSES.has(status)) throw new Error("Unsupported template status.");
  return status;
}

function validateTemplate(values) {
  if (!cleanText(values.name, 200)) throw new Error("Template name is required.");
  if (!cleanText(values.default_subject, 300)) throw new Error("Default subject is required.");
}

function normalizeValues(values = {}) {
  const normalized = {
    name: cleanText(values.name, 200),
    description: cleanText(values.description, 1000),
    category: normalizeCategory(values.category),
    default_subject: cleanText(values.default_subject, 300),
    preview_text: cleanText(values.preview_text, 300),
    header_logo: cleanText(values.header_logo, 1000),
    hero_heading: cleanText(values.hero_heading, 300),
    intro_text: cleanText(values.intro_text, 2000),
    main_body: cleanText(values.main_body, 12000),
    cta_text: cleanText(values.cta_text, 120),
    cta_url: cleanText(values.cta_url, 1000),
    footer: cleanText(values.footer, 2000),
    brand_colour: cleanColour(values.brand_colour),
    status: normalizeStatus(values.status),
  };
  validateTemplate(normalized);
  if (!EDITABLE_STATUSES.has(normalized.status)) throw new Error("Use the Archive action to archive templates.");
  return normalized;
}

function normalizeTemplate(row = {}) {
  return {
    id: row.id || "",
    name: row.name || "",
    description: row.description || "",
    category: row.category || "custom",
    default_subject: row.default_subject || "",
    preview_text: row.preview_text || "",
    header_logo: row.header_logo || "",
    hero_heading: row.hero_heading || "",
    intro_text: row.intro_text || "",
    main_body: row.main_body || "",
    cta_text: row.cta_text || "",
    cta_url: row.cta_url || "",
    footer: row.footer || "",
    brand_colour: row.brand_colour || "#2563eb",
    status: row.status || "draft",
    created_by: row.created_by || "",
    created_at: row.created_at || "",
    updated_at: row.updated_at || "",
    archived_at: row.archived_at || "",
  };
}

async function loadTemplate(supabase, id) {
  if (!id) throw new Error("Template ID is required.");
  const { data } = assertSupabase(
    await supabase.from("marketing_email_templates").select(TEMPLATE_COLUMNS).eq("id", id).single(),
    "Could not load email template."
  );
  return normalizeTemplate(data);
}

async function listTemplates(supabase, body = {}) {
  let query = supabase.from("marketing_email_templates").select(TEMPLATE_COLUMNS).order("updated_at", { ascending: false });
  if (!body.includeArchived) query = query.neq("status", "archived");
  if (body.category && body.category !== "all") query = query.eq("category", normalizeCategory(body.category));
  const { data } = assertSupabase(await query, "Could not load email templates.");
  return { templates: (data || []).map(normalizeTemplate) };
}

async function createTemplate(supabase, body = {}) {
  const values = normalizeValues(templateInput(body));
  const { data } = assertSupabase(
    await supabase.from("marketing_email_templates").insert({ ...values, created_by: cleanText(body.createdBy || "Marketing CRM", 200) }).select(TEMPLATE_COLUMNS).single(),
    "Could not create email template."
  );
  return { template: normalizeTemplate(data) };
}

async function updateTemplate(supabase, body = {}) {
  const existing = await loadTemplate(supabase, body.template?.id || body.id);
  if (existing.status === "archived") throw new Error("Archived templates are read only.");
  const values = normalizeValues(templateInput(body));
  const { data } = assertSupabase(
    await supabase.from("marketing_email_templates").update(values).eq("id", existing.id).select(TEMPLATE_COLUMNS).single(),
    "Could not update email template."
  );
  return { template: normalizeTemplate(data) };
}

async function archiveTemplate(supabase, body = {}) {
  const existing = await loadTemplate(supabase, body.template?.id || body.id);
  if (existing.status === "archived") return { template: existing };
  const { data } = assertSupabase(
    await supabase.from("marketing_email_templates").update({ status: "archived", archived_at: new Date().toISOString() }).eq("id", existing.id).select(TEMPLATE_COLUMNS).single(),
    "Could not archive email template."
  );
  return { template: normalizeTemplate(data) };
}

async function duplicateTemplate(supabase, body = {}) {
  const existing = await loadTemplate(supabase, body.template?.id || body.id);
  const { id, created_at, updated_at, archived_at, created_by, ...copy } = existing;
  const values = normalizeValues({ ...copy, name: `Copy of ${existing.name}`, status: "draft" });
  const { data } = assertSupabase(
    await supabase.from("marketing_email_templates").insert({ ...values, created_by: cleanText(body.createdBy || "Marketing CRM", 200) }).select(TEMPLATE_COLUMNS).single(),
    "Could not duplicate email template."
  );
  return { template: normalizeTemplate(data) };
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function renderVehicleGrid() {
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:18px 0;">${SAMPLE_VEHICLES.map((vehicle) => `<div style="border:1px solid #dbe2ea;border-radius:10px;padding:12px;background:#f8fafc;"><strong>${escapeHtml(vehicle.name)}</strong><br><span>${escapeHtml(vehicle.mileage)}</span><br><strong>£${escapeHtml(vehicle.price)}</strong></div>`).join("")}</div>`;
}

function replacePlaceholders(value, html = false) {
  const replacements = { ...SAMPLE_DATA, vehicle_grid: html ? renderVehicleGrid() : "[Vehicle grid preview]" };
  return String(value || "").replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (match, key) => replacements[key] ?? match);
}

function textToHtml(value) {
  const rendered = replacePlaceholders(value, true);
  return rendered.split(/\n{2,}/).map((part) => `<p>${part.includes("<div") ? part : escapeHtml(part).replace(/\n/g, "<br>")}</p>`).join("");
}

function previewTemplate(body = {}) {
  const values = normalizeValues(templateInput(body));
  const subject = replacePlaceholders(values.default_subject);
  const html = `<!doctype html><html><body style="margin:0;background:#f3f6fb;font-family:Arial,sans-serif;color:#0f172a;"><div style="max-width:680px;margin:0 auto;background:#fff;">${values.header_logo ? `<div style="padding:20px;text-align:center;"><img src="${escapeHtml(values.header_logo)}" alt="" style="max-width:180px;max-height:80px;"></div>` : ""}<div style="background:${values.brand_colour};color:#fff;padding:28px;"><h1 style="margin:0;font-size:30px;">${escapeHtml(replacePlaceholders(values.hero_heading || values.name))}</h1></div><div style="padding:28px;"><p style="color:#64748b;margin-top:0;">${escapeHtml(replacePlaceholders(values.preview_text))}</p>${textToHtml(values.intro_text)}${textToHtml(values.main_body)}${values.cta_text ? `<p style="margin:28px 0;"><a href="${escapeHtml(values.cta_url || "#")}" style="display:inline-block;background:${values.brand_colour};color:#fff;text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:700;">${escapeHtml(replacePlaceholders(values.cta_text))}</a></p>` : ""}${textToHtml(values.footer)}</div></div></body></html>`;
  return { preview: { subject, preview_text: replacePlaceholders(values.preview_text), html } };
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");

  if (request.method !== "POST") {
    json(response, 405, { ok: false, message: "Method not allowed." });
    return;
  }

  if (!authorize(request)) {
    json(response, 401, { ok: false, message: "Email Templates API access denied." });
    return;
  }

  try {
    const supabase = getSupabase();
    const body = parseBody(request);
    const action = body.action || "list";
    let result;

    if (action === "validateAccess") result = {};
    else if (action === "list") result = await listTemplates(supabase, body);
    else if (action === "create") result = await createTemplate(supabase, body);
    else if (action === "update") result = await updateTemplate(supabase, body);
    else if (action === "archive") result = await archiveTemplate(supabase, body);
    else if (action === "duplicate") result = await duplicateTemplate(supabase, body);
    else if (action === "preview") result = previewTemplate(body);
    else throw new Error("Unknown Email Templates API action.");

    json(response, 200, { ok: true, ...result });
  } catch (error) {
    json(response, 500, { ok: false, message: error?.message || "Email Templates API error." });
  }
}

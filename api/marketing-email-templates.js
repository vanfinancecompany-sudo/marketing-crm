import { createClient } from "@supabase/supabase-js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const TEMPLATE_COLUMNS = "id,name,description,category,default_subject,preview_text,header_logo,hero_heading,intro_text,main_body,cta_text,cta_url,footer,brand_colour,company_name,secondary_colour,social_links,master_layout,status,created_by,created_at,updated_at,archived_at";
const CATEGORIES = new Set(["new_stock", "finance_offer", "rent2buy", "weekend_offer", "re_engagement", "custom"]);
const STATUSES = new Set(["draft", "active", "archived"]);
const EDITABLE_STATUSES = new Set(["draft", "active"]);
const MASTER_LAYOUTS = new Set(["new_stock", "finance_offer", "rent2buy", "weekend_offer", "re_engagement", "newsletter", "custom_blank"]);
const VEHICLE_GRID_TOKEN = "%%MARKETING_TRUSTED_VEHICLE_GRID_TOKEN%%";

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

function cleanColour(value, fallback = "#2563eb") {
  const colour = cleanText(value || fallback, 20);
  return /^#[0-9a-fA-F]{6}$/.test(colour) ? colour : fallback;
}

function requireColour(value, label) {
  const colour = cleanText(value, 20);
  if (!/^#[0-9a-fA-F]{6}$/.test(colour)) throw new Error(`${label} must be a six-digit hex colour.`);
  return colour;
}

function cleanHttpsUrl(value, label) {
  const text = cleanText(value, 1000);
  if (!text) return "";
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "https:") throw new Error("Invalid protocol.");
    return parsed.toString();
  } catch {
    throw new Error(`${label} must be a valid absolute HTTPS URL.`);
  }
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

function normalizeMasterLayout(value) {
  const layout = cleanText(value || "custom_blank", 40);
  if (!MASTER_LAYOUTS.has(layout)) throw new Error("Unsupported master layout.");
  return layout;
}

function validateTemplate(values) {
  if (!cleanText(values.name, 200)) throw new Error("Template name is required.");
  if (!cleanText(values.default_subject, 300)) throw new Error("Default subject is required.");
  if (!cleanText(values.company_name, 200)) throw new Error("Company name is required.");
}

function normalizeValues(values = {}) {
  const normalized = {
    name: cleanText(values.name, 200),
    description: cleanText(values.description, 1000),
    category: normalizeCategory(values.category),
    default_subject: cleanText(values.default_subject, 300),
    preview_text: cleanText(values.preview_text, 300),
    header_logo: cleanHttpsUrl(values.header_logo, "Header logo"),
    hero_heading: cleanText(values.hero_heading, 300),
    intro_text: cleanText(values.intro_text, 2000),
    main_body: cleanText(values.main_body, 12000),
    cta_text: cleanText(values.cta_text, 120),
    cta_url: cleanHttpsUrl(values.cta_url, "CTA URL"),
    footer: cleanText(values.footer, 2000),
    brand_colour: requireColour(values.brand_colour || "#2563eb", "Brand colour"),
    company_name: cleanText(values.company_name || "Van Finance Company", 200),
    secondary_colour: requireColour(values.secondary_colour || "#eef2ff", "Secondary colour"),
    social_links: cleanText(values.social_links, 1000),
    master_layout: normalizeMasterLayout(values.master_layout),
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
    company_name: row.company_name || "Van Finance Company",
    secondary_colour: row.secondary_colour || "#eef2ff",
    social_links: row.social_links || "",
    master_layout: row.master_layout || "custom_blank",
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

function sampleData(values = {}) {
  return {
    campaign_name: "July New Stock",
    first_name: "Alex",
    company: values.company_name || "Van Finance Company",
    vehicle_count: "3",
    vehicle_grid: "[Vehicle grid preview]",
  };
}

function replaceTextPlaceholders(value, values = {}) {
  const replacements = sampleData(values);
  return String(value || "").replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (match, key) => replacements[key] ?? match);
}

function renderVehicleGrid() {
  const rows = SAMPLE_VEHICLES.map((vehicle) => `
    <tr>
      <td style="padding:12px;border:1px solid #dbe2ea;background:#f8fafc;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="font-family:Arial,sans-serif;font-size:15px;line-height:20px;color:#0f172a;font-weight:bold;">${escapeHtml(vehicle.name)}</td></tr>
          <tr><td style="font-family:Arial,sans-serif;font-size:13px;line-height:20px;color:#64748b;padding-top:4px;">${escapeHtml(vehicle.mileage)}</td></tr>
          <tr><td style="font-family:Arial,sans-serif;font-size:16px;line-height:22px;color:#0f172a;font-weight:bold;padding-top:6px;">£${escapeHtml(vehicle.price)}</td></tr>
        </table>
      </td>
    </tr>
  `).join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-spacing:0 10px;margin:18px 0;">${rows}</table>`;
}

function renderEscapedTextBlock(value) {
  const normalized = String(value || "").replace(/\r\n/g, "\n");
  if (!normalized.trim()) return "";
  return normalized
    .split(/\n{2,}/)
    .map((part) => `<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:15px;line-height:23px;color:#1f2937;">${part.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function textToHtml(value, values = {}) {
  const withVehicleToken = String(value || "").replace(/{{\s*vehicle_grid\s*}}/g, VEHICLE_GRID_TOKEN);
  const withTextPlaceholders = replaceTextPlaceholders(withVehicleToken, values);
  return escapeHtml(withTextPlaceholders)
    .split(VEHICLE_GRID_TOKEN)
    .map((part, index, parts) => `${renderEscapedTextBlock(part)}${index < parts.length - 1 ? renderVehicleGrid() : ""}`)
    .join("");
}

function renderEmailHtml(values = {}) {
  const subject = replaceTextPlaceholders(values.default_subject, values);
  const previewText = replaceTextPlaceholders(values.preview_text, values);
  const heroHeading = replaceTextPlaceholders(values.hero_heading || values.name, values);
  const ctaText = replaceTextPlaceholders(values.cta_text, values);
  const primary = cleanColour(values.brand_colour, "#2563eb");
  const secondary = cleanColour(values.secondary_colour, "#eef2ff");
  const companyName = values.company_name || "Van Finance Company";
  const logoHtml = values.header_logo ? `
    <tr>
      <td align="center" style="padding:22px 24px 14px;background:#ffffff;">
        <img src="${escapeHtml(values.header_logo)}" alt="${escapeHtml(companyName)}" width="180" style="display:block;max-width:180px;width:100%;height:auto;border:0;outline:none;text-decoration:none;">
      </td>
    </tr>
  ` : `
    <tr>
      <td align="center" style="padding:24px 24px 14px;background:#ffffff;font-family:Arial,sans-serif;font-size:20px;line-height:26px;color:#0f172a;font-weight:bold;">${escapeHtml(companyName)}</td>
    </tr>
  `;
  const ctaHtml = values.cta_text && values.cta_url ? `
    <tr>
      <td align="left" style="padding:4px 30px 26px;background:#ffffff;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${primary}" style="border-radius:8px;"><a href="${escapeHtml(values.cta_url)}" style="display:inline-block;padding:13px 19px;font-family:Arial,sans-serif;font-size:15px;line-height:20px;color:#ffffff;text-decoration:none;font-weight:bold;">${escapeHtml(ctaText)}</a></td></tr></table>
      </td>
    </tr>
  ` : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#eef3f8;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef3f8" style="width:100%;background:#eef3f8;border-collapse:collapse;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="660" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:660px;background:#ffffff;border-collapse:collapse;border-radius:14px;overflow:hidden;">
            ${logoHtml}
            <tr>
              <td bgcolor="${primary}" style="padding:34px 30px;background:${primary};">
                <p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:13px;line-height:18px;color:#ffffff;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;">${escapeHtml(companyName)}</p>
                <h1 style="margin:0;font-family:Arial,sans-serif;font-size:34px;line-height:40px;color:#ffffff;font-weight:bold;">${escapeHtml(heroHeading)}</h1>
              </td>
            </tr>
            <tr><td bgcolor="${secondary}" style="padding:14px 30px;background:${secondary};font-family:Arial,sans-serif;font-size:14px;line-height:20px;color:#334155;">${escapeHtml(previewText)}</td></tr>
            <tr><td style="padding:26px 30px 6px;background:#ffffff;">${textToHtml(values.intro_text, values)}</td></tr>
            <tr><td style="padding:0 30px 6px;background:#ffffff;">${textToHtml(values.main_body, values)}</td></tr>
            ${ctaHtml}
            <tr>
              <td style="padding:22px 30px 30px;background:#f8fafc;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#64748b;">
                ${textToHtml(values.footer, values)}
                ${values.social_links ? `<p style="margin:10px 0 0;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#64748b;">${escapeHtml(values.social_links)}</p>` : ""}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function previewTemplate(body = {}) {
  const values = normalizeValues(templateInput(body));
  return {
    preview: {
      subject: replaceTextPlaceholders(values.default_subject, values),
      preview_text: replaceTextPlaceholders(values.preview_text, values),
      html: renderEmailHtml(values),
    },
  };
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

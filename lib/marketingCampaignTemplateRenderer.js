const BLOCK_TYPES = new Set(["text", "manual_image", "button", "divider", "spacer", "vehicle_grid"]);
const ALIGNMENTS = new Set(["left", "centre", "right"]);
const TEXT_ALIGNMENTS = new Set(["left", "centre"]);
const PADDING_SIZES = new Set(["small", "medium", "large"]);
const IMAGE_WIDTHS = new Set(["full", "contained", "half"]);
const BUTTON_WIDTHS = new Set(["auto", "full"]);
const VEHICLE_LAYOUTS = new Set(["one_column", "two_column"]);
const VEHICLE_SOURCE_MODES = new Set(["selected", "newest", "manual"]);
const VEHICLE_PRODUCT_MODES = new Set(["finance", "rent2buy"]);
const MASTER_LAYOUTS = new Set(["new_stock", "finance_offer", "rent2buy", "weekend_offer", "re_engagement", "newsletter", "custom_blank"]);
const VEHICLE_GRID_TOKEN = "%%MARKETING_TRUSTED_VEHICLE_GRID_TOKEN%%";

const SAMPLE_VEHICLES = [
  { name: "Ford Transit Custom Limited", price: "16995", mileage: "42,000 miles" },
  { name: "Volkswagen Transporter Highline", price: "18995", mileage: "36,500 miles" },
  { name: "Mercedes-Benz Vito Premium", price: "21995", mileage: "29,000 miles" },
];

export class CampaignValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "CampaignValidationError";
    this.statusCode = 400;
  }
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

export function cleanText(value, limit = 5000) {
  const text = String(value || "").trim();
  if (text.length > limit) throw new CampaignValidationError("Submitted text is too long.");
  return text;
}

function requireText(value, label, limit = 300) {
  const text = cleanText(value, limit);
  if (!text) throw new CampaignValidationError(`${label} is required.`);
  return text;
}

function cleanColour(value, fallback = "#2563eb") {
  const colour = String(value || fallback).trim();
  return /^#[0-9a-fA-F]{6}$/.test(colour) ? colour : fallback;
}

function requireColour(value, label) {
  const colour = String(value || "").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(colour)) throw new CampaignValidationError(`${label} must be a six-digit hex colour.`);
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
    throw new CampaignValidationError(`${label} must be a valid absolute HTTPS URL.`);
  }
}

function requireChoice(value, allowed, label, fallback = "") {
  const text = cleanText(value || fallback, 60);
  if (!allowed.has(text)) throw new CampaignValidationError(`${label} is not supported.`);
  return text;
}

function requireInteger(value, label, options = {}) {
  const { allowed = null, min = 1, max = 1000 } = options;
  const isStringInteger = typeof value === "string" && /^\d+$/.test(value.trim());
  const isNumberInteger = typeof value === "number" && Number.isInteger(value);
  if (!isStringInteger && !isNumberInteger) throw new CampaignValidationError(`${label} must be a whole number.`);
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) throw new CampaignValidationError(`${label} must be a whole number.`);
  if (allowed && !allowed.includes(number)) throw new CampaignValidationError(`${label} is not supported.`);
  if (number < min || number > max) throw new CampaignValidationError(`${label} must be between ${min} and ${max}.`);
  return number;
}

function requireBlockId(value) {
  if (typeof value !== "string") throw new CampaignValidationError("Content block id must be a string.");
  const id = value.trim();
  if (!id) throw new CampaignValidationError("Content block id is required.");
  if (id.length > 120) throw new CampaignValidationError("Content block id is too long.");
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new CampaignValidationError("Content block id may only contain letters, numbers, underscores and hyphens.");
  return id;
}

function normalizeProfileText(value, label, limit = 300) {
  const text = String(value || "").trim();
  if (text.length > limit) throw new CampaignValidationError(`${label} is too long.`);
  return text;
}

function normalizeFinanceSnapshot(value, enabled) {
  if (!isPlainObject(value)) throw new CampaignValidationError("Finance vehicle pricing must be an object.");
  const finance = {
    price: normalizeProfileText(value.price, "Finance price", 120),
    vat: normalizeProfileText(value.vat, "Finance VAT", 80),
    monthly: normalizeProfileText(value.monthly, "Finance monthly payment", 120),
    url: cleanHttpsUrl(value.url, "Finance vehicle URL"),
  };
  if (enabled && !finance.url) throw new CampaignValidationError("Finance vehicle URL is required for selected Finance vehicles.");
  return finance;
}

function normalizeRentSnapshot(value, enabled) {
  if (!isPlainObject(value)) throw new CampaignValidationError("Rent2Buy vehicle pricing must be an object.");
  const rent2buy = {
    monthly: normalizeProfileText(value.monthly, "Rent2Buy monthly payment", 120),
    initialRental: normalizeProfileText(value.initialRental, "Rent2Buy initial rental", 120),
    term: normalizeProfileText(value.term, "Rent2Buy term", 120),
    url: cleanHttpsUrl(value.url, "Rent2Buy vehicle URL"),
  };
  if (enabled && !rent2buy.url) throw new CampaignValidationError("Rent2Buy vehicle URL is required for selected Rent2Buy vehicles.");
  return rent2buy;
}

function normalizeFrozenSelectedVehicle(vehicle, productMode, enabled) {
  if (!isPlainObject(vehicle)) throw new CampaignValidationError("Each selected vehicle snapshot must be an object.");
  if (vehicle.snapshot_status && vehicle.snapshot_status !== "frozen") throw new CampaignValidationError("Campaign vehicle snapshots must already be frozen.");
  const snapshot = {
    snapshot_status: "frozen",
    selection_id: requireText(vehicle.selection_id, "Selected vehicle selection_id", 160),
    source_id: normalizeProfileText(vehicle.source_id, "Selected vehicle source_id", 160),
    registration: normalizeProfileText(vehicle.registration, "Selected vehicle registration", 40),
    title: normalizeProfileText(vehicle.title, "Selected vehicle title", 300),
    description: normalizeProfileText(vehicle.description, "Selected vehicle description", 1000),
    spec: normalizeProfileText(vehicle.spec, "Selected vehicle spec", 1000),
    primary_image_url: cleanHttpsUrl(vehicle.primary_image_url, "Selected vehicle image URL"),
    image_override_url: cleanHttpsUrl(vehicle.image_override_url, "Selected vehicle override image URL"),
    finance: null,
    rent2buy: null,
  };
  if (!snapshot.registration && !snapshot.title) throw new CampaignValidationError("Selected vehicle registration or title is required.");
  if (productMode === "finance") {
    if (!vehicle.finance || vehicle.rent2buy) throw new CampaignValidationError("Finance vehicle grids require finance pricing and must not include Rent2Buy pricing.");
    snapshot.finance = normalizeFinanceSnapshot(vehicle.finance, enabled);
  } else {
    if (!vehicle.rent2buy || vehicle.finance) throw new CampaignValidationError("Rent2Buy vehicle grids require Rent2Buy pricing and must not include Finance pricing.");
    snapshot.rent2buy = normalizeRentSnapshot(vehicle.rent2buy, enabled);
  }
  return snapshot;
}

function normalizeSelectedVehicles(value, productMode, enabled) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new CampaignValidationError("Vehicle grid selected_vehicles must be an array.");
  if (value.length > 6) throw new CampaignValidationError("Vehicle grid can contain a maximum of 6 selected vehicles.");
  const seen = new Set();
  return value.map((vehicle) => {
    const normalized = normalizeFrozenSelectedVehicle(vehicle, productMode, enabled);
    if (seen.has(normalized.selection_id)) throw new CampaignValidationError("Selected vehicle references must be unique.");
    seen.add(normalized.selection_id);
    return normalized;
  });
}

function normalizeBlockSettings(type, settings = {}, enabled = true) {
  if (!isPlainObject(settings)) throw new CampaignValidationError("Block settings must be an object.");
  if (type === "text") {
    return {
      heading: cleanText(settings.heading, 300),
      body: cleanText(settings.body, 8000),
      alignment: requireChoice(settings.alignment, TEXT_ALIGNMENTS, "Text block alignment"),
      background_colour: requireColour(settings.background_colour, "Text block background colour"),
      text_colour: requireColour(settings.text_colour, "Text block text colour"),
      padding_size: requireChoice(settings.padding_size, PADDING_SIZES, "Text block padding"),
    };
  }
  if (type === "manual_image") {
    const imageUrl = cleanHttpsUrl(settings.image_url, "Image URL");
    const altText = cleanText(settings.alt_text, 200);
    if (enabled && !imageUrl) throw new CampaignValidationError("Image URL is required for enabled promotional image blocks.");
    if (enabled && !altText) throw new CampaignValidationError("Alt text is required for enabled promotional image blocks.");
    return {
      image_url: imageUrl,
      alt_text: altText,
      link_url: cleanHttpsUrl(settings.link_url, "Image link URL"),
      heading: cleanText(settings.heading, 300),
      caption: cleanText(settings.caption, 500),
      width: requireChoice(settings.width, IMAGE_WIDTHS, "Image block width"),
      alignment: requireChoice(settings.alignment, ALIGNMENTS, "Image block alignment"),
      background_colour: requireColour(settings.background_colour, "Image block background colour"),
      padding_size: requireChoice(settings.padding_size, PADDING_SIZES, "Image block padding"),
    };
  }
  if (type === "button") {
    const text = cleanText(settings.text, 120);
    const url = cleanHttpsUrl(settings.url, "Button URL");
    if (enabled && !text) throw new CampaignValidationError("Button text is required for enabled button blocks.");
    if (enabled && !url) throw new CampaignValidationError("Button URL is required for enabled button blocks.");
    return {
      text,
      url,
      alignment: requireChoice(settings.alignment, ALIGNMENTS, "Button alignment"),
      primary_colour: requireColour(settings.primary_colour, "Button colour"),
      text_colour: requireColour(settings.text_colour, "Button text colour"),
      width: requireChoice(settings.width, BUTTON_WIDTHS, "Button width"),
    };
  }
  if (type === "divider") {
    return {
      colour: requireColour(settings.colour, "Divider colour"),
      thickness: requireInteger(settings.thickness, "Divider thickness", { allowed: [1, 2, 3], min: 1, max: 3 }),
      width_percentage: requireInteger(settings.width_percentage, "Divider width percentage", { min: 10, max: 100 }),
      spacing: requireInteger(settings.spacing, "Divider spacing", { allowed: [8, 16, 24, 32], min: 8, max: 32 }),
    };
  }
  if (type === "spacer") return { height: requireInteger(settings.height, "Spacer height", { allowed: [8, 16, 24, 32, 48], min: 8, max: 48 }) };
  if (type === "vehicle_grid") {
    const productMode = requireChoice(settings.product_mode || "finance", VEHICLE_PRODUCT_MODES, "Vehicle grid product mode");
    const sourceMode = requireChoice(settings.source_mode || "selected", VEHICLE_SOURCE_MODES, "Vehicle grid source mode");
    const selectedVehicles = normalizeSelectedVehicles(settings.selected_vehicles || [], productMode, enabled && sourceMode === "selected");
    const selectedCount = selectedVehicles.length;
    return {
      heading: cleanText(settings.heading, 300),
      intro_text: cleanText(settings.intro_text, 1000),
      number_of_vehicles: selectedCount || requireInteger(settings.number_of_vehicles || 3, "Vehicle grid number of vehicles", { min: 1, max: 6 }),
      layout: requireChoice(settings.layout || "one_column", VEHICLE_LAYOUTS, "Vehicle grid layout"),
      source_mode: sourceMode,
      product_mode: productMode,
      selected_vehicles: selectedVehicles,
      placeholder_note: cleanText(settings.placeholder_note, 500),
      top_padding: requireInteger(settings.top_padding ?? 24, "Vehicle grid top padding", { allowed: [0, 8, 16, 24], min: 0, max: 24 }),
    };
  }
  throw new CampaignValidationError("Unsupported content block type.");
}

export function normalizeContentBlocks(value = []) {
  if (!Array.isArray(value)) throw new CampaignValidationError("content_blocks must be an array.");
  if (value.length > 50) throw new CampaignValidationError("Campaign snapshots can contain a maximum of 50 content blocks.");
  const seenIds = new Set();
  const seenPositions = new Set();
  const normalized = value.map((block) => {
    if (!isPlainObject(block)) throw new CampaignValidationError("Each content block must be an object.");
    const id = requireBlockId(block.id);
    if (seenIds.has(id)) throw new CampaignValidationError("Content block ids must be unique within a campaign snapshot.");
    seenIds.add(id);
    const type = cleanText(block.type, 40);
    if (!BLOCK_TYPES.has(type)) throw new CampaignValidationError("Unsupported content block type.");
    if (typeof block.enabled !== "boolean") throw new CampaignValidationError("Content block enabled must be true or false.");
    const position = requireInteger(block.position, "Content block position", { min: 1, max: 50 });
    if (seenPositions.has(position)) throw new CampaignValidationError("Content block positions must be unique.");
    seenPositions.add(position);
    return { id, type, position, enabled: block.enabled, settings: normalizeBlockSettings(type, block.settings, block.enabled) };
  });
  return normalized.sort((a, b) => a.position - b.position).map((block, index) => ({ ...block, position: index + 1 }));
}

export function normalizeTemplateSnapshot(value = {}) {
  if (!isPlainObject(value)) throw new CampaignValidationError("Campaign template_snapshot must be a JSON object.");
  const snapshot = {
    snapshot_version: 1,
    source_template_id: cleanText(value.source_template_id, 120),
    source_template_updated_at: cleanText(value.source_template_updated_at, 80),
    name: requireText(value.name, "Snapshot template name", 200),
    category: cleanText(value.category || "custom", 60),
    default_subject: requireText(value.default_subject, "Snapshot subject", 300),
    preview_text: cleanText(value.preview_text, 300),
    header_logo: cleanHttpsUrl(value.header_logo, "Header logo"),
    hero_heading: cleanText(value.hero_heading, 300),
    intro_text: cleanText(value.intro_text, 2000),
    main_body: cleanText(value.main_body, 12000),
    cta_text: cleanText(value.cta_text, 120),
    cta_url: cleanHttpsUrl(value.cta_url, "CTA URL"),
    footer: cleanText(value.footer, 2000),
    brand_colour: requireColour(value.brand_colour || "#2563eb", "Brand colour"),
    secondary_colour: requireColour(value.secondary_colour || "#eef2ff", "Secondary colour"),
    company_name: requireText(value.company_name || "Van Finance Company", "Company name", 200),
    social_links: cleanText(value.social_links, 1000),
    master_layout: requireChoice(value.master_layout || "custom_blank", MASTER_LAYOUTS, "Master layout"),
    content_blocks: normalizeContentBlocks(value.content_blocks || []),
  };
  return snapshot;
}

export function buildTemplateSnapshotFromTemplate(template = {}) {
  return normalizeTemplateSnapshot({
    snapshot_version: 1,
    source_template_id: template.id || "",
    source_template_updated_at: template.updated_at || "",
    name: template.name || "",
    category: template.category || "custom",
    default_subject: template.default_subject || "",
    preview_text: template.preview_text || "",
    header_logo: template.header_logo || "",
    hero_heading: template.hero_heading || "",
    intro_text: template.intro_text || "",
    main_body: template.main_body || "",
    cta_text: template.cta_text || "",
    cta_url: template.cta_url || "",
    footer: template.footer || "",
    brand_colour: template.brand_colour || "#2563eb",
    secondary_colour: template.secondary_colour || "#eef2ff",
    company_name: template.company_name || "Van Finance Company",
    social_links: template.social_links || "",
    master_layout: template.master_layout || "custom_blank",
    content_blocks: Array.isArray(template.content_blocks) ? template.content_blocks : [],
  });
}

export function countSelectedVehicles(snapshot = {}) {
  return (snapshot.content_blocks || []).reduce((count, block) => {
    if (block.type !== "vehicle_grid") return count;
    return count + (Array.isArray(block.settings?.selected_vehicles) ? block.settings.selected_vehicles.length : 0);
  }, 0);
}

export function cloneSnapshot(snapshot = {}) {
  return JSON.parse(JSON.stringify(normalizeTemplateSnapshot(snapshot)));
}

export function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function sampleData(values = {}) {
  return {
    campaign_name: cleanText(values.campaign_name || "July New Stock", 300),
    first_name: cleanText(values.first_name || "there", 200),
    company: cleanText(values.company || values.company_name || "Van Finance Company", 300),
    vehicle_count: cleanText(values.vehicle_count || "3", 20),
    vehicle_grid: cleanText(values.vehicle_grid || "[Vehicle grid preview]", 500),
  };
}

export function replaceTextPlaceholders(value, values = {}) {
  const replacements = sampleData(values);
  return String(value || "").replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (match, key) => replacements[key] ?? match);
}

function renderEscapedTextBlock(value, colour = "#1f2937", align = "left") {
  const normalized = String(value || "").replace(/\r\n/g, "\n");
  if (!normalized.trim()) return "";
  return normalized
    .split(/\n{2,}/)
    .map((part, index, parts) => `<p class="email-body-copy" style="margin:0 0 ${index < parts.length - 1 ? 16 : 0}px;font-family:Arial,sans-serif;font-size:15px;line-height:23px;color:${colour};text-align:${align === "centre" ? "center" : "left"};">${part.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function compactLine(parts = [], separator = " | ") {
  return parts.map((part) => String(part || "").trim()).filter(Boolean).join(separator);
}

function selectedVehicleTitle(vehicle = {}) { return vehicle.title || vehicle.description || vehicle.registration || "Selected vehicle"; }
function selectedVehicleDescription(vehicle = {}) { return String(vehicle.description || "").trim(); }
function selectedVehicleSpec(vehicle = {}) { return String(vehicle.spec || "").trim(); }
function selectedVehicleImage(vehicle = {}) { return vehicle.image_override_url || vehicle.primary_image_url || ""; }
function selectedVehicleProfile(vehicle = {}, productMode = "finance") { return productMode === "rent2buy" ? vehicle.rent2buy || {} : vehicle.finance || {}; }
function financeMonthlyLine(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /^from\b/i.test(text) ? text : `FROM ${text}`;
}
function financeHeadline(profile = {}) {
  const cashLine = compactLine([String(profile.price || "").trim(), String(profile.vat || "").trim()], " ");
  return compactLine([cashLine, financeMonthlyLine(profile.monthly)]);
}
function rent2BuyMonthlyLine(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /monthly\s+(?:rent2buy\s+)?rental/i.test(text) ? text : `${text} monthly rental`;
}
function rent2BuySupportingLine(profile = {}) {
  return compactLine([
    profile.initialRental ? `Initial rental: ${profile.initialRental}` : "",
    profile.term ? `Term: ${profile.term}` : "",
  ]);
}
function isInternalVehicleGridMessage(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return new Set([
    "dummy vans are shown for preview only.",
    "selected vehicle names are saved now; live card rendering will be added later.",
    "selected vehicles render from saved snapshots.",
  ]).has(normalized);
}

function renderVehicleImageCell(vehicle, href) {
  const imageUrl = selectedVehicleImage(vehicle);
  const alt = selectedVehicleTitle(vehicle);
  if (!imageUrl) return `<tr><td class="email-vehicle-detail" align="center" bgcolor="#e2e8f0" style="padding:30px 12px;font-family:Arial,sans-serif;font-size:13px;line-height:18px;color:#475569;">Vehicle image</td></tr>`;
  const image = `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(alt)}" width="280" style="display:block;width:100%;max-width:280px;height:auto;border:0;outline:none;text-decoration:none;">`;
  return `<tr><td align="center" bgcolor="#f1f5f9" style="padding:0;">${href ? `<a href="${escapeHtml(href)}" style="text-decoration:none;border:0;">${image}</a>` : image}</td></tr>`;
}

function renderSelectedVehicleCard(vehicle = {}, productMode = "finance", primaryColour) {
  const profile = selectedVehicleProfile(vehicle, productMode);
  const href = profile.url || "";
  const title = selectedVehicleTitle(vehicle);
  const description = selectedVehicleDescription(vehicle);
  const spec = selectedVehicleSpec(vehicle);
  const fallbackRegistration = !vehicle.title && vehicle.registration ? vehicle.registration : "";
  const isRent2Buy = productMode === "rent2buy";
  const headline = isRent2Buy ? rent2BuyMonthlyLine(profile.monthly) : financeHeadline(profile);
  const fixedLine = isRent2Buy ? "NO CREDIT CHECK" : `FROM ${String.fromCharCode(163)}99 DEPOSIT`;
  const supporting = isRent2Buy ? rent2BuySupportingLine(profile) : "";
  const ctaText = isRent2Buy ? "View Rent2Buy van" : "View van";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #dbe2ea;background:#ffffff;">
    ${renderVehicleImageCell(vehicle, href)}
    ${headline ? `<tr><td style="padding:14px 14px 2px;font-family:Arial,sans-serif;font-size:22px;line-height:27px;color:#0f172a;font-weight:bold;">${escapeHtml(headline)}</td></tr>` : ""}
    <tr><td class="email-vehicle-detail" style="padding:${headline ? "0" : "14px"} 14px 8px;font-family:Arial,sans-serif;font-size:12px;line-height:17px;color:#2563eb;font-weight:bold;letter-spacing:0.04em;text-transform:uppercase;">${escapeHtml(fixedLine)}</td></tr>
    <tr><td style="padding:0 14px 4px;font-family:Arial,sans-serif;font-size:16px;line-height:21px;color:#0f172a;font-weight:bold;">${escapeHtml(title)}</td></tr>
    ${description ? `<tr><td class="email-vehicle-detail" style="padding:0 14px 5px;font-family:Arial,sans-serif;font-size:13px;line-height:19px;color:#475569;">${escapeHtml(description)}</td></tr>` : ""}
    ${spec ? `<tr><td class="email-vehicle-detail" style="padding:0 14px 8px;font-family:Arial,sans-serif;font-size:13px;line-height:19px;color:#475569;">${escapeHtml(spec)}</td></tr>` : ""}
    ${supporting ? `<tr><td class="email-vehicle-detail" style="padding:0 14px 8px;font-family:Arial,sans-serif;font-size:13px;line-height:19px;color:#334155;">${escapeHtml(supporting)}</td></tr>` : ""}
    ${fallbackRegistration ? `<tr><td class="email-vehicle-detail" style="padding:0 14px 8px;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#64748b;">Reg: ${escapeHtml(fallbackRegistration)}</td></tr>` : ""}
    ${href ? `<tr><td style="padding:2px 14px 16px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${primaryColour}" style="border-radius:7px;"><a class="email-button-text" href="${escapeHtml(href)}" style="display:inline-block;padding:10px 13px;font-family:Arial,sans-serif;font-size:13px;line-height:18px;color:#ffffff;text-decoration:none;font-weight:bold;">${escapeHtml(ctaText)}</a></td></tr></table></td></tr>` : ""}
  </table>`;
}

function renderVehicleRows(cards, twoColumn) {
  const rows = [];
  for (let index = 0; index < cards.length; index += twoColumn ? 2 : 1) {
    rows.push(`<tr>${cards.slice(index, index + (twoColumn ? 2 : 1)).join("")}${twoColumn && !cards[index + 1] ? '<td width="50%" valign="top" style="padding:8px;"></td>' : ""}</tr>`);
  }
  return rows.join("");
}

function renderPlaceholderVehicleGrid(settings = {}, primaryColour) {
  const count = Math.max(1, Math.min(6, Number(settings.number_of_vehicles || 3)));
  const vehicles = SAMPLE_VEHICLES.slice(0, count);
  while (vehicles.length < count) vehicles.push(SAMPLE_VEHICLES[vehicles.length % SAMPLE_VEHICLES.length]);
  const twoColumn = settings.layout === "two_column";
  const cards = vehicles.map((vehicle) => `
    <td width="${twoColumn ? "50%" : "100%"}" valign="top" style="padding:8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #dbe2ea;background:#f8fafc;">
        <tr><td class="email-vehicle-detail" align="center" bgcolor="#e2e8f0" style="padding:22px 12px;font-family:Arial,sans-serif;font-size:13px;line-height:18px;color:#475569;">Vehicle image placeholder</td></tr>
        <tr><td style="padding:13px 12px 4px;font-family:Arial,sans-serif;font-size:15px;line-height:20px;color:#0f172a;font-weight:bold;">${escapeHtml(vehicle.name)}</td></tr>
        <tr><td class="email-vehicle-detail" style="padding:0 12px;font-family:Arial,sans-serif;font-size:13px;line-height:20px;color:#64748b;">${escapeHtml(vehicle.mileage)}</td></tr>
        <tr><td style="padding:3px 12px 10px;font-family:Arial,sans-serif;font-size:16px;line-height:22px;color:#0f172a;font-weight:bold;">&#163;${escapeHtml(vehicle.price)}</td></tr>
        <tr><td style="padding:0 12px 14px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${primaryColour}" style="border-radius:7px;"><a class="email-button-text" href="https://www.vanfinancecompany.co.uk" style="display:inline-block;padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;line-height:18px;color:#ffffff;text-decoration:none;font-weight:bold;">View Van</a></td></tr></table></td></tr>
      </table>
    </td>
  `);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:10px 0;">${renderVehicleRows(cards, twoColumn)}</table>`;
}

function renderSelectedVehicleGrid(settings = {}, primaryColour) {
  const selected = Array.isArray(settings.selected_vehicles) ? settings.selected_vehicles : [];
  const productMode = settings.product_mode === "rent2buy" ? "rent2buy" : "finance";
  const twoColumn = settings.layout === "two_column";
  const cards = selected.map((vehicle) => `<td width="${twoColumn ? "50%" : "100%"}" valign="top" style="padding:8px;">${renderSelectedVehicleCard(vehicle, productMode, primaryColour)}</td>`);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:10px 0;">${renderVehicleRows(cards, twoColumn)}</table>`;
}

function renderVehicleGrid(settings = {}, primaryColour) {
  const selected = Array.isArray(settings.selected_vehicles) ? settings.selected_vehicles : [];
  if (settings.source_mode === "selected" && selected.length) return renderSelectedVehicleGrid(settings, primaryColour);
  return renderPlaceholderVehicleGrid(settings, primaryColour);
}

function textToHtml(value, values = {}) {
  const withVehicleToken = String(value || "").replace(/{{\s*vehicle_grid\s*}}/g, VEHICLE_GRID_TOKEN);
  const withTextPlaceholders = replaceTextPlaceholders(withVehicleToken, values);
  return escapeHtml(withTextPlaceholders)
    .split(VEHICLE_GRID_TOKEN)
    .map((part, index, parts) => `${renderEscapedTextBlock(part)}${index < parts.length - 1 ? renderVehicleGrid({ number_of_vehicles: 3, layout: "one_column" }, cleanColour(values.brand_colour, "#2563eb")) : ""}`)
    .join("");
}

function paddingPixels(size) { return size === "small" ? 14 : size === "large" ? 30 : 22; }

function renderTextBlock(block, values, context = {}) {
  const s = block.settings;
  const padding = paddingPixels(s.padding_size);
  const topPadding = context.previousType === "button" ? 10 : padding;
  const bottomPadding = context.nextType === "vehicle_grid" ? 12 : padding;
  const heading = replaceTextPlaceholders(s.heading, values);
  const body = replaceTextPlaceholders(s.body, values);
  return `<tr><td bgcolor="${s.background_colour}" style="padding:${topPadding}px 30px ${bottomPadding}px;background:${s.background_colour};">
    ${heading ? `<h2 style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:23px;line-height:29px;color:${s.text_colour};text-align:${s.alignment === "centre" ? "center" : "left"};">${escapeHtml(heading)}</h2>` : ""}
    ${renderEscapedTextBlock(escapeHtml(body), s.text_colour, s.alignment)}
  </td></tr>`;
}

function renderManualImageBlock(block, values) {
  const s = block.settings;
  if (!s.image_url) return "";
  const padding = paddingPixels(s.padding_size);
  const heading = replaceTextPlaceholders(s.heading, values);
  const caption = replaceTextPlaceholders(s.caption, values);
  const width = s.width === "half" ? 320 : s.width === "contained" ? 520 : 600;
  const image = `<img src="${escapeHtml(s.image_url)}" alt="${escapeHtml(s.alt_text)}" width="${width}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none;">`;
  const linkedImage = s.link_url ? `<a href="${escapeHtml(s.link_url)}" style="text-decoration:none;border:0;">${image}</a>` : image;
  return `<tr><td bgcolor="${s.background_colour}" align="${s.alignment === "right" ? "right" : s.alignment === "left" ? "left" : "center"}" style="padding:${padding}px 30px;background:${s.background_colour};">
    ${heading ? `<h2 style="margin:0 0 12px;font-family:Arial,sans-serif;font-size:22px;line-height:28px;color:#0f172a;">${escapeHtml(heading)}</h2>` : ""}
    ${linkedImage}
    ${caption ? `<p class="email-support-copy" style="margin:10px 0 0;font-family:Arial,sans-serif;font-size:13px;line-height:19px;color:#64748b;">${escapeHtml(caption)}</p>` : ""}
  </td></tr>`;
}

function renderButtonBlock(block, values, context = {}) {
  const s = block.settings;
  if (!s.text || !s.url) return "";
  const text = replaceTextPlaceholders(s.text, values);
  const full = s.width === "full";
  const bottomPadding = context.nextType === "text" ? 10 : 26;
  return `<tr><td align="${s.alignment === "right" ? "right" : s.alignment === "centre" ? "center" : "left"}" style="padding:8px 30px ${bottomPadding}px;background:#ffffff;">
    <table role="presentation" ${full ? 'width="100%"' : ""} cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${s.primary_colour}" align="center" style="border-radius:8px;"><a class="email-button-text" href="${escapeHtml(s.url)}" style="display:inline-block;${full ? "width:100%;" : ""}padding:13px 19px;font-family:Arial,sans-serif;font-size:15px;line-height:20px;color:${s.text_colour};text-decoration:none;font-weight:bold;">${escapeHtml(text)}</a></td></tr></table>
  </td></tr>`;
}

function renderDividerBlock(block) {
  const s = block.settings;
  return `<tr><td align="center" style="padding:${s.spacing}px 30px;background:#ffffff;"><table role="presentation" width="${s.width_percentage}%" cellpadding="0" cellspacing="0" border="0"><tr><td height="${s.thickness}" bgcolor="${s.colour}" style="font-size:0;line-height:0;background:${s.colour};">&nbsp;</td></tr></table></td></tr>`;
}
function renderSpacerBlock(block) { return `<tr><td height="${block.settings.height}" style="height:${block.settings.height}px;font-size:0;line-height:0;background:#ffffff;">&nbsp;</td></tr>`; }

function renderVehicleGridBlock(block, values, context = {}) {
  const s = block.settings;
  const selected = Array.isArray(s.selected_vehicles) ? s.selected_vehicles : [];
  const hasSelectedVehicles = s.source_mode === "selected" && selected.length > 0;
  const heading = replaceTextPlaceholders(s.heading, values);
  const rawIntro = replaceTextPlaceholders(s.intro_text, values);
  const intro = hasSelectedVehicles && isInternalVehicleGridMessage(rawIntro) ? "" : rawIntro;
  const rawPlaceholderNote = s.placeholder_note || "";
  const placeholderNote = hasSelectedVehicles && isInternalVehicleGridMessage(rawPlaceholderNote) ? "" : rawPlaceholderNote;
  const previewOnlyNote = hasSelectedVehicles ? "" : "Preview only: dummy vehicle cards are shown until vehicles are selected.";
  const configuredTopPadding = [0, 8, 16, 24].includes(Number(s.top_padding)) ? Number(s.top_padding) : 24;
  const topPadding = context.previousType === "text" ? 8 : configuredTopPadding;
  const bottomPadding = context.nextType === "button" ? 4 : 24;
  return `<tr><td style="padding:${topPadding}px 22px ${bottomPadding}px;background:#ffffff;">
    ${heading ? `<h2 style="margin:0 8px 8px;font-family:Arial,sans-serif;font-size:23px;line-height:29px;color:#0f172a;">${escapeHtml(heading)}</h2>` : ""}
    ${intro ? `<p class="email-support-copy" style="margin:0 8px 12px;font-family:Arial,sans-serif;font-size:15px;line-height:23px;color:#334155;">${escapeHtml(intro)}</p>` : ""}
    ${renderVehicleGrid(s, cleanColour(values.brand_colour, "#2563eb"))}
    ${previewOnlyNote ? `<p style="margin:8px 8px 0;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#64748b;">${escapeHtml(previewOnlyNote)}</p>` : ""}
    ${placeholderNote ? `<p style="margin:4px 8px 0;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#64748b;">${escapeHtml(placeholderNote)}</p>` : ""}
  </td></tr>`;
}

function renderContentBlocks(values = {}) {
  const blocks = (values.content_blocks || [])
    .filter((block) => block.enabled !== false)
    .sort((a, b) => a.position - b.position);
  return blocks
    .map((block, index) => {
      const context = { previousType: blocks[index - 1]?.type || "", nextType: blocks[index + 1]?.type || "" };
      if (block.type === "text") return renderTextBlock(block, values, context);
      if (block.type === "manual_image") return renderManualImageBlock(block, values);
      if (block.type === "button") return renderButtonBlock(block, values, context);
      if (block.type === "divider") return renderDividerBlock(block);
      if (block.type === "spacer") return renderSpacerBlock(block);
      if (block.type === "vehicle_grid") return renderVehicleGridBlock(block, values, context);
      return "";
    }).join("");
}

function renderLegacyBody(values = {}) {
  const ctaText = replaceTextPlaceholders(values.cta_text, values);
  const primary = cleanColour(values.brand_colour, "#2563eb");
  const ctaHtml = values.cta_text && values.cta_url ? `<tr><td align="left" style="padding:4px 30px 26px;background:#ffffff;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${primary}" style="border-radius:8px;"><a class="email-button-text" href="${escapeHtml(values.cta_url)}" style="display:inline-block;padding:13px 19px;font-family:Arial,sans-serif;font-size:15px;line-height:20px;color:#ffffff;text-decoration:none;font-weight:bold;">${escapeHtml(ctaText)}</a></td></tr></table></td></tr>` : "";
  return `<tr><td style="padding:26px 30px 6px;background:#ffffff;">${textToHtml(values.intro_text, values)}</td></tr><tr><td style="padding:0 30px 6px;background:#ffffff;">${textToHtml(values.main_body, values)}</td></tr>${ctaHtml}`;
}

export function renderEmailHtml(values = {}, personalizationValues = {}) {
  const snapshot = {
    ...normalizeTemplateSnapshot(values),
    ...personalizationValues,
    first_name: cleanText(personalizationValues.first_name ?? values.first_name, 200),
  };
  const subject = replaceTextPlaceholders(snapshot.default_subject, snapshot);
  const previewText = replaceTextPlaceholders(snapshot.preview_text, snapshot);
  const heroHeading = replaceTextPlaceholders(snapshot.hero_heading || snapshot.name, snapshot);
  const primary = cleanColour(snapshot.brand_colour, "#2563eb");
  const secondary = cleanColour(snapshot.secondary_colour, "#eef2ff");
  const companyName = snapshot.company_name || "Van Finance Company";
  const hasBlocks = Array.isArray(snapshot.content_blocks) && snapshot.content_blocks.length > 0;
  const logoHtml = snapshot.header_logo ? `<tr><td align="center" style="padding:22px 24px 14px;background:#ffffff;"><img src="${escapeHtml(snapshot.header_logo)}" alt="${escapeHtml(companyName)}" width="180" style="display:block;max-width:180px;width:100%;height:auto;border:0;outline:none;text-decoration:none;"></td></tr>` : `<tr><td align="center" style="padding:24px 24px 14px;background:#ffffff;font-family:Arial,sans-serif;font-size:20px;line-height:26px;color:#0f172a;font-weight:bold;">${escapeHtml(companyName)}</td></tr>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(subject)}</title><style type="text/css">
@media only screen and (max-width:600px) {
  .email-body-copy, .email-body-copy p, .email-body-copy ul, .email-body-copy ol, .email-body-copy li { font-size:16px !important; line-height:24px !important; }
  .email-support-copy { font-size:15px !important; line-height:23px !important; }
  .email-vehicle-detail { font-size:14px !important; line-height:21px !important; }
  .email-button-text { font-size:15px !important; line-height:20px !important; }
}
</style></head>
<body style="margin:0;padding:0;background:#eef3f8;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef3f8" style="width:100%;background:#eef3f8;border-collapse:collapse;"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" width="660" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:660px;background:#ffffff;border-collapse:collapse;border-radius:14px;overflow:hidden;">
${logoHtml}<tr><td bgcolor="${primary}" style="padding:34px 30px;background:${primary};"><p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:13px;line-height:18px;color:#ffffff;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;">${escapeHtml(companyName)}</p><h1 style="margin:0;font-family:Arial,sans-serif;font-size:34px;line-height:40px;color:#ffffff;font-weight:bold;">${escapeHtml(heroHeading)}</h1></td></tr>
<tr><td class="email-support-copy" bgcolor="${secondary}" style="padding:14px 30px;background:${secondary};font-family:Arial,sans-serif;font-size:14px;line-height:20px;color:#334155;">${escapeHtml(previewText)}</td></tr>
${hasBlocks ? renderContentBlocks(snapshot) : renderLegacyBody(snapshot)}
<tr><td style="padding:22px 30px 30px;background:#f8fafc;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#64748b;">${textToHtml(snapshot.footer, snapshot)}${snapshot.social_links ? `<p style="margin:10px 0 0;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#64748b;">${escapeHtml(snapshot.social_links)}</p>` : ""}</td></tr>
</table></td></tr></table></body></html>`;
}

export function renderCampaignPreview(campaign = {}, personalizationValues = {}) {
  const snapshot = normalizeTemplateSnapshot({
    ...(campaign.template_snapshot || {}),
    default_subject: campaign.subject_line || campaign.template_snapshot?.default_subject || "",
    preview_text: campaign.preview_text || campaign.template_snapshot?.preview_text || "",
  });
  const renderValues = { ...snapshot, ...personalizationValues };
  return {
    subject: replaceTextPlaceholders(snapshot.default_subject, renderValues),
    preview_text: replaceTextPlaceholders(snapshot.preview_text, renderValues),
    html: renderEmailHtml(snapshot, personalizationValues),
  };
}

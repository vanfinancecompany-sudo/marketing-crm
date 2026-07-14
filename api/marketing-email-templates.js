import { createClient } from "@supabase/supabase-js";
import {
  composeFinanceVehicleWithRent2Buy,
  mapFinanceVehicleRow,
  mapRentVehicleRow,
  normalizeRegistrationKey,
  toMarketingVehicleSelectionContract,
} from "../services/marketingVehicleContract.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const TEMPLATE_COLUMNS = "id,name,description,category,default_subject,preview_text,header_logo,hero_heading,intro_text,main_body,cta_text,cta_url,footer,brand_colour,company_name,secondary_colour,social_links,master_layout,content_blocks,status,created_by,created_at,updated_at,archived_at";
const CATEGORIES = new Set(["new_stock", "finance_offer", "rent2buy", "weekend_offer", "re_engagement", "custom"]);
const STATUSES = new Set(["draft", "active", "archived"]);
const EDITABLE_STATUSES = new Set(["draft", "active"]);
const MASTER_LAYOUTS = new Set(["new_stock", "finance_offer", "rent2buy", "weekend_offer", "re_engagement", "newsletter", "custom_blank"]);
const BLOCK_TYPES = new Set(["text", "manual_image", "button", "divider", "spacer", "vehicle_grid"]);
const ALIGNMENTS = new Set(["left", "centre", "right"]);
const TEXT_ALIGNMENTS = new Set(["left", "centre"]);
const PADDING_SIZES = new Set(["small", "medium", "large"]);
const IMAGE_WIDTHS = new Set(["full", "contained", "half"]);
const BUTTON_WIDTHS = new Set(["auto", "full"]);
const VEHICLE_LAYOUTS = new Set(["one_column", "two_column"]);
const VEHICLE_SOURCE_MODES = new Set(["selected", "newest", "manual"]);
const VEHICLE_PRODUCT_MODES = new Set(["finance", "rent2buy"]);
const VEHICLE_GRID_TOKEN = "%%MARKETING_TRUSTED_VEHICLE_GRID_TOKEN%%";
const STOCK_LIMIT = 500;

const SAMPLE_VEHICLES = [
  { name: "Ford Transit Custom Limited", price: "16995", mileage: "42,000 miles" },
  { name: "Volkswagen Transporter Highline", price: "18995", mileage: "36,500 miles" },
  { name: "Mercedes-Benz Vito Premium", price: "21995", mileage: "29,000 miles" },
];

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
    this.statusCode = 400;
  }
}

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

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
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
  if (!/^#[0-9a-fA-F]{6}$/.test(colour)) throw new ValidationError(`${label} must be a six-digit hex colour.`);
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
    throw new ValidationError(`${label} must be a valid absolute HTTPS URL.`);
  }
}

function normalizeCategory(value) {
  const category = cleanText(value || "custom", 40);
  if (!CATEGORIES.has(category)) throw new ValidationError("Unsupported template category.");
  return category;
}

function normalizeStatus(value) {
  const status = cleanText(value || "draft", 40);
  if (!STATUSES.has(status)) throw new ValidationError("Unsupported template status.");
  return status;
}

function normalizeMasterLayout(value) {
  const layout = cleanText(value || "custom_blank", 40);
  if (!MASTER_LAYOUTS.has(layout)) throw new ValidationError("Unsupported master layout.");
  return layout;
}

function requireChoice(value, allowed, label) {
  const text = cleanText(value, 40);
  if (!allowed.has(text)) throw new ValidationError(`${label} is not supported.`);
  return text;
}

function requireInteger(value, label, options = {}) {
  const { allowed = null, min = 1, max = 1000 } = options;
  const isStringInteger = typeof value === "string" && /^\d+$/.test(value.trim());
  const isNumberInteger = typeof value === "number" && Number.isInteger(value);
  if (!isStringInteger && !isNumberInteger) throw new ValidationError(`${label} must be a whole number.`);
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) throw new ValidationError(`${label} must be a whole number.`);
  if (allowed && !allowed.includes(number)) throw new ValidationError(`${label} is not supported.`);
  if (number < min || number > max) throw new ValidationError(`${label} must be between ${min} and ${max}.`);
  return number;
}

function requireBlockId(value) {
  if (typeof value !== "string") throw new ValidationError("Content block id must be a string.");
  const id = value.trim();
  if (!id) throw new ValidationError("Content block id is required.");
  if (id.length > 120) throw new ValidationError("Content block id is too long.");
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new ValidationError("Content block id may only contain letters, numbers, underscores and hyphens.");
  return id;
}

function generateBlockId() {
  if (globalThis.crypto?.randomUUID) return `block_${globalThis.crypto.randomUUID()}`;
  return `block_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeProfileText(value, label, limit = 300) {
  const text = String(value || "").trim();
  if (text.length > limit) throw new ValidationError(`${label} is too long.`);
  return text;
}

function frozenSelectionKey(productMode, selectionId) {
  return `${productMode}:${selectionId}`;
}

function selectionIdForVehicle(productMode, vehicle = {}) {
  const identity = vehicle.id || vehicle.source_id || vehicle.registration || vehicle.title || vehicle.name || "";
  return `${productMode}:${identity}`;
}

function cloneVehicleSnapshot(snapshot = {}) {
  return JSON.parse(JSON.stringify(snapshot));
}

function collectFrozenVehicleSnapshots(blocks = []) {
  const snapshots = new Map();
  (blocks || []).forEach((block) => {
    if (block?.type !== "vehicle_grid") return;
    const productMode = block.settings?.product_mode || "finance";
    (block.settings?.selected_vehicles || []).forEach((vehicle) => {
      if (vehicle?.selection_id) snapshots.set(frozenSelectionKey(productMode, vehicle.selection_id), cloneVehicleSnapshot(vehicle));
    });
  });
  return snapshots;
}

function normalizeFinanceSnapshot(value, enabled) {
  if (!isPlainObject(value)) throw new ValidationError("Finance vehicle pricing must be an object.");
  const finance = {
    price: normalizeProfileText(value.price, "Finance price", 120),
    vat: normalizeProfileText(value.vat, "Finance VAT", 80),
    monthly: normalizeProfileText(value.monthly, "Finance monthly payment", 120),
    url: cleanHttpsUrl(value.url, "Finance vehicle URL"),
  };
  if (enabled && !finance.url) throw new ValidationError("Finance vehicle URL is required for selected Finance vehicles.");
  return finance;
}

function normalizeRentSnapshot(value, enabled) {
  if (!isPlainObject(value)) throw new ValidationError("Rent2Buy vehicle pricing must be an object.");
  const rent2buy = {
    monthly: normalizeProfileText(value.monthly, "Rent2Buy monthly payment", 120),
    initialRental: normalizeProfileText(value.initialRental, "Rent2Buy initial rental", 120),
    term: normalizeProfileText(value.term, "Rent2Buy term", 120),
    url: cleanHttpsUrl(value.url, "Rent2Buy vehicle URL"),
  };
  if (enabled && !rent2buy.url) throw new ValidationError("Rent2Buy vehicle URL is required for selected Rent2Buy vehicles.");
  return rent2buy;
}

function normalizeFrozenSelectedVehicle(vehicle, productMode, enabled, options = {}) {
  const selectionId = normalizeProfileText(vehicle.selection_id, "Selected vehicle selection_id", 160);
  if (!selectionId) throw new ValidationError("Selected vehicle selection_id is required.");
  const existingSnapshot = options.existingFrozenSnapshots?.get(frozenSelectionKey(productMode, selectionId));
  if (existingSnapshot) return { ...cloneVehicleSnapshot(existingSnapshot), snapshot_status: "frozen" };
  if (!options.allowSubmittedFrozenSnapshots) throw new ValidationError("New selected vehicles must be selected from current stock.");
  const snapshot = {
    snapshot_status: "frozen",
    selection_id: selectionId,
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
  if (!snapshot.registration && !snapshot.title) throw new ValidationError("Selected vehicle registration or title is required.");
  if (productMode === "finance") {
    if (!vehicle.finance || vehicle.rent2buy) throw new ValidationError("Finance vehicle grids require finance pricing and must not include Rent2Buy pricing.");
    snapshot.finance = normalizeFinanceSnapshot(vehicle.finance, enabled);
  } else {
    if (!vehicle.rent2buy || vehicle.finance) throw new ValidationError("Rent2Buy vehicle grids require Rent2Buy pricing and must not include Finance pricing.");
    snapshot.rent2buy = normalizeRentSnapshot(vehicle.rent2buy, enabled);
  }
  return snapshot;
}

function shouldResolveSelectedVehicle(vehicle, options = {}) {
  if (vehicle.snapshot_status === "unresolved" || vehicle.requires_resolution === true) return true;
  if (vehicle.snapshot_status === "frozen") return false;
  if (options.allowUnmarkedFrozenSnapshots && (vehicle.finance || vehicle.rent2buy)) return false;
  return true;
}

function normalizeUnresolvedSelectedVehicle(vehicle, productMode) {
  const selectionId = normalizeProfileText(vehicle.selection_id, "Selected vehicle selection_id", 160);
  const sourceId = normalizeProfileText(vehicle.source_id, "Selected vehicle source_id", 160);
  const registration = normalizeProfileText(vehicle.registration, "Selected vehicle registration", 40);
  const lookupValue = selectionId || sourceId || registration;
  if (!lookupValue) throw new ValidationError("Selected vehicle reference is required.");
  return {
    snapshot_status: "unresolved",
    selection_id: selectionId,
    source_id: sourceId,
    registration,
    product_mode: productMode,
    image_override_url: cleanHttpsUrl(vehicle.image_override_url, "Selected vehicle override image URL"),
  };
}

function normalizeSelectedVehicles(value, productMode, enabled, options = {}) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ValidationError("Vehicle grid selected_vehicles must be an array.");
  if (value.length > 6) throw new ValidationError("Vehicle grid can contain a maximum of 6 selected vehicles.");
  const seen = new Set();
  return value.map((vehicle) => {
    if (!isPlainObject(vehicle)) throw new ValidationError("Each selected vehicle snapshot must be an object.");
    const normalized = shouldResolveSelectedVehicle(vehicle, options)
      ? normalizeUnresolvedSelectedVehicle(vehicle, productMode)
      : normalizeFrozenSelectedVehicle(vehicle, productMode, enabled, options);
    const uniqueKey = normalized.selection_id || `${productMode}:${normalized.source_id}` || `${productMode}:${normalizeRegistrationKey(normalized.registration)}`;
    if (!uniqueKey) throw new ValidationError("Selected vehicle reference is required.");
    if (seen.has(uniqueKey)) throw new ValidationError("Selected vehicle references must be unique.");
    seen.add(uniqueKey);
    return normalized;
  });
}

function normalizeBlockSettings(type, settings = {}, enabled = true, options = {}) {
  if (!isPlainObject(settings)) throw new ValidationError("Block settings must be an object.");
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
    if (enabled && !imageUrl) throw new ValidationError("Image URL is required for enabled promotional image blocks.");
    if (enabled && !altText) throw new ValidationError("Alt text is required for enabled promotional image blocks.");
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
    if (enabled && !text) throw new ValidationError("Button text is required for enabled button blocks.");
    if (enabled && !url) throw new ValidationError("Button URL is required for enabled button blocks.");
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
  if (type === "spacer") {
    return { height: requireInteger(settings.height, "Spacer height", { allowed: [8, 16, 24, 32, 48], min: 8, max: 48 }) };
  }
  if (type === "vehicle_grid") {
    const productMode = requireChoice(settings.product_mode || "finance", VEHICLE_PRODUCT_MODES, "Vehicle grid product mode");
    const sourceMode = requireChoice(settings.source_mode || "selected", VEHICLE_SOURCE_MODES, "Vehicle grid source mode");
    const selectedVehicles = normalizeSelectedVehicles(settings.selected_vehicles || [], productMode, enabled && sourceMode === "selected", options);
    if (enabled && sourceMode === "selected" && selectedVehicles.length > 6) throw new ValidationError("Vehicle grid can contain a maximum of 6 selected vehicles.");
    const selectedCount = selectedVehicles.length;
    const requestedCount = selectedCount || settings.number_of_vehicles || 3;
    return {
      heading: cleanText(settings.heading, 300),
      intro_text: cleanText(settings.intro_text, 1000),
      number_of_vehicles: selectedCount || requireInteger(requestedCount, "Vehicle grid number of vehicles", { min: 1, max: 6 }),
      layout: requireChoice(settings.layout || "one_column", VEHICLE_LAYOUTS, "Vehicle grid layout"),
      source_mode: sourceMode,
      product_mode: productMode,
      selected_vehicles: selectedVehicles,
      placeholder_note: cleanText(settings.placeholder_note, 500),
    };
  }
  throw new ValidationError("Unsupported content block type.");
}

function normalizeContentBlocks(value = [], options = {}) {
  const supplied = options.supplied ?? true;
  if (!supplied) return [];
  if (!Array.isArray(value)) throw new ValidationError("content_blocks must be an array.");
  if (value.length > 50) throw new ValidationError("Email templates can contain a maximum of 50 content blocks.");
  const seenIds = new Set();
  const seenPositions = new Set();
  const normalized = value.map((block) => {
    if (!isPlainObject(block)) throw new ValidationError("Each content block must be an object.");
    const id = requireBlockId(block.id);
    if (seenIds.has(id)) throw new ValidationError("Content block ids must be unique within a template.");
    seenIds.add(id);
    const type = cleanText(block.type, 40);
    if (!BLOCK_TYPES.has(type)) throw new ValidationError("Unsupported content block type.");
    if (typeof block.enabled !== "boolean") throw new ValidationError("Content block enabled must be true or false.");
    const position = requireInteger(block.position, "Content block position", { min: 1, max: 50 });
    if (seenPositions.has(position)) throw new ValidationError("Content block positions must be unique.");
    seenPositions.add(position);
    return {
      id,
      type,
      position,
      enabled: block.enabled,
      settings: normalizeBlockSettings(type, block.settings, block.enabled, options),
    };
  });
  return normalized.sort((a, b) => a.position - b.position).map((block, index) => ({ ...block, position: index + 1 }));
}

function cloneContentBlocks(blocks = []) {
  return normalizeContentBlocks(blocks, { allowSubmittedFrozenSnapshots: true, allowUnmarkedFrozenSnapshots: true }).map((block, index) => ({ ...block, id: generateBlockId(), position: index + 1 }));
}

function vehicleLookupCandidates(productMode, reference = {}) {
  const candidates = [];
  if (reference.selection_id) candidates.push(reference.selection_id);
  if (reference.source_id) candidates.push(`${productMode}:${reference.source_id}`);
  if (reference.registration) {
    candidates.push(`${productMode}:${reference.registration}`);
    const registrationKey = normalizeRegistrationKey(reference.registration);
    if (registrationKey) candidates.push(`${productMode}:reg:${registrationKey}`);
  }
  return candidates.filter(Boolean);
}

function buildVehicleSelectionLookup(vehicles = []) {
  const lookup = new Map();
  vehicles.forEach((vehicle) => {
    ["finance", "rent2buy"].forEach((productMode) => {
      const profile = vehicle[productMode];
      if (!profile || profile.eligible === false) return;
      const entries = [selectionIdForVehicle(productMode, vehicle)];
      if (vehicle.id) entries.push(`${productMode}:${vehicle.id}`);
      if (vehicle.registration) {
        entries.push(`${productMode}:${vehicle.registration}`);
        const registrationKey = normalizeRegistrationKey(vehicle.registration);
        if (registrationKey) entries.push(`${productMode}:reg:${registrationKey}`);
      }
      entries.filter(Boolean).forEach((key) => {
        if (!lookup.has(key)) lookup.set(key, vehicle);
      });
    });
  });
  return lookup;
}

function buildAuthoritativeSelectedVehicleSnapshot(reference, vehicle, productMode) {
  const profile = vehicle[productMode];
  if (!profile || profile.eligible === false) throw new ValidationError("Selected vehicle is not eligible for the chosen product mode.");
  const snapshot = {
    snapshot_status: "frozen",
    selection_id: normalizeProfileText(reference.selection_id || selectionIdForVehicle(productMode, vehicle), "Selected vehicle selection_id", 160),
    source_id: normalizeProfileText(vehicle.id || reference.source_id, "Selected vehicle source_id", 160),
    registration: normalizeProfileText(vehicle.registration || reference.registration, "Selected vehicle registration", 40),
    title: normalizeProfileText(vehicle.title || vehicle.name, "Selected vehicle title", 300),
    description: normalizeProfileText(vehicle.description || "", "Selected vehicle description", 1000),
    spec: normalizeProfileText(vehicle.spec || "", "Selected vehicle spec", 1000),
    primary_image_url: cleanHttpsUrl(vehicle.primaryImageUrl || vehicle.primary_image_url || vehicle.image_url || "", "Selected vehicle image URL"),
    image_override_url: cleanHttpsUrl(reference.image_override_url, "Selected vehicle override image URL"),
    finance: null,
    rent2buy: null,
  };
  if (!snapshot.registration && !snapshot.title) throw new ValidationError("Selected vehicle registration or title is required.");
  if (productMode === "finance") {
    snapshot.finance = normalizeFinanceSnapshot({
      price: profile.price,
      vat: profile.vat,
      monthly: profile.monthly,
      url: profile.url,
    }, true);
  } else {
    snapshot.rent2buy = normalizeRentSnapshot({
      monthly: profile.monthly,
      initialRental: profile.initialRental,
      term: profile.term,
      url: profile.url,
    }, true);
  }
  return snapshot;
}

async function resolveSelectedVehicleReferences(supabase, blocks = []) {
  const needsResolution = blocks.some((block) => block.type === "vehicle_grid" && (block.settings.selected_vehicles || []).some((vehicle) => vehicle.snapshot_status === "unresolved"));
  if (!needsResolution) return blocks;
  if (!supabase) throw new Error("Vehicle selection resolution requires Supabase access.");
  const { vehicles } = await vehiclesForSelection(supabase);
  const lookup = buildVehicleSelectionLookup(vehicles);
  return blocks.map((block) => {
    if (block.type !== "vehicle_grid") return block;
    const productMode = block.settings.product_mode;
    const resolvedSeen = new Set();
    const selectedVehicles = (block.settings.selected_vehicles || []).map((vehicle) => {
      const resolved = vehicle.snapshot_status === "unresolved"
        ? (() => {
            const sourceVehicle = vehicleLookupCandidates(productMode, vehicle).map((key) => lookup.get(key)).find(Boolean);
            if (!sourceVehicle) throw new ValidationError("Selected vehicle could not be found in current stock.");
            return buildAuthoritativeSelectedVehicleSnapshot(vehicle, sourceVehicle, productMode);
          })()
        : vehicle;
      if (resolvedSeen.has(resolved.selection_id)) throw new ValidationError("Selected vehicle references must be unique.");
      resolvedSeen.add(resolved.selection_id);
      return resolved;
    });
    return {
      ...block,
      settings: {
        ...block.settings,
        selected_vehicles: selectedVehicles,
        number_of_vehicles: selectedVehicles.length || block.settings.number_of_vehicles || 3,
      },
    };
  });
}

function validateTemplate(values) {
  if (!cleanText(values.name, 200)) throw new ValidationError("Template name is required.");
  if (!cleanText(values.default_subject, 300)) throw new ValidationError("Default subject is required.");
  if (!cleanText(values.company_name, 200)) throw new ValidationError("Company name is required.");
  if (values.status === "active") {
    const emptySelectedGrid = (values.content_blocks || []).find((block) => block.enabled !== false && block.type === "vehicle_grid" && block.settings.source_mode === "selected" && !block.settings.selected_vehicles.length);
    if (emptySelectedGrid) throw new ValidationError("Active templates cannot contain an enabled selected vehicle grid with no selected vehicles.");
  }
}

async function normalizeValues(values = {}, options = {}) {
  const contentBlocksSupplied = Object.prototype.hasOwnProperty.call(values, "content_blocks");
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
    content_blocks: normalizeContentBlocks(contentBlocksSupplied ? values.content_blocks : [], { supplied: true, ...options }),
    status: normalizeStatus(values.status),
  };
  if (options.resolveVehicleReferences) normalized.content_blocks = await resolveSelectedVehicleReferences(options.supabase, normalized.content_blocks);
  validateTemplate(normalized);
  if (!options.allowArchivedStatus && !EDITABLE_STATUSES.has(normalized.status)) throw new ValidationError("Use the Archive action to archive templates.");
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
    content_blocks: normalizeContentBlocks(row.content_blocks || [], { supplied: true, allowSubmittedFrozenSnapshots: true, allowUnmarkedFrozenSnapshots: true }),
    status: row.status || "draft",
    created_by: row.created_by || "",
    created_at: row.created_at || "",
    updated_at: row.updated_at || "",
    archived_at: row.archived_at || "",
  };
}

async function loadTemplate(supabase, id) {
  if (!id) throw new ValidationError("Template ID is required.");
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
  const values = await normalizeValues(templateInput(body), { supabase, resolveVehicleReferences: true });
  const { data } = assertSupabase(
    await supabase.from("marketing_email_templates").insert({ ...values, created_by: cleanText(body.createdBy || "Marketing CRM", 200) }).select(TEMPLATE_COLUMNS).single(),
    "Could not create email template."
  );
  return { template: normalizeTemplate(data) };
}

async function updateTemplate(supabase, body = {}) {
  const existing = await loadTemplate(supabase, body.template?.id || body.id);
  if (existing.status === "archived") throw new ValidationError("Archived templates are read only.");
  const existingFrozenSnapshots = collectFrozenVehicleSnapshots(existing.content_blocks);
  const values = await normalizeValues(templateInput(body), { supabase, resolveVehicleReferences: true, existingFrozenSnapshots });
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
  const existingFrozenSnapshots = collectFrozenVehicleSnapshots(existing.content_blocks);
  const { id, created_at, updated_at, archived_at, created_by, ...copy } = existing;
  const values = await normalizeValues({ ...copy, name: `Copy of ${existing.name}`, status: "draft", content_blocks: cloneContentBlocks(existing.content_blocks) }, { existingFrozenSnapshots });
  const { data } = assertSupabase(
    await supabase.from("marketing_email_templates").insert({ ...values, created_by: cleanText(body.createdBy || "Marketing CRM", 200) }).select(TEMPLATE_COLUMNS).single(),
    "Could not duplicate email template."
  );
  return { template: normalizeTemplate(data) };
}

async function vehiclesForSelection(supabase) {
  const [financeResult, rentResult] = await Promise.all([
    supabase.from("facebook_adverts").select("id, title, picture, price, vat, salePrice, vanDescription, vanSpec, weblink, is_active").eq("is_active", true).limit(STOCK_LIMIT),
    supabase.from("rent_vehicles").select("id, created_at, registration, picture, monthly, week, initialRental, vanDescription, vanSpec, webLink, is_active").eq("is_active", true).limit(STOCK_LIMIT),
  ]);
  assertSupabase(financeResult, "Could not load Finance stock.");
  assertSupabase(rentResult, "Could not load Rent2Buy stock.");
  const financeVehicles = (financeResult.data || []).map(mapFinanceVehicleRow);
  const rentVehicles = (rentResult.data || []).map(mapRentVehicleRow);
  const rentByReg = new Map(
    rentVehicles
      .map((vehicle) => [normalizeRegistrationKey(vehicle.reg || vehicle.registration || vehicle.title || vehicle.name), vehicle])
      .filter(([registration]) => registration)
  );
  const vehicles = financeVehicles.map((vehicle) => {
    const registration = normalizeRegistrationKey(vehicle.reg || vehicle.registration || vehicle.title || vehicle.name);
    return composeFinanceVehicleWithRent2Buy(vehicle, rentByReg.get(registration) || null);
  });
  return { vehicles: vehicles.map(toMarketingVehicleSelectionContract) };
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

function renderEscapedTextBlock(value, colour = "#1f2937", align = "left") {
  const normalized = String(value || "").replace(/\r\n/g, "\n");
  if (!normalized.trim()) return "";
  return normalized
    .split(/\n{2,}/)
    .map((part) => `<p style="margin:0 0 16px;font-family:Arial,sans-serif;font-size:15px;line-height:23px;color:${colour};text-align:${align === "centre" ? "center" : "left"};">${part.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function compactLine(parts = [], separator = " | ") {
  return parts.map((part) => String(part || "").trim()).filter(Boolean).join(separator);
}

function selectedVehicleTitle(vehicle = {}) {
  return vehicle.title || vehicle.description || vehicle.registration || "Selected vehicle";
}

function selectedVehicleDescription(vehicle = {}) {
  return String(vehicle.description || "").trim();
}

function selectedVehicleSpec(vehicle = {}) {
  return String(vehicle.spec || "").trim();
}

function selectedVehicleImage(vehicle = {}) {
  return vehicle.image_override_url || vehicle.primary_image_url || "";
}

function selectedVehicleProfile(vehicle = {}, productMode = "finance") {
  return productMode === "rent2buy" ? vehicle.rent2buy || {} : vehicle.finance || {};
}

function financeMonthlyLine(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /^from\b/i.test(text) ? text : `FROM ${text}`;
}

function financeHeadline(profile = {}) {
  const price = String(profile.price || "").trim();
  const vat = String(profile.vat || "").trim();
  const cashLine = compactLine([price, vat], " ");
  return compactLine([cashLine, financeMonthlyLine(profile.monthly)]);
}

function financePricePresentation(profile = {}) {
  const price = String(profile.price || "").trim();
  const vat = String(profile.vat || "").trim();
  return {
    fullPrice: compactLine([price, vat], " "),
    monthlyPayment: financeMonthlyLine(profile.monthly),
  };
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
  if (!imageUrl) {
    return `<tr><td align="center" bgcolor="#e2e8f0" style="padding:30px 12px;font-family:Arial,sans-serif;font-size:13px;line-height:18px;color:#475569;">Vehicle image</td></tr>`;
  }
  const image = `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(alt)}" width="280" style="display:block;width:100%;max-width:280px;height:auto;border:0;outline:none;text-decoration:none;">`;
  return `<tr><td align="center" bgcolor="#f1f5f9" style="padding:0;">${href ? `<a href="${escapeHtml(href)}" style="text-decoration:none;border:0;">${image}</a>` : image}</td></tr>`;
}

function renderSelectedVehicleCard(vehicle = {}, productMode = "finance") {
  const profile = selectedVehicleProfile(vehicle, productMode);
  const href = profile.url || "";
  const title = selectedVehicleTitle(vehicle);
  const description = selectedVehicleDescription(vehicle);
  const spec = selectedVehicleSpec(vehicle);
  const fallbackRegistration = !vehicle.title && vehicle.registration ? vehicle.registration : "";
  const isRent2Buy = productMode === "rent2buy";
  const financePricing = isRent2Buy ? null : financePricePresentation(profile);
  const fullPrice = isRent2Buy ? profile.monthly : financePricing.fullPrice || financePricing.monthlyPayment;
  const monthlyPayment = isRent2Buy || !financePricing.fullPrice ? "" : financePricing.monthlyPayment;
  const fixedLine = isRent2Buy ? "NO CREDIT CHECK" : `FROM ${String.fromCharCode(163)}99 DEPOSIT`;
  const supporting = isRent2Buy ? compactLine([profile.initialRental, profile.term]) : "";
  const ctaText = isRent2Buy ? "View Rent2Buy van" : "View van";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #dbe2ea;background:#ffffff;">
    ${renderVehicleImageCell(vehicle, href)}
    <tr><td style="padding:14px 14px 7px;font-family:Arial,sans-serif;font-size:16px;line-height:21px;color:#0f172a;font-weight:bold;">${escapeHtml(title)}</td></tr>
    ${fullPrice ? `<tr><td style="padding:0 14px 3px;font-family:Arial,sans-serif;font-size:22px;line-height:27px;color:#0f172a;font-weight:bold;">${escapeHtml(fullPrice)}</td></tr>` : ""}
    ${monthlyPayment ? `<tr><td style="padding:0 14px 8px;font-family:Arial,sans-serif;font-size:17px;line-height:22px;color:#334155;font-weight:normal;">${escapeHtml(monthlyPayment)}</td></tr>` : ""}
    <tr><td style="padding:0 14px 9px;font-family:Arial,sans-serif;font-size:12px;line-height:17px;color:#2563eb;font-weight:bold;letter-spacing:0.04em;text-transform:uppercase;">${escapeHtml(fixedLine)}</td></tr>
    ${description ? `<tr><td style="padding:0 14px 6px;font-family:Arial,sans-serif;font-size:13px;line-height:19px;color:#475569;">${escapeHtml(description)}</td></tr>` : ""}
    ${spec ? `<tr><td style="padding:0 14px 9px;font-family:Arial,sans-serif;font-size:13px;line-height:19px;color:#475569;">${escapeHtml(spec)}</td></tr>` : ""}
    ${supporting ? `<tr><td style="padding:0 14px 9px;font-family:Arial,sans-serif;font-size:13px;line-height:19px;color:#334155;">${escapeHtml(supporting)}</td></tr>` : ""}
    ${fallbackRegistration ? `<tr><td style="padding:0 14px 9px;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#64748b;">Reg: ${escapeHtml(fallbackRegistration)}</td></tr>` : ""}
    ${href ? `<tr><td style="padding:4px 14px 16px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#2563eb" style="border-radius:7px;"><a href="${escapeHtml(href)}" style="display:inline-block;padding:10px 13px;font-family:Arial,sans-serif;font-size:13px;line-height:18px;color:#ffffff;text-decoration:none;font-weight:bold;">${escapeHtml(ctaText)}</a></td></tr></table></td></tr>` : ""}
  </table>`;
}

function renderVehicleRows(cards, twoColumn) {
  const rows = [];
  for (let index = 0; index < cards.length; index += twoColumn ? 2 : 1) {
    rows.push(`<tr>${cards.slice(index, index + (twoColumn ? 2 : 1)).join("")}${twoColumn && !cards[index + 1] ? '<td width="50%" valign="top" style="padding:8px;"></td>' : ""}</tr>`);
  }
  return rows.join("");
}

function renderPlaceholderVehicleGrid(settings = {}) {
  const count = Math.max(1, Math.min(6, Number(settings.number_of_vehicles || 3)));
  const vehicles = SAMPLE_VEHICLES.slice(0, count);
  while (vehicles.length < count) vehicles.push(SAMPLE_VEHICLES[vehicles.length % SAMPLE_VEHICLES.length]);
  const twoColumn = settings.layout === "two_column";
  const cards = vehicles.map((vehicle) => `
    <td width="${twoColumn ? "50%" : "100%"}" valign="top" style="padding:8px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #dbe2ea;background:#f8fafc;">
        <tr><td align="center" bgcolor="#e2e8f0" style="padding:22px 12px;font-family:Arial,sans-serif;font-size:13px;line-height:18px;color:#475569;">Vehicle image placeholder</td></tr>
        <tr><td style="padding:14px 12px 7px;font-family:Arial,sans-serif;font-size:15px;line-height:20px;color:#0f172a;font-weight:bold;">${escapeHtml(vehicle.name)}</td></tr>
        <tr><td style="padding:0 12px 4px;font-family:Arial,sans-serif;font-size:22px;line-height:27px;color:#0f172a;font-weight:bold;">&#163;${escapeHtml(vehicle.price)}</td></tr>
        <tr><td style="padding:0 12px 11px;font-family:Arial,sans-serif;font-size:13px;line-height:20px;color:#64748b;">${escapeHtml(vehicle.mileage)}</td></tr>
        <tr><td style="padding:0 12px 15px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#2563eb" style="border-radius:7px;"><a href="https://www.vanfinancecompany.co.uk" style="display:inline-block;padding:10px 12px;font-family:Arial,sans-serif;font-size:13px;line-height:18px;color:#ffffff;text-decoration:none;font-weight:bold;">View Van</a></td></tr></table></td></tr>
      </table>
    </td>
  `);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:10px 0;">${renderVehicleRows(cards, twoColumn)}</table>`;
}

function renderSelectedVehicleGrid(settings = {}) {
  const selected = Array.isArray(settings.selected_vehicles) ? settings.selected_vehicles : [];
  const productMode = settings.product_mode === "rent2buy" ? "rent2buy" : "finance";
  const twoColumn = settings.layout === "two_column";
  const cards = selected.map((vehicle) => `
    <td width="${twoColumn ? "50%" : "100%"}" valign="top" style="padding:8px;">
      ${renderSelectedVehicleCard(vehicle, productMode)}
    </td>
  `);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:10px 0;">${renderVehicleRows(cards, twoColumn)}</table>`;
}

function renderVehicleGrid(settings = {}) {
  const selected = Array.isArray(settings.selected_vehicles) ? settings.selected_vehicles : [];
  if (settings.source_mode === "selected" && selected.length) return renderSelectedVehicleGrid(settings);
  return renderPlaceholderVehicleGrid(settings);
}

function textToHtml(value, values = {}) {
  const withVehicleToken = String(value || "").replace(/{{\s*vehicle_grid\s*}}/g, VEHICLE_GRID_TOKEN);
  const withTextPlaceholders = replaceTextPlaceholders(withVehicleToken, values);
  return escapeHtml(withTextPlaceholders)
    .split(VEHICLE_GRID_TOKEN)
    .map((part, index, parts) => `${renderEscapedTextBlock(part)}${index < parts.length - 1 ? renderVehicleGrid({ number_of_vehicles: 3, layout: "one_column" }) : ""}`)
    .join("");
}

function paddingPixels(size) {
  return size === "small" ? 14 : size === "large" ? 30 : 22;
}

function renderTextBlock(block, values) {
  const s = block.settings;
  const padding = paddingPixels(s.padding_size);
  const heading = replaceTextPlaceholders(s.heading, values);
  const body = replaceTextPlaceholders(s.body, values);
  return `<tr><td bgcolor="${s.background_colour}" style="padding:${padding}px 30px;background:${s.background_colour};">
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
    ${caption ? `<p style="margin:10px 0 0;font-family:Arial,sans-serif;font-size:13px;line-height:19px;color:#64748b;">${escapeHtml(caption)}</p>` : ""}
  </td></tr>`;
}

function renderButtonBlock(block, values) {
  const s = block.settings;
  if (!s.text || !s.url) return "";
  const text = replaceTextPlaceholders(s.text, values);
  const full = s.width === "full";
  return `<tr><td align="${s.alignment === "right" ? "right" : s.alignment === "centre" ? "center" : "left"}" style="padding:8px 30px 26px;background:#ffffff;">
    <table role="presentation" ${full ? 'width="100%"' : ""} cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${s.primary_colour}" align="center" style="border-radius:8px;"><a href="${escapeHtml(s.url)}" style="display:inline-block;${full ? "width:100%;" : ""}padding:13px 19px;font-family:Arial,sans-serif;font-size:15px;line-height:20px;color:${s.text_colour};text-decoration:none;font-weight:bold;">${escapeHtml(text)}</a></td></tr></table>
  </td></tr>`;
}

function renderDividerBlock(block) {
  const s = block.settings;
  return `<tr><td align="center" style="padding:${s.spacing}px 30px;background:#ffffff;"><table role="presentation" width="${s.width_percentage}%" cellpadding="0" cellspacing="0" border="0"><tr><td height="${s.thickness}" bgcolor="${s.colour}" style="font-size:0;line-height:0;background:${s.colour};">&nbsp;</td></tr></table></td></tr>`;
}

function renderSpacerBlock(block) {
  return `<tr><td height="${block.settings.height}" style="height:${block.settings.height}px;font-size:0;line-height:0;background:#ffffff;">&nbsp;</td></tr>`;
}

function renderVehicleGridBlock(block, values) {
  const s = block.settings;
  const selected = Array.isArray(s.selected_vehicles) ? s.selected_vehicles : [];
  const hasSelectedVehicles = s.source_mode === "selected" && selected.length > 0;
  const heading = replaceTextPlaceholders(s.heading, values);
  const rawIntro = replaceTextPlaceholders(s.intro_text, values);
  const intro = hasSelectedVehicles && isInternalVehicleGridMessage(rawIntro) ? "" : rawIntro;
  const rawPlaceholderNote = s.placeholder_note || "";
  const placeholderNote = hasSelectedVehicles && isInternalVehicleGridMessage(rawPlaceholderNote) ? "" : rawPlaceholderNote;
  const previewOnlyNote = hasSelectedVehicles ? "" : "Preview only: dummy vehicle cards are shown until vehicles are selected.";
  return `<tr><td style="padding:24px 22px;background:#ffffff;">
    ${heading ? `<h2 style="margin:0 8px 8px;font-family:Arial,sans-serif;font-size:23px;line-height:29px;color:#0f172a;">${escapeHtml(heading)}</h2>` : ""}
    ${intro ? `<p style="margin:0 8px 12px;font-family:Arial,sans-serif;font-size:15px;line-height:23px;color:#334155;">${escapeHtml(intro)}</p>` : ""}
    ${renderVehicleGrid(s)}
    ${previewOnlyNote ? `<p style="margin:8px 8px 0;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#64748b;">${escapeHtml(previewOnlyNote)}</p>` : ""}
    ${placeholderNote ? `<p style="margin:4px 8px 0;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#64748b;">${escapeHtml(placeholderNote)}</p>` : ""}
  </td></tr>`;
}

function renderContentBlocks(values = {}) {
  return (values.content_blocks || [])
    .filter((block) => block.enabled !== false)
    .sort((a, b) => a.position - b.position)
    .map((block) => {
      if (block.type === "text") return renderTextBlock(block, values);
      if (block.type === "manual_image") return renderManualImageBlock(block, values);
      if (block.type === "button") return renderButtonBlock(block, values);
      if (block.type === "divider") return renderDividerBlock(block);
      if (block.type === "spacer") return renderSpacerBlock(block);
      if (block.type === "vehicle_grid") return renderVehicleGridBlock(block, values);
      return "";
    })
    .join("");
}

function renderLegacyBody(values = {}) {
  const ctaText = replaceTextPlaceholders(values.cta_text, values);
  const primary = cleanColour(values.brand_colour, "#2563eb");
  const ctaHtml = values.cta_text && values.cta_url ? `
    <tr><td align="left" style="padding:4px 30px 26px;background:#ffffff;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${primary}" style="border-radius:8px;"><a href="${escapeHtml(values.cta_url)}" style="display:inline-block;padding:13px 19px;font-family:Arial,sans-serif;font-size:15px;line-height:20px;color:#ffffff;text-decoration:none;font-weight:bold;">${escapeHtml(ctaText)}</a></td></tr></table></td></tr>
  ` : "";
  return `
    <tr><td style="padding:26px 30px 6px;background:#ffffff;">${textToHtml(values.intro_text, values)}</td></tr>
    <tr><td style="padding:0 30px 6px;background:#ffffff;">${textToHtml(values.main_body, values)}</td></tr>
    ${ctaHtml}
  `;
}

function renderEmailHtml(values = {}) {
  const subject = replaceTextPlaceholders(values.default_subject, values);
  const previewText = replaceTextPlaceholders(values.preview_text, values);
  const heroHeading = replaceTextPlaceholders(values.hero_heading || values.name, values);
  const primary = cleanColour(values.brand_colour, "#2563eb");
  const secondary = cleanColour(values.secondary_colour, "#eef2ff");
  const companyName = values.company_name || "Van Finance Company";
  const hasBlocks = Array.isArray(values.content_blocks) && values.content_blocks.length > 0;
  const logoHtml = values.header_logo ? `<tr><td align="center" style="padding:22px 24px 14px;background:#ffffff;"><img src="${escapeHtml(values.header_logo)}" alt="${escapeHtml(companyName)}" width="180" style="display:block;max-width:180px;width:100%;height:auto;border:0;outline:none;text-decoration:none;"></td></tr>` : `<tr><td align="center" style="padding:24px 24px 14px;background:#ffffff;font-family:Arial,sans-serif;font-size:20px;line-height:26px;color:#0f172a;font-weight:bold;">${escapeHtml(companyName)}</td></tr>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#eef3f8;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#eef3f8" style="width:100%;background:#eef3f8;border-collapse:collapse;"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" width="660" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:660px;background:#ffffff;border-collapse:collapse;border-radius:14px;overflow:hidden;">
${logoHtml}<tr><td bgcolor="${primary}" style="padding:34px 30px;background:${primary};"><p style="margin:0 0 8px;font-family:Arial,sans-serif;font-size:13px;line-height:18px;color:#ffffff;font-weight:bold;letter-spacing:0.06em;text-transform:uppercase;">${escapeHtml(companyName)}</p><h1 style="margin:0;font-family:Arial,sans-serif;font-size:34px;line-height:40px;color:#ffffff;font-weight:bold;">${escapeHtml(heroHeading)}</h1></td></tr>
<tr><td bgcolor="${secondary}" style="padding:14px 30px;background:${secondary};font-family:Arial,sans-serif;font-size:14px;line-height:20px;color:#334155;">${escapeHtml(previewText)}</td></tr>
${hasBlocks ? renderContentBlocks(values) : renderLegacyBody(values)}
<tr><td style="padding:22px 30px 30px;background:#f8fafc;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#64748b;">${textToHtml(values.footer, values)}${values.social_links ? `<p style="margin:10px 0 0;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#64748b;">${escapeHtml(values.social_links)}</p>` : ""}</td></tr>
</table></td></tr></table></body></html>`;
}

async function previewTemplate(supabase, body = {}) {
  const values = await normalizeValues(templateInput(body), { allowArchivedStatus: true, allowSubmittedFrozenSnapshots: true, supabase, resolveVehicleReferences: true });
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
    else if (action === "preview") result = await previewTemplate(supabase, body);
    else if (action === "vehiclesForSelection") result = await vehiclesForSelection(supabase);
    else throw new ValidationError("Unknown Email Templates API action.");

    json(response, 200, { ok: true, ...result });
  } catch (error) {
    const status = error instanceof ValidationError || error?.statusCode === 400 ? 400 : 500;
    json(response, status, { ok: false, message: error?.message || "Email Templates API error." });
  }
}

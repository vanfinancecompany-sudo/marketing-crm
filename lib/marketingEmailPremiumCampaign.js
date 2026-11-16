// Premium dark campaign email (Black Friday 2026 master).
//
// A template uses this presentation when it contains a `campaign_hero` content block.
// Existing templates never contain that block, so their rendering is unchanged.
// The module owns the validation and rendering of the three premium block types and the
// dark presentation of the standard blocks (text, image, button, divider, spacer, vehicle grid).

export const MAX_VEHICLES_PER_GRID = 10;
export const PREMIUM_BLOCK_TYPES = Object.freeze(["campaign_hero", "usp_panel", "campaign_cta"]);

const PRODUCTION_ASSET_BASE_URL = "https://marketing-crm-six.vercel.app";
const ASSET_FOLDER = "/email-assets/black-friday-2026";
const WEBSITE_URL = "https://www.vanfinancecompany.co.uk";
const PHONE_DISPLAY = "0330 133 6376";
const PHONE_HREF = "tel:03301336376";
const USP_ICONS = new Set(["warranty", "deposit", "delivery", "stock", "none"]);
const YES_NO = new Set(["yes", "no"]);
const FONT = "Arial,Helvetica,sans-serif";
const COLOURS = Object.freeze({
  canvas: "#050506",
  shell: "#0b0b0d",
  panel: "#131316",
  line: "#26262c",
  text: "#ffffff",
  muted: "#a1a1aa",
  dim: "#8b8b93",
});

const HERO_TEXT_FIELDS = [["eyebrow", 80], ["headline", 160], ["subheadline", 160], ["supporting_text", 600], ["button_text", 80], ["image_alt", 200], ["partner_logo_alt", 200]];
const CTA_TEXT_FIELDS = [["heading", 200], ["body", 600], ["button_text", 80], ["secondary_text", 200]];

export function isPremiumBlockType(type) {
  return PREMIUM_BLOCK_TYPES.includes(type);
}

export function isPremiumCampaign(blocks = []) {
  return Array.isArray(blocks) && blocks.some((block) => block && block.type === "campaign_hero");
}

// Campaign artwork is served by this app. Preview deployments sit behind Vercel sign-in, where
// an email client could not fetch images, so previews read the same committed files from the
// public repository at the exact commit being previewed.
export function premiumAssetBaseUrl(env = typeof process !== "undefined" ? process.env : {}) {
  const configured = String(env?.MARKETING_EMAIL_ASSET_BASE_URL || "").trim().replace(/\/+$/, "");
  if (/^https:\/\/[^\s"'<>]+$/.test(configured)) return configured;
  const safe = /^[A-Za-z0-9._-]+$/;
  const owner = String(env?.VERCEL_GIT_REPO_OWNER || "");
  const slug = String(env?.VERCEL_GIT_REPO_SLUG || "");
  const sha = String(env?.VERCEL_GIT_COMMIT_SHA || "");
  if (env?.VERCEL_ENV === "preview" && safe.test(owner) && safe.test(slug) && /^[0-9a-f]{40}$/.test(sha)) {
    return `https://raw.githubusercontent.com/${owner}/${slug}/${sha}/public`;
  }
  return PRODUCTION_ASSET_BASE_URL;
}

function assetUrl(file) {
  return `${premiumAssetBaseUrl()}${ASSET_FOLDER}/${file}`;
}

function text(value, limit, label, fail) {
  const cleaned = String(value ?? "").trim();
  if (cleaned.length > limit) fail(`${label} is too long.`);
  return cleaned;
}

function httpsUrl(value, label, fail) {
  const cleaned = text(value, 1000, label, fail);
  if (!cleaned) return "";
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== "https:") throw new Error("Invalid protocol.");
    return parsed.toString();
  } catch {
    return fail(`${label} must be a valid absolute HTTPS URL.`);
  }
}

function choice(value, allowed, fallback, label, fail) {
  const cleaned = String(value ?? "").trim() || fallback;
  if (!allowed.has(cleaned)) fail(`${label} is not supported.`);
  return cleaned;
}

// Shared by the Email Templates API and the campaign snapshot validator. `fail` must throw.
export function normalizePremiumBlockSettings(type, settings = {}, enabled = true, fail) {
  if (type === "campaign_hero") {
    const result = { theme: choice(settings.theme, new Set(["black_friday"]), "black_friday", "Campaign hero theme", fail) };
    HERO_TEXT_FIELDS.forEach(([key, limit]) => { result[key] = text(settings[key], limit, `Campaign hero ${key.replace(/_/g, " ")}`, fail); });
    result.button_url = httpsUrl(settings.button_url, "Campaign hero button URL", fail);
    result.show_image = choice(settings.show_image, YES_NO, "yes", "Campaign hero image setting", fail);
    result.image_url = httpsUrl(settings.image_url, "Campaign hero image URL", fail);
    result.show_partner_logo = choice(settings.show_partner_logo, YES_NO, "yes", "Campaign hero warranty logo setting", fail);
    result.partner_logo_url = httpsUrl(settings.partner_logo_url, "Campaign hero warranty logo URL", fail);
    if (enabled && !result.headline) fail("Headline is required for enabled campaign hero blocks.");
    if (enabled && result.button_text && !result.button_url) fail("Button URL is required when the campaign hero has button text.");
    return result;
  }
  if (type === "usp_panel") {
    const result = { heading: text(settings.heading, 160, "Selling points heading", fail) };
    for (let item = 1; item <= 4; item += 1) {
      result[`item_${item}_icon`] = choice(settings[`item_${item}_icon`], USP_ICONS, "none", `Selling point ${item} icon`, fail);
      result[`item_${item}_title`] = text(settings[`item_${item}_title`], 120, `Selling point ${item} title`, fail);
      result[`item_${item}_text`] = text(settings[`item_${item}_text`], 200, `Selling point ${item} text`, fail);
    }
    return result;
  }
  if (type === "campaign_cta") {
    const result = {};
    CTA_TEXT_FIELDS.forEach(([key, limit]) => { result[key] = text(settings[key], limit, `Closing panel ${key.replace(/_/g, " ")}`, fail); });
    result.button_url = httpsUrl(settings.button_url, "Closing panel button URL", fail);
    if (enabled && result.button_text && !result.button_url) fail("Button URL is required when the closing panel has button text.");
    return result;
  }
  return fail("Unsupported content block type.");
}

function accentColour(value) {
  const colour = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(colour) ? colour : "#d81e36";
}

// Returns a display plate only for a genuine UK registration format (current "AB12 CDE" or
// prefix "A123 BCD"). Anything else, such as trim text mistaken for a plate, shows no plate.
function ukPlate(value) {
  const compact = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^[A-Z]{2}\d{2}[A-Z]{3}$/.test(compact)) return `${compact.slice(0, 4)} ${compact.slice(4)}`;
  if (/^[A-Z]\d{1,3}[A-Z]{3}$/.test(compact)) return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
  return "";
}

// Finance stock rows carry no registration field; the vehicle page address ends with it
// (for example /van-finance/fl71gzw). Only a standard current-format plate is ever shown.
function registrationFromUrl(url) {
  const slug = String(url || "").split(/[?#]/)[0].replace(/\/+$/, "").split("/").pop() || "";
  return ukPlate(slug) ? slug : "";
}

function sentenceCase(value) {
  const lower = String(value || "").trim().toLowerCase();
  return lower.replace(/(^|[\s/-])([a-z])/g, (match, lead, letter) => `${lead}${letter.toUpperCase()}`);
}

// Stock specs arrive as "MILEAGE: 15,000 / FUEL TYPE: DIESEL / TRANSMISSION: MANUAL" lines.
// Presentation only: the stored snapshot is never changed.
function specSummary(spec) {
  const lines = String(spec || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return "";
  if (!lines.every((line) => /^[^:]{2,30}:\s*\S/.test(line))) {
    const flat = lines.join(" · ");
    return flat.length > 90 ? `${flat.slice(0, 87).trimEnd()}...` : flat;
  }
  return lines.slice(0, 3).map((line) => {
    const [label, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (/mileage|miles/i.test(label)) return /mile/i.test(value) ? value.toLowerCase() : `${value} miles`;
    return sentenceCase(value);
  }).join(" · ");
}

function monthlyLine(value, helpers) {
  const line = helpers.financeMonthlyLine(value);
  if (!line) return "";
  return /[a-z]{2,}/i.test(line.replace(/^from\b/i, "")) ? line : `${line} per month`;
}

function button({ href, label, accent, esc, size = "large", fullWidth = false }) {
  const large = size === "large";
  const padding = large ? "17px 34px" : "14px 16px";
  return `<table role="presentation" ${fullWidth ? 'width="100%"' : ""} cellpadding="0" cellspacing="0" border="0" class="${fullWidth ? "" : "pc-button"}" style="border-collapse:separate;"><tr><td align="center" bgcolor="${accent}" style="border-radius:8px;background:${accent};mso-padding-alt:${padding};"><a href="${esc(href)}" style="display:block;padding:${padding};font-family:${FONT};font-size:${large ? 16 : 14}px;line-height:20px;font-weight:bold;letter-spacing:0.08em;color:#ffffff;text-decoration:none;text-transform:uppercase;border-radius:8px;">${esc(label)}&nbsp;&rarr;</a></td></tr></table>`;
}

function paragraphs(value, style, esc) {
  return String(value || "").replace(/\r\n/g, "\n").split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
    .map((part, index, parts) => `<div style="${style}${index < parts.length - 1 ? "padding-bottom:12px;" : ""}">${esc(part).replace(/\n/g, "<br>")}</div>`).join("");
}

function renderHero(block, ctx) {
  const { esc, fill, accent } = ctx;
  const s = block.settings;
  const eyebrow = fill(s.eyebrow);
  const headline = fill(s.headline);
  const subheadline = fill(s.subheadline);
  const supporting = fill(s.supporting_text);
  const buttonText = fill(s.button_text);
  const logoUrl = s.partner_logo_url || assetUrl("autoguard-warranties-logo.png");
  const logoAlt = s.partner_logo_alt || "MBi AutoGuard Warranties";
  const imageUrl = s.image_url || assetUrl("hero-van.jpg");
  const imageAlt = s.image_alt || `${ctx.companyName} van`;
  const image = `<img src="${esc(imageUrl)}" alt="${esc(imageAlt)}" width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0;outline:none;text-decoration:none;">`;
  return `<tr><td class="pc-pad" align="center" bgcolor="${COLOURS.shell}" style="padding:44px 32px ${s.show_image === "yes" ? 6 : 44}px;background:${COLOURS.shell};">
    ${eyebrow ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td class="pc-eyebrow" style="padding:11px 16px 11px 26px;border:1px solid ${accent};font-family:${FONT};font-size:20px;line-height:24px;font-weight:bold;letter-spacing:0.46em;color:#ffffff;text-transform:uppercase;">${esc(eyebrow)}</td></tr></table>` : ""}
    <h1 class="pc-h1" style="margin:${eyebrow ? 24 : 0}px 0 0;font-family:${FONT};font-size:47px;line-height:50px;font-weight:bold;letter-spacing:-0.5px;color:#ffffff;text-align:center;text-transform:uppercase;">${esc(headline)}</h1>
    ${subheadline ? `<div class="pc-h2" style="padding-top:14px;font-family:${FONT};font-size:21px;line-height:27px;font-weight:bold;letter-spacing:0.34em;color:${accent};text-align:center;text-transform:uppercase;">${esc(subheadline)}</div>` : ""}
    ${s.show_partner_logo === "yes" ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-top:26px;"><tr><td bgcolor="#ffffff" style="padding:8px 14px;border-radius:12px;background:#ffffff;"><img src="${esc(logoUrl)}" alt="${esc(logoAlt)}" width="132" style="display:block;width:132px;height:auto;border:0;outline:none;"></td></tr></table>` : ""}
    ${supporting ? `<div style="padding-top:22px;">${paragraphs(supporting, `font-family:${FONT};font-size:16px;line-height:25px;color:${COLOURS.muted};text-align:center;`, esc)}</div>` : ""}
    ${buttonText && s.button_url ? `<table class="pc-button" role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-top:26px;"><tr><td>${button({ href: s.button_url, label: buttonText, accent, esc })}</td></tr></table>` : ""}
  </td></tr>
  ${s.show_image === "yes" ? `<tr><td bgcolor="${COLOURS.shell}" style="padding:0;font-size:0;line-height:0;background:${COLOURS.shell};">${s.button_url ? `<a href="${esc(s.button_url)}" style="text-decoration:none;border:0;">${image}</a>` : image}</td></tr>` : ""}`;
}

function renderUspPanel(block, ctx) {
  const { esc, fill } = ctx;
  const s = block.settings;
  const heading = fill(s.heading);
  const items = [1, 2, 3, 4]
    .map((item) => ({ icon: s[`item_${item}_icon`], title: fill(s[`item_${item}_title`]), text: fill(s[`item_${item}_text`]) }))
    .filter((item) => item.title);
  if (!items.length) return "";
  const cell = (item, index) => {
    const icon = item.icon && item.icon !== "none" ? `<td width="56" valign="top" style="width:56px;padding:0 14px 0 0;"><img src="${esc(assetUrl(`icon-${item.icon}.png`))}" alt="" width="56" height="56" style="display:block;width:56px;height:56px;border:0;outline:none;"></td>` : "";
    const borders = `${index % 2 === 1 ? `border-left:1px solid ${COLOURS.line};` : ""}${index >= 2 ? `border-top:1px solid ${COLOURS.line};` : ""}`;
    return `<td class="pc-usp-cell${index === 0 ? " pc-usp-first" : ""}" width="50%" valign="top" style="width:50%;padding:22px 20px;${borders}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${icon}<td valign="middle" style="font-family:${FONT};">
        <div style="font-family:${FONT};font-size:14px;line-height:19px;font-weight:bold;letter-spacing:0.05em;color:#ffffff;text-transform:uppercase;">${esc(item.title)}</div>
        ${item.text ? `<div style="padding-top:5px;font-family:${FONT};font-size:13px;line-height:19px;color:${COLOURS.muted};">${esc(item.text)}</div>` : ""}
      </td></tr></table>
    </td>`;
  };
  const rows = [];
  for (let index = 0; index < items.length; index += 2) {
    const pair = items.slice(index, index + 2).map((item, offset) => cell(item, index + offset));
    if (pair.length === 1) pair.push(`<td class="pc-usp-cell pc-hide-mobile" width="50%" style="width:50%;border-left:1px solid ${COLOURS.line};${index >= 2 ? `border-top:1px solid ${COLOURS.line};` : ""}">&nbsp;</td>`);
    rows.push(`<tr class="pc-usp-row">${pair.join("")}</tr>`);
  }
  return `<tr><td class="pc-pad" bgcolor="${COLOURS.shell}" style="padding:30px 32px 10px;background:${COLOURS.shell};">
    ${heading ? `<div class="pc-section-heading" style="padding:0 0 18px;font-family:${FONT};font-size:13px;line-height:18px;font-weight:bold;letter-spacing:0.32em;color:${COLOURS.muted};text-align:center;text-transform:uppercase;">${esc(heading)}</div>` : ""}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOURS.panel}" style="border-collapse:separate;border-spacing:0;border:1px solid ${COLOURS.line};border-radius:14px;background:${COLOURS.panel};">${rows.join("")}</table>
  </td></tr>`;
}

function renderVehicleCard(vehicle, productMode, twoColumn, ctx) {
  const { esc, helpers, accent } = ctx;
  const profile = helpers.selectedVehicleProfile(vehicle, productMode);
  const href = profile.url || "";
  const title = helpers.selectedVehicleTitle(vehicle);
  const imageUrl = helpers.selectedVehicleImage(vehicle);
  const registration = ukPlate(vehicle.registration) || ukPlate(registrationFromUrl(href));
  const summary = specSummary(vehicle.spec);
  const isRent2Buy = productMode === "rent2buy";
  const imageWidth = twoColumn ? 294 : 604;
  const image = imageUrl ? `<img class="email-vehicle-image" src="${esc(imageUrl)}" alt="${esc(title)}" width="${imageWidth}" style="display:block;width:100%;max-width:${imageWidth}px;height:auto;border:0;outline:none;text-decoration:none;border-radius:13px 13px 0 0;">` : "";
  const price = String(profile.price || "").trim();
  const vatText = String(profile.vat || "").trim();
  const vat = /^n\/?a$/i.test(vatText) ? "" : vatText;
  const monthly = isRent2Buy ? helpers.rent2BuyMonthlyLine(profile.monthly) : monthlyLine(profile.monthly, helpers);
  const supporting = isRent2Buy ? helpers.rent2BuySupportingLines(profile) : [];
  const priceRow = isRent2Buy
    ? (monthly ? `<tr><td class="email-vehicle-payment" style="padding:14px 18px 0;font-family:${FONT};font-size:20px;line-height:26px;font-weight:bold;color:#ffffff;">${esc(monthly)}</td></tr>` : "")
    : (price ? `<tr><td class="email-vehicle-payment" style="padding:14px 18px 0;font-family:${FONT};font-size:25px;line-height:30px;font-weight:bold;color:#ffffff;">${esc(price)}${vat ? ` <span style="font-size:13px;line-height:18px;font-weight:bold;letter-spacing:0.04em;color:${COLOURS.muted};">${esc(vat)}</span>` : ""}</td></tr>` : "");
  const financeRow = !isRent2Buy && monthly ? `<tr><td class="email-vehicle-detail" style="padding:${price ? 3 : 14}px 18px 0;font-family:${FONT};font-size:14px;line-height:20px;font-weight:bold;color:#ffffff;"><span style="color:${COLOURS.muted};font-weight:normal;">Finance</span> ${esc(monthly)}</td></tr>` : "";
  return `<table class="email-vehicle-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOURS.panel}" style="border-collapse:separate;border-spacing:0;border:1px solid ${COLOURS.line};border-radius:14px;background:${COLOURS.panel};">
    ${image ? `<tr><td bgcolor="#1c1c21" style="padding:0;font-size:0;line-height:0;border-radius:13px 13px 0 0;background:#1c1c21;">${href ? `<a href="${esc(href)}" style="text-decoration:none;border:0;">${image}</a>` : image}</td></tr>` : ""}
    <tr><td class="email-vehicle-title" style="padding:17px 18px 0;font-family:${FONT};font-size:17px;line-height:23px;font-weight:bold;color:#ffffff;">${esc(title)}</td></tr>
    ${registration ? `<tr><td style="padding:10px 18px 0;font-family:${FONT};font-size:12px;line-height:20px;"><span style="display:inline-block;padding:1px 8px;border-radius:3px;background:#f6c915;font-family:${FONT};font-size:12px;line-height:18px;font-weight:bold;letter-spacing:0.05em;color:#111111;white-space:nowrap;">${esc(registration)}</span></td></tr>` : ""}
    ${summary ? `<tr><td class="email-vehicle-detail" style="padding:${registration ? 7 : 10}px 18px 0;font-family:${FONT};font-size:13px;line-height:19px;color:${COLOURS.muted};">${esc(summary)}</td></tr>` : ""}
    ${priceRow}
    ${financeRow}
    ${supporting.map((line) => `<tr><td class="email-vehicle-detail" style="padding:3px 18px 0;font-family:${FONT};font-size:13px;line-height:19px;color:${COLOURS.muted};">${esc(line)}</td></tr>`).join("")}
    ${href ? `<tr><td style="padding:17px 18px 18px;">${button({ href, label: "View this van", accent, esc, size: "small", fullWidth: true })}</td></tr>` : `<tr><td height="18" style="height:18px;font-size:0;line-height:0;">&nbsp;</td></tr>`}
  </table>`;
}

function renderVehicleGrid(block, ctx) {
  const { esc, fill, helpers } = ctx;
  const s = block.settings;
  const selected = s.source_mode === "selected" && Array.isArray(s.selected_vehicles) ? s.selected_vehicles : [];
  const productMode = s.product_mode === "rent2buy" ? "rent2buy" : "finance";
  const twoColumn = s.layout === "two_column";
  const heading = fill(s.heading);
  const rawIntro = fill(s.intro_text);
  const intro = helpers.isInternalVehicleGridMessage(rawIntro) ? "" : rawIntro;
  const note = helpers.isInternalVehicleGridMessage(s.placeholder_note) ? "" : String(s.placeholder_note || "");
  const cells = selected.map((vehicle) => `<td class="email-vehicle-card-cell" width="${twoColumn ? "50%" : "100%"}" valign="top" style="width:${twoColumn ? "50%" : "100%"};padding:8px;">${renderVehicleCard(vehicle, productMode, twoColumn, ctx)}</td>`);
  const rows = [];
  for (let index = 0; index < cells.length; index += twoColumn ? 2 : 1) {
    const pair = cells.slice(index, index + (twoColumn ? 2 : 1));
    if (twoColumn && pair.length === 1) pair.push('<td class="email-vehicle-card-cell pc-hide-mobile" width="50%" style="width:50%;padding:8px;">&nbsp;</td>');
    rows.push(`<tr class="email-vehicle-row">${pair.join("")}</tr>`);
  }
  // No sample or placeholder vans are ever shown in a campaign email.
  const emptyState = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:26px 20px;border:1px dashed ${COLOURS.line};border-radius:14px;font-family:${FONT};font-size:14px;line-height:21px;color:${COLOURS.muted};">No vans selected yet. Use Select Vehicles on this block to choose up to ${MAX_VEHICLES_PER_GRID} vans from live stock.</td></tr></table>`;
  return `<tr><td class="email-vehicle-panel" bgcolor="${COLOURS.shell}" style="padding:34px 24px 14px;background:${COLOURS.shell};">
    ${heading ? `<h2 class="pc-section-title" style="margin:0 8px;font-family:${FONT};font-size:27px;line-height:33px;font-weight:bold;letter-spacing:0.02em;color:#ffffff;text-align:center;text-transform:uppercase;">${esc(heading)}</h2>` : ""}
    ${intro ? `<div style="padding:10px 8px 0;font-family:${FONT};font-size:15px;line-height:23px;color:${COLOURS.muted};text-align:center;">${esc(intro)}</div>` : ""}
    <div style="height:${heading || intro ? 14 : 0}px;font-size:0;line-height:0;">&nbsp;</div>
    ${rows.length ? `<table class="email-vehicle-grid" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${rows.join("")}</table>` : `<div style="padding:0 8px;">${emptyState}</div>`}
    ${note ? `<div style="padding:8px 8px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${COLOURS.dim};text-align:center;">${esc(note)}</div>` : ""}
  </td></tr>`;
}

function renderCta(block, ctx) {
  const { esc, fill, accent } = ctx;
  const s = block.settings;
  const heading = fill(s.heading);
  const body = fill(s.body);
  const buttonText = fill(s.button_text);
  const secondary = fill(s.secondary_text);
  return `<tr><td class="pc-pad" bgcolor="${COLOURS.shell}" style="padding:22px 32px 36px;background:${COLOURS.shell};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOURS.panel}" style="border-collapse:separate;border-spacing:0;border:1px solid ${COLOURS.line};border-top:3px solid ${accent};border-radius:14px;background:${COLOURS.panel};"><tr><td class="pc-cta" align="center" style="padding:36px 28px 34px;">
      ${heading ? `<h2 class="pc-section-title" style="margin:0;font-family:${FONT};font-size:28px;line-height:34px;font-weight:bold;letter-spacing:0.01em;color:#ffffff;text-align:center;text-transform:uppercase;">${esc(heading)}</h2>` : ""}
      ${body ? `<div style="padding-top:${heading ? 12 : 0}px;">${paragraphs(body, `font-family:${FONT};font-size:15px;line-height:24px;color:${COLOURS.muted};text-align:center;`, esc)}</div>` : ""}
      ${buttonText && s.button_url ? `<table class="pc-button" role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin-top:${heading || body ? 24 : 0}px;"><tr><td>${button({ href: s.button_url, label: buttonText, accent, esc })}</td></tr></table>` : ""}
      ${secondary ? `<div style="padding-top:18px;font-family:${FONT};font-size:14px;line-height:21px;color:${COLOURS.muted};text-align:center;">${esc(secondary)}</div>` : ""}
    </td></tr></table>
  </td></tr>`;
}

function isDarkColour(colour) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(colour || ""));
  if (!match) return false;
  const [r, g, b] = match.slice(1).map((part) => parseInt(part, 16));
  return (r * 299 + g * 587 + b * 114) / 1000 < 90;
}

// Standard blocks keep working inside a premium campaign. Light colours saved on a block are
// honoured; the editor's light defaults are only replaced where they would break the dark design.
function renderStandardBlock(block, ctx) {
  const { esc, fill, accent } = ctx;
  const s = block.settings;
  if (block.type === "text") {
    const small = s.padding_size === "small";
    const background = s.background_colour === "#ffffff" ? COLOURS.shell : s.background_colour;
    const colour = isDarkColour(background) && isDarkColour(s.text_colour) ? COLOURS.muted : s.text_colour;
    const align = s.alignment === "centre" ? "center" : "left";
    const heading = fill(s.heading);
    const padding = small ? 14 : s.padding_size === "large" ? 34 : 24;
    return `<tr><td class="pc-pad" bgcolor="${background}" style="padding:${padding}px 32px;background:${background};">
      ${heading ? `<h2 class="pc-section-title" style="margin:0 0 10px;font-family:${FONT};font-size:22px;line-height:28px;font-weight:bold;color:${isDarkColour(background) ? "#ffffff" : colour};text-align:${align};">${esc(heading)}</h2>` : ""}
      ${paragraphs(fill(s.body), `font-family:${FONT};font-size:${small ? 12 : 15}px;line-height:${small ? 18 : 24}px;color:${colour};text-align:${align};`, esc)}
    </td></tr>`;
  }
  if (block.type === "manual_image") {
    if (!s.image_url) return "";
    const background = s.background_colour === "#ffffff" ? COLOURS.shell : s.background_colour;
    const width = s.width === "half" ? 288 : s.width === "contained" ? 480 : 576;
    const image = `<img src="${esc(s.image_url)}" alt="${esc(s.alt_text)}" width="${width}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none;border-radius:12px;">`;
    const heading = fill(s.heading);
    const caption = fill(s.caption);
    return `<tr><td class="pc-pad" bgcolor="${background}" align="${s.alignment === "right" ? "right" : s.alignment === "left" ? "left" : "center"}" style="padding:22px 32px;background:${background};">
      ${heading ? `<h2 class="pc-section-title" style="margin:0 0 12px;font-family:${FONT};font-size:22px;line-height:28px;font-weight:bold;color:${isDarkColour(background) ? "#ffffff" : "#0f172a"};">${esc(heading)}</h2>` : ""}
      ${s.link_url ? `<a href="${esc(s.link_url)}" style="text-decoration:none;border:0;">${image}</a>` : image}
      ${caption ? `<div style="padding-top:10px;font-family:${FONT};font-size:13px;line-height:19px;color:${isDarkColour(background) ? COLOURS.muted : "#64748b"};">${esc(caption)}</div>` : ""}
    </td></tr>`;
  }
  if (block.type === "button") {
    if (!s.text || !s.url) return "";
    const colour = s.primary_colour === "#2563eb" ? accent : s.primary_colour;
    return `<tr><td class="pc-pad" bgcolor="${COLOURS.shell}" align="${s.alignment === "right" ? "right" : s.alignment === "left" ? "left" : "center"}" style="padding:12px 32px 22px;background:${COLOURS.shell};">${button({ href: s.url, label: fill(s.text), accent: colour, esc, fullWidth: s.width === "full" })}</td></tr>`;
  }
  if (block.type === "divider") {
    const colour = s.colour === "#d9e2ef" ? COLOURS.line : s.colour;
    return `<tr><td align="center" bgcolor="${COLOURS.shell}" style="padding:${s.spacing}px 32px;background:${COLOURS.shell};"><table role="presentation" width="${s.width_percentage}%" cellpadding="0" cellspacing="0" border="0"><tr><td height="${s.thickness}" bgcolor="${colour}" style="height:${s.thickness}px;font-size:0;line-height:0;background:${colour};">&nbsp;</td></tr></table></td></tr>`;
  }
  if (block.type === "spacer") return `<tr><td height="${s.height}" bgcolor="${COLOURS.shell}" style="height:${s.height}px;font-size:0;line-height:0;background:${COLOURS.shell};">&nbsp;</td></tr>`;
  return "";
}

function renderBlocks(snapshot, ctx) {
  return (snapshot.content_blocks || [])
    .filter((block) => block.enabled !== false)
    .sort((a, b) => a.position - b.position)
    .map((block) => {
      if (block.type === "campaign_hero") return renderHero(block, ctx);
      if (block.type === "usp_panel") return renderUspPanel(block, ctx);
      if (block.type === "campaign_cta") return renderCta(block, ctx);
      if (block.type === "vehicle_grid") return renderVehicleGrid(block, ctx);
      return renderStandardBlock(block, ctx);
    })
    .join("");
}

function wordmark(companyName, accent, esc, size = 17) {
  const words = String(companyName || "").trim().toUpperCase().split(/\s+/).filter(Boolean);
  const last = words.length > 1 ? words.pop() : "";
  return `<a class="pc-wordmark" href="${WEBSITE_URL}" style="font-family:${FONT};font-size:${size}px;line-height:${size + 6}px;font-weight:bold;letter-spacing:0.14em;color:#ffffff;text-decoration:none;white-space:nowrap;">${esc(words.join(" "))}${last ? ` <span style="color:${accent};">${esc(last)}</span>` : ""}</a>`;
}

// `snapshot` must already be a normalised template snapshot. `helpers` are the shared
// renderer's own escaping, placeholder and vehicle-snapshot functions.
export function renderPremiumCampaignEmail(snapshot, helpers) {
  const esc = helpers.escapeHtml;
  const fill = (value) => helpers.replaceTextPlaceholders(value, snapshot);
  const accent = accentColour(snapshot.brand_colour);
  const companyName = snapshot.company_name || "Van Finance Company";
  const ctx = { esc, fill, accent, helpers, companyName };
  const subject = fill(snapshot.default_subject);
  const previewText = fill(snapshot.preview_text);
  const footer = fill(snapshot.footer);
  const social = fill(snapshot.social_links);
  const logo = snapshot.header_logo
    ? `<a href="${WEBSITE_URL}" style="text-decoration:none;border:0;"><img src="${esc(snapshot.header_logo)}" alt="${esc(companyName)}" width="170" style="display:block;width:170px;max-width:170px;height:auto;border:0;outline:none;"></a>`
    : wordmark(companyName, accent, esc);
  const footerLink = (label, path) => `<a href="${WEBSITE_URL}${path}" style="font-family:${FONT};font-size:13px;line-height:20px;font-weight:bold;letter-spacing:0.06em;color:#ffffff;text-decoration:none;text-transform:uppercase;white-space:nowrap;">${label}</a>`;
  const linkGap = `<span style="color:${COLOURS.line};">&nbsp;&nbsp;|&nbsp;&nbsp;</span>`;
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light"><title>${esc(subject)}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style type="text/css">
body { margin:0 !important; padding:0 !important; background:${COLOURS.canvas}; }
table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
img { -ms-interpolation-mode:bicubic; }
a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; }
body > p { margin:0 !important; padding:4px 20px 30px !important; color:${COLOURS.dim} !important; }
body > p a { color:#ffffff !important; }
@media only screen and (max-width:660px) {
  .pc-shell { width:100% !important; }
  .pc-outer { padding:0 !important; }
  .pc-pad { padding-left:18px !important; padding-right:18px !important; }
  .pc-header-phone { font-size:13px !important; }
  .pc-eyebrow { font-size:16px !important; line-height:20px !important; letter-spacing:0.4em !important; }
  .pc-wordmark { font-size:14px !important; letter-spacing:0.1em !important; }
  .pc-h1 { font-size:35px !important; line-height:38px !important; }
  .pc-h2 { font-size:17px !important; line-height:23px !important; letter-spacing:0.28em !important; }
  .pc-section-title { font-size:23px !important; line-height:29px !important; }
  .pc-button { width:100% !important; }
  .pc-cta { padding:30px 18px 28px !important; }
  .pc-usp-row, .pc-usp-cell { display:block !important; width:100% !important; box-sizing:border-box !important; }
  .pc-usp-cell { border-left:0 !important; border-top:1px solid ${COLOURS.line} !important; padding:18px 18px !important; }
  .pc-usp-first { border-top:0 !important; }
  .email-vehicle-panel { padding-left:10px !important; padding-right:10px !important; }
  .email-vehicle-grid, .email-vehicle-card { width:100% !important; }
  .email-vehicle-row, .email-vehicle-card-cell { display:block !important; width:100% !important; max-width:100% !important; box-sizing:border-box !important; }
  .email-vehicle-card-cell { padding:9px 8px !important; }
  .email-vehicle-image { width:100% !important; max-width:none !important; height:auto !important; }
  .email-vehicle-title { font-size:19px !important; line-height:25px !important; }
  .email-vehicle-detail { font-size:14px !important; line-height:21px !important; }
  .email-vehicle-payment { font-size:27px !important; line-height:32px !important; }
  .pc-hide-mobile { display:none !important; }
  .pc-footer-links a { display:block !important; padding:7px 0 !important; }
  .pc-footer-gap { display:none !important; }
}
</style></head>
<body bgcolor="${COLOURS.canvas}" style="margin:0;padding:0;background:${COLOURS.canvas};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${COLOURS.canvas};">${esc(previewText)}${"&#847;&zwnj;&nbsp;".repeat(previewText ? 60 : 0)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOURS.canvas}" style="background:${COLOURS.canvas};"><tr><td class="pc-outer" align="center" style="padding:24px 12px 12px;">
<!--[if mso]><table role="presentation" width="640" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table class="pc-shell" role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOURS.shell}" style="width:100%;max-width:640px;background:${COLOURS.shell};">
  <tr><td height="4" bgcolor="${accent}" style="height:4px;font-size:0;line-height:0;background:${accent};">&nbsp;</td></tr>
  <tr><td class="pc-pad" bgcolor="${COLOURS.shell}" style="padding:20px 32px;background:${COLOURS.shell};border-bottom:1px solid ${COLOURS.line};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td align="left" valign="middle">${logo}</td>
      <td align="right" valign="middle"><a class="pc-header-phone" href="${PHONE_HREF}" style="font-family:${FONT};font-size:14px;line-height:20px;font-weight:bold;letter-spacing:0.04em;color:#ffffff;text-decoration:none;white-space:nowrap;">${PHONE_DISPLAY}</a></td>
    </tr></table>
  </td></tr>
  ${renderBlocks(snapshot, ctx)}
  <tr><td class="pc-pad" align="center" bgcolor="${COLOURS.canvas}" style="padding:32px 32px 30px;background:${COLOURS.canvas};border-top:1px solid ${COLOURS.line};">
    <div>${wordmark(companyName, accent, esc, 15)}</div>
    <div style="padding-top:14px;font-family:${FONT};font-size:15px;line-height:22px;color:${COLOURS.muted};">Call <a href="${PHONE_HREF}" style="color:#ffffff;font-weight:bold;text-decoration:none;white-space:nowrap;">${PHONE_DISPLAY}</a></div>
    <div class="pc-footer-links" style="padding-top:16px;">${footerLink("View all vans", "/vans")}<span class="pc-footer-gap">${linkGap}</span>${footerLink("Van warranty", "/van-warranty")}<span class="pc-footer-gap">${linkGap}</span>${footerLink("Contact us", "/contact")}<span class="pc-footer-gap">${linkGap}</span>${footerLink("Privacy policy", "/privacy-policy")}</div>
    ${footer ? `<div style="padding-top:20px;">${paragraphs(footer, `font-family:${FONT};font-size:12px;line-height:18px;color:${COLOURS.dim};text-align:center;`, esc)}</div>` : ""}
    ${social ? `<div style="padding-top:12px;">${paragraphs(social, `font-family:${FONT};font-size:12px;line-height:18px;color:${COLOURS.dim};text-align:center;`, esc)}</div>` : ""}
  </td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body></html>`;
}

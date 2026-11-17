import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { previewTemplate } from "../api/marketing-email-templates.js";
import { renderEmailHtml } from "../lib/marketingCampaignTemplateRenderer.js";
import { renderRecipientCampaignPreview } from "../lib/marketingRecipientPersonalization.js";
import { MAX_VEHICLES_PER_GRID, premiumAssetBaseUrl } from "../lib/marketingEmailPremiumCampaign.js";

const designerSource = fs.readFileSync(new URL("../public/email-templates/index.html", import.meta.url), "utf8");
const masterSource = fs.readFileSync(new URL("../public/email-templates/black-friday-master.js", import.meta.url), "utf8");
const sandbox = {};
vm.runInNewContext(masterSource, sandbox);
const kit = sandbox.VFC_BLACK_FRIDAY_2026;

function stockRow(index) {
  const plate = `AB${String(10 + index)}CDE`;
  return {
    id: `finance-${index}`,
    title: `Ford Transit Custom Limited ${index}`,
    picture: `https://images.example/van-${index}.jpg`,
    price: `£${10 + index},995`,
    vat: index === 3 ? "N/A" : "+VAT",
    salePrice: index === 4 ? "" : `£${200 + index}`,
    vanDescription: "Description",
    vanSpec: "MILEAGE: 15,000\nFUEL TYPE: DIESEL\nTRANSMISSION: MANUAL",
    weblink: `https://www.vanfinancecompany.co.uk/van-finance/${plate.toLowerCase()}`,
    is_active: true,
  };
}

function supabaseWithStock(count) {
  const rows = { facebook_adverts: Array.from({ length: count }, (_, index) => stockRow(index + 1)), rent_vehicles: [] };
  return { from(table) { return { select() { return this; }, eq() { return this; }, limit() { return Promise.resolve({ data: rows[table] || [], error: null }); } }; } };
}

function blackFridayTemplate(vehicleCount) {
  const { master, blockDefaults } = kit;
  const blocks = master.blocks.map((block, index) => {
    const settings = { ...(blockDefaults[block.type] || {}), ...block.settings };
    if (block.type === "vehicle_grid") {
      Object.assign(settings, {
        placeholder_note: "",
        selected_vehicles: Array.from({ length: vehicleCount }, (_, item) => ({ snapshot_status: "unresolved", selection_id: `finance:finance-${item + 1}`, source_id: `finance-${item + 1}`, registration: "", title: `Ford Transit Custom Limited ${item + 1}`, image_override_url: "" })),
        number_of_vehicles: Math.max(1, Math.min(vehicleCount, 10)),
      });
    }
    return { id: `block-${index + 1}`, type: block.type, position: index + 1, enabled: true, settings };
  });
  return {
    name: master.name, category: master.category, default_subject: master.subject, preview_text: master.preview, hero_heading: master.hero,
    footer: master.footer, brand_colour: master.colour, secondary_colour: master.secondary, company_name: "Van Finance Company",
    master_layout: master.layout, content_blocks: blocks,
  };
}

test("Black Friday master renders the authorised offer, four selling points and ten real vans", async () => {
  const result = await previewTemplate(supabaseWithStock(12), { template: blackFridayTemplate(10) });
  const html = result.preview.html;
  assert.match(html, /BLACK FRIDAY/);
  assert.match(html, /FREE 2-YEAR AUTOGUARD WARRANTY/);
  assert.match(html, /WITH EVERY VAN/);
  assert.match(html, /VAN FINANCE FROM JUST £99 DEPOSIT/);
  assert.match(html, /FREE UK DOORSTEP DELIVERY/);
  assert.match(html, /autoguard-warranties-logo\.png/);
  assert.equal((html.match(/View this van/g) || []).length, 10);
  for (let index = 1; index <= 10; index += 1) {
    assert.ok(html.includes(`https://www.vanfinancecompany.co.uk/van-finance/ab${10 + index}cde`), `van ${index} links to its own page`);
    assert.ok(html.includes(`https://images.example/van-${index}.jpg`), `van ${index} uses its stock photo`);
  }
  assert.doesNotMatch(html, /van-11\.jpg|Preview only|Sample van/i);
  // every monthly figure keeps FROM; no blanket per-van deposit claim; one-year wording never appears
  assert.equal((html.match(/FROM £2\d\d per month/g) || []).length, 9);
  assert.doesNotMatch(html, /FROM £99 DEPOSIT<\/td>/);
  assert.doesNotMatch(html, /1-year/i);
  // van with no monthly figure shows no finance line; "N/A" VAT text is not printed
  assert.doesNotMatch(html, /£13,995[^<]*<span[^>]*>N\/A/);
  assert.match(html, /AB11 CDE/);
  assert.doesNotMatch(html, /\{\{|\}\}/);
  assert.equal(html.split("</body>").length, 2, "send pipeline appends the unsubscribe line before a single </body>");
  assert.ok(Buffer.byteLength(html, "utf8") < 90_000, "stays under Gmail's clipping limit");
  assert.match(html, /max-width:600px/);
});

test("vehicle grids accept ten vans and reject an eleventh", async () => {
  assert.equal(MAX_VEHICLES_PER_GRID, 10);
  await assert.rejects(() => previewTemplate(supabaseWithStock(12), { template: blackFridayTemplate(11) }), /maximum of 10 selected vehicles/);
  assert.match(designerSource, /const MAX_SELECTED_VEHICLES = 10;/);
  assert.doesNotMatch(designerSource, /up to 6 vehicles|Maximum 6 vehicles|0 \/ 6</);
});

test("existing templates keep their own layout and can now carry more than six vans", async () => {
  const template = blackFridayTemplate(8);
  template.content_blocks = template.content_blocks.filter((block) => block.type === "vehicle_grid").map((block) => ({ ...block, position: 1 }));
  template.master_layout = "new_stock";
  const html = (await previewTemplate(supabaseWithStock(12), { template })).preview.html;
  assert.equal((html.match(/images\.example\/van-\d+\.jpg/g) || []).length >= 8, true);
  assert.doesNotMatch(html, /pc-shell|View this van/);
});

test("the final recipient email uses the premium design and the send pipeline can add the unsubscribe line", () => {
  assert.match(renderEmailHtml(blackFridayTemplate(0)), /FREE 2-YEAR AUTOGUARD WARRANTY/);
  const snapshot = { ...blackFridayTemplate(0) };
  const campaign = { subject_line: kit.master.subject, preview_text: kit.master.preview, template_snapshot: snapshot };
  const recipient = renderRecipientCampaignPreview(campaign, { first_name: "Customer" }, { mode: "recipient" });
  assert.match(recipient.html, /FREE 2-YEAR AUTOGUARD WARRANTY/);
  assert.match(recipient.html, /No vans selected yet/);
  assert.ok(recipient.html.replace("</body>", "<p>unsubscribe</p></body>").includes("<p>unsubscribe</p></body></html>"));
});

test("premium blocks are validated", async () => {
  const missingHeadline = blackFridayTemplate(1);
  missingHeadline.content_blocks[0].settings.headline = "";
  await assert.rejects(() => previewTemplate(supabaseWithStock(2), { template: missingHeadline }), /Headline is required/);
  const badUrl = blackFridayTemplate(1);
  badUrl.content_blocks[0].settings.image_url = "http://insecure.example/van.jpg";
  await assert.rejects(() => previewTemplate(supabaseWithStock(2), { template: badUrl }), /HTTPS/);
  const unknown = blackFridayTemplate(1);
  unknown.content_blocks[0].type = "mystery_block";
  await assert.rejects(() => previewTemplate(supabaseWithStock(2), { template: unknown }));
});

test("stock wording follows the live count and only claims 200+ when supported", () => {
  assert.deepEqual({ ...kit.stockCopy(177) }, { title: "OVER 170 VANS IN STOCK", button: "VIEW ALL VANS" });
  assert.deepEqual({ ...kit.stockCopy(200) }, { title: "200+ VANS IN STOCK", button: "SHOP ALL 200+ VANS" });
  assert.deepEqual({ ...kit.stockCopy(214) }, { title: "200+ VANS IN STOCK", button: "SHOP ALL 200+ VANS" });
  assert.deepEqual({ ...kit.stockCopy(undefined) }, { title: "HUGE CHOICE OF VANS IN STOCK", button: "VIEW ALL VANS" });
  assert.doesNotMatch(JSON.stringify(kit.blockDefaults), /200/);
});

test("campaign artwork is served from production, or from the previewed commit on preview deployments", () => {
  assert.equal(premiumAssetBaseUrl({}), "https://marketing-crm-six.vercel.app");
  assert.equal(premiumAssetBaseUrl({ VERCEL_ENV: "production", VERCEL_GIT_REPO_OWNER: "o", VERCEL_GIT_REPO_SLUG: "r", VERCEL_GIT_COMMIT_SHA: "a".repeat(40) }), "https://marketing-crm-six.vercel.app");
  assert.equal(premiumAssetBaseUrl({ VERCEL_ENV: "preview", VERCEL_GIT_REPO_OWNER: "o", VERCEL_GIT_REPO_SLUG: "r", VERCEL_GIT_COMMIT_SHA: "a".repeat(40) }), `https://raw.githubusercontent.com/o/r/${"a".repeat(40)}/public`);
  assert.equal(premiumAssetBaseUrl({ MARKETING_EMAIL_ASSET_BASE_URL: "https://cdn.example.com/" }), "https://cdn.example.com");
  assert.equal(premiumAssetBaseUrl({ MARKETING_PUBLIC_BASE_URL: "https://crm.example.com/" }), "https://crm.example.com");
  assert.equal(premiumAssetBaseUrl({ VERCEL_ENV: "preview", MARKETING_PUBLIC_BASE_URL: "https://crm.example.com", VERCEL_GIT_REPO_OWNER: "o", VERCEL_GIT_REPO_SLUG: "r", VERCEL_GIT_COMMIT_SHA: "b".repeat(40) }), `https://raw.githubusercontent.com/o/r/${"b".repeat(40)}/public`);
  for (const file of ["hero-van.jpg", "autoguard-warranties-logo.png", "icon-warranty.png", "icon-deposit.png", "icon-delivery.png", "icon-stock.png"]) {
    assert.ok(fs.existsSync(new URL(`../public/email-assets/black-friday-2026/${file}`, import.meta.url)), file);
  }
});

test("the designer offers the Black Friday master without touching existing masters", () => {
  assert.equal(kit.master.layout, "finance_offer");
  assert.match(kit.master.subject, /FREE 2-Year AutoGuard Warranty With Every Van/);
  assert.match(designerSource, /<script src="\/email-templates\/black-friday-master\.js"><\/script>/);
  for (const key of ["black_november", "new_stock", "finance_offer", "rent2buy", "weekend_offer", "re_engagement", "newsletter", "custom_blank"]) {
    assert.match(designerSource, new RegExp(`\\b${key}: \\{ label:`), `${key} master is still defined`);
  }
});

// ---------- Dark-mode compatibility (Gmail, Outlook, Apple Mail) ----------
import { renderFrozenCampaign } from "../api/marketing-template-campaign-sends.js";
import { hardenDarkModeHtml } from "../lib/marketingEmailPremiumCampaign.js";

function frozenBlackFridayCampaign(vehicleCount = 10) {
  const template = blackFridayTemplate(0);
  const grid = template.content_blocks.find((block) => block.type === "vehicle_grid");
  grid.settings.number_of_vehicles = vehicleCount;
  grid.settings.selected_vehicles = Array.from({ length: vehicleCount }, (_, index) => {
    const row = stockRow(index + 1);
    return { snapshot_status: "frozen", selection_id: `finance:${row.id}`, source_id: row.id, registration: "", title: row.title, description: "", spec: row.vanSpec, primary_image_url: row.picture, image_override_url: "", finance: { price: row.price, vat: row.vat, monthly: row.salePrice, url: row.weblink }, rent2buy: null };
  });
  return { subject_line: kit.master.subject, preview_text: kit.master.preview, template_snapshot: template };
}

function finalSendHtml() {
  return renderFrozenCampaign(frozenBlackFridayCampaign(10), { unsubscribeUrl: "https://marketing-crm-six.vercel.app/unsubscribe?token=test", values: { first_name: "Customer" } }).html;
}

function inlineStyles(html) {
  return [...html.matchAll(/<[a-z][a-z0-9]*\s[^<>]*?style="([^"]*)"/gi)].map((match) => match[1]);
}

test("final send HTML backs every solid background with a same-colour gradient so Gmail cannot invert it", () => {
  const html = finalSendHtml();
  const styles = inlineStyles(html.split("You can unsubscribe")[0]);
  let checked = 0;
  for (const style of styles) {
    assert.doesNotMatch(style, /(^|;)\s*background\s*:\s*#/i, `solid background shorthand left unprotected: ${style.slice(0, 120)}`);
    const colour = /background-color:(#[0-9a-f]{6})/i.exec(style)?.[1];
    if (colour) { checked += 1; assert.ok(style.includes(`background-image:linear-gradient(${colour},${colour})`), `gradient must repeat ${colour}`); }
  }
  assert.ok(checked >= 40, `expected the shell, panels, cards and buttons to be protected (found ${checked})`);
  // The design's colours are unchanged.
  for (const colour of ["#050506", "#0b0b0d", "#131316", "#d81e36"]) assert.ok(html.includes(`background-color:${colour}`), colour);
});

test("final send HTML restores colours that Outlook.com and new Outlook rewrite in dark mode", () => {
  const html = finalSendHtml();
  const head = html.slice(0, html.indexOf("</head>"));
  assert.match(head, /\[data-ogsc\] \.bf-c-ffffff,\.bf-c-ffffff\[data-ogsc\]\{color:#ffffff !important;\}/);
  assert.match(head, /\[data-ogsc\] \.bf-c-a1a1aa/);
  for (const colour of ["050506", "0b0b0d", "131316", "d81e36"]) assert.match(head, new RegExp(`\\[data-ogsb\\] \\.bf-bg-${colour},\\.bf-bg-${colour}\\[data-ogsb\\]\\{background-color:#${colour} !important;`));
  assert.match(head, /@media \(prefers-color-scheme: dark\) \{/);
  assert.match(head, /:root\{color-scheme:dark light;supported-color-schemes:dark light;\}/);
  assert.match(head, /<meta name="color-scheme" content="dark light">/);
  // Every class the head rules rely on is present on the elements themselves.
  const body = html.slice(html.indexOf("<body"));
  assert.match(body, /<h1 class="pc-h1 bf-c-ffffff"/);
  assert.match(body, /class="email-vehicle-card bf-bg-131316"/);
});

test("final send HTML protects light text with the Gmail-only blend layers", () => {
  const html = finalSendHtml();
  assert.match(html, /<body class="body bf-bg-050506 bf-c-ffffff"/);
  assert.match(html, /u \+ \.body \.bf-gm-s\{background:#000000;mix-blend-mode:screen;\}/);
  assert.match(html, /u \+ \.body \.bf-gm-d\{background:#000000;mix-blend-mode:difference;\}/);
  assert.match(html, /<span class="bf-gm-s"><span class="bf-gm-d">FREE 2-YEAR AUTOGUARD WARRANTY<\/span><\/span><\/h1>/);
  assert.equal((html.match(/<span class="bf-gm-s"><span class="bf-gm-d">View this van/g) || []).length, 10);
  // Coloured text (the red accent line) and dark plate text are not blended, so their colours stay true.
  assert.match(html, /bf-c-d81e36"[^>]*>WITH EVERY VAN<\/div>/);
  assert.doesNotMatch(html, /bf-gm-d"><span[^>]*bf-c-111111/);
});

test("dark-mode protection keeps the email intact: links, images, unsubscribe line and size", () => {
  const html = finalSendHtml();
  assert.equal((html.match(/View this van/g) || []).length, 10);
  for (let index = 1; index <= 10; index += 1) assert.ok(html.includes(`https://www.vanfinancecompany.co.uk/van-finance/ab${10 + index}cde`));
  assert.match(html, /autoguard-warranties-logo\.png/);
  assert.equal((html.match(/unsubscribe\?token=test/g) || []).length, 1);
  assert.match(html, /unsubscribe<\/a>\.<\/p><\/body><\/html>$/);
  assert.match(html, /\.body > p a \{ color:#ffffff !important; \}|body > p a, \.body > p a \{ color:#ffffff !important; \}/);
  assert.equal(html.split("</body>").length, 2);
  assert.doesNotMatch(html, /\{\{|\}\}/);
  assert.ok(Buffer.byteLength(html, "utf8") < 90_000, `final email must stay well under Gmail's 102KB clipping limit (${Buffer.byteLength(html, "utf8")} bytes)`);
  assert.match(html, /@media only screen and \(max-width:600px\)/);
});

test("customer-entered wording that looks like markup is escaped and never touched by the dark-mode pass", () => {
  const template = blackFridayTemplate(0);
  template.content_blocks[0].settings.headline = 'BIG <b style="background:#ffffff;color:#000000">DEAL</b>';
  const html = renderEmailHtml(template);
  assert.match(html, /BIG &lt;b style=&quot;background:#ffffff;color:#000000&quot;&gt;DEAL&lt;\/b&gt;/);
  const { html: again } = hardenDarkModeHtml('<p>a style="background:#ffffff" b</p>');
  assert.equal(again, '<p>a style="background:#ffffff" b</p>');
});

test("other email templates are not affected by the Black Friday dark-mode protection", () => {
  const template = blackFridayTemplate(0);
  template.content_blocks = template.content_blocks.filter((block) => block.type === "text").map((block, index) => ({ ...block, position: index + 1 }));
  template.master_layout = "finance_offer";
  const html = renderEmailHtml(template);
  assert.doesNotMatch(html, /bf-gm-|bf-bg-|bf-c-|data-ogsc|linear-gradient\(#/);
  assert.doesNotMatch(html, /class="body/);
});

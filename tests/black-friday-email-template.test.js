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

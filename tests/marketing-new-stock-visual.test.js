import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { renderEmailHtml, renderCampaignPreview } from "../lib/marketingCampaignTemplateRenderer.js";

const vehicle = {
  snapshot_status: "frozen", selection_id: "finance-1", registration: "AB22 CDE",
  title: "Ford Transit Custom Limited", description: "A practical panel van.", spec: "2022 • 42,000 miles • Manual",
  primary_image_url: "https://images.example/van.jpg", image_override_url: "",
  finance: { price: "£18,995", vat: "+ VAT", monthly: "£399 per month", url: "https://www.vanfinancecompany.co.uk/van-one" },
};
const block = (type, position, settings) => ({ id: `block-${position}`, type, position, enabled: true, settings });
const textSettings = { heading: "New arrivals ready to view", body: "Hi {{first_name}},\n\nBrowse the latest arrivals.", alignment: "left", background_colour: "#ffffff", text_colour: "#1f2937", padding_size: "medium" };
const buttonSettings = { text: "View the latest vans", url: "https://www.vanfinancecompany.co.uk", alignment: "left", primary_colour: "#2557d6", text_colour: "#ffffff", width: "auto" };
const gridSettings = { heading: "Latest vans to view", intro_text: "Browse the latest arrivals below.", number_of_vehicles: 3, layout: "two_column", source_mode: "selected", product_mode: "finance", selected_vehicles: [vehicle, { ...vehicle, selection_id: "finance-2", title: "Volkswagen Transporter", image_override_url: "https://images.example/override.jpg", finance: { ...vehicle.finance, url: "https://www.vanfinancecompany.co.uk/van-two" } }, { ...vehicle, selection_id: "finance-3", title: "Mercedes-Benz Vito", primary_image_url: "", finance: { ...vehicle.finance, monthly: "", url: "https://www.vanfinancecompany.co.uk/van-three" } }], placeholder_note: "", top_padding: 0 };
const template = {
  name: "New Stock Email", default_subject: "Fresh vans at {{company}}", preview_text: "Newly arrived vans are ready to view.",
  hero_heading: "Fresh vans have just landed", company_name: "Van Finance Company", brand_colour: "#2557d6", secondary_colour: "#ecfdf3",
  footer: "Van Finance Company Ltd.\n\n{{unsubscribe_url}}", social_links: "Find us online", master_layout: "new_stock",
  content_blocks: [
    block("text", 1, textSettings), block("vehicle_grid", 2, gridSettings), block("button", 3, buttonSettings),
    block("text", 4, { ...textSettings, heading: "", body: "Seen something suitable?", padding_size: "small" }),
    block("manual_image", 5, { image_url: "https://images.example/promo.jpg", alt_text: "Promotion", link_url: "https://www.vanfinancecompany.co.uk", heading: "Image heading", caption: "Image caption", width: "contained", alignment: "centre", background_colour: "#ffffff", padding_size: "medium" }),
    block("divider", 6, { colour: "#d9e2ef", thickness: 1, width_percentage: 100, spacing: 16 }),
    block("spacer", 7, { height: 24 }),
    { ...block("text", 8, { ...textSettings, body: "Disabled copy" }), enabled: false },
  ],
};

// Shared-function coverage, including the legacy body and dummy-grid fallback.
export const regressionCases = {
  selected: template,
  placeholder: { ...template, header_logo: "https://images.example/logo.png", content_blocks: [block("vehicle_grid", 1, { ...gridSettings, selected_vehicles: [] }), block("button", 2, { ...buttonSettings, width: "full" })] },
  rent: { ...template, content_blocks: [block("vehicle_grid", 1, { ...gridSettings, layout: "one_column", product_mode: "rent2buy", selected_vehicles: [{ ...vehicle, finance: null, rent2buy: { monthly: "£795", initialRental: "£1,590", term: "48 months", url: "https://www.rent2buyvans.co.uk/van-one" } }] })] },
  legacy: { ...template, content_blocks: [], intro_text: "Hello {{first_name}}", main_body: "Current stock\n\n{{vehicle_grid}}", cta_text: "View the latest vans", cta_url: buttonSettings.url },
};

// SHA-256 of the complete pre-refresh HTML, captured from the original renderer.
// These deliberately lock both markup and inline/responsive styles for other masters.
const originalHashes = {
  selected: "5326db2c8cc2531e52aadfcfc5bbe774eaf08632abfa80ee52b0757aac7e5ba7",
  placeholder: "a2d23c433e265d75634be0ddde74e55cb3ccdb38b97aa9814917628eae0ef2b3",
  rent: "23ef47e733298bb65ca7e75ac80ec575408dfc3fbc1045d18cef2ce9790f2f16",
  legacy: "ca5ee0eb1aa01bf8ec2925f6ab043bf39f6690018a385f91267623fee8f26555",
};

for (const master of ["finance_offer", "rent2buy", "weekend_offer", "re_engagement", "newsletter", "custom_blank", undefined]) {
  test(`${master || "unspecified master"} retains byte-identical pre-refresh HTML`, () => {
    for (const [name, values] of Object.entries(regressionCases)) {
      const html = renderEmailHtml({ ...values, category: "new_stock", master_layout: master });
      assert.equal(createHash("sha256").update(html).digest("hex"), originalHashes[name], name);
      assert.doesNotMatch(html, /new-stock-/);
    }
  });
}

test("New Stock changes presentation while preserving snapshots, vehicle order, data, links and text", () => {
  const before = structuredClone(template);
  const html = renderEmailHtml(template);
  const classic = renderEmailHtml({ ...template, master_layout: "custom_blank" });
  assert.deepEqual(template, before);
  assert.match(html, /class="new-stock-email"/);
  assert.match(html, /max-width:720px/);
  assert.match(html, /bgcolor="#142536"/);
  assert.match(html, /width="318"/);
  assert.match(html, /font-size:26px;line-height:32px;">£18,995 \+ VAT/);
  assert.match(html, /font-size:20px;line-height:27px;color:#2557d6;">FROM £399 per month/);
  assert.match(html, /FROM £99 DEPOSIT/);
  assert.match(html, /mso-padding-alt:15px 20px/);
  assert.match(html, /class="new-stock-main-button"/);
  const attributes = (markup, name) => [...markup.matchAll(new RegExp(`${name}="([^"]+)"`, "g"))].map((match) => match[1]);
  assert.deepEqual(attributes(html, "href"), attributes(classic, "href"));
  assert.deepEqual(attributes(html, "src"), attributes(classic, "src"));
  for (const selected of gridSettings.selected_vehicles) {
    assert.ok(html.includes(selected.title));
    assert.ok(html.includes(selected.finance.price));
  }
  assert.ok(html.indexOf("Ford Transit Custom Limited") < html.indexOf("Volkswagen Transporter"));
  assert.ok(html.indexOf("Volkswagen Transporter") < html.indexOf("Mercedes-Benz Vito"));
  assert.match(html, /Vehicle image<\/td>/);
  assert.doesNotMatch(html, /Disabled copy|<script|display:(?:grid|flex)|@font-face/);
  const refreshed = renderCampaignPreview({ template_snapshot: template });
  const unchanged = renderCampaignPreview({ template_snapshot: { ...template, master_layout: "custom_blank" } });
  assert.equal(refreshed.subject, unchanged.subject);
  assert.equal(refreshed.preview_text, unchanged.preview_text);
});

test("New Stock supports one-column, full buttons, placeholders, legacy content and Rent2Buy snapshots", () => {
  const single = renderEmailHtml({ ...template, content_blocks: [block("vehicle_grid", 1, { ...gridSettings, layout: "one_column", selected_vehicles: [vehicle] }), block("button", 2, { ...buttonSettings, width: "full" })] });
  assert.match(single, /width="654"/);
  assert.match(single, /class="new-stock-main-button" role="presentation" width="100%"/);
  assert.doesNotMatch(single, /width:100%;padding:18px/);
  assert.match(single, /\[if mso\]/);
  assert.match(single, /\.new-stock-main-button \{ width:100% !important/);
  assert.match(single, /email-vehicle-card-cell:empty \{ display:none !important/);
  assert.match(renderEmailHtml(regressionCases.placeholder), /Preview only: dummy vehicle cards/);
  assert.match(renderEmailHtml(regressionCases.legacy), /Current stock/);
  const rent = renderEmailHtml(regressionCases.rent);
  assert.match(rent, /£795 monthly rental/);
  assert.match(rent, /Initial rental: £1,590/);
  assert.match(rent, /Term: 48 months/);
  assert.match(rent, /View Rent2Buy van/);
  assert.doesNotMatch(rent, /FROM £99 DEPOSIT/);
});

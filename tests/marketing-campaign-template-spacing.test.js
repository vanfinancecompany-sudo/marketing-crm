import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { renderEmailHtml } from "../lib/marketingCampaignTemplateRenderer.js";

function textBlock(position, body = "Closing copy") {
  return {
    id: `text-${position}`,
    type: "text",
    position,
    enabled: true,
    settings: {
      heading: "",
      body,
      alignment: "left",
      background_colour: "#ffffff",
      text_colour: "#1f2937",
      padding_size: "medium",
    },
  };
}

function vehicleGridBlock(position) {
  return {
    id: `vehicles-${position}`,
    type: "vehicle_grid",
    position,
    enabled: true,
    settings: {
      heading: "This Week's Featured Vehicles",
      intro_text: "Browse this week's selection.",
      number_of_vehicles: 2,
      layout: "two_column",
      source_mode: "newest",
      product_mode: "finance",
      selected_vehicles: [],
      placeholder_note: "",
      top_padding: 24,
    },
  };
}

function buttonBlock(position) {
  return {
    id: `button-${position}`,
    type: "button",
    position,
    enabled: true,
    settings: {
      text: "Browse all vans",
      url: "https://www.vanfinancecompany.co.uk/vans",
      alignment: "left",
      primary_colour: "#2563eb",
      text_colour: "#ffffff",
      width: "auto",
    },
  };
}

function renderBlocks(contentBlocks) {
  return renderEmailHtml({
    name: "Renderer spacing test",
    default_subject: "Renderer spacing test",
    preview_text: "Preview",
    hero_heading: "Latest vans",
    footer: "Footer",
    brand_colour: "#2563eb",
    secondary_colour: "#eef2ff",
    company_name: "Van Finance Company",
    master_layout: "custom_blank",
    content_blocks: contentBlocks,
  });
}

test("text followed by vehicle grid has one compact boundary and no trailing final-paragraph margin", () => {
  const html = renderBlocks([textBlock(1, "First paragraph.\n\nBrowse the latest arrivals below..."), vehicleGridBlock(2)]);

  assert.match(html, /First paragraph\.<\/p>[\s\S]*?margin:0 0 0px[^>]*>Browse the latest arrivals below\.\.\.<\/p>/);
  assert.doesNotMatch(html, /margin:0 0 16px[^>]*>Browse the latest arrivals below\.\.\.<\/p>/);
  assert.match(html, /padding:22px 30px 12px;background:#ffffff/);
  assert.match(html, /padding:8px 22px 24px;background:#ffffff/);
});

test("vehicle grid followed by button avoids cumulative grid-bottom and button-top padding", () => {
  const html = renderBlocks([vehicleGridBlock(1), buttonBlock(2)]);

  assert.match(html, /padding:24px 22px 4px;background:#ffffff/);
  assert.match(html, /margin:10px 0;/);
  assert.match(html, /padding:8px 30px 26px;background:#ffffff/);
  assert.doesNotMatch(html, /padding:24px 22px 24px;background:#ffffff;[\s\S]*?padding:8px 30px 26px/);
});

test("button followed by text splits the boundary spacing between adjacent table cells", () => {
  const html = renderBlocks([buttonBlock(1), textBlock(2)]);

  assert.match(html, /padding:8px 30px 10px;background:#ffffff/);
  assert.match(html, /padding:10px 30px 22px;background:#ffffff/);
  assert.doesNotMatch(html, /padding:8px 30px 26px;background:#ffffff;[\s\S]*?padding:22px 30px 22px/);
});

test("Email Template Live Preview uses the shared campaign and send renderer", () => {
  const source = fs.readFileSync(new URL("../api/marketing-email-templates.js", import.meta.url), "utf8");
  assert.match(source, /renderEmailHtml as renderSharedEmailHtml/);
  assert.match(source, /html: renderSharedEmailHtml\(\{ \.\.\.values, first_name: "Alex" \}\)/);
});

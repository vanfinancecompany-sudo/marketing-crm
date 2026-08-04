import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { vehiclesForSelection } from "../api/marketing-email-templates.js";
import { renderEmailHtml } from "../lib/marketingCampaignTemplateRenderer.js";
import { renderRecipientCampaignPreview } from "../lib/marketingRecipientPersonalization.js";

const selectorSource = fs.readFileSync(new URL("../public/email-templates/index.html", import.meta.url), "utf8");

function createSupabaseFixture() {
  const calls = [];
  const rows = {
    facebook_adverts: [{
      id: "finance-1",
      title: "2022 Ford Transit Custom AB22 CDE",
      picture: "https://images.example/finance.jpg",
      price: "£18,995",
      vat: "NO VAT",
      salePrice: "£399 per month",
      vanDescription: "Finance description",
      vanSpec: "Finance specification",
      weblink: "https://www.vanfinancecompany.co.uk/finance-van",
      is_active: true,
    }],
    rent_vehicles: [{
      id: "rent-1",
      registration: "XY23 ZZZ",
      picture: "https://images.example/rent.jpg",
      monthly: "£795",
      week: "48 months",
      initialRental: "£1,590",
      vanDescription: "Rent2Buy description",
      vanSpec: "Rent2Buy specification",
      webLink: "https://www.rent2buyvans.co.uk/van-pages/xy23zzz",
      is_active: true,
    }],
  };
  return {
    calls,
    from(table) {
      calls.push(table);
      return {
        select() { return this; },
        eq() { return this; },
        limit() { return Promise.resolve({ data: rows[table] || [], error: null }); },
      };
    },
  };
}

function selectedVehicleBlock(productMode, selectedVehicle) {
  return {
    id: `vehicles-${productMode}`,
    type: "vehicle_grid",
    position: 1,
    enabled: true,
    settings: {
      heading: "Featured vehicles",
      intro_text: "",
      number_of_vehicles: 1,
      layout: "two_column",
      source_mode: "selected",
      product_mode: productMode,
      selected_vehicles: [selectedVehicle],
      placeholder_note: "",
      top_padding: 0,
    },
  };
}

function vehicleEmailTemplate(block, brandColour = "#2563eb") {
  return {
    name: "Vehicle selector test",
    default_subject: "Vehicle selector test",
    preview_text: "Preview",
    hero_heading: "Vehicle selector test",
    footer: "Footer",
    brand_colour: brandColour,
    secondary_colour: "#eef2ff",
    company_name: "Van Finance Company",
    master_layout: "custom_blank",
    content_blocks: [block],
  };
}

function renderVehicleEmail(block, brandColour = "#2563eb") {
  return renderEmailHtml({
    ...vehicleEmailTemplate(block, brandColour),
  });
}

test("Finance mode returns only Finance inventory", async () => {
  const supabase = createSupabaseFixture();
  const result = await vehiclesForSelection(supabase, "finance");

  assert.deepEqual(supabase.calls, ["facebook_adverts"]);
  assert.equal(result.productMode, "finance");
  assert.equal(result.vehicles.length, 1);
  assert.equal(result.vehicles[0].finance.eligible, true);
  assert.equal(result.vehicles[0].rent2buy.eligible, false);
  assert.equal(result.vehicles[0].finance.price, "£18,995");
});

test("Rent2Buy mode returns only Rent2Buy inventory and its native fields", async () => {
  const supabase = createSupabaseFixture();
  const result = await vehiclesForSelection(supabase, "rent2buy");

  assert.deepEqual(supabase.calls, ["rent_vehicles"]);
  assert.equal(result.productMode, "rent2buy");
  assert.equal(result.vehicles.length, 1);
  assert.equal(result.vehicles[0].finance.eligible, false);
  assert.equal(result.vehicles[0].rent2buy.eligible, true);
  assert.equal(result.vehicles[0].rent2buy.monthly, "£795");
  assert.equal(result.vehicles[0].rent2buy.initialRental, "£1,590");
  assert.equal(result.vehicles[0].rent2buy.url, "https://www.rent2buyvans.co.uk/van-pages/xy23zzz");
});

test("changing Finance to Rent2Buy clears incompatible Finance selections", () => {
  assert.match(selectorSource, /target\.dataset\.blockSetting === "product_mode"\) block\.settings\.selected_vehicles = \[\]/);
  assert.match(selectorSource, /state\.selector\.mode = elements\.selectorMode\.value; state\.selector\.selected = \[\]/);
});

test("changing Rent2Buy to Finance clears incompatible Rent2Buy selections", () => {
  assert.match(selectorSource, /Switching product mode will remove incompatible selections/);
  assert.match(selectorSource, /state\.selector\.selected = \[\]; state\.selector\.search = ""/);
});

test("selector search is scoped to the active product inventory", () => {
  assert.match(selectorSource, /postJson\(TEMPLATE_API, \{ action: "vehiclesForSelection", productMode: mode \}\)/);
  assert.match(selectorSource, /const activeInventory = state\.vehiclesByMode\[mode\] \|\| \[\]; const vehicles = activeInventory\.filter/);
  assert.match(selectorSource, /vehicleSearchText\(vehicle\)\.includes\(query\)/);
});

test("Rent2Buy preview cards use Rent2Buy payments and advert URL, never Finance cash price", () => {
  const html = renderVehicleEmail(selectedVehicleBlock("rent2buy", {
    selection_id: "rent2buy:rent-1",
    source_id: "rent-1",
    registration: "XY23 ZZZ",
    title: "Ford Transit Custom Rent2Buy",
    description: "Rent2Buy description",
    spec: "Rent2Buy specification",
    primary_image_url: "https://images.example/rent.jpg",
    finance: null,
    rent2buy: {
      monthly: "£795",
      initialRental: "£1,590",
      term: "48 months",
      url: "https://www.rent2buyvans.co.uk/van-pages/xy23zzz",
    },
  }));

  assert.match(html, /£795 monthly rental/);
  assert.match(html, /Initial rental: £1,590/);
  assert.match(html, /https:\/\/www\.rent2buyvans\.co\.uk\/van-pages\/xy23zzz/);
  assert.doesNotMatch(html, /£18,995|NO VAT|FROM £399 per month/);
});

test("existing Finance vehicle cards retain their cash, VAT and monthly presentation", () => {
  const html = renderVehicleEmail(selectedVehicleBlock("finance", {
    selection_id: "finance:finance-1",
    source_id: "finance-1",
    registration: "AB22 CDE",
    title: "2022 Ford Transit Custom AB22 CDE",
    description: "Finance description",
    spec: "Finance specification",
    primary_image_url: "https://images.example/finance.jpg",
    finance: {
      price: "£18,995",
      vat: "NO VAT",
      monthly: "£399 per month",
      url: "https://www.vanfinancecompany.co.uk/finance-van",
    },
    rent2buy: null,
  }));

  assert.match(html, /£18,995 NO VAT \| FROM £399 per month/);
  assert.match(html, /FROM £99 DEPOSIT/);
  assert.match(html, /https:\/\/www\.vanfinancecompany\.co\.uk\/finance-van/);
});

test("Finance and Rent2Buy vehicle buttons inherit the template Primary Colour with white text", () => {
  const financeVehicle = {
    selection_id: "finance:finance-1",
    source_id: "finance-1",
    registration: "AB22 CDE",
    title: "2022 Ford Transit Custom AB22 CDE",
    primary_image_url: "https://images.example/finance.jpg",
    finance: { price: "£18,995", vat: "NO VAT", monthly: "£399 per month", url: "https://www.vanfinancecompany.co.uk/finance-van" },
    rent2buy: null,
  };
  const rentVehicle = {
    selection_id: "rent2buy:rent-1",
    source_id: "rent-1",
    registration: "XY23 ZZZ",
    title: "Ford Transit Custom Rent2Buy",
    primary_image_url: "https://images.example/rent.jpg",
    finance: null,
    rent2buy: { monthly: "£795", initialRental: "£1,590", term: "48 months", url: "https://www.rent2buyvans.co.uk/van-pages/xy23zzz" },
  };

  const financeHtml = renderVehicleEmail(selectedVehicleBlock("finance", financeVehicle), "#8B0000");
  const rentHtml = renderVehicleEmail(selectedVehicleBlock("rent2buy", rentVehicle), "#8B0000");

  assert.match(financeHtml, /bgcolor="#8B0000" style="border-radius:7px;"[^>]*><a[^>]*color:#ffffff[^>]*>View van<\/a>/);
  assert.match(rentHtml, /bgcolor="#8B0000" style="border-radius:7px;"[^>]*><a[^>]*color:#ffffff[^>]*>View Rent2Buy van<\/a>/);
  assert.doesNotMatch(financeHtml, /bgcolor="#2563eb" style="border-radius:7px;"/);
  assert.doesNotMatch(rentHtml, /bgcolor="#2563eb" style="border-radius:7px;"/);
});

test("dummy View Van preview cards inherit the template Primary Colour", () => {
  const block = selectedVehicleBlock("finance", {});
  block.settings.source_mode = "newest";
  block.settings.selected_vehicles = [];

  const html = renderVehicleEmail(block, "#8B0000");
  assert.match(html, /bgcolor="#8B0000" style="border-radius:7px;"[^>]*><a[^>]*color:#ffffff[^>]*>View Van<\/a>/);
  assert.doesNotMatch(html, /bgcolor="#2563eb" style="border-radius:7px;"/);
});

test("test and final recipient email HTML preserve the Primary Colour on vehicle buttons", () => {
  const vehicle = {
    selection_id: "finance:finance-1",
    source_id: "finance-1",
    registration: "AB22 CDE",
    title: "2022 Ford Transit Custom AB22 CDE",
    primary_image_url: "https://images.example/finance.jpg",
    finance: { price: "£18,995", vat: "NO VAT", monthly: "£399 per month", url: "https://www.vanfinancecompany.co.uk/finance-van" },
    rent2buy: null,
  };
  const templateSnapshot = vehicleEmailTemplate(selectedVehicleBlock("finance", vehicle), "#8B0000");
  const campaign = { subject_line: "Vehicle offer", preview_text: "Preview", template_snapshot: templateSnapshot };

  const testEmail = renderRecipientCampaignPreview(campaign, { first_name: "Stuart" }, { mode: "test" });
  const finalEmail = renderRecipientCampaignPreview(campaign, { first_name: "Customer" }, { mode: "recipient" });

  for (const rendered of [testEmail, finalEmail]) {
    assert.match(rendered.html, /bgcolor="#8B0000" style="border-radius:7px;"[^>]*><a[^>]*color:#ffffff[^>]*>View van<\/a>/);
    assert.doesNotMatch(rendered.html, /bgcolor="#2563eb" style="border-radius:7px;"/);
  }
});

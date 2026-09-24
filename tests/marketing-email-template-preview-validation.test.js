import test from "node:test";
import assert from "node:assert/strict";
import {
  previewTemplate,
  validateTemplate,
} from "../api/marketing-email-templates.js";

function emptySelectedGridTemplate(overrides = {}) {
  return {
    name: "New Stock Email",
    description: "",
    category: "new_stock",
    default_subject: "Fresh vans have just landed",
    preview_text: "Latest vans ready to view.",
    header_logo: "",
    hero_heading: "Fresh vans have just landed",
    intro_text: "",
    main_body: "",
    cta_text: "",
    cta_url: "",
    footer: "Van Finance Company Ltd.",
    brand_colour: "#2557d6",
    company_name: "Van Finance Company",
    secondary_colour: "#eef2ff",
    social_links: "",
    master_layout: "new_stock",
    content_blocks: [{
      id: "grid-1",
      type: "vehicle_grid",
      position: 1,
      enabled: true,
      settings: {
        heading: "Latest vans to view",
        intro_text: "Browse the latest arrivals below.",
        top_padding: 0,
        number_of_vehicles: 3,
        layout: "two_column",
        source_mode: "selected",
        product_mode: "finance",
        selected_vehicles: [],
        placeholder_note: "",
      },
    }],
    status: "active",
    ...overrides,
  };
}

test("preview allows an active selected vehicle grid with no vehicles and renders placeholders", async () => {
  const result = await previewTemplate(null, { template: emptySelectedGridTemplate() });
  assert.match(result.preview.html, /Preview only: dummy vehicle cards are shown until vehicles are selected\./);
  assert.match(result.preview.html, /Vehicle image placeholder/);
});

test("normal active-template validation still rejects an empty selected vehicle grid", () => {
  assert.throws(
    () => validateTemplate(emptySelectedGridTemplate()),
    /Active templates cannot contain an enabled selected vehicle grid with no selected vehicles\./
  );
});

test("preview-only allowance does not disable other required validation", () => {
  assert.throws(
    () => validateTemplate(emptySelectedGridTemplate({ name: "" }), { allowEmptySelectedVehicleGrid: true }),
    /Template name is required\./
  );
});

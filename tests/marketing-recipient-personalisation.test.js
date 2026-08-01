import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertProductionPersonalization,
  renderRecipientCampaignPreview,
  replaceRecipientPlaceholders,
} from "../lib/marketingEmailTemplateRenderer.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

function campaign() {
  return {
    name: "Personalised campaign",
    subject_line: "New vans for {{first_name}}",
    preview_text: "{{first_name}}, three vans are ready",
    template_snapshot: {
      snapshot_version: 1,
      source_template_id: "template-1",
      source_template_updated_at: "2026-08-01T00:00:00.000Z",
      name: "Personalised campaign",
      category: "custom",
      default_subject: "New vans for {{first_name}}",
      preview_text: "{{first_name}}, three vans are ready",
      header_logo: "",
      hero_heading: "Hi {{first_name}}",
      intro_text: "Hi {{first_name}},",
      main_body: "Here are {{vehicle_count}} vans for {{company}}.",
      cta_text: "View vans, {{first_name}}",
      cta_url: "https://www.vanfinancecompany.co.uk/vans-on-finance?customer={{customer_id}}",
      footer: "Thanks {{first_name}}",
      brand_colour: "#2563eb",
      secondary_colour: "#eef2ff",
      company_name: "Van Finance Company",
      social_links: "",
      master_layout: "custom_blank",
      content_blocks: [
        {
          id: "text-1",
          type: "text",
          position: 1,
          enabled: true,
          settings: {
            heading: "Hi {{first_name}}",
            body: "Selected for {{company}}",
            alignment: "left",
            background_colour: "#ffffff",
            text_colour: "#1f2937",
            padding_size: "medium",
          },
        },
        {
          id: "button-1",
          type: "button",
          position: 2,
          enabled: true,
          settings: {
            text: "Open for {{first_name}}",
            url: "https://www.vanfinancecompany.co.uk/vans-on-finance?customer={{customer_id}}",
            alignment: "left",
            primary_colour: "#2563eb",
            text_colour: "#ffffff",
            width: "auto",
          },
        },
        {
          id: "vehicle-grid-1",
          type: "vehicle_grid",
          position: 3,
          enabled: true,
          settings: {
            heading: "Latest vans",
            intro_text: "Prepared for {{first_name}}",
            number_of_vehicles: 3,
            layout: "one_column",
            source_mode: "newest",
            product_mode: "finance",
            selected_vehicles: [],
            placeholder_note: "",
            top_padding: 24,
          },
        },
      ],
    },
  };
}

test("Jane and John receive different recipient-specific renders", () => {
  const jane = renderRecipientCampaignPreview(campaign(), {
    first_name: "  Jane  ", company: "Jane Ltd", customer_id: "CUST-JANE",
  });
  const john = renderRecipientCampaignPreview(campaign(), {
    first_name: "John", company: "John Ltd", customer_id: "CUST-JOHN",
  });
  assert.match(jane.html, /Hi Jane/);
  assert.match(john.html, /Hi John/);
  assert.notEqual(jane.html, john.html);
  assert.equal(jane.subject, "New vans for Jane");
  assert.equal(john.subject, "New vans for John");
  assert.equal(jane.preview_text, "Jane, three vans are ready");
  assert.equal(john.preview_text, "John, three vans are ready");
  assert.match(jane.html, /customer=CUST-JANE/);
  assert.match(john.html, /customer=CUST-JOHN/);
  assert.match(jane.html, /Vehicle image placeholder/);
});

test("blank first names use there and never leak Alex", () => {
  const rendered = renderRecipientCampaignPreview(campaign(), {
    first_name: "   ", company: "Van Finance Company", customer_id: "CUST-EMPTY",
  });
  assert.match(rendered.html, /Hi there/);
  assert.equal(rendered.subject, "New vans for there");
  assert.equal(rendered.preview_text, "there, three vans are ready");
  assert.doesNotMatch(rendered.html, /\bAlex\b/);
});

test("explicit test first name is independent of destination email", () => {
  const rendered = renderRecipientCampaignPreview(
    campaign(),
    { first_name: "Stuart", customer_id: "TEST" },
    { mode: "test" },
  );
  assert.match(rendered.html, /Hi Stuart/);
  assert.equal(rendered.personalization.mode, "test");
  assertProductionPersonalization(rendered);
});

test("unresolved placeholders cannot reach a provider", () => {
  const rendered = renderRecipientCampaignPreview(campaign(), { first_name: "Jane" });
  rendered.html += "{{unknown_value}}";
  assert.throws(
    () => assertProductionPersonalization(rendered),
    /unresolved marketing placeholder/i,
  );
});

test("designer sample mode is rejected for provider submission", () => {
  const rendered = renderRecipientCampaignPreview(
    campaign(),
    {},
    { mode: "designer_preview" },
  );
  assert.match(rendered.html, /Hi Alex/);
  assert.throws(
    () => assertProductionPersonalization(rendered),
    /designer sample data/i,
  );
});

test("recipient unsubscribe URLs remain independently replaceable", () => {
  const janeUrl = "https://example.test/unsubscribe?token=jane";
  const johnUrl = "https://example.test/unsubscribe?token=john";
  const jane = `${renderRecipientCampaignPreview(campaign(), { first_name: "Jane" }).html}<a href="${janeUrl}">unsubscribe</a>`;
  const john = `${renderRecipientCampaignPreview(campaign(), { first_name: "John" }).html}<a href="${johnUrl}">unsubscribe</a>`;
  assert.match(jane, /token=jane/);
  assert.doesNotMatch(jane, /token=john/);
  assert.match(john, /token=john/);
});

test("production send route renders inside the recipient loop and guards providers", async () => {
  const sends = await read("../api/marketing-template-campaign-sends.js");
  assert.match(sends, /for \(const recipient of selectedRecipients\)[\s\S]*renderFrozenCampaign\(campaign,[\s\S]*first_name: recipient\.first_name/);
  assert.match(sends, /assertProductionPersonalization\(rendered\)[\s\S]*callEmailProvider/);
  assert.doesNotMatch(sends, /const renderedBase = renderFrozenCampaign/);
  assert.match(sends, /test_first_name \|\| body\.testFirstName \|\| "Stuart"/);
  assert.match(sends, /unsubscribeUrl/);
});

test("placeholder helper trims supplied first names", () => {
  assert.equal(replaceRecipientPlaceholders("Hi {{first_name}}", { first_name: " Jane " }), "Hi Jane");
  assert.equal(replaceRecipientPlaceholders("Hi {{first_name}}", {}), "Hi there");
});

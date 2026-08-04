import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertProductionPersonalization,
  finalizeProviderEmailTemplate,
  renderCampaignPreview,
  renderRecipientCampaignPreview,
  replaceRecipientPlaceholders,
} from "../lib/marketingEmailTemplateRenderer.js";
import { callEmailProvider, renderFrozenCampaign } from "../api/marketing-template-campaign-sends.js";
import { renderDesignerCampaignPreview } from "../api/marketing-template-campaigns.js";
import { renderLegacySendGridTestCampaign } from "../api/sendgrid-test-email.js";

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

test("recipient first names are ignored while non-name substitutions remain independent", () => {
  const jane = renderRecipientCampaignPreview(campaign(), {
    first_name: "  Jane  ", company: "Jane Ltd", customer_id: "CUST-JANE",
  });
  const john = renderRecipientCampaignPreview(campaign(), {
    first_name: "John", company: "John Ltd", customer_id: "CUST-JOHN",
  });
  assert.match(jane.html, /Hi there/);
  assert.match(john.html, /Hi there/);
  assert.notEqual(jane.html, john.html);
  assert.equal(jane.subject, "New vans for there");
  assert.equal(john.subject, "New vans for there");
  assert.equal(jane.preview_text, "there, three vans are ready");
  assert.equal(john.preview_text, "there, three vans are ready");
  assert.match(jane.html, /customer=CUST-JANE/);
  assert.match(john.html, /customer=CUST-JOHN/);
  assert.match(jane.html, /Vehicle image placeholder/);
});

test("mock provider receives fixed greetings with independent unsubscribe data", async () => {
  const calls = [];
  const mockProvider = async (payload) => {
    calls.push(structuredClone(payload));
    return { messageId: `mock-${calls.length}` };
  };
  const recipients = [
    { email: "jane@example.test", first_name: "Jane", last_name: "Jones", company: "Jane Ltd", customer_id: "CUST-JANE", unsubscribe: "https://example.test/unsubscribe?token=jane" },
    { email: "john@example.test", first_name: "John", last_name: "Smith", company: "John Ltd", customer_id: "CUST-JOHN", unsubscribe: "https://example.test/unsubscribe?token=john" },
  ];

  for (const recipient of recipients) {
    const rendered = renderFrozenCampaign(campaign(), {
      mode: "recipient",
      unsubscribeUrl: recipient.unsubscribe,
      values: {
        first_name: recipient.first_name,
        last_name: recipient.last_name,
        company: recipient.company,
        customer_id: recipient.customer_id,
        campaign_name: campaign().name,
      },
    });
    assertProductionPersonalization(rendered);
    await mockProvider({
      to: recipient.email,
      subject: rendered.subject,
      preview_text: rendered.preview_text,
      html: rendered.html,
      text: rendered.text,
    });
  }

  assert.equal(calls.length, 2);
  assert.match(calls[0].html, /Hi there,/);
  assert.match(calls[1].html, /Hi there,/);
  assert.match(calls[0].text, /Hi there,/);
  assert.match(calls[1].text, /Hi there,/);
  assert.notEqual(calls[0].html, calls[1].html);
  assert.equal(calls[0].subject, "New vans for there");
  assert.equal(calls[1].subject, "New vans for there");
  assert.equal(calls[0].preview_text, "there, three vans are ready");
  assert.equal(calls[1].preview_text, "there, three vans are ready");
  assert.match(calls[0].html, /token=jane/);
  assert.doesNotMatch(calls[0].html, /token=john/);
  assert.match(calls[1].html, /token=john/);
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

test("base and explicit designer previews use Alex", () => {
  const base = renderCampaignPreview(campaign());
  const explicit = renderRecipientCampaignPreview(campaign(), {}, { mode: "designer_preview" });
  assert.equal(base.subject, "New vans for Alex");
  assert.match(base.html, /Hi Alex/);
  assert.equal(explicit.subject, "New vans for Alex");
  assert.match(explicit.html, /Hi Alex/);
  assert.equal(explicit.personalization.mode, "designer_preview");
});

test("test mode always uses the fixed greeting", () => {
  const rendered = renderRecipientCampaignPreview(campaign(), { first_name: "   " }, { mode: "test" });
  assert.equal(rendered.subject, "New vans for there");
  assert.match(rendered.html, /Hi there/);
  assert.equal(rendered.personalization.first_name, "there");
  assertProductionPersonalization(rendered);
});

test("a supplied recipient name cannot enter provider rendering", () => {
  const rendered = renderRecipientCampaignPreview(campaign(), { first_name: "Alex" }, { mode: "recipient" });
  assert.equal(rendered.subject, "New vans for there");
  assert.match(rendered.html, /Hi there/);
  assert.equal(rendered.personalization.designer_sample_used, false);
  assertProductionPersonalization(rendered);
});

test("campaign preview endpoint explicitly uses designer preview mode", () => {
  const rendered = renderDesignerCampaignPreview(campaign());
  assert.equal(rendered.subject, "New vans for Alex");
  assert.match(rendered.html, /Hi Alex/);
  assert.equal(rendered.personalization.mode, "designer_preview");
});

test("legacy SendGrid Email Templates test rendering ignores names", () => {
  const fallback = renderLegacySendGridTestCampaign(campaign(), { test_first_name: "   " });
  const named = renderLegacySendGridTestCampaign(campaign(), { test_first_name: "Jane" });
  assert.equal(fallback.subject, "[SENDGRID TEST] New vans for there");
  assert.match(fallback.html, /Hi there,/);
  assert.match(fallback.text, /Hi there,/);
  assert.equal(named.subject, "[SENDGRID TEST] New vans for there");
  assert.match(named.html, /Hi there,/);
  assert.doesNotMatch(named.html, /Hi Alex/);
});

test("explicit test first name is ignored", () => {
  const rendered = renderRecipientCampaignPreview(
    campaign(),
    { first_name: "Stuart", customer_id: "TEST" },
    { mode: "test" },
  );
  assert.match(rendered.html, /Hi there/);
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
  const jane = renderFrozenCampaign(campaign(), {
    mode: "recipient",
    unsubscribeUrl: janeUrl,
    values: { first_name: "Jane", customer_id: "CUST-JANE" },
  }).html;
  const john = renderFrozenCampaign(campaign(), {
    mode: "recipient",
    unsubscribeUrl: johnUrl,
    values: { first_name: "John", customer_id: "CUST-JOHN" },
  }).html;
  assert.match(jane, /token=jane/);
  assert.doesNotMatch(jane, /token=john/);
  assert.match(john, /token=john/);
});

test("production send route renders inside the recipient loop and guards providers", async () => {
  const sends = await read("../api/marketing-template-campaign-sends.js");
  assert.match(sends, /for \(const recipient of selectedRecipients\)[\s\S]*renderFrozenCampaign\(campaign,/);
  assert.match(sends, /assertProductionPersonalization\(rendered\)[\s\S]*callEmailProvider/);
  assert.doesNotMatch(sends, /const renderedBase = renderFrozenCampaign/);
  assert.doesNotMatch(sends, /test_first_name|testFirstName/);
  assert.match(sends, /unsubscribeUrl/);
});

test("placeholder helper ignores supplied first names outside designer preview", () => {
  assert.equal(replaceRecipientPlaceholders("Hi {{first_name}}", { first_name: " Jane " }), "Hi there");
  assert.equal(replaceRecipientPlaceholders("Hi {{first_name}}", {}), "Hi there");
});

for (const oldGreeting of ["Hi Alex,", "Hi {{first_name}},", "Hi Tim,"]) {
  test(`${oldGreeting} is replaced in provider HTML and plain text`, () => {
    const finalized = finalizeProviderEmailTemplate({
      subject: "Vehicle update",
      html: `<html><body><p>${oldGreeting}</p><p>Your vans are ready.</p></body></html>`,
      text: `${oldGreeting}\n\nYour vans are ready.`,
    });
    assert.match(finalized.html, /<p>Hi there,<\/p>/);
    assert.match(finalized.text, /^Hi there,/);
    assert.doesNotMatch(finalized.html, /Alex|Tim|first_name/i);
    assert.doesNotMatch(finalized.text, /Alex|Tim|first_name/i);
  });
}

test("an old materialised Alex greeting is corrected before the provider guard", () => {
  const oldCampaign = campaign();
  oldCampaign.template_snapshot.hero_heading = "Hi Alex,";
  oldCampaign.template_snapshot.content_blocks[0].settings.heading = "Hi Alex,";
  const rendered = renderFrozenCampaign(oldCampaign, { mode: "recipient" });

  assert.doesNotThrow(() => assertProductionPersonalization(rendered));
  assert.match(rendered.html, /Hi there,/);
  assert.match(rendered.text, /Hi there,/);
  assert.doesNotMatch(rendered.html, /Hi Alex,/);
});

for (const productMode of ["finance", "rent2buy"]) {
  test(`${productMode} mocked provider send preserves unsubscribe and tracking`, async () => {
    const productCampaign = campaign();
    productCampaign.template_snapshot.content_blocks[2].settings.product_mode = productMode;
    const unsubscribeUrl = `https://example.test/unsubscribe?token=${productMode}`;
    const rendered = renderFrozenCampaign(productCampaign, {
      mode: "recipient",
      unsubscribeUrl,
      values: { first_name: "Alex", customer_id: `CUST-${productMode.toUpperCase()}` },
    });
    assertProductionPersonalization(rendered);
    const requests = [];
    const result = await callEmailProvider({
      to: `${productMode}@example.test`,
      name: "Customer",
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tags: ["marketing-crm", productMode],
      sendType: "production",
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "X-Marketing-Campaign-Id": `campaign-${productMode}`,
        "X-Marketing-Send-Id": `send-${productMode}`,
        "X-Marketing-Recipient-Id": `recipient-${productMode}`,
      },
    }, {
      provider: "sendgrid",
      environment: providerEnvironment,
      fetchImpl: async (url, options) => {
        requests.push({ url, body: JSON.parse(options.body) });
        return providerResponse("sendgrid", 1);
      },
    });

    assert.equal(result.messageId, "sendgrid-1");
    assert.equal(requests.length, 1);
    const payload = requests[0].body;
    assert.match(payload.content[0].value, /Hi there,/);
    assert.match(payload.content[1].value, /Hi there,/);
    assert.match(payload.content[1].value, new RegExp(`token=${productMode}`));
    assert.equal(payload.personalizations[0].headers["List-Unsubscribe"], `<${unsubscribeUrl}>`);
    assert.equal(payload.personalizations[0].custom_args.marketing_campaign_id, `campaign-${productMode}`);
  });
}

function providerResponse(provider, index) {
  if (provider === "sendgrid") {
    return {
      ok: true,
      status: 202,
      headers: { get: (name) => name.toLowerCase() === "x-message-id" ? `sendgrid-${index}` : "" },
      text: async () => "",
    };
  }
  if (provider === "brevo") {
    return { ok: true, status: 201, text: async () => JSON.stringify({ messageId: `brevo-${index}` }) };
  }
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ data: { succeeded: 1, failed: 0, email_id: `smtp2go-${index}` } }),
  };
}

const providerEnvironment = {
  SENDGRID_API_KEY: "SG.abcdefghijklmnop.abcdefghijklmnopqrstuvwxyz123456",
  BREVO_API_KEY: "brevo-mocked-key",
  BREVO_SENDER_EMAIL: "sender@example.test",
  BREVO_SENDER_NAME: "Mock Sender",
  SMTP2GO_API_KEY: "smtp2go-mocked-key",
  SMTP2GO_SENDER_EMAIL: "sender@example.test",
  SMTP2GO_SENDER_NAME: "Mock Sender",
};

for (const provider of ["sendgrid", "brevo", "smtp2go"]) {
  test(`${provider} adapter submits fixed-greeting HTML and plain text using mocked fetch`, async () => {
    const requests = [];
    const fetchImpl = async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return providerResponse(provider, requests.length);
    };
    for (const firstName of ["Jane", "John"]) {
      const rendered = renderFrozenCampaign(campaign(), {
        mode: "recipient",
        unsubscribeUrl: `https://example.test/unsubscribe?token=${firstName.toLowerCase()}`,
        values: { first_name: firstName, customer_id: `CUST-${firstName.toUpperCase()}` },
      });
      assertProductionPersonalization(rendered);
      await callEmailProvider({
        to: `${firstName.toLowerCase()}@example.test`,
        name: firstName,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        tags: ["marketing-crm", "test"],
        sendType: "test",
        headers: {
          "X-Marketing-Campaign-Id": "campaign-test",
          "X-Marketing-Send-Id": `send-${firstName.toLowerCase()}`,
          "X-Marketing-Recipient-Id": `recipient-${firstName.toLowerCase()}`,
        },
      }, { provider, environment: providerEnvironment, fetchImpl });
    }

    assert.equal(requests.length, 2);
    const submitted = requests.map(({ body }) => provider === "brevo"
      ? { subject: body.subject, html: body.htmlContent, text: body.textContent }
      : provider === "smtp2go"
        ? { subject: body.subject, html: body.html_body, text: body.text_body }
        : { subject: body.subject, text: body.content[0].value, html: body.content[1].value });
    assert.equal(submitted[0].subject, "New vans for there");
    assert.equal(submitted[1].subject, "New vans for there");
    assert.match(submitted[0].html, /Hi there,/);
    assert.match(submitted[1].html, /Hi there,/);
    assert.match(submitted[0].text, /Hi there,/);
    assert.match(submitted[1].text, /Hi there,/);
    assert.notEqual(submitted[0].html, submitted[1].html);
  });
}

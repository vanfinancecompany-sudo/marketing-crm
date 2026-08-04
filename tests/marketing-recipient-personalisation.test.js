import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  assertProductionPersonalization,
  campaignFromOriginalTemplateSource,
  normalizeRecipientFirstName,
  renderCampaignPreview,
  renderRecipientCampaignPreview,
  replaceRecipientPlaceholders,
} from "../lib/marketingEmailTemplateRenderer.js";
import { callEmailProvider, loadProviderCampaignSource, renderFrozenCampaign } from "../api/marketing-template-campaign-sends.js";
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
            body: "Hi {{first_name}},\n\nSelected for {{company}}",
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

function originalTemplateSource() {
  const sourceCampaign = campaign();
  const snapshot = sourceCampaign.template_snapshot;
  return {
    ...snapshot,
    id: snapshot.source_template_id,
    updated_at: snapshot.source_template_updated_at,
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

test("mock provider receives independently rendered Stuart and Jane payloads", async () => {
  const calls = [];
  const mockProvider = async (payload) => {
    calls.push(structuredClone(payload));
    return { messageId: `mock-${calls.length}` };
  };
  const recipients = [
    { email: "stuart@example.test", first_name: "Stuart", last_name: "Weston", company: "Van Finance Company", customer_id: "CUST-STUART", unsubscribe: "https://example.test/unsubscribe?token=stuart" },
    { email: "jane@example.test", first_name: "Jane", last_name: "Jones", company: "Jane Ltd", customer_id: "CUST-JANE", unsubscribe: "https://example.test/unsubscribe?token=jane" },
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
    });
  }

  assert.equal(calls.length, 2);
  assert.match(calls[0].html, /Hi Stuart/);
  assert.match(calls[1].html, /Hi Jane/);
  assert.notEqual(calls[0].html, calls[1].html);
  assert.equal(calls[0].subject, "New vans for Stuart");
  assert.equal(calls[1].subject, "New vans for Jane");
  assert.equal(calls[0].preview_text, "Stuart, three vans are ready");
  assert.equal(calls[1].preview_text, "Jane, three vans are ready");
  assert.match(calls[0].html, /token=stuart/);
  assert.doesNotMatch(calls[0].html, /token=jane/);
  assert.match(calls[1].html, /token=jane/);
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

test("only explicit designer previews use Alex", () => {
  const base = renderCampaignPreview(campaign());
  const explicit = renderRecipientCampaignPreview(campaign(), {}, { mode: "designer_preview" });
  assert.equal(base.subject, "New vans for there");
  assert.match(base.html, /Hi there/);
  assert.doesNotMatch(base.html, /Hi Alex/);
  assert.equal(explicit.subject, "New vans for Alex");
  assert.match(explicit.html, /Hi Alex/);
  assert.equal(explicit.personalization.mode, "designer_preview");
});

test("test mode with a blank first name defaults to Stuart", () => {
  const rendered = renderRecipientCampaignPreview(campaign(), { first_name: "   " }, { mode: "test" });
  assert.equal(rendered.subject, "New vans for Stuart");
  assert.match(rendered.html, /Hi Stuart/);
  assert.equal(rendered.personalization.first_name, "Stuart");
  assertProductionPersonalization(rendered);
});

test("internal tests render explicitly supplied Stuart and Sarah names", () => {
  const stuart = renderFrozenCampaign(campaign(), { test: true, mode: "test", values: { first_name: "Stuart" } });
  const sarah = renderFrozenCampaign(campaign(), { test: true, mode: "test", values: { first_name: "Sarah" } });
  assert.match(stuart.html, /Hi Stuart/);
  assert.doesNotMatch(stuart.html, /Hi Alex/);
  assert.match(sarah.html, /Hi Sarah/);
  assert.doesNotMatch(sarah.html, /Hi Alex/);
  assertProductionPersonalization(stuart);
  assertProductionPersonalization(sarah);
});

test("blank and malformed production first names use there", () => {
  for (const firstName of ["", "   ", null, "jane@example.test", "https://example.test/name", "12345", "<script>"]) {
    const rendered = renderFrozenCampaign(campaign(), { mode: "recipient", values: { first_name: firstName } });
    assert.match(rendered.html, /Hi there/);
    assert.doesNotMatch(rendered.html, /Hi Alex/);
    assertProductionPersonalization(rendered);
  }
});

test("consecutive recipients cannot inherit the previous first name", () => {
  const first = renderFrozenCampaign(campaign(), { mode: "recipient", values: { first_name: "Stuart" } });
  const blank = renderFrozenCampaign(campaign(), { mode: "recipient", values: { first_name: "" } });
  const third = renderFrozenCampaign(campaign(), { mode: "recipient", values: { first_name: "Jane" } });
  assert.match(first.html, /Hi Stuart/);
  assert.match(blank.html, /Hi there/);
  assert.doesNotMatch(blank.html, /Hi Stuart|Hi Jane|Hi Alex/);
  assert.match(third.html, /Hi Jane/);
  assert.doesNotMatch(third.html, /Hi Stuart|Hi Alex/);
});

test("designer sample data is rejected if it leaks into a test or recipient render", () => {
  const staleSampleCampaign = campaign();
  staleSampleCampaign.template_snapshot.content_blocks[0].settings.body = "Hi Alex,\n\nThis stale designer preview must not be sent.";
  for (const [mode, firstName] of [["test", "Stuart"], ["recipient", "Jane"]]) {
    const rendered = renderRecipientCampaignPreview(staleSampleCampaign, { first_name: firstName }, { mode });
    assert.equal(rendered.personalization.designer_sample_leaked, true);
    assert.throws(() => assertProductionPersonalization(rendered), /designer sample data/i);
  }
});

test("a genuine recipient named Alex remains valid", () => {
  const rendered = renderRecipientCampaignPreview(campaign(), { first_name: "Alex" }, { mode: "recipient" });
  assert.equal(rendered.subject, "New vans for Alex");
  assert.equal(rendered.personalization.designer_sample_used, false);
  assertProductionPersonalization(rendered);
});

test("campaign preview endpoint explicitly uses designer preview mode", () => {
  const rendered = renderDesignerCampaignPreview(campaign());
  assert.equal(rendered.subject, "New vans for Alex");
  assert.match(rendered.html, /Hi Alex/);
  assert.equal(rendered.personalization.mode, "designer_preview");
});

test("provider test discards materialised designer preview data and freshly renders Tim from original source", () => {
  const sourceCampaign = campaign();
  const designerPreview = renderDesignerCampaignPreview(sourceCampaign);
  assert.match(designerPreview.html, /Hi Alex/);

  const contaminatedCampaign = structuredClone(sourceCampaign);
  contaminatedCampaign.subject_line = "New vans for Alex";
  contaminatedCampaign.preview_text = "Alex, three vans are ready";
  contaminatedCampaign.template_snapshot.hero_heading = "Hi Alex";
  contaminatedCampaign.template_snapshot.content_blocks[0].settings.heading = "Hi Alex";
  contaminatedCampaign.template_snapshot.content_blocks[0].settings.body = "Hi Alex,\n\nSelected for Van Finance Company";
  contaminatedCampaign.template_snapshot.footer = "Thanks Alex";

  const recovered = campaignFromOriginalTemplateSource(contaminatedCampaign, originalTemplateSource());
  assert.equal(recovered.refreshed, true);
  assert.equal(recovered.campaign.template_snapshot.content_blocks[0].settings.heading, "Hi {{first_name}}");
  assert.equal(Object.prototype.hasOwnProperty.call(recovered.campaign, "preview"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(recovered.campaign.template_snapshot, "html"), false);

  const providerBound = renderFrozenCampaign(recovered.campaign, {
    test: true,
    mode: "test",
    values: { first_name: "tim" },
  });
  const greeting = providerBound.html.match(/Hi [\p{L}\p{M}'’.-]+,/u)?.[0];
  assert.equal(greeting, "Hi Tim,");
  assert.doesNotMatch(providerBound.html, /\bAlex\b/);
  assert.equal(providerBound.personalization.designer_sample_leaked, false);
  assert.doesNotThrow(() => assertProductionPersonalization(providerBound));

  const sarah = renderFrozenCampaign(recovered.campaign, { test: true, mode: "test", values: { first_name: "Sarah" } });
  const blank = renderFrozenCampaign(recovered.campaign, { test: true, mode: "test", values: { first_name: "" } });
  assert.match(sarah.html, /Hi Sarah,/);
  assert.doesNotMatch(sarah.html, /\bAlex\b/);
  assert.match(blank.html, /Hi Stuart,/);
  assert.doesNotMatch(blank.html, /\bAlex\b/);
  assert.doesNotThrow(() => assertProductionPersonalization(sarah));
  assert.doesNotThrow(() => assertProductionPersonalization(blank));
});

test("a changed reusable template cannot replace the frozen provider source", () => {
  const contaminatedCampaign = campaign();
  contaminatedCampaign.template_snapshot.content_blocks[0].settings.heading = "Hi Alex";
  const changedTemplate = { ...originalTemplateSource(), updated_at: "2026-08-02T00:00:00.000Z" };
  const recovered = campaignFromOriginalTemplateSource(contaminatedCampaign, changedTemplate);
  assert.equal(recovered.refreshed, false);
  const rendered = renderFrozenCampaign(recovered.campaign, { test: true, mode: "test", values: { first_name: "Tim" } });
  assert.throws(() => assertProductionPersonalization(rendered), /designer sample data/i);
});

test("provider source loader reads the original template row rather than preview HTML", async () => {
  const selectedTables = [];
  const supabase = {
    from(table) {
      selectedTables.push(table);
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: originalTemplateSource(), error: null }; },
      };
    },
  };
  const contaminatedCampaign = campaign();
  contaminatedCampaign.template_snapshot.content_blocks[0].settings.body = "Hi Alex,";
  contaminatedCampaign.preview = { html: "<p>Hi Alex,</p>" };
  const providerSource = await loadProviderCampaignSource(supabase, contaminatedCampaign);
  assert.deepEqual(selectedTables, ["marketing_email_templates"]);
  assert.equal(providerSource.template_snapshot.content_blocks[0].settings.body, "Hi {{first_name}},\n\nSelected for {{company}}");
  assert.equal(Object.prototype.hasOwnProperty.call(providerSource, "preview"), false);
  const rendered = renderFrozenCampaign(providerSource, { test: true, mode: "test", values: { first_name: "Tim" } });
  assert.match(rendered.html, /Hi Tim,/);
  assert.doesNotMatch(rendered.html, /\bAlex\b/);
});

test("legacy SendGrid test rendering accepts a name and defaults to Stuart", () => {
  const fallback = renderLegacySendGridTestCampaign(campaign(), { test_first_name: "   " });
  const named = renderLegacySendGridTestCampaign(campaign(), { test_first_name: "Jane" });
  assert.equal(fallback.subject, "[SENDGRID TEST] New vans for Stuart");
  assert.match(fallback.html, /Hi Stuart/);
  assert.equal(fallback.test_first_name, "Stuart");
  assert.equal(named.subject, "[SENDGRID TEST] New vans for Jane");
  assert.match(named.html, /Hi Jane/);
  assert.doesNotMatch(named.html, /Hi Alex/);
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
  assert.match(sends, /for \(const recipient of selectedRecipients\)[\s\S]*renderFrozenCampaign\(campaign,[\s\S]*first_name: recipient\.first_name/);
  assert.match(sends, /assertProductionPersonalization\(rendered\)[\s\S]*callEmailProvider/);
  assert.doesNotMatch(sends, /const renderedBase = renderFrozenCampaign/);
  assert.match(sends, /test_first_name \|\| body\.testFirstName \|\| "Stuart"/);
  assert.match(sends, /unsubscribeUrl/);
});

test("placeholder helper trims supplied first names", () => {
  assert.equal(replaceRecipientPlaceholders("Hi {{first_name}}", { first_name: " Jane " }), "Hi Jane");
  assert.equal(replaceRecipientPlaceholders("Hi {{first_name}}", {}), "Hi there");
  assert.equal(normalizeRecipientFirstName("  Sarah  "), "Sarah");
  assert.equal(normalizeRecipientFirstName("tim"), "Tim");
  assert.equal(normalizeRecipientFirstName("sarah@example.test"), "there");
});

for (const productMode of ["finance", "rent2buy"]) {
  test(`${productMode} campaign snapshots use corrected recipient personalisation`, () => {
    const productCampaign = campaign();
    productCampaign.campaign_type = productMode;
    productCampaign.template_snapshot.category = productMode === "finance" ? "finance_offer" : "rent2buy";
    productCampaign.template_snapshot.content_blocks[2].settings.product_mode = productMode;
    const rendered = renderFrozenCampaign(productCampaign, { mode: "recipient", values: { first_name: "Jane" } });
    assert.match(rendered.html, /Hi Jane/);
    assert.doesNotMatch(rendered.html, /Hi Alex/);
    assertProductionPersonalization(rendered);
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
  test(`${provider} adapter submits distinct final recipient subject and HTML using mocked fetch`, async () => {
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
      ? { subject: body.subject, html: body.htmlContent }
      : provider === "smtp2go"
        ? { subject: body.subject, html: body.html_body }
        : { subject: body.subject, html: body.content[0].value });
    assert.equal(submitted[0].subject, "New vans for Jane");
    assert.equal(submitted[1].subject, "New vans for John");
    assert.match(submitted[0].html, /Hi Jane/);
    assert.match(submitted[1].html, /Hi John/);
    assert.notEqual(submitted[0].html, submitted[1].html);
  });
}

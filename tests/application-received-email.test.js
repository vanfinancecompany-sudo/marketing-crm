import test from "node:test";
import assert from "node:assert/strict";
import {
  APPLICATION_RECEIVED_TEMPLATE_NAME,
  renderApplicationReceivedEmail,
} from "../lib/applicationReceivedEmail.js";

const environment = {
  APPLICATION_RECEIVED_CONTACT_PHONE: "023 8000 0000",
  APPLICATION_RECEIVED_CONTACT_EMAIL: "sales@vanfinancecompany.co.uk",
  APPLICATION_RECEIVED_CONTACT_WEBSITE: "https://www.vanfinancecompany.co.uk",
};

test("Application Received renders optional vehicle details and contact details", () => {
  const email = renderApplicationReceivedEmail({
    lead_id: "lead-1",
    customer_name: "Stuart Example",
    customer_email: "stuart@example.com",
    vehicle: {
      title: "Ford Transit Custom Limited",
      registration: "AB24 XYZ",
      image_url: "https://example.com/van.jpg",
    },
  }, environment);

  assert.equal(email.templateName, APPLICATION_RECEIVED_TEMPLATE_NAME);
  assert.match(email.html, /Hi Stuart/);
  assert.match(email.html, /Ford Transit Custom Limited/);
  assert.match(email.html, /AB24 XYZ/);
  assert.match(email.html, /https:\/\/example\.com\/van\.jpg/);
  assert.match(email.html, /023 8000 0000/);
  assert.doesNotMatch(email.html, /£99|deposit/i);
});

test("Application Received cleanly replaces an absent vehicle section", () => {
  const email = renderApplicationReceivedEmail({
    lead_id: "lead-2",
    customer_name: "Alex Example",
    customer_email: "alex@example.com",
  }, environment);

  assert.match(email.html, /help you find the right van for your needs/i);
  assert.doesNotMatch(email.html, /Registration:/);
  assert.doesNotMatch(email.html, /<img/);
  assert.doesNotMatch(email.html, /£99|deposit/i);
});

test("Application Received uses the Van Finance Company phone number by default", () => {
  const email = renderApplicationReceivedEmail({
    lead_id: "lead-default-phone",
    customer_name: "Jamie Example",
    customer_email: "jamie@example.com",
  }, {});

  assert.match(email.html, /0330 133 6376/);
  assert.match(email.html, /tel:03301336376/);
});

test("Application Received escapes customer and vehicle content", () => {
  const email = renderApplicationReceivedEmail({
    lead_id: "lead-3",
    customer_name: "<script>alert(1)</script>",
    customer_email: "safe@example.com",
    vehicle: { title: "Transit <Limited>" },
  }, environment);

  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.html, /Transit &lt;Limited&gt;/);
});

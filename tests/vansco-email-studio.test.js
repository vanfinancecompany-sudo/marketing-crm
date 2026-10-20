import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normaliseSettings, mappedVehicle } from "../api/vansco-email-studio.js";

const base = {
  theme: "halloween",
  subject: "Halloween Sale",
  preview_text: "Explore Vansco offers",
  heading: "HALLOWEEN VAN SALE",
  introduction: "Browse our featured vans.",
  offer: "Seasonal deals",
  cta_label: "VIEW VANS",
  cta_url: "https://www.vansco.co.uk/all-stock/",
  selected_keys: ["dk:sample"],
};

test("seasonal master normalisation supports four themes and only Vansco links", () => {
  for (const theme of ["standard", "halloween", "black_friday", "christmas"]) {
    const result = normaliseSettings({ ...base, theme });
    assert.equal(result.theme, theme);
    assert.equal(result.selected_keys[0], "dk:sample");
  }
  assert.throws(() => normaliseSettings({ ...base, theme: "vfc" }), /theme/i);
  assert.throws(() => normaliseSettings({ ...base, cta_url: "https://www.vanfinancecompany.co.uk/" }), /Vansco/i);
  assert.throws(() => normaliseSettings({ ...base, cta_url: "javascript:alert(1)" }), /valid/i);
  assert.throws(() => normaliseSettings({ ...base, selected_keys: ["abc", "abc"] }), /six different/i);
  assert.throws(() => normaliseSettings({ ...base, selected_keys: Array(7).fill(0).map((_, i) => String(i)) }), /six different/i);
});

test("vehicle selector enforces source availability, Vansco host, photographs and van classification", () => {
  const van = {
    vehicleKey: "dk:abc", availability: "AVAILABLE", vehicleUrl: "https://www.vansco.co.uk/vehicle-details/abc",
    imageUrl: "https://cdn.dealerkit.uk/abc.jpg", title: "Ford Transit Custom", price: "£15,995",
    bodyStyle: "Panel Van",
  };
  assert.equal(mappedVehicle(van)?.key, "dk:abc");
  assert.equal(mappedVehicle({ ...van, availability: "SOLD" }), null);
  assert.equal(mappedVehicle({ ...van, imageUrl: "" }), null);
  assert.equal(mappedVehicle({ ...van, vehicleUrl: "https://example.com/vehicle-details/abc" }), null);
});

test("new Vansco studio cannot alter automatic transactional sends or dispatch campaigns", () => {
  const api = readFileSync(new URL("../api/vansco-email-studio.js", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../public/vansco-email-studio/index.html", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/20261020_vansco_email_studio_foundation.sql", import.meta.url), "utf8");
  assert.match(api, /NO|NEVER invokes an email provider/i);
  assert.doesNotMatch(api, /sendSendGridEmail|callEmailProvider|sendgrid\.com\/v3\/mail\/send|api\.brevo\.com\/v3\/smtp\/email/);
  assert.doesNotMatch(api, /from\(["']marketing_campaigns["']\)|from\(["']marketing_email_sends["']\)/);
  assert.match(ui, /disabled title="Available once send-safety checks are complete"/);
  assert.match(ui, /No customer emails are sent from this screen/);
  assert.match(migration, /marketing_vansco_email_contacts/);
  assert.doesNotMatch(migration, /alter table public\.marketing_contacts|update public\.marketing_contacts|delete from public\.marketing_contacts/i);
});

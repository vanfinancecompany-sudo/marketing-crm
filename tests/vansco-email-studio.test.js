import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normaliseSettings, mappedVehicle, normaliseSalePrices, normalisePrice } from "../api/vansco-email-studio.js";
import { verifyLogoBytes } from "../api/vansco-email-logo.js";

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

test("more template fields persist without breaking legacy master settings", () => {
  const settings = normaliseSettings({
    ...base, eyebrow: "HALLOWEEN EDITION", subheading: "Autumn Vansco sale",
    brand_description: "Vansco serves Southampton and the New Forest.",
    extra_text: "Offers available while stock lasts.", footer_note: "Subject to availability.",
    logo_url: "https://static.wixstatic.com/media/real-vansco-logo.png",
  });
  assert.equal(settings.eyebrow, "HALLOWEEN EDITION");
  assert.equal(settings.brand_description, "Vansco serves Southampton and the New Forest.");
  assert.equal(settings.footer_note, "Subject to availability.");
  assert.match(settings.logo_url, /wixstatic/);
  assert.equal(normaliseSettings(base).logo_url, "");
  assert.throws(() => normaliseSettings({ ...base, logo_url: "https://example.com/malicious.svg" }), /Logo must use/);
});

test("sale pricing is isolated by selected van and mathematically consistent", () => {
  assert.equal(normalisePrice("£15,995"), "15995.00");
  assert.equal(normalisePrice("12999.50"), "12999.50");
  assert.equal(normaliseSalePrices({ van1: { was: "15995", now: "13995", save: "2000" }, other: { was: "999", now: "1" } }, ["van1"]).van1.save, "2000.00");
  assert.equal(normaliseSalePrices({ van1: { was: "15995", now: "13995" } }, ["van1"]).van1.save, "2000.00");
  assert.deepEqual(normaliseSalePrices({ van1: { was: "15995", now: "13995" } }, ["van2"]), {});
  assert.throws(() => normaliseSalePrices({ van1: { was: "15995", now: "13995", save: "1000" } }, ["van1"]), /must equal/);
  assert.throws(() => normaliseSalePrices({ van1: { was: "100", now: "120" } }, ["van1"]), /exceed/);
  assert.throws(() => normalisePrice("one thousand"), /valid amount/);
});

test("logo upload validates actual PNG/JPEG/WebP signatures and size", () => {
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(50)]);
  assert.equal(verifyLogoBytes(png, "image/png"), "image/png");
  assert.throws(() => verifyLogoBytes(Buffer.alloc(40), "image/png"), /genuine/);
  assert.throws(() => verifyLogoBytes(png, "image/jpeg"), /genuine/);
  assert.throws(() => verifyLogoBytes(Buffer.alloc(1_500_001), "image/png"), /1.5 MB/);
});

test("seasonal email renderer preserves complete source image and promotion controls", () => {
  const ui = readFileSync(new URL("../public/vansco-email-studio/index.html", import.meta.url), "utf8");
  const api = readFileSync(new URL("../api/vansco-email-studio.js", import.meta.url), "utf8");
  assert.match(ui, /id="saleEditors"/);
  assert.match(ui, /id="logoFile"/);
  assert.match(ui, /id="brandDescription"/);
  assert.match(ui, /id="extraText"/);
  assert.match(ui, /text-decoration:line-through/);
  assert.match(ui, /SAVE /);
  assert.match(ui, /🎃/);
  assert.doesNotMatch(ui, /max-height:200px;object-fit:cover/);
  assert.match(ui, /width:100%;max-width:290px;height:auto/);
  assert.match(api, /selected_vehicles: priceSnapshots/);
  assert.match(api, /normaliseSalePrices/);
});

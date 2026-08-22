import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  automatedVehicleUrl,
  buildAutomatedFacebookCaption,
  buildAutomatedReelCaption,
} from "../lib/facebookAutomationContent.js";

function source(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("automated Finance copy uses the full advert text and the live CMS URL", () => {
  const vehicle = {
    reg: "DN69JYP",
    vanDescription: "Vauxhall Combo 1.5 Limited Edition L1",
    price: "10995",
    salePrice: "299",
    weblink: "https://www.vanfinancecompany.co.uk/van-finance/live-dn69jyp",
  };
  const caption = buildAutomatedFacebookCaption(vehicle, "vanFinance");
  assert.match(caption, /FROM £99 DEPOSIT - £10,995 \+ VAT \| FROM £299 MTH/);
  assert.match(caption, /Finance the VAT/);
  assert.match(caption, /200\+ vans in stock/);
  assert.match(caption, /APPROVED IN JUST 60 MINUTES/);
  assert.match(caption, /https:\/\/www\.vanfinancecompany\.co\.uk\/van-finance\/live-dn69jyp/);
  assert.doesNotMatch(caption, /\/van-finance\/DN69JYP$/);
});

test("Due In Soon vehicles fall back to the appropriate home page instead of inventing a 404 URL", () => {
  const finance = { reg: "DN69JYP", vanDescription: "Vauxhall Combo", weblink: "" };
  const rent = { registration: "FG71THN", vanDescription: "Renault Trafic", webLink: "" };
  assert.equal(automatedVehicleUrl(finance, "vanFinance"), "https://www.vanfinancecompany.co.uk/");
  assert.equal(automatedVehicleUrl(rent, "rent2buy"), "https://www.rent2buyvans.co.uk/");
  assert.match(buildAutomatedFacebookCaption(finance, "vanFinance"), /https:\/\/www\.vanfinancecompany\.co\.uk\/$/);
  assert.match(buildAutomatedFacebookCaption(rent, "rent2buy"), /https:\/\/www\.rent2buyvans\.co\.uk\/$/);
});

test("Reel captions use the same full vehicle advert builder", () => {
  const vehicle = {
    reg: "HV73OVS",
    vanDescription: "Ford Transit MWB L2/H3 Leader",
    price: "15995",
    salePrice: "399",
    weblink: "https://www.vanfinancecompany.co.uk/van-finance/HV73OVS",
  };
  assert.equal(
    buildAutomatedReelCaption({ productKey: "vanFinance", vehicle, registration: "HV73OVS", title: vehicle.vanDescription }),
    buildAutomatedFacebookCaption(vehicle, "vanFinance"),
  );
});

test("Daily Reels and Buffer UI scripts no longer require the Customer Database browser key", () => {
  const daily = source("public/daily-reels/app.js");
  const drafts = source("public/daily-reels/buffer-drafts.js");
  const bridge = source("public/buffer-posting-bridge.js");
  const status = source("public/buffer-live-status.js");

  for (const text of [daily, drafts, bridge, status]) {
    assert.doesNotMatch(text, /marketingCustomerDatabaseApiKey/);
    assert.doesNotMatch(text, /Open and unlock the Marketing CRM/i);
  }
  assert.match(daily, /\/api\/youtube-daily-batch-ui/);
  assert.match(drafts, /\/api\/buffer-publishing-ui/);
  assert.match(bridge, /\/api\/buffer-publishing-ui/);
  assert.match(status, /\/api\/buffer-publish-status-ui/);
});

test("Facebook browser integrations avoid document-wide observer loops", () => {
  const bridge = source("public/buffer-posting-bridge.js");
  const status = source("public/buffer-live-status.js");
  const main = source("main.jsx");
  assert.doesNotMatch(bridge, /MutationObserver/);
  assert.doesNotMatch(status, /MutationObserver/);
  assert.doesNotMatch(main, /setInterval\(loadActiveBrowserIntegrations/);
});

test("server-side UI wrappers inject the existing key without changing Customer Database protection", () => {
  const wrapper = source("lib/marketingUiNoLock.js");
  const marketingAccess = source("services/marketingAccess.js");
  assert.match(wrapper, /process\.env\.MARKETING_CUSTOMER_DATABASE_API_KEY/);
  assert.match(wrapper, /request\.headers\[API_KEY_HEADER\] = serverKey/);
  assert.match(marketingAccess, /MARKETING_ACCESS_STORAGE_KEY = "marketingCustomerDatabaseApiKey"/);
  assert.match(source("api/youtube-daily-batch-ui.js"), /withMarketingUiNoLock/);
  assert.match(source("api/buffer-publishing-ui.js"), /withMarketingUiNoLock/);
  assert.match(source("api/buffer-publish-status-ui.js"), /withMarketingUiNoLock/);
  assert.match(source("api/marketing-daily-operations-ui.js"), /withMarketingUiNoLock/);
});

test("automatic Reel scheduling resolves the live vehicle before building Buffer copy", () => {
  const worker = source("api/buffer-facebook-automation-worker.js");
  assert.match(worker, /findVehicleByRegistration/);
  assert.match(worker, /captionVehicle = findVehicleByRegistration/);
  assert.match(worker, /buildAutomatedReelCaption\(\{[\s\S]*vehicle: captionVehicle/);
});

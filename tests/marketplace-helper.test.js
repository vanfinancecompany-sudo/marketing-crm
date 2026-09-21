import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  MARKETPLACE_CREATE_URL,
  RENT2BUY_MARKETPLACE_LOCATIONS,
  VAN_FINANCE_MARKETPLACE_LOCATIONS,
  nextMarketplaceLocation,
} from "../services/marketplaceAutomation.js";

const postingDeskSource = fs.readFileSync(new URL("../pages/PostingDeskPage.jsx", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
const sidebarSource = fs.readFileSync(new URL("../public/shared/sidebar-navigation.js", import.meta.url), "utf8");
const marketplaceAutomationSource = fs.readFileSync(
  new URL("../services/marketplaceAutomation.js", import.meta.url),
  "utf8",
);
const backgroundSource = fs.readFileSync(new URL("../browser-extension/marketplace-helper/background.js", import.meta.url), "utf8");
const facebookSource = fs.readFileSync(new URL("../browser-extension/marketplace-helper/facebook.js", import.meta.url), "utf8");
const manifest = JSON.parse(
  fs.readFileSync(new URL("../browser-extension/marketplace-helper/manifest.json", import.meta.url), "utf8"),
);

test("Marketplace jobs keep separate Rent2Buy and Van Finance location pools", () => {
  assert.equal(MARKETPLACE_CREATE_URL, "https://www.facebook.com/marketplace/create/vehicle");

  assert.ok(RENT2BUY_MARKETPLACE_LOCATIONS.length >= 8);
  assert.ok(RENT2BUY_MARKETPLACE_LOCATIONS.includes("Southampton"));
  assert.ok(RENT2BUY_MARKETPLACE_LOCATIONS.includes("Basingstoke"));
  assert.ok(RENT2BUY_MARKETPLACE_LOCATIONS.includes("Portsmouth"));
  assert.ok(RENT2BUY_MARKETPLACE_LOCATIONS.includes(nextMarketplaceLocation()));

  assert.ok(VAN_FINANCE_MARKETPLACE_LOCATIONS.length >= 20);
  assert.ok(VAN_FINANCE_MARKETPLACE_LOCATIONS.includes("London"));
  assert.ok(VAN_FINANCE_MARKETPLACE_LOCATIONS.includes("Birmingham"));
  assert.ok(VAN_FINANCE_MARKETPLACE_LOCATIONS.includes("Manchester"));
  assert.ok(VAN_FINANCE_MARKETPLACE_LOCATIONS.includes(nextMarketplaceLocation("finance")));
});

test("Posting Desk keeps Van Finance and Rent2Buy Marketplace as separate prepared workflows", () => {
  assert.match(postingDeskSource, /Advertise on Marketplace/);
  assert.match(postingDeskSource, /buildRent2BuyMarketplaceJob/);
  assert.match(postingDeskSource, /buildVanFinanceMarketplaceJob/);
  assert.match(postingDeskSource, /Van Finance Marketplace/);
  assert.match(postingDeskSource, /Rent2Buy Marketplace/);
  assert.match(postingDeskSource, /sendMarketplaceJobToExtension/);
  assert.match(postingDeskSource, /Confirm Advertised/);
  assert.match(postingDeskSource, /MARKETPLACE_PUBLISHED_MESSAGE_TYPE/);
  assert.match(postingDeskSource, /removed from the Marketplace to-do list/);

  assert.match(appSource, /vanFinanceMarketplaceQueue/);
  assert.match(appSource, /rent2BuyMarketplaceQueue/);
  assert.match(sidebarSource, /Van Finance Marketplace/);
  assert.match(sidebarSource, /Rent2Buy Marketplace/);
});

test("Van Finance Marketplace uses cash pricing and a £99-deposit title hook", () => {
  assert.match(marketplaceAutomationSource, /buildVanFinanceMarketplaceJob/);
  assert.match(marketplaceAutomationSource, /postingDestination: "Van Finance Marketplace"/);
  assert.match(marketplaceAutomationSource, /VANFINANCECOMPANY\.co\.uk \| Deposit from £99/);
  assert.match(marketplaceAutomationSource, /priceContext: "cash"/);
  assert.match(marketplaceAutomationSource, /cmsUploads\?\.vanFinance/);
  assert.match(backgroundSource, /postingDestination/);
  assert.match(facebookSource, /job\.pipeline === "finance"/);
});

test("Marketplace preparation failures stay visible instead of silently closing", () => {
  assert.match(postingDeskSource, /Marketplace preparation needs attention/);
  assert.match(postingDeskSource, /Nothing has been posted/);
  assert.match(postingDeskSource, /Back to Marketing CRM/);
  assert.doesNotMatch(
    postingDeskSource,
    /catch \(error\) \{\s*if \(marketplaceWindow && !marketplaceWindow\.closed\) marketplaceWindow\.close\(\)/,
  );
  assert.match(marketplaceAutomationSource, /MARKETPLACE_EXTENSION_ACK_TIMEOUT_MS = 6000/);
  assert.match(marketplaceAutomationSource, /MARKETPLACE_EXTENSION_ACK_ATTEMPTS = 2/);
  assert.match(marketplaceAutomationSource, /sendMarketplaceJobAttempt/);
});

test("Marketplace extension requires manual Publish before a live listing receipt", () => {
  assert.match(backgroundSource, /MARKETPLACE_PUBLISH_CLICKED/);
  assert.match(backgroundSource, /publishClickedAt/);
  assert.match(backgroundSource, /marketplace\\\/item/);
  assert.match(backgroundSource, /PUBLISH_CONFIRM_WINDOW_MS/);
  assert.match(facebookSource, /Nothing has been published/);
  assert.match(facebookSource, /click Facebook's Publish button yourself/);
  assert.doesNotMatch(facebookSource, /auto(?:matically)?[^\n]{0,30}click[^\n]{0,30}Publish/i);
});

test("Marketplace extension is scoped and preserves controlled image handoff", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.content_scripts.some((entry) => entry.matches.includes("https://marketing-crm-six.vercel.app/*")));
  assert.ok(manifest.content_scripts.some((entry) => entry.matches.includes("https://www.facebook.com/marketplace/create/vehicle*")));
  assert.match(facebookSource, /slice\(0, 20\)/);
  assert.match(facebookSource, /CMS images attached in order/);
  assert.match(facebookSource, /Vehicle type/);
  assert.match(facebookSource, /Car\/Truck/);
  assert.match(facebookSource, /Body style/);
});

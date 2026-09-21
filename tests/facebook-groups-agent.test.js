import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  loadFacebookGroups,
  normalizeFacebookGroupUrl,
  scoreFacebookGroups,
} from "../services/facebookGroupsAgent.js";

const pageSource = fs.readFileSync(new URL("../pages/FacebookGroupsAgentPage.jsx", import.meta.url), "utf8");
const serviceSource = fs.readFileSync(new URL("../services/facebookGroupsAgent.js", import.meta.url), "utf8");
const backgroundSource = fs.readFileSync(new URL("../browser-extension/marketplace-helper/background.js", import.meta.url), "utf8");
const bridgeSource = fs.readFileSync(new URL("../browser-extension/marketplace-helper/crm-bridge.js", import.meta.url), "utf8");
const groupsHelperSource = fs.readFileSync(new URL("../browser-extension/marketplace-helper/facebook-groups.js", import.meta.url), "utf8");
const manifest = JSON.parse(
  fs.readFileSync(new URL("../browser-extension/marketplace-helper/manifest.json", import.meta.url), "utf8"),
);

test("Facebook group seed gives both products a useful starting pool", () => {
  const groups = loadFacebookGroups();
  assert.ok(groups.length >= 12);
  assert.ok(groups.some((group) => group.finance));
  assert.ok(groups.some((group) => group.rent2buy));
  assert.ok(groups.some((group) => /courier|trade/i.test(group.segment)));
  assert.ok(groups.some((group) => /van|marketplace/i.test(group.segment)));
});

test("Facebook group URLs are canonicalised for dedupe and history", () => {
  assert.equal(
    normalizeFacebookGroupUrl("https://www.facebook.com/groups/360871827417794/?ref=share"),
    "https://www.facebook.com/groups/360871827417794/",
  );
});

test("Rent2Buy and Finance scoring stay separate", () => {
  const groups = loadFacebookGroups();
  const finance = scoreFacebookGroups(groups, "finance");
  const rent2buy = scoreFacebookGroups(groups, "rent2buy");
  assert.ok(finance.length > 0);
  assert.ok(rent2buy.length > 0);
  assert.ok(finance.every((group) => group.finance));
  assert.ok(rent2buy.every((group) => group.rent2buy));
});

test("CRM exposes discovery, live checks and manual group-post preparation", () => {
  assert.match(pageSource, /Discover New Groups/);
  assert.match(pageSource, /Check Next 12/);
  assert.match(pageSource, /Prepare Group Post/);
  assert.match(pageSource, /Green groups are the best posting candidates/);
  assert.match(serviceSource, /FINANCE_QUERY_BANK/);
  assert.match(serviceSource, /RENT2BUY_QUERY_BANK/);
  assert.match(serviceSource, /van classifieds UK/);
  assert.match(serviceSource, /Southampton courier drivers/);
});

test("Chrome helper can discover and inspect groups without auto-posting", () => {
  assert.equal(manifest.version, "1.2.0");
  assert.equal(manifest.name, "VFC Facebook Helper");
  assert.ok(
    manifest.content_scripts.some((entry) =>
      entry.matches.includes("https://www.facebook.com/groups/*")
      && entry.js.includes("facebook-groups.js")
    ),
  );
  assert.ok(
    manifest.content_scripts.some((entry) =>
      entry.matches.includes("https://www.facebook.com/search/groups/*")
      && entry.js.includes("facebook-groups.js")
    ),
  );
  assert.match(backgroundSource, /STORE_GROUP_DISCOVERY_JOB/);
  assert.match(backgroundSource, /STORE_GROUP_INSPECTION_JOB/);
  assert.match(backgroundSource, /GROUP_DISCOVERY_PAGE_RESULTS/);
  assert.match(backgroundSource, /GROUP_INSPECTION_PAGE_RESULT/);
  assert.match(bridgeSource, /VFC_GROUP_DISCOVERY_START/);
  assert.match(bridgeSource, /VFC_GROUP_INSPECTION_START/);
  assert.match(groupsHelperSource, /Nothing has been posted/);
  assert.doesNotMatch(groupsHelperSource, /click\(\).*Post/i);
});

test("Group post helper leaves final Facebook Post action to the user", () => {
  assert.match(groupsHelperSource, /click Facebook\\'s Post button yourself/);
  assert.match(groupsHelperSource, /GROUP_POST_FILL_COMPLETED/);
  assert.match(backgroundSource, /STORE_GROUP_POST_JOB/);
});

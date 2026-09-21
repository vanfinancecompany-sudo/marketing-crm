import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

import {
  archiveFacebookGroup,
  groupDueState,
  groupPipeline,
  loadFacebookGroups,
  markGroupAccepted,
  markGroupPostStatus,
  markGroupPosted,
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

test("CRM exposes discovery, live checks and two-stage group pipelines", () => {
  assert.match(pageSource, /Discover New Groups/);
  assert.match(pageSource, /Check Next 12/);
  assert.match(pageSource, /New & Testing/);
  assert.match(pageSource, /Proven \/ Hot/);
  assert.match(pageSource, /Check .*Awaiting Posts/);
  assert.match(pageSource, /Prepare Test Post/);
  assert.match(pageSource, /Prepare Next Post/);
  assert.match(serviceSource, /FINANCE_QUERY_BANK/);
  assert.match(serviceSource, /RENT2BUY_QUERY_BANK/);
  assert.match(serviceSource, /van classifieds UK/);
  assert.match(serviceSource, /Southampton courier drivers/);
});

test("Chrome helper can discover and inspect groups without auto-posting", () => {
  assert.equal(manifest.version, "1.2.7");
  assert.equal(manifest.name, "VFC Facebook Helper");
  assert.ok(manifest.permissions.includes("alarms"));
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
  assert.match(backgroundSource, /STORE_GROUP_POST_STATUS_JOB/);
  assert.match(backgroundSource, /GROUP_POST_STATUS_PAGE_RESULT/);
  assert.match(backgroundSource, /GROUP_POST_SUBMITTED/);
  assert.match(backgroundSource, /GROUP_APPROVAL_ALARM/);
  assert.match(backgroundSource, /startAutomaticApprovalCheck/);
  assert.match(backgroundSource, /groups-auto-approval-monitor/);
  assert.match(backgroundSource, /GROUP_POST_STATUS_EVENT/);
  assert.match(bridgeSource, /VFC_GROUP_DISCOVERY_START/);
  assert.match(bridgeSource, /VFC_GROUP_INSPECTION_START/);
  assert.match(bridgeSource, /VFC_FACEBOOK_HELPER_PING/);
  assert.match(bridgeSource, /VFC_GROUP_POST_STATUS_EVENT/);
  assert.match(bridgeSource, /crm-b5po-/);
  assert.match(backgroundSource, /GET_FACEBOOK_HELPER_STATUS/);
  assert.match(pageSource, /Facebook Helper:/);
  assert.match(pageSource, /Groups ready/);
  assert.match(pageSource, /approval monitor on/);
  assert.match(pageSource, /Post approval:/);
  assert.match(pageSource, /GROUP_POST_STATUS_EVENT/);
  assert.match(groupsHelperSource, /Nothing has been posted/);
  assert.match(groupsHelperSource, /watchManualGroupPost/);
  assert.match(groupsHelperSource, /checkPostedStatus/);
  assert.match(groupsHelperSource, /findComposerOpener/);
  assert.match(groupsHelperSource, /waitForComposerEditor/);
  assert.match(groupsHelperSource, /Create a public post/);
  assert.match(groupsHelperSource, /data-lexical-editor/);
  assert.match(groupsHelperSource, /composerEditorCandidates/);
  assert.match(groupsHelperSource, /GET_PENDING_GROUP_POST_JOB/);
  assert.match(groupsHelperSource, /contentUnavailable/);
  assert.doesNotMatch(groupsHelperSource, /\.click\(\).*Facebook.*Post/i);
});

test("Group post helper leaves final Facebook Post action to the user", () => {
  assert.match(groupsHelperSource, /click Facebook\\'s Post button yourself/);
  assert.match(groupsHelperSource, /GROUP_POST_FILL_COMPLETED/);
  assert.match(backgroundSource, /STORE_GROUP_POST_JOB/);
});


test("accepted groups become proven and get a seven-day repeat cadence", () => {
  const base = loadFacebookGroups()[0];
  const posted = markGroupPosted([base], base.url, {
    registration: "AB12CDE",
    postedAt: "2026-09-01T09:00:00.000Z",
  })[0];
  assert.equal(groupPipeline(posted), "testing");
  assert.equal(posted.postStatus, "awaiting");

  const accepted = markGroupAccepted([posted], posted.url, {
    registration: "AB12CDE",
    acceptedAt: "2026-09-01T10:00:00.000Z",
  })[0];
  assert.equal(groupPipeline(accepted), "proven");
  assert.equal(accepted.acceptedPostCount, 1);
  assert.equal(accepted.repeatDays, 7);

  const due = groupDueState(accepted, new Date("2026-09-09T09:00:00.000Z"));
  assert.equal(due.due, true);
  assert.ok(due.daysSincePost >= 7);
});

test("bad groups can leave the active pipeline without deleting history", () => {
  const base = loadFacebookGroups()[0];
  const archived = archiveFacebookGroup([base], base.url, "Unavailable")[0];
  assert.equal(groupPipeline(archived), "archived");
  assert.equal(archived.archived, true);
});


test("group post preparation takes priority over background inspection jobs", () => {
  const postIndex = groupsHelperSource.indexOf("GET_PENDING_GROUP_POST_JOB");
  const agentIndex = groupsHelperSource.indexOf("GET_GROUP_AGENT_STATE");
  assert.ok(postIndex >= 0);
  assert.ok(agentIndex >= 0);
  assert.ok(postIndex < agentIndex);
});

test("group helper actually claims an explicit post before reading inspection state", async () => {
  const calls = [];
  let activeElement = null;
  const editor = {
    innerText: "",
    textContent: "",
    getAttribute(name) {
      return {
        "aria-label": "Create a public post",
        role: "textbox",
        contenteditable: "true",
        "data-lexical-editor": "true",
      }[name] || "";
    },
    getBoundingClientRect: () => ({ width: 600, height: 160 }),
    closest: () => null,
    focus() { activeElement = editor; },
  };
  const heading = {
    innerText: "Create post",
    textContent: "Create post",
    getAttribute: (name) => name === "role" ? "heading" : "",
    getBoundingClientRect: () => ({ width: 180, height: 30 }),
  };
  const postButton = {
    innerText: "Post",
    textContent: "Post",
    getAttribute: (name) => name === "role" ? "button" : "",
    getBoundingClientRect: () => ({ width: 90, height: 36 }),
  };
  const dialog = {
    innerText: "Create post",
    textContent: "Create post",
    getAttribute(name) {
      return { role: "dialog", "aria-label": "Create post" }[name] || "";
    },
    getBoundingClientRect: () => ({ width: 700, height: 500 }),
    querySelectorAll(selector) {
      if (selector === '[role="heading"], h1, h2, h3') return [heading];
      if (selector === 'button, [role="button"]') return [postButton];
      if (selector === 'input[type="file"]') return [];
      return /contenteditable|textbox|lexical|Create a public post|Write something/.test(selector) ? [editor] : [];
    },
    contains: (element) => element === editor || element === heading || element === postButton,
  };
  const document = {
    body: { innerText: "", appendChild() {} },
    get activeElement() { return activeElement; },
    querySelectorAll(selector) { return selector === '[role="dialog"]' ? [dialog] : []; },
    getElementById: () => null,
    createElement: () => ({ style: {}, innerHTML: "", remove() {} }),
    addEventListener() {},
    removeEventListener() {},
    execCommand(command, _showUi, value) {
      if (command === "insertText" && activeElement) {
        activeElement.innerText = value;
        activeElement.textContent = value;
      }
      return true;
    },
  };
  const sandbox = {
    chrome: {
      runtime: {
        async sendMessage(message) {
          calls.push(message.type);
          if (message.type === "GET_PENDING_GROUP_POST_JOB") {
            return {
              ok: true,
              job: {
                id: "explicit-post",
                groupUrl: "https://www.facebook.com/groups/test/",
                groupName: "Test group",
                registration: "AB12CDE",
                caption: "Rent2Buy caption long enough to be accepted",
                imageUrl: "",
              },
            };
          }
          if (message.type === "GET_GROUP_AGENT_STATE") {
            return { ok: true, state: { mode: "inspection", job: { id: "inspection" } } };
          }
          return { ok: true };
        },
      },
    },
    console,
    document,
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    location: { href: "https://www.facebook.com/groups/test/", origin: "https://www.facebook.com", pathname: "/groups/test/" },
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {},
  };
  sandbox.window = sandbox;

  vm.runInNewContext(groupsHelperSource, sandbox, { filename: "facebook-groups.js" });
  for (let attempt = 0; attempt < 20 && !calls.includes("GROUP_POST_FILL_COMPLETED"); attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.equal(calls[0], "GET_PENDING_GROUP_POST_JOB");
  assert.ok(calls.includes("GROUP_POST_FILL_COMPLETED"));
  assert.equal(calls.includes("GET_GROUP_AGENT_STATE"), false);
});

test("manual group post submission is recorded in Awaiting with its exact time and registration", () => {
  const base = loadFacebookGroups()[0];
  const postedAt = "2026-09-21T10:15:00.000Z";
  const posted = markGroupPosted([base], base.url, {
    registration: "AB12 CDE",
    postedAt,
    approvalState: "pending",
  })[0];
  assert.equal(posted.lastPostedAt, postedAt);
  assert.equal(posted.pendingRegistration, "AB12 CDE");
  assert.equal(posted.postStatus, "awaiting");
  assert.equal(posted.pipeline, "testing");
  assert.equal(posted.postCount, Number(base.postCount || 0) + 1);
});

test("post monitoring moves pending adverts to Proven and archives unavailable groups", () => {
  const first = loadFacebookGroups()[0];
  const second = loadFacebookGroups()[1];
  const posted = [first, second].map((group) => markGroupPosted([group], group.url, {
    registration: group === first ? "AB12CDE" : "XY34ZTT",
    postedAt: "2026-09-21T10:15:00.000Z",
  })[0]);

  const pending = markGroupPostStatus(posted, {
    url: first.url,
    registration: "AB12CDE",
    pending: true,
    checkedAt: "2026-09-21T11:00:00.000Z",
  });
  assert.equal(pending[0].postStatus, "pending");

  const accepted = markGroupPostStatus(pending, {
    url: first.url,
    registration: "AB12CDE",
    accepted: true,
    checkedAt: "2026-09-21T12:00:00.000Z",
  });
  assert.equal(accepted[0].postStatus, "accepted");
  assert.equal(groupPipeline(accepted[0]), "proven");
  assert.equal(accepted[0].repeatDays, 7);

  const unavailable = markGroupPostStatus(accepted, {
    url: second.url,
    registration: "XY34ZTT",
    unavailable: true,
    checkedAt: "2026-09-21T12:00:00.000Z",
  });
  assert.equal(unavailable[1].postStatus, "unavailable");
  assert.equal(unavailable[1].archived, true);
  assert.equal(groupPipeline(unavailable[1]), "archived");
});

test("background monitor keeps posted groups under hourly approval review", () => {
  assert.match(backgroundSource, /periodInMinutes: GROUP_APPROVAL_CHECK_MINUTES/);
  assert.match(backgroundSource, /GROUP_APPROVAL_CHECK_MINUTES = 60/);
  assert.match(backgroundSource, /mode: "auto-post-status"/);
  assert.match(backgroundSource, /chrome\.action\.setBadgeText/);
  assert.match(backgroundSource, /GET_LAST_GROUP_STATUS_EVENT/);
});

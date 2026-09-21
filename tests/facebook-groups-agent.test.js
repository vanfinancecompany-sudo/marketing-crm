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


function makeGroupHelperNode({ text = "", attrs = {}, accept = "", query = null, contains = null } = {}) {
  return {
    innerText: text,
    textContent: text,
    accept,
    events: [],
    clicked: 0,
    getAttribute(name) { return attrs[name] || ""; },
    getBoundingClientRect: () => ({ width: 520, height: 120 }),
    querySelectorAll(selector) { return query ? query(selector) : []; },
    closest: () => null,
    contains(element) { return contains ? contains(element) : false; },
    click() { this.clicked += 1; },
    focus() {},
    dispatchEvent(event) { this.events.push(event.type); },
  };
}

function createVerifiedComposerFixture() {
  const heading = makeGroupHelperNode({ text: "Create post", attrs: { role: "heading" } });
  const postButton = makeGroupHelperNode({ text: "Post", attrs: { role: "button" } });
  const photoButton = makeGroupHelperNode({ text: "Photo/video", attrs: { role: "button" } });
  const editor = makeGroupHelperNode({
    attrs: {
      role: "textbox",
      contenteditable: "true",
      "data-lexical-editor": "true",
      "aria-label": "Create a public post",
    },
  });
  const fileInput = makeGroupHelperNode({ accept: "image/*" });
  const children = [heading, postButton, photoButton, editor, fileInput];
  const dialog = makeGroupHelperNode({
    attrs: { role: "dialog", "aria-label": "Create post" },
    query(selector) {
      if (selector === '[role="heading"], h1, h2, h3') return [heading];
      if (selector === 'button, [role="button"]') return [postButton, photoButton];
      if (selector === 'input[type="file"]') return [fileInput];
      if (selector === "div, span, p") return [];
      if (/contenteditable|textbox|lexical|Create a public post|Write something/.test(selector)) return [editor];
      return [];
    },
    contains: (element) => children.includes(element),
  });
  return { dialog, heading, postButton, photoButton, editor, fileInput };
}

function loadGroupHelperTestHooks({ dialogs = [], controls = [], labels = [], runtimeSendMessage } = {}) {
  const hooks = {};
  const appended = [];
  const calls = [];
  let activeElement = null;
  let insertTextCalls = 0;
  let clock = 0;

  class FastDate extends Date {
    static now() {
      clock += 1000;
      return clock;
    }
  }

  class FakeEvent {
    constructor(type) { this.type = type; }
  }

  class FakeFile {
    constructor(parts, name, options = {}) {
      this.parts = parts;
      this.name = name;
      this.type = options.type || "";
    }
  }

  class FakeDataTransfer {
    constructor() {
      const files = [];
      this.items = { add(file) { files.push(file); } };
      Object.defineProperty(this, "files", { get: () => files });
    }
  }

  const document = {
    body: {
      innerText: "",
      appendChild(node) { appended.push(node); },
    },
    get activeElement() { return activeElement; },
    querySelectorAll(selector) {
      if (selector === '[role="dialog"]') return dialogs;
      if (selector === 'button, [role="button"], a') return controls;
      if (selector === "div, span") return labels;
      return [];
    },
    getElementById: () => null,
    createElement: () => ({ style: {}, innerHTML: "", remove() {} }),
    addEventListener() {},
    removeEventListener() {},
    execCommand(command, _showUi, value) {
      if (command === "insertText" && activeElement) {
        insertTextCalls += 1;
        activeElement.innerText = value;
        activeElement.textContent = value;
      }
      return true;
    },
  };

  const sandbox = {
    __VFC_FACEBOOK_GROUPS_TEST_HOOKS__: hooks,
    __VFC_FACEBOOK_GROUPS_TEST_MODE__: true,
    chrome: {
      runtime: {
        async sendMessage(message) {
          calls.push(message.type);
          if (runtimeSendMessage) return runtimeSendMessage(message);
          return { ok: true };
        },
      },
    },
    console,
    document,
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    location: {
      href: "https://www.facebook.com/groups/test/",
      origin: "https://www.facebook.com",
      pathname: "/groups/test/",
    },
    Date: FastDate,
    Event: FakeEvent,
    InputEvent: FakeEvent,
    File: FakeFile,
    DataTransfer: FakeDataTransfer,
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {},
  };
  sandbox.window = sandbox;

  vm.runInNewContext(groupsHelperSource, sandbox, { filename: "facebook-groups.js" });

  return {
    hooks,
    document,
    appended,
    calls,
    setActive(element) { activeElement = element; },
    get insertTextCalls() { return insertTextCalls; },
  };
}

test("Facebook group comment and reply editors are rejected", () => {
  const harness = loadGroupHelperTestHooks();
  const comment = makeGroupHelperNode({
    attrs: { role: "textbox", contenteditable: "true", "aria-label": "Comment" },
  });
  const writeComment = makeGroupHelperNode({
    attrs: { role: "textbox", contenteditable: "true", "aria-label": "Write a comment..." },
  });
  const reply = makeGroupHelperNode({
    attrs: { role: "textbox", contenteditable: "true", "aria-label": "Reply" },
  });

  assert.equal(harness.hooks.isRejectedComposerEditor(comment), true);
  assert.equal(harness.hooks.isRejectedComposerEditor(writeComment), true);
  assert.equal(harness.hooks.isRejectedComposerEditor(reply), true);
});

test("generic page-level contenteditable is never accepted as a Facebook group composer", () => {
  const genericEditor = makeGroupHelperNode({
    attrs: { role: "textbox", contenteditable: "true" },
  });
  const genericScope = makeGroupHelperNode({
    query: () => [genericEditor],
  });
  const harness = loadGroupHelperTestHooks();

  assert.equal(harness.hooks.isVerifiedCreatePostDialog(genericScope), false);
  assert.deepEqual(harness.hooks.composerEditorCandidates(genericScope), []);
  assert.doesNotMatch(groupsHelperSource, /dialogs\[dialogs\.length - 1\]\s*\|\|\s*document/);
  assert.doesNotMatch(groupsHelperSource, /\(dialog\s*\|\|\s*document\)/);
});

test("helper inserts nothing when no verified Create Post dialog exists", async () => {
  const comment = makeGroupHelperNode({
    text: "",
    attrs: { role: "textbox", contenteditable: "true", "aria-label": "Write a comment..." },
  });
  const harness = loadGroupHelperTestHooks();

  await harness.hooks.prepareGroupPost({
    id: "unsafe-comment-test",
    groupName: "Test group",
    registration: "AB12CDE",
    caption: "This advert must never be inserted into a comment editor.",
    imageUrl: "https://example.test/van.jpg",
  });

  assert.equal(comment.innerText, "");
  assert.equal(harness.insertTextCalls, 0);
  assert.equal(harness.calls.includes("FETCH_MARKETPLACE_IMAGE"), false);
  assert.equal(harness.calls.includes("GROUP_POST_FILL_COMPLETED"), true);
  assert.ok(
    harness.appended.some((panel) =>
      String(panel.innerHTML).includes("Could not verify Facebook group post composer. Nothing was inserted.")
    ),
  );
});

test("verified top-level Create Post dialog is accepted and caption target stays inside it", () => {
  const fixture = createVerifiedComposerFixture();
  const pageComment = makeGroupHelperNode({
    attrs: { role: "textbox", contenteditable: "true", "aria-label": "Write a comment..." },
  });
  const harness = loadGroupHelperTestHooks({ dialogs: [fixture.dialog] });
  fixture.editor.focus = () => harness.setActive(fixture.editor);

  assert.equal(harness.hooks.isVerifiedCreatePostDialog(fixture.dialog), true);
  assert.equal(harness.hooks.verifiedComposerDialog(), fixture.dialog);
  const candidates = harness.hooks.composerEditorCandidates(fixture.dialog);
  assert.equal(candidates[0], fixture.editor);
  assert.equal(candidates.includes(pageComment), false);

  harness.hooks.reactSetText(candidates[0], "Verified composer caption");
  assert.equal(fixture.editor.innerText, "Verified composer caption");
  assert.equal(pageComment.innerText, "");
});

test("group image upload stays inside the same verified Create Post dialog", async () => {
  const fixture = createVerifiedComposerFixture();
  const pageLevelFileInput = makeGroupHelperNode({ accept: "image/*" });
  const harness = loadGroupHelperTestHooks({
    dialogs: [fixture.dialog],
    runtimeSendMessage(message) {
      if (message.type === "FETCH_MARKETPLACE_IMAGE") {
        return { ok: true, dataUrl: "data:image/jpeg;base64,QQ==" };
      }
      return { ok: true };
    },
  });

  harness.document.querySelectorAll = (selector) => {
    if (selector === '[role="dialog"]') return [fixture.dialog];
    if (selector === 'input[type="file"]') return [pageLevelFileInput];
    return [];
  };

  const result = await harness.hooks.attachImage({
    registration: "AB12CDE",
    imageUrl: "https://example.test/van.jpg",
  }, fixture.dialog);

  assert.equal(result.ok, true);
  assert.equal(fixture.fileInput.files.length, 1);
  assert.equal(pageLevelFileInput.files, undefined);
  assert.deepEqual(fixture.fileInput.events, ["input", "change"]);
  assert.deepEqual(harness.calls, ["FETCH_MARKETPLACE_IMAGE"]);
});

test("unverified dialogs cannot trigger group image download or upload", async () => {
  const fakeDialog = makeGroupHelperNode({
    attrs: { role: "dialog", "aria-label": "Comments" },
    query: () => [],
  });
  const harness = loadGroupHelperTestHooks();
  const result = await harness.hooks.attachImage({
    registration: "AB12CDE",
    imageUrl: "https://example.test/van.jpg",
  }, fakeDialog);

  assert.equal(result.ok, false);
  assert.match(result.detail, /Verified Create Post composer required/);
  assert.equal(harness.calls.includes("FETCH_MARKETPLACE_IMAGE"), false);
});

test("group composer fail-safe and manual final Post safeguard remain explicit", () => {
  assert.match(groupsHelperSource, /Could not verify Facebook group post composer\. Nothing was inserted\./);
  assert.match(groupsHelperSource, /isVerifiedCreatePostDialog\(scope\)/);
  assert.match(groupsHelperSource, /dialog\.contains\(active\)/);
  assert.match(groupsHelperSource, /click Facebook\\'s Post button yourself/);
  assert.doesNotMatch(groupsHelperSource, /\.click\(\).*Facebook.*Post/i);
});

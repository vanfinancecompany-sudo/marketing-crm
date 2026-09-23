import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

import {
  applyGroupInspection,
  archiveFacebookGroup,
  groupDueState,
  groupPipeline,
  isRent2BuyLocalGroup,
  loadFacebookGroups,
  markGroupAccepted,
  markGroupPostStatus,
  markGroupPosted,
  normalizeFacebookGroupUrl,
  preserveFacebookGroupCaption,
  recoverFacebookGroupsFromSnapshot,
  scoreFacebookGroups,
} from "../services/facebookGroupsAgent.js";

const pageSource = fs.readFileSync(new URL("../pages/FacebookGroupsAgentPage.jsx", import.meta.url), "utf8");
const serviceSource = fs.readFileSync(new URL("../services/facebookGroupsAgent.js", import.meta.url), "utf8");
const backgroundSource = fs.readFileSync(new URL("../browser-extension/marketplace-helper/background.js", import.meta.url), "utf8");
const bridgeSource = fs.readFileSync(new URL("../browser-extension/marketplace-helper/crm-bridge.js", import.meta.url), "utf8");
const groupsHelperSource = fs.readFileSync(new URL("../browser-extension/marketplace-helper/facebook-groups.js", import.meta.url), "utf8");
const stateApiSource = fs.readFileSync(new URL("../api/facebook-groups-state.js", import.meta.url), "utf8");
const stateMigrationSource = fs.readFileSync(new URL("../supabase/migrations/202609230830_facebook_group_state.sql", import.meta.url), "utf8");
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

test("Facebook group caption handoff preserves paragraph breaks exactly", () => {
  const caption = "NO CREDIT CHECK\r\n\r\n£536 MTH RENT IT · DRIVE IT · OWN IT\r\nApply in 60 seconds\r\n\r\nJUST £99 FINAL PAYMENT. IT'S YOURS!";
  assert.equal(
    preserveFacebookGroupCaption(caption),
    "NO CREDIT CHECK\n\n£536 MTH RENT IT · DRIVE IT · OWN IT\nApply in 60 seconds\n\nJUST £99 FINAL PAYMENT. IT'S YOURS!",
  );
  assert.match(serviceSource, /caption: preserveFacebookGroupCaption\(caption \|\| vehicle\.caption \|\| ""\)/);
  assert.match(serviceSource, /captionCopied: Boolean\(captionCopied\)/);
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
  assert.ok(rent2buy.every((group) => isRent2BuyLocalGroup(group)));
});

test("Rent2Buy discovery rejects national and out-of-area groups", () => {
  const groups = loadFacebookGroups();
  const merged = mergeDiscoveredGroups(groups, [
    {
      name: "Southampton Trades and Vans",
      url: "https://www.facebook.com/groups/southampton-trades-vans/",
      context: "Southampton Hampshire local trades",
      segment: "Trades",
    },
    {
      name: "Manchester Van Traders",
      url: "https://www.facebook.com/groups/manchester-van-traders/",
      context: "Manchester Greater Manchester",
      segment: "Van/Vehicle",
    },
    {
      name: "UK Vans Nationwide",
      url: "https://www.facebook.com/groups/uk-vans-nationwide/",
      context: "UK nationwide van sales",
      segment: "Van/Vehicle",
    },
  ], "rent2buy");

  assert.ok(merged.some((group) => /southampton-trades-vans/i.test(group.url)));
  assert.equal(merged.some((group) => /manchester-van-traders/i.test(group.url)), false);
  assert.equal(merged.some((group) => /uk-vans-nationwide/i.test(group.url)), false);
});

test("Rent2Buy local radius recognises intended Southampton-area locations", () => {
  for (const name of ["Portsmouth Buy Sell", "Bournemouth Trades", "Reading Vans", "Guildford Marketplace", "Bristol Small Business", "London Van Sales"]) {
    assert.equal(isRent2BuyLocalGroup({ name }), true, name);
  }
  for (const name of ["Manchester Van Sales", "Leeds Trades", "Liverpool Marketplace", "UK Nationwide Vans"]) {
    assert.equal(isRent2BuyLocalGroup({ name }), false, name);
  }
});

test("Facebook group state persists remotely without deleting browser recovery data", () => {
  assert.match(serviceSource, /\/api\/facebook-groups-state/);
  assert.match(serviceSource, /hydrateFacebookGroups/);
  assert.match(serviceSource, /remoteSyncReady/);
  assert.match(pageSource, /hydrateFacebookGroups\(loadFacebookGroups\(\)\)/);
  assert.match(stateApiSource, /getSupabaseServiceAdmin/);
  assert.match(stateApiSource, /upsert\(rows, \{ onConflict: "group_key" \}\)/);
  assert.match(stateApiSource, /suspicious reduction/i);
  assert.match(stateApiSource, /facebook_group_state_backups/);
  assert.match(stateMigrationSource, /create table if not exists public\.facebook_group_state/);
  assert.match(stateMigrationSource, /create table if not exists public\.facebook_group_state_backups/);
  assert.match(stateMigrationSource, /enable row level security/);
  assert.match(stateMigrationSource, /revoke all .* anon, authenticated/);
});

test("Chrome helper recovery can rebuild Awaiting group records", () => {
  const recovered = recoverFacebookGroupsFromSnapshot(loadFacebookGroups(), {
    approvalItems: [{
      productKey: "rent2buy",
      groupUrl: "https://www.facebook.com/groups/recovered-awaiting-test/",
      groupName: "Recovered Awaiting Test",
      registration: "AB12CDE",
      postedAt: "2026-09-21T10:15:00.000Z",
      lastCheckedAt: "2026-09-21T11:15:00.000Z",
      lastResult: "pending",
    }],
  });
  const restored = recovered.find((group) => /recovered-awaiting-test/i.test(group.url));
  assert.ok(restored);
  assert.equal(restored.rent2buy, true);
  assert.equal(restored.finance, false);
  assert.equal(restored.pendingRegistration, "AB12CDE");
  assert.equal(restored.postStatus, "pending");
  assert.equal(groupPipeline(restored), "testing");
});

test("CRM exposes separate New, Pending Membership, Awaiting and Proven pipelines", () => {
  assert.match(pageSource, /Discover New Groups/);
  assert.match(pageSource, /Check Next 12/);
  assert.match(pageSource, /New & Testing/);
  assert.match(pageSource, /Pending Membership \(\{counts\.membershipPending\}\)/);
  assert.match(pageSource, /pipelineView === "membership_pending"/);
  assert.match(pageSource, /Check Pending Membership \(\$\{counts\.membershipPending\}\)/);
  assert.match(pageSource, /async function checkPendingMembership\(\)/);
  assert.match(pageSource, /membershipPendingGroups,/);
  assert.match(pageSource, /groupPipeline\(group\) !== "membership_pending"/);
  assert.match(pageSource, /Awaiting \(\{counts\.awaiting\}\)/);
  assert.match(pageSource, /Proven \/ Hot/);
  assert.match(pageSource, /pipelineView === "awaiting"/);
  assert.match(pageSource, /groupPipeline\(group\) === "new"/);
  assert.match(pageSource, /Check .*Awaiting Posts/);
  assert.match(pageSource, /Prepare Test Post/);
  assert.match(pageSource, /Prepare Next Post/);
  assert.match(serviceSource, /FINANCE_QUERY_BANK/);
  assert.match(serviceSource, /RENT2BUY_QUERY_BANK/);
  assert.match(serviceSource, /van classifieds UK/);
  assert.match(serviceSource, /Southampton courier drivers/);
  assert.match(pageSource, /navigator\.clipboard\?\.writeText/);
  assert.match(pageSource, /captionCopyPromise = copyGroupCaptionForFallback\(caption\)/);
  assert.match(pageSource, /Reset Vans/);
  assert.match(pageSource, /vfcFacebookGroupsUsedVans/);
  assert.match(pageSource, /markVehicleUsed\(postEvent\.registration/);
  const copyIndex = pageSource.indexOf("captionCopyPromise = copyGroupCaptionForFallback(caption)");
  const healthIndex = pageSource.indexOf("await requireGroupsHelper()", copyIndex);
  assert.ok(copyIndex >= 0 && healthIndex > copyIndex, "caption clipboard write must start before async helper health check");
});

test("Chrome helper can discover and inspect groups without auto-posting", () => {
  assert.equal(manifest.version, "1.2.16");
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
  assert.match(backgroundSource, /groups-state-recovery/);
  assert.match(backgroundSource, /GET_GROUP_RECOVERY_SNAPSHOT/);
  assert.match(backgroundSource, /GROUP_POST_STATUS_EVENT/);
  assert.match(bridgeSource, /VFC_GROUP_DISCOVERY_START/);
  assert.match(bridgeSource, /VFC_GROUP_INSPECTION_START/);
  assert.match(bridgeSource, /VFC_FACEBOOK_HELPER_PING/);
  assert.match(bridgeSource, /VFC_GROUP_RECOVERY_REQUEST/);
  assert.match(bridgeSource, /VFC_GROUP_RECOVERY_RESPONSE/);
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
  assert.match(groupsHelperSource, /membershipPending/);
  assert.match(groupsHelperSource, /cancel request\|requested\|pending/);
  assert.doesNotMatch(groupsHelperSource, /\.click\(\).*Facebook.*Post/i);
  assert.doesNotMatch(groupsHelperSource, /FORMAT_PROBE_TEXT/);
  assert.match(groupsHelperSource, /captionCopied/);
  assert.match(groupsHelperSource, /press Ctrl\+V/);
});

test("Group post helper leaves final Facebook Post action to the user", () => {
  assert.match(groupsHelperSource, /click Facebook\\'s Post button yourself/);
  assert.match(groupsHelperSource, /GROUP_POST_FILL_COMPLETED/);
  assert.match(backgroundSource, /STORE_GROUP_POST_JOB/);
});


test("pending group membership leaves New and returns once Facebook shows joined", () => {
  const base = loadFacebookGroups()[0];
  const pending = applyGroupInspection([base], [{
    url: base.url,
    joined: false,
    membershipPending: true,
    canPost: false,
    pageText: "Your request to join is pending",
  }], "rent2buy")[0];

  assert.equal(pending.membershipPending, true);
  assert.equal(groupPipeline(pending), "membership_pending");

  const joined = applyGroupInspection([pending], [{
    url: base.url,
    joined: true,
    membershipPending: false,
    canPost: true,
    pageText: "Joined",
  }], "rent2buy")[0];

  assert.equal(joined.membershipPending, false);
  assert.equal(joined.joined, true);
  assert.equal(groupPipeline(joined), "new");
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
    dispatchEvent(event) {
      if (event?.type === "paste" && event.clipboardData) {
        const text = event.clipboardData.getData("text/plain");
        editor.innerText = text;
        editor.textContent = text;
      }
      return true;
    },
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
    DataTransfer: class DataTransfer {
      constructor() {
        this.data = {};
        this.files = [];
        this.items = { add: (file) => this.files.push(file) };
      }
      setData(type, value) { this.data[type] = String(value); }
      getData(type) { return this.data[type] || ""; }
    },
    ClipboardEvent: class ClipboardEvent {
      constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
    },
    Event: class Event {
      constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
    },
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

test("declined Facebook group posts move straight to Archived", () => {
  const base = loadFacebookGroups()[0];
  const posted = markGroupPosted([base], base.url, {
    registration: "AB12CDE",
    postedAt: "2026-09-21T10:15:00.000Z",
  });
  const declined = markGroupPostStatus(posted, {
    url: base.url,
    registration: "AB12CDE",
    declined: true,
    checkedAt: "2026-09-21T11:00:00.000Z",
  })[0];

  assert.equal(declined.postStatus, "declined");
  assert.equal(declined.archived, true);
  assert.equal(groupPipeline(declined), "archived");
  assert.match(declined.archiveReason, /declined|rejected/i);
  assert.match(groupsHelperSource, /declined by/);
  assert.match(backgroundSource, /event\.declined/);
  assert.match(pageSource, /Mark Declined/);
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

function loadGroupHelperTestHooks({
  dialogs = [],
  controls = [],
  labels = [],
  runtimeSendMessage,
} = {}) {
  const hooks = {};
  const appended = [];
  const calls = [];
  let activeElement = null;
  let clock = 0;

  class FastDate extends Date {
    static now() {
      clock += 1000;
      return clock;
    }
  }

  class FakeEvent {
    constructor(type, init = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  }

  class FakeClipboardEvent extends FakeEvent {}

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
      this.data = {};
      this.items = { add(file) { files.push(file); } };
      Object.defineProperty(this, "files", { get: () => files });
    }
    setData(type, value) { this.data[type] = String(value); }
    getData(type) { return this.data[type] || ""; }
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
    execCommand(command) {
      if ((command === "selectAll" || command === "delete") && activeElement) {
        activeElement.innerText = "";
        activeElement.textContent = "";
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
    ClipboardEvent: FakeClipboardEvent,
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
  assert.equal(harness.hooks.composerEditorCandidates(genericScope).length, 0);
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
  assert.equal(harness.calls.includes("FETCH_MARKETPLACE_IMAGE"), false);
  assert.equal(harness.calls.includes("GROUP_POST_FILL_COMPLETED"), true);
  assert.ok(
    harness.appended.some((panel) =>
      String(panel.innerHTML).includes("Could not verify Facebook group post composer. Nothing was inserted.")
    ),
  );
});

test("approval checker can recognise a live advert from registration text without a permalink anchor", () => {
  const harness = loadGroupHelperTestHooks();
  harness.document.body.innerText = [
    "Search results for YG73AMF",
    "NO CREDIT CHECK",
    "REGISTRATION: YG73AMF",
    "RENT IT! - DRIVE IT! - OWN IT!",
  ].join("\n");

  const evidence = Array.from(harness.hooks.registrationEvidenceLines("YG73 AMF"));
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0], "REGISTRATION: YG73AMF");
});

test("approval checker ignores registration shown only inside the helper panel", () => {
  const harness = loadGroupHelperTestHooks();
  harness.document.body.innerText = "Search results for YG73AMF";
  harness.document.getElementById = (id) => id === "vfc-group-helper-report"
    ? { innerText: "FaceBay Hampshire • YG73AMF" }
    : null;

  assert.equal(Array.from(harness.hooks.registrationEvidenceLines("YG73AMF")).length, 0);
});

test("membership pending detection waits for Facebook to render the banner", async () => {
  const harness = loadGroupHelperTestHooks();
  let reads = 0;
  Object.defineProperty(harness.document.body, "innerText", {
    configurable: true,
    get() {
      reads += 1;
      return reads < 3
        ? ""
        : "Your membership is pending. You'll be notified if your request to join is approved.";
    },
  });

  assert.equal(await harness.hooks.waitForMembershipPending(5000), true);
  assert.ok(reads >= 3);
});

test("post prep detects Facebook membership pending and reports it back to CRM", async () => {
  let fillMessage = null;
  const harness = loadGroupHelperTestHooks({
    runtimeSendMessage(message) {
      if (message.type === "GROUP_POST_FILL_COMPLETED") fillMessage = message;
      return { ok: true };
    },
  });
  harness.document.body.innerText = "Your membership is pending. You'll be notified if your request to join is approved.";

  await harness.hooks.prepareGroupPost({
    id: "membership-pending-test",
    groupName: "FaceBay Hampshire.. Sell Anything",
    groupUrl: "https://www.facebook.com/groups/test/",
    registration: "YG73AMF",
    caption: "Test caption",
    imageUrl: "https://example.test/van.jpg",
  });

  assert.equal(fillMessage?.membershipPending, true);
  assert.ok(
    harness.appended.some((panel) =>
      String(panel.innerHTML).includes("moved to Pending Membership")
    ),
  );
  assert.equal(harness.calls.includes("FETCH_MARKETPLACE_IMAGE"), false);
  assert.match(backgroundSource, /message\.membershipPending/);
  assert.match(backgroundSource, /type: "GROUP_INSPECTION_COMPLETE"/);
  assert.match(backgroundSource, /membershipPending: true/);
});

test("verified top-level Create Post dialog is accepted without injecting caption text", () => {
  const fixture = createVerifiedComposerFixture();
  const pageComment = makeGroupHelperNode({
    attrs: { role: "textbox", contenteditable: "true", "aria-label": "Write a comment..." },
  });
  const harness = loadGroupHelperTestHooks({ dialogs: [fixture.dialog] });

  assert.equal(harness.hooks.isVerifiedCreatePostDialog(fixture.dialog), true);
  assert.equal(harness.hooks.verifiedComposerDialog(), fixture.dialog);
  const candidates = harness.hooks.composerEditorCandidates(fixture.dialog);
  assert.equal(candidates[0], fixture.editor);
  assert.equal(candidates.includes(pageComment), false);
  assert.equal(fixture.editor.innerText, "");
  assert.equal(pageComment.innerText, "");
});

test("group preparation attaches image, leaves caption box untouched, and instructs manual Ctrl+V", async () => {
  const fixture = createVerifiedComposerFixture();
  const harness = loadGroupHelperTestHooks({
    dialogs: [fixture.dialog],
    runtimeSendMessage(message) {
      if (message.type === "FETCH_MARKETPLACE_IMAGE") {
        return { ok: true, dataUrl: "data:image/jpeg;base64,QQ==" };
      }
      return { ok: true };
    },
  });
  fixture.editor.focus = () => harness.setActive(fixture.editor);

  const caption = "NO CREDIT CHECK\n\n£376 MTH\n\nRENT IT! - DRIVE IT! - OWN IT!\n\nhttps://www.rent2buyvans.co.uk/van-pages/AB12CDE";
  await harness.hooks.prepareGroupPost({
    id: "manual-paste-test",
    groupName: "Test group",
    registration: "AB12CDE",
    caption,
    captionCopied: true,
    imageUrl: "https://example.test/van.jpg",
  });

  assert.equal(fixture.editor.innerText, "");
  assert.equal(fixture.editor.textContent, "");
  assert.equal(fixture.fileInput.files.length, 1);
  assert.equal(harness.calls.includes("FETCH_MARKETPLACE_IMAGE"), true);
  assert.equal(harness.calls.includes("GROUP_POST_FILL_COMPLETED"), true);
  assert.ok(
    harness.appended.some((panel) =>
      String(panel.innerHTML).includes("Caption copied")
      && String(panel.innerHTML).includes("press Ctrl+V")
    ),
  );
  assert.doesNotMatch(groupsHelperSource, /execCommand\("(?:insertText|insertHTML|insertLineBreak)"/);
  assert.doesNotMatch(groupsHelperSource, /ClipboardEvent/);
  assert.doesNotMatch(groupsHelperSource, /reactSetText/);
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

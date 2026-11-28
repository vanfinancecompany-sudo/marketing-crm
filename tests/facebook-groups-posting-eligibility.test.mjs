import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  applyGroupInspection,
  groupPipeline,
  groupPostingLabel,
  isReadyToTest,
  isUnsuitableForTesting,
  markGroupPosted,
} from "../services/facebookGroupsAgent.js";

const pageSource = fs.readFileSync(new URL("../pages/FacebookGroupsAgentPage.jsx", import.meta.url), "utf8");
const url = (slug) => `https://www.facebook.com/groups/${slug}/`;
const group = (slug, fields = {}) => ({ name: "Southampton Buy and Sell", url: url(slug), rent2buy: true, status: "Amber",
  pipeline: "new", postStatus: "new", archived: false, postCount: 0, acceptedPostCount: 0, ...fields });

function inspect(mode, fields = {}) {
  const [checked] = applyGroupInspection([group("123456789012")], [{
    url: url("123456789012"), requestedUrl: url("123456789012"), postingMode: mode, postingEvidence: fields.evidence || "",
    canPost: mode === "normal", joined: mode === "normal" || mode === "listing_only" ? true : mode === "join_required" ? false : null,
    membershipPending: mode === "membership_pending", unavailable: mode === "unavailable", ...fields,
  }], "rent2buy");
  return checked;
}

test("a live check stores the posting mode Facebook showed and sorts the group accordingly", () => {
  const normal = inspect("normal", { evidence: "Write something..." });
  assert.equal(normal.postingMode, "normal");
  assert.equal(normal.postingEvidence, "Write something...");
  assert.ok(normal.postingCheckedAt);
  assert.equal(isReadyToTest(normal), true);
  assert.equal(groupPostingLabel(normal), "Normal posting available");

  const listing = inspect("listing_only", { evidence: "Sell something" });
  assert.equal(isReadyToTest(listing), false);
  assert.equal(isUnsuitableForTesting(listing), true);
  assert.equal(listing.archived, false, "listing-only groups are kept, not archived");

  const off = inspect("posting_off");
  assert.equal(isUnsuitableForTesting(off), true);
  assert.equal(off.archived, false);

  for (const mode of ["unknown", "join_required"]) {
    const uncertain = inspect(mode);
    assert.equal(isReadyToTest(uncertain), false, mode);
    assert.equal(isUnsuitableForTesting(uncertain), false, `${mode} stays in New & Testing`);
    assert.equal(uncertain.archived, false, mode);
  }
  const pending = inspect("membership_pending");
  assert.equal(groupPipeline(pending), "membership_pending");
  assert.equal(inspect("unavailable").archived, true, "Facebook-confirmed unavailable groups archive as before");
});

test("an older helper result without a posting mode leaves eligibility unknown", () => {
  const [checked] = applyGroupInspection([group("123456789012")], [{ url: url("123456789012"), canPost: true }], "rent2buy");
  assert.equal(checked.postingMode, undefined);
  assert.equal(isReadyToTest(checked), false);
  assert.equal(groupPostingLabel(checked), "Posting not checked yet");
});

test("Ready to Test is for untested groups only; posting moves a group on as before", () => {
  const ready = group("222333444555", { postingMode: "normal", postingCheckedAt: "2026-11-28T10:00:00.000Z" });
  assert.equal(isReadyToTest(ready), true);
  const posted = markGroupPosted([ready], ready.url, { registration: "AB12CDE" })[0];
  assert.equal(groupPipeline(posted), "testing");
  assert.equal(isReadyToTest(posted), false);
  const proven = { ...ready, pipeline: "proven", acceptedPostCount: 2, postingMode: "listing_only" };
  assert.equal(isUnsuitableForTesting(proven), false, "proven groups are never set aside");
  assert.equal(isReadyToTest({ ...ready, archived: true }), false);
});

test("page: Ready to Test view, Next Suitable Group, posting badge; manual posting kept", () => {
  for (const text of ["Ready to Test ({counts.ready})", "Next Suitable Group (${readyGroups.length} ready)", "openNextSuitableGroup",
    "Listing only / posting off ({counts.unsuitable})", "groupPostingLabel(group)", 'useState("ready")',
    "await preparePost(next);", "Prepare Test Post", "I Posted It", "Mark Accepted", "Check All Groups (${groupQueue.length})"]) {
    assert.ok(pageSource.includes(text), text);
  }
  assert.equal(pageSource.includes("autoSubmit"), false);
});

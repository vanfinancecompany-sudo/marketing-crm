import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  DISCOVERY_MAX_ROAD_MILES,
  RENT2BUY_COVERAGE_PLACES,
  RENT2BUY_MAX_ROAD_MILES,
  buildRent2BuyDiscoveryQueries,
} from "../lib/rent2buyCoverage.js";
import {
  CHECK_BATCH_SIZE,
  applyGroupInspection,
  archiveFacebookGroup,
  awaitingPostQueue,
  cleanGroupName,
  consolidateFacebookGroups,
  facebookGroupNumericId,
  groupCheckQueue,
  isRent2BuyLocalGroup,
  markGroupPostStatus,
  mergeDiscoveredGroupsWithReport,
  mergeFacebookGroups,
  restoreFacebookGroup,
  scoreFacebookGroups,
} from "../services/facebookGroupsAgent.js";
import { preserveNewerPostState } from "../api/facebook-groups-state.js";

const pageSource = fs.readFileSync(new URL("../pages/FacebookGroupsAgentPage.jsx", import.meta.url), "utf8");
const NOW = new Date("2026-11-28T12:00:00.000Z");
const url = (slug) => `https://www.facebook.com/groups/${slug}/`;

function group(slug, fields = {}) {
  return {
    name: "Southampton Buy and Sell", url: url(slug), rent2buy: true, finance: false, status: "Amber",
    pipeline: "new", postStatus: "new", archived: false, postCount: 0, acceptedPostCount: 0, ...fields,
  };
}

test("discovery searches only places inside the Rent2Buy 100-mile driving area", () => {
  for (const place of RENT2BUY_COVERAGE_PLACES) {
    if (place.roadMiles !== null) assert.ok(place.roadMiles <= RENT2BUY_MAX_ROAD_MILES, `${place.name} ${place.roadMiles}`);
    else assert.ok(place.straightMiles <= 72, `${place.name} is unmeasured but ${place.straightMiles} straight-line miles`);
  }
  const names = RENT2BUY_COVERAGE_PLACES.map((place) => place.name);
  for (const outside of ["Gloucester", "Sevenoaks", "Tunbridge Wells", "Bromley", "Maidstone", "Milton Keynes", "Luton", "Hastings"]) {
    assert.equal(names.includes(outside), false, `${outside} is beyond 100 driving miles`);
  }
  const queries = buildRent2BuyDiscoveryQueries();
  assert.ok(queries.length > 1000, "every place x every group type");
  const searched = new Set(queries.map((item) => item.area));
  for (const place of RENT2BUY_COVERAGE_PLACES) {
    const miles = place.roadMiles ?? place.straightMiles * 1.25;
    assert.equal(searched.has(place.name), miles <= DISCOVERY_MAX_ROAD_MILES, place.name);
  }
  assert.equal(queries[0].query, "Hampshire buy and sell");
  for (const term of ["buy and sell", "marketplace", "classifieds", "vans for sale", "cars and vans for sale", "trades", "local business"]) {
    assert.ok(queries.some((item) => item.query === `Basingstoke ${term}`), term);
  }
});

test("locality: named local places, or local searches that do not name somewhere else", () => {
  assert.equal(isRent2BuyLocalGroup({ name: "Totton & Marchwood Selling Page" }), true);
  assert.equal(isRent2BuyLocalGroup({ name: "Buy Sell Swap No Rules", query: "Romsey buy and sell" }), true);
  assert.equal(isRent2BuyLocalGroup({ name: "Vans For Sale Hull", query: "Southampton vans for sale" }), false);
  assert.equal(isRent2BuyLocalGroup({ name: "Vans For Sale UK", query: "Hampshire vans for sale" }), false);
  assert.equal(isRent2BuyLocalGroup({ name: "Buy Sell Swap No Rules" }), false, "no location evidence at all");
});

test("rediscovering known groups never resets them, archived groups stay archived", () => {
  const archived = group("296917307036835", { name: "Buy And Sell Portsmouth", archived: true, archivedAt: "2026-10-01T10:00:00.000Z",
    archiveReason: "Removed as not worth posting", discoveredAt: "2026-09-23T10:00:00.000Z", status: "Red" });
  const proven = group("southamptoncommunitysales", { name: "Southampton-Portsmouth UK Online Sales", groupId: "100200300400",
    pipeline: "proven", postStatus: "accepted", postCount: 4, acceptedPostCount: 3, lastPostedAt: "2026-11-20T10:00:00.000Z",
    discoveredAt: "2026-09-23T10:00:00.000Z" });
  const before = JSON.parse(JSON.stringify([archived, proven]));
  const { groups, report } = mergeDiscoveredGroupsWithReport([archived, proven], [
    { name: "Profile photo of Buy And Sell Portsmouth", url: "/groups/296917307036835/?ref=search", query: "Portsmouth buy and sell" },
    { name: "Southampton-Portsmouth UK Online Sales", url: "/groups/100200300400/", query: "Southampton buy and sell" },
    { name: "Southampton-Portsmouth UK Online Sales", url: "/groups/southamptoncommunitysales/", query: "Southampton marketplace" },
    { name: "Profile photo of Totton Selling Page", url: "/groups/987654321098/", query: "Totton buy and sell", context: "Public · 4K members" },
    { name: "Vans For Sale Hull", url: "/groups/123123123123/", query: "Southampton vans for sale" },
  ], "rent2buy", NOW);

  assert.deepEqual({ ...report, addedUrls: report.addedUrls.length },
    { found: 4, added: 1, known: 2, knownArchived: 1, outOfScope: 1, addedUrls: 1 });
  const after = (slug) => groups.find((item) => item.url === url(slug));
  for (const field of ["archived", "archivedAt", "archiveReason", "status", "pipeline", "postStatus", "postCount", "acceptedPostCount", "discoveredAt", "lastPostedAt"]) {
    assert.deepEqual(after("296917307036835")[field], before[0][field], `archived ${field}`);
    assert.deepEqual(after("southamptoncommunitysales")[field], before[1][field], `proven ${field}`);
  }
  assert.ok(after("southamptoncommunitysales").aliasUrls.includes(url("100200300400")), "numeric URL recorded as an alias");
  assert.equal(after("987654321098").name, "Totton Selling Page");
  assert.equal(after("987654321098").pipeline, "new");
  assert.equal(groups.length, 3);
});

test("the same group under two URLs is folded into one record with its full history", () => {
  const vanity = group("leabaysouthampton", { name: "Buy & Sell Portsmouth, Southampton", groupId: "555666777888",
    pipeline: "proven", postStatus: "accepted", postCount: 3, acceptedPostCount: 2, lastPostedAt: "2026-11-01T10:00:00.000Z",
    lastAcceptedAt: "2026-11-02T10:00:00.000Z" });
  const numeric = group("555666777888", { name: "Profile photo of Buy & Sell Portsmouth, Southampton", postStatus: "pending",
    pipeline: "testing", postCount: 1, lastPostedAt: "2026-11-25T10:00:00.000Z", pendingRegistration: "AB12CDE" });
  const merged = mergeFacebookGroups([], [vanity, numeric]);
  const primary = merged.find((item) => !item.mergedInto);
  const folded = merged.find((item) => item.mergedInto);
  assert.equal(primary.url, url("leabaysouthampton"));
  assert.equal(primary.postCount, 4);
  assert.equal(primary.acceptedPostCount, 2);
  assert.equal(primary.lastPostedAt, "2026-11-25T10:00:00.000Z", "latest advert carried over");
  assert.equal(primary.pendingRegistration, "AB12CDE");
  assert.equal(primary.lastAcceptedAt, "2026-11-02T10:00:00.000Z");
  assert.ok(primary.aliasUrls.includes(url("555666777888")));
  assert.equal(folded.mergedInto, primary.url);
  assert.equal(folded.postCount, 1, "folded record keeps its own history");
  assert.equal(scoreFacebookGroups(merged, "rent2buy").length, 1, "only one record is shown");
  assert.deepEqual(consolidateFacebookGroups(merged), merged, "folding is stable");
  assert.equal(facebookGroupNumericId(url("facebay-portsmouth-%26-surrounding-areas-288347711259127")), "288347711259127");
  // Actions on either URL reach the kept record only.
  const declined = markGroupPostStatus(merged, { url: url("555666777888"), registration: "AB12CDE", declined: true, checkedAt: "2026-11-28T09:00:00.000Z" });
  assert.equal(declined.find((item) => !item.mergedInto).postStatus, "declined");
  assert.equal(declined.find((item) => item.mergedInto).postStatus, "pending");
});

test("a live check that redirects to the vanity URL updates the record and learns the group ID", () => {
  const groups = [group("444555666777", { name: "Profile photo of Romsey Buy Sell" })];
  const updated = applyGroupInspection(groups, [{
    requestedUrl: url("444555666777"), url: url("romseybuysell"), groupId: "444555666777",
    name: "Romsey Buy Sell", canPost: true, joined: true, members: "8.1K",
  }], "rent2buy");
  assert.equal(updated[0].canPost, true);
  assert.equal(updated[0].groupId, "444555666777");
  assert.equal(updated[0].name, "Romsey Buy Sell");
  assert.ok(updated[0].aliasUrls.includes(url("romseybuysell")));
  assert.ok(updated[0].lastCheckedAt);
  assert.equal(cleanGroupName("This content isn't available right now"), "");
});

test("saved state: an archived group returns only through an explicit restore; discovery history is kept", () => {
  const row = (state) => ({ group_key: state.url.toLowerCase(), group_url: state.url, state });
  const stored = row(group("111222333444", { archived: true, archivedAt: "2026-11-01T10:00:00.000Z", archiveReason: "Declined",
    discoveredAt: "2026-09-23T10:00:00.000Z", groupId: "111222333444", aliasUrls: [url("oldname")] }));
  const stale = row(group("111222333444", { archived: false, discoveredAt: "2026-11-28T10:00:00.000Z" }));
  const kept = preserveNewerPostState(stale, stored).state;
  assert.equal(kept.archived, true);
  assert.equal(kept.archiveReason, "Declined");
  assert.equal(kept.discoveredAt, "2026-09-23T10:00:00.000Z");
  assert.equal(kept.groupId, "111222333444");
  assert.deepEqual(kept.aliasUrls, [url("oldname")]);

  const restored = restoreFacebookGroup([stored.state], url("111222333444"))[0];
  assert.ok(restored.restoredAt);
  assert.equal(preserveNewerPostState(row(restored), stored).state.archived, false);
  const rearchived = archiveFacebookGroup([restored], url("111222333444"))[0];
  assert.equal(rearchived.archived, true);
});

test("Check All queues cover every eligible item, in automatic batches", () => {
  const groups = [];
  for (let index = 0; index < 64; index += 1) groups.push(group(`9000000000${String(index).padStart(2, "0")}`, { name: `Southampton Buy Sell ${index}` }));
  groups.push(group("900000000100", { archived: true }));
  groups.push(group("900000000101", { status: "Red" }));
  groups.push(group("900000000102", { membershipPending: true }));
  groups.push(group("900000000103", { lastCheckedAt: "2026-11-27T10:00:00.000Z", postingCheckedAt: "2026-11-27T10:00:00.000Z", postingMode: "normal" }));
  groups.push(group("900000000104", { lastCheckedAt: "2026-11-27T10:00:00.000Z" }));
  // 64 never checked + pending membership (a check shows approval) + recently checked before posting detection.
  assert.equal(groupCheckQueue(groups, "rent2buy", NOW).length, 66);

  const posted = [];
  for (let index = 0; index < 91; index += 1) {
    posted.push(group(`8000000000${String(index).padStart(2, "0")}`, { postStatus: index % 3 ? "awaiting" : "pending", pipeline: "testing",
      lastPostedAt: "2026-11-20T10:00:00.000Z", pendingRegistration: `AB${index}CDE`, postCount: 1 }));
  }
  posted.push(group("800000000200", { postStatus: "accepted", pipeline: "proven", lastPostedAt: "2026-11-20T10:00:00.000Z", pendingRegistration: "ZZ1" }));
  assert.equal(awaitingPostQueue(posted, "rent2buy").length, 91);
  assert.equal(CHECK_BATCH_SIZE, 25);
});

test("page: single-click Check All with progress, stop and resume; background renewal panel removed", () => {
  for (const text of ["Check All Groups (${groupQueue.length})", "Check All Awaiting Posts (${postQueue.length})",
    "Resume ({remaining} left)", "cancelFacebookGroupAgentJob(run.current.jobId)", "window.setTimeout(() => void runNextCheckBatch(), 1500)",
    "unable to verify", "still awaiting", "mergeDiscoveredGroupsWithReport",
    'run.status === "stopping" ? run.current.keys.filter((key) => reported.has(key)) : run.current.keys']) {
    assert.ok(pageSource.includes(text), text);
  }
  for (const removed of ["Pair background Groups Helper", "Prepare today's renewal queue", "Proven / Hot renewals",
    "Held from automatic adverts", "requestGroupRenewalHelper", "GET_GROUP_RENEWAL_STATE", "worker-enroll"]) {
    assert.equal(pageSource.includes(removed), false, removed);
  }
  // Manual posting and approval monitoring stay.
  for (const kept of ["Prepare Test Post", "Prepare Next Post", "I Posted It", "Mark Accepted", "Mark Declined", "recordGroupApproval",
    "GROUP_POST_STATUS_EVENT", "recordGroupPostActivity"]) {
    assert.ok(pageSource.includes(kept), kept);
  }
});

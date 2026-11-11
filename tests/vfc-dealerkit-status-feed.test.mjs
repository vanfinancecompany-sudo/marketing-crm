import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isSoldRemovalReview, projectPublicDealerKitAvailability } from "../lib/dealerKitPublicAvailability.mjs";

test("only confirmed final lifecycle transitions enter Sold / Removal Review", () => {
  for (const sourceLifecycleStatus of ["sold", "awaiting_delivery", "removed_from_dealerkit"]) {
    assert.equal(isSoldRemovalReview({ sourceLifecycleStatus, sourceStatus: "reserved" }), true);
    assert.equal(isSoldRemovalReview({ sourceLifecycleStatus, workflowStatus: "hidden" }), true);
    assert.equal(isSoldRemovalReview({ sourceLifecycleStatus, workflowStatus: "never_show_again" }), true);
  }
  for (const sourceLifecycleStatus of ["reserved", "deposit_taken", "available", "source_unresolved"]) {
    assert.equal(isSoldRemovalReview({ sourceLifecycleStatus }), false);
  }
});

test("server-safe availability projection retains only real observed registrations and respects manual Hide per lane", () => {
  const now = Date.parse("2026-11-11T13:00:00Z");
  const source = [
    { registration: "AB22 CDE", supplier_stock_id: "1", source_status: "Reserved", last_seen_at: "2026-11-11T12:45:00Z" },
    { registration: "CC72 DEF", supplier_stock_id: "2", source_status: "Deposit Taken", last_seen_at: "2026-11-11T12:43:00Z" },
    { registration: "SO22 LDD", supplier_stock_id: "3", source_status: "Sold", last_seen_at: "2026-11-11T12:43:00Z" },
    { registration: "OL22 DER", supplier_stock_id: "4", source_status: "Reserved", last_seen_at: "2026-10-01T12:43:00Z" },
    { registration: "YY22 AAA", supplier_stock_id: "5", source_status: "In Stock", last_seen_at: "2026-11-11T12:43:00Z" },
    { registration: "XX22 AAA", supplier_stock_id: "", source_status: "Reserved", last_seen_at: "2026-11-11T12:43:00Z" },
  ];
  const actions = [
    { registration: "AB22 CDE", pipeline: "finance", workflow_status: "hidden" },
    { registration: "AB22 CDE", pipeline: "rent2buy", workflow_status: "new" },
    { registration: "SO22 LDD", pipeline: "cars", workflow_status: "never_show_again" },
  ];
  assert.deepEqual(projectPublicDealerKitAvailability(source, actions, { now }), [
    { registration: "AB22CDE", status: "reserved", hidden: ["finance"] },
    { registration: "CC72DEF", status: "reserved", hidden: [] },
    { registration: "SO22LDD", status: "unavailable", hidden: ["cars"] },
  ]);
});

test("the latest confirmed DealerKit observation controls the badge", () => {
  const now = Date.parse("2026-11-11T13:00:00Z");
  const row = (registration, supplier_stock_id, source_status, minutesAgo) => ({
    registration,
    supplier_stock_id,
    source_status,
    last_seen_at: new Date(now - minutesAgo * 60000).toISOString(),
  });
  const source = [
    row("AB22 CDE", "1", "Reserved", 10),
    row("CC72 DEF", "2", "Awaiting Delivery", 5),
    row("SO22 LDD", "3", "Available", 5),
    row("AB22 CDE", "4", "In Stock", 5),
    row("CC72 DEF", "5", "Reserved", 10),
    row("SO22 LDD", "6", "Sold", 10),
  ];
  assert.deepEqual(projectPublicDealerKitAvailability(source, [], { now }), [
    { registration: "CC72DEF", status: "unavailable", hidden: [] },
  ]);
});


test("DealerKit status feed is private, read-only and refuses missing credentials", () => {
  const route = fs.readFileSync(new URL("../api/vfc-dealerkit-availability.js", import.meta.url), "utf8");
  assert.match(route, /timingSafeEqual/);
  assert.match(route, /if \(!expected \|\| !provided\) return false/);
  assert.match(route, /request\.method !== "GET"/);
  assert.match(route, /response\.status\(401\)/);
  assert.match(route, /private, no-store/);
  assert.match(route, /dealerkit_stock_state/);
  assert.doesNotMatch(route, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildCarsWritePlan } from "../api/sync-cars-stock.js";

test("Cars write plan updates current, inserts new and deactivates stale only", () => {
  const source = [
    { registration: "AA11AAA", title: "Current A" },
    { registration: "BB22BBB", title: "New B" },
  ];
  const existing = [
    { id: "keep-a", registration: "AA11AAA", is_active: true },
    { id: "stale-c", registration: "CC33CCC", is_active: true },
    { id: "already-off", registration: "DD44DDD", is_active: false },
  ];

  const plan = buildCarsWritePlan(source, existing);

  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].id, "keep-a");
  assert.equal(plan.updates[0].payload.registration, "AA11AAA");
  assert.equal(plan.updates[0].payload.is_active, true);
  assert.deepEqual(plan.inserts.map((row) => row.registration), ["BB22BBB"]);
  assert.deepEqual(plan.deactivateIds, ["stale-c"]);
});

test("Cars write plan deactivates active duplicate rows but keeps one identity", () => {
  const source = [{ registration: "AA11AAA", title: "Current A" }];
  const existing = [
    { id: "keeper", registration: "AA11AAA", is_active: true },
    { id: "duplicate", registration: "AA11AAA", is_active: true },
  ];

  const plan = buildCarsWritePlan(source, existing);

  assert.equal(plan.updates.length, 1);
  assert.equal(plan.updates[0].id, "keeper");
  assert.deepEqual(plan.deactivateIds, ["duplicate"]);
});

test("manual Van Finance posting pool excludes Cars", async () => {
  const source = await readFile(new URL("../App.jsx", import.meta.url), "utf8");
  assert.match(
    source,
    /return vehicles\.filter\(\(vehicle\) => vehicle\.pipeline !== "cars"\);/
  );
});

test("Cars cron is hourly, isolated and feature-gated in source", async () => {
  const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const cron = vercel.crons.find((item) => item.path === "/api/sync-cars-stock?auto=true");
  assert.deepEqual(cron, {
    path: "/api/sync-cars-stock?auto=true",
    schedule: "7 * * * *",
  });

  const syncSource = await readFile(new URL("../api/sync-cars-stock.js", import.meta.url), "utf8");
  assert.match(syncSource, /CARS_STOCK_SYNC_ENABLED/);
  assert.match(syncSource, /CRON_SECRET/);
  assert.match(syncSource, /if \(!syncEnabled\(\)\)/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Content Operations is the single daily marketing page", async () => {
  const [app, navigation] = await Promise.all([
    read("App.jsx"),
    read("public/shared/sidebar-navigation.js"),
  ]);

  assert.match(app, /case "Content Operations"/);
  assert.doesNotMatch(app, /MarketingTotalsPage|DailyTargetBanner/);
  assert.match(navigation, /label: "Content Operations"/);
  assert.doesNotMatch(navigation, /label: "Totals"/);
});

test("Content Operations shows only the five daily activity cards", async () => {
  const page = await read("pages/DashboardPage.jsx");

  assert.match(page, /operations-activity-grid/);
  assert.match(page, /DAILY_ACTIVITY_TYPES\.map/);
  assert.match(page, /VIEW TOTALS AND HISTORY/);
  assert.match(page, /EDIT DAILY TARGETS/);
  assert.match(page, /generated/);
  assert.doesNotMatch(page, /MARK ONE POSTED|POST VAN FINANCE|POST RENT2BUY|SEND EMAIL BATCH/);
  assert.doesNotMatch(page, /Top Performing Reels|Recent Reel Activity|Stock posts waiting/);
});

test("email totals use completed production sends from the selected UK day", async () => {
  const endpoint = await read("api/marketing-daily-operations.js");
  assert.match(endpoint, /from\("marketing_email_sends"\)/);
  assert.match(endpoint, /\.gte\("completed_at", startRange\.start\)/);
  assert.match(endpoint, /sends\.filter\(\(row\) => sendActivityDate\(row\) === dateKey\)/);
  assert.doesNotMatch(endpoint, /first_sent_at\.is\.null,created_at/);
});

test("the floating incomplete warning was removed", async () => {
  const [renderer, css] = await Promise.all([
    read("public/shared/sidebar-renderer.js"),
    read("public/shared/sidebar.css"),
  ]);

  assert.doesNotMatch(renderer, /marketing-daily-warning|loadDailyTargetWarning/);
  assert.doesNotMatch(css, /marketing-daily-warning/);
});

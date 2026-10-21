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

test("Content Operations renders the full daily placement card set", async () => {
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

test("Content Operations shows Vansco Buffer posts as a blue-accent live card", async () => {
  const [page, css] = await Promise.all([
    read("pages/DashboardPage.jsx"),
    read("styles.css"),
  ]);

  assert.match(page, /targetFor\("vansco_facebook_post"\)/);
  assert.match(page, /vanscoStatus\?\.buffer\?\.sentToday/);
  assert.match(page, /type: "vansco_facebook_post"/);
  assert.match(page, /Vansco Facebook posts/);
  assert.match(page, /Vansco 333 Google Business/);
  assert.match(page, /Vansco Airport Google Business/);
  assert.match(page, /Vansco New Forest Google Business/);
  assert.match(page, /targetFor\(type\)/);
  assert.match(page, /targetFor\("vansco_facebook_story"\)/);
  assert.match(page, /Vansco Facebook Stories/);
  assert.match(page, /vanscoStatus\?\.stories\?\.sentToday/);
  assert.match(page, /startsWith\("vansco_"\)/);
  assert.match(css, /operations-activity-card\.is-vansco/);
  assert.match(css, /border: 2px solid #2563eb/);
});



test("Content Operations shows Finance and Rent2Buy Story cards without the Vansco blue accent", async () => {
  const page = await read("pages/DashboardPage.jsx");

  assert.match(page, /Van Finance Facebook Stories/);
  assert.match(page, /Rent2Buy Facebook Stories/);
  assert.match(page, /bufferLiveStatus\?\.today\?\.\[productKey\]\?\.stories/);
  assert.match(page, /type: "van_finance_facebook_story"/);
  assert.match(page, /type: "rent2buy_facebook_story"/);
  assert.match(page, /const isVansco = String\(metric\.type \|\| ""\)\.startsWith\("vansco_"\)/);
});

test("Content Operations includes Van Finance Instagram and totals all visible cards", async () => {
  const [page, bridge] = await Promise.all([
    read("pages/DashboardPage.jsx"),
    read("public/buffer-live-status.js"),
  ]);
  assert.match(page, /Van Finance Instagram posts/);
  assert.match(page, /Van Finance Instagram Stories/);
  assert.match(page, /Van Finance Instagram Reels/);
  assert.match(page, /vanFinanceInstagram/);
  assert.match(page, /operationsSummary/);
  assert.match(page, /remainingTotal/);
  assert.match(page, /completionPercentage/);
  assert.doesNotMatch(page, /overview\?\.day\?\.remaining_total \|\| 0/);
  assert.match(bridge, /Van Finance Instagram:/);
  assert.match(bridge, /buffer-facebook-live-status/);
  assert.doesNotMatch(bridge, /Buffer live today/);
});
test("View Totals and Edit Daily Targets both use the complete placement registry", async () => {
  const [page, daily] = await Promise.all([
    read("pages/DashboardPage.jsx"),
    read("lib/marketingDailyOperations.js"),
  ]);

  assert.match(page, /DAILY_ACTIVITY_TYPES\.map\(\(type\) =>/);
  assert.match(page, /<TargetFields/);
  for (const type of [
    "van_finance_facebook_story",
    "van_finance_instagram_post",
    "van_finance_instagram_story",
    "van_finance_instagram_reel",
    "rent2buy_facebook_story",
    "vansco_facebook_post",
    "vansco_facebook_story",
    "vansco_333_google_business_post",
    "vansco_airport_google_business_post",
    "vansco_new_forest_google_business_post",
  ]) {
    assert.match(daily, new RegExp(type));
  }
});

test("Vehicle Google Ads route highlights its own sidebar item, including direct loads", async () => {
  const [app, nav] = await Promise.all([
    read("App.jsx"),
    read("public/shared/sidebar-navigation.js"),
  ]);
  assert.match(app, /"Vansco Google Vehicle Ads": "\/vansco-google-vehicle-ads"/);
  assert.match(app, /path === "\/vansco-google-vehicle-ads"\) return "Vansco Google Vehicle Ads"/);
  assert.match(nav, /id: "vansco-google-vehicle-ads"/);
  assert.match(nav, /paths: \["\/vansco-google-vehicle-ads"\]/);
});

test("Content Operations includes a real Vansco Google feed card and totals drawer snapshot", async () => {
  const page = await read("pages/DashboardPage.jsx");
  assert.match(page, /function GoogleVehicleAdsCard/);
  assert.match(page, /"\/api\/vansco-google-vehicle-selection"/);
  assert.match(page, /!vehicle\.missingFromFeed/);
  assert.match(page, /!vehicle\.feedExclusion/);
  assert.match(page, /inventory=\{googleVehicleInventory\}/);
  assert.match(page, /<summary>VIEW TOTALS AND HISTORY<\/summary>/);
  assert.match(page, /Current DealerKit Google feed stock/);
  assert.match(page, /Open Vehicle Ads/);
  assert.match(page, /onNavigate\?\.\("Vansco Google Vehicle Ads"\)/);
  assert.match(page, /not a historical advertisement or approval count/);
});

test("Buffer live status keeps updating placement cards without creating a duplicate summary", async () => {
  const bridge = await read("public/buffer-live-status.js");
  assert.doesNotMatch(bridge, /function ensureOperationsPanel|<h3>Buffer live today<\/h3>/);
  assert.match(bridge, /window\.dispatchEvent\(new CustomEvent\("buffer-facebook-live-status"/);
  assert.match(bridge, /if \(kind === "operations"\)/);
});

test("Vansco Email Studio card, live daily count and detailed totals are based on real isolated production sends", async () => {
  const [page, endpoint, registry, migration] = await Promise.all([
    read("pages/DashboardPage.jsx"),
    read("api/marketing-daily-operations.js"),
    read("lib/marketingDailyOperations.js"),
    read("supabase/migrations/20261021_vansco_email_content_operations_daily_totals.sql"),
  ]);
  assert.match(registry, /vansco_emails_sent: "Vansco Email Studio"/);
  assert.match(registry, /vansco_emails_sent: 0/);
  assert.match(registry, /vanscoEmailSends\.reduce/);
  assert.match(registry, /!\["emails_sent","vansco_emails_sent"\]\.includes\(type\)/);
  assert.match(endpoint, /vansco_email_daily_sent_counts/);
  assert.match(endpoint, /vanscoEmailSends: vanscoEmailSends\.filter/);
  assert.match(endpoint, /if \(action === "vanscoEmailToday"\)/);
  assert.match(page, /getVanscoEmailToday\(today\)/);
  assert.match(page, /60 \* 1000/);
  assert.match(page, /window\.location\.assign\("\/vansco-email-studio\/"\)/);
  assert.match(page, /Vansco Email Studio · Daily history/);
  assert.match(page, /day\.metrics\?\.vansco_emails_sent\?\.completed/);
  assert.match(migration, /s\.send_type='production'/);
  assert.match(migration, /s\.provider_message_id is not null/);
  assert.match(migration, /s\.status in \('accepted','sent','delivered','opened','clicked','bounced'\)/);
  assert.match(migration, /s\.created_at at time zone 'Europe\/London'/);
  assert.match(migration, /revoke all on function public\.vansco_email_daily_sent_counts/);
  assert.match(migration, /grant execute on function public\.vansco_email_daily_sent_counts.*to service_role/);
});

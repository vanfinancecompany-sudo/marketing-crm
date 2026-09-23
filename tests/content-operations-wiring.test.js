import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createYouTubeExportOperationId,
  youtubeActivityTypeForProduct,
} from "../services/marketingDailyOperations.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("global browser anchor interception is removed", async () => {
  const service = await read("../services/marketingDailyOperations.js");
  assert.doesNotMatch(service, /HTMLAnchorElement\.prototype\.click/);
  assert.doesNotMatch(
    service,
    /document\.querySelector\("\.youtube-generator"\)/,
  );
  assert.doesNotMatch(service, /pageText|originalClick|trackedDownloadClick/);
});

test("all four successful YouTube video paths call direct tracking", async () => {
  const page = await read("../pages/YouTubeGeneratorPage.jsx");
  assert.match(
    page,
    /handleDownloadMp4[\s\S]*format:\s*"mp4"[\s\S]*queueDownload:\s*false/,
  );
  assert.match(
    page,
    /handleDownloadWebm[\s\S]*format:\s*"webm"[\s\S]*queueDownload:\s*false/,
  );
  assert.match(
    page,
    /exportQueuedVehicle[\s\S]*format:\s*"mp4"[\s\S]*queueDownload:\s*true/,
  );
  assert.match(
    page,
    /exportQueuedVehicle[\s\S]*format:\s*"webm"[\s\S]*queueDownload:\s*true/,
  );
});

test("structured vehicle identity and queue status are supplied directly", async () => {
  const service = await read("../services/marketingDailyOperations.js");
  const page = await read("../pages/YouTubeGeneratorPage.jsx");
  assert.match(service, /vehicle_id:\s*vehicleId/);
  assert.match(service, /registration,/);
  assert.match(service, /queue_download:\s*Boolean\(queueDownload\)/);
  assert.match(page, /vehicle:\s*selectedVehicle/);
  assert.doesNotMatch(
    `${service}\n${page}`,
    /page\.textContent|querySelector\("\.youtube-generator"\)/,
  );
});

test("operation IDs are created before downloads and reused for tracking retries", async () => {
  const page = await read("../pages/YouTubeGeneratorPage.jsx");
  const service = await read("../services/marketingDailyOperations.js");
  assert.match(
    page,
    /const operationId = createYouTubeExportOperationId\(\);[\s\S]*downloadYouTubeMp4FromServer[\s\S]*operationId/,
  );
  assert.match(
    service,
    /sourceId:\s*`youtube-export:\$\{productKey\}:\$\{operationId\}`/,
  );
  assert.match(
    service,
    /await recordDailyMarketingActivity\(activityType, options\)[\s\S]*await recordDailyMarketingActivity\(activityType, options\)/,
  );
  assert.notEqual(
    createYouTubeExportOperationId(),
    createYouTubeExportOperationId(),
  );
});

test("Cars and non-video exports are excluded", async () => {
  const page = await read("../pages/YouTubeGeneratorPage.jsx");
  assert.equal(youtubeActivityTypeForProduct("vanFinance"), "van_finance_reel");
  assert.equal(youtubeActivityTypeForProduct("rent2buy"), "rent2buy_reel");
  assert.equal(youtubeActivityTypeForProduct("cars"), null);
  assert.doesNotMatch(
    page,
    /trackCompletedDownload\([\s\S]{0,120}descriptionFilenameFromMp4/,
  );
});

test("tracking failure remains non-blocking after the browser download", async () => {
  const page = await read("../pages/YouTubeGeneratorPage.jsx");
  assert.match(page, /YOUTUBE CONTENT OPERATIONS TRACKING ERROR/);
  assert.match(page, /YOUTUBE_TRACKING_WARNING/);
  assert.match(
    page,
    /downloadYouTubeMp4FromServer[\s\S]*await trackCompletedDownload/,
  );
});

test("Content Operations links the four new five-a-day lanes to their pages", async () => {
  const [dashboard, lib, postingDesk, groupsPage, migration] = await Promise.all([
    read("../pages/DashboardPage.jsx"),
    read("../lib/marketingDailyOperations.js"),
    read("../pages/PostingDeskPage.jsx"),
    read("../pages/FacebookGroupsAgentPage.jsx"),
    read("../supabase/migrations/202609231330_content_operations_marketplace_groups.sql"),
  ]);

  for (const type of [
    "van_finance_groups_post",
    "rent2buy_groups_post",
    "van_finance_marketplace_post",
    "rent2buy_marketplace_post",
  ]) {
    assert.match(lib, new RegExp(`${type}: 5`));
  }

  assert.match(dashboard, /van_finance_groups_post: "Van Finance Groups & Classifieds"/);
  assert.match(dashboard, /rent2buy_groups_post: "Rent2Buy Facebook Groups"/);
  assert.match(dashboard, /van_finance_marketplace_post: "Van Finance Marketplace"/);
  assert.match(dashboard, /rent2buy_marketplace_post: "Rent2Buy Marketplace"/);
  assert.match(postingDesk, /return "van_finance_marketplace_post"/);
  assert.match(postingDesk, /return "rent2buy_marketplace_post"/);
  assert.match(groupsPage, /groupActivityType/);
  assert.match(groupsPage, /source: "facebook_groups"/);
  assert.match(migration, /metadata->>'destination' = 'Van Finance Marketplace'/);
  assert.match(migration, /metadata->>'destination' = 'Rent2Buy Marketplace'/);
});

test("Knowledge Hub card uses sent-to-Wix wording", async () => {
  const dashboard = await read("../pages/DashboardPage.jsx");
  assert.match(dashboard, /knowledge_hub_article:\s*"sent to Wix"/);
  assert.doesNotMatch(dashboard, /knowledge_hub_article:\s*"published"/);
});

test("Knowledge Hub activity records only the first successful Wix draft", async () => {
  const api = await read("../api/marketing-wix-publishing.js");
  assert.match(
    api,
    /result\.operation!=="created"\|\|clean\(article\.wix_item_id\)/,
  );
  assert.match(api, /activity_type:"knowledge_hub_article"/);
  assert.match(api, /source:"knowledge_hub_wix_draft"/);
  assert.match(api, /source_id:article\.id/);
  assert.match(api, /created_or_updated:"created"/);
});

test("migration remains required and preserves fixed-column defaults", async () => {
  const migration = await read(
    "../supabase/migrations/016_content_operations_knowledge_hub.sql",
  );
  assert.match(
    migration,
    /marketing_daily_target_schedules[\s\S]*knowledge_hub_article integer not null default 2/,
  );
  assert.match(
    migration,
    /marketing_daily_target_overrides[\s\S]*knowledge_hub_article integer not null default 2/,
  );
  assert.match(
    migration,
    /marketing_daily_activity_events_activity_type_check/,
  );
});

test("Wix success remains draft-only when activity tracking fails", async () => {
  const api = await read("../api/marketing-wix-publishing.js");
  const wixLib = await read("../lib/wixPublishing.js");
  assert.match(
    api,
    /contentOperationsWarning="Wix draft created, but Content Operations could not be updated\."/,
  );
  assert.match(api, /published:false/);
  assert.doesNotMatch(
    `${api}\n${wixLib}`,
    /publishLive|livePublish|status:\s*["']published["']/,
  );
});

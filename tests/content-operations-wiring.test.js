import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("YouTube downloads are observed only after the browser anchor click path", async () => {
  const service = await read("../services/marketingDailyOperations.js");
  assert.match(service, /originalClick\.apply\(this, args\)/);
  assert.match(service, /recordDailyMarketingActivity\(activity\.activityType/);
  assert.match(service, /source:\s*"youtube_generator"/);
  assert.match(service, /Video downloaded, but Content Operations could not be updated\./);
  assert.match(service, /\.catch\(showYouTubeTrackingWarning\)/);
});

test("preview, queue additions, skipped items, cancellation and text files are not activity sources", async () => {
  const service = await read("../services/marketingDailyOperations.js");
  assert.match(service, /endsWith\("\.webm"\).*endsWith\("\.mp4"\)/s);
  assert.match(service, /productKey === "cars"/);
  assert.doesNotMatch(service, /Generate Preview|Add Current Vehicle|Queue cancelled/);
});

test("source ids include the completed output URL and stay stable for duplicate callbacks", async () => {
  const service = await read("../services/marketingDailyOperations.js");
  assert.match(service, /operationIdentity = `\$\{productKey\}\|\$\{filename\}\|\$\{format\}\|\$\{href\}`/);
  assert.match(service, /youtube-export:/);
});

test("Knowledge Hub activity records only the first successful Wix draft creation", async () => {
  const api = await read("../api/marketing-wix-publishing.js");
  assert.match(api, /result\.operation!=="created"\|\|clean\(article\.wix_item_id\)/);
  assert.match(api, /activity_type:"knowledge_hub_article"/);
  assert.match(api, /source:"knowledge_hub_wix_draft"/);
  assert.match(api, /source_id:article\.id/);
  assert.match(api, /created_or_updated:"created"/);
});

test("Wix success is retained when Content Operations tracking fails", async () => {
  const api = await read("../api/marketing-wix-publishing.js");
  assert.match(api, /contentOperationsWarning="Wix draft created, but Content Operations could not be updated\."/);
  assert.match(api, /return\{article:savedArticle,content_operations_warning:contentOperationsWarning/);
});

test("failed Wix creation records no Knowledge Hub activity and live publication is absent", async () => {
  const api = await read("../api/marketing-wix-publishing.js");
  const wixLib = await read("../lib/wixPublishing.js");
  const trackingCall = api.indexOf("recordKnowledgeActivity(supabase,article,result)");
  const wixCall = api.indexOf("createOrUpdateWixDraft({article,suggestions,configuration,fetchImpl})");
  assert.ok(wixCall >= 0 && trackingCall > wixCall);
  assert.match(api, /published:false/);
  assert.doesNotMatch(`${api}\n${wixLib}`, /publishLive|livePublish|status:\s*["']published["']/);
});

test("fixed-column target schema receives the minimal Knowledge Hub migration", async () => {
  const migration = await read("../supabase/migrations/016_content_operations_knowledge_hub.sql");
  assert.match(migration, /marketing_daily_target_schedules[\s\S]*knowledge_hub_article integer not null default 2/);
  assert.match(migration, /marketing_daily_target_overrides[\s\S]*knowledge_hub_article integer not null default 2/);
  assert.match(migration, /marketing_daily_activity_events_activity_type_check/);
});

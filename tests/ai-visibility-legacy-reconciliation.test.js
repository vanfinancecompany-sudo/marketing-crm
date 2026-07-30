import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  deactivationSelectionReason,
  isWixKnowledgeManagedArticle,
  stableWixIdentityForArticle,
  wixManagementClassification,
} from "../lib/aiVisibilityWixLifecycle.js";
import { buildVisibilitySummary } from "../lib/aiVisibility.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

function article(index, live = false) {
  const slug = `article-${index}`;
  return {
    id: `article-${index}`,
    title: `Article ${index}`,
    slug,
    wix_item_id: live ? `wix-${index}` : null,
    wix_collection_id: live ? "knowledge-hub" : null,
    live_wix_url: `https://www.vanfinancecompany.co.uk/knowledge-hub-article/${slug}`,
    wix_sync_status: live ? "live" : "synced",
    wix_publication_status: "live",
    publication_verified_at: "2026-07-01T10:00:00Z",
    last_wix_verification_at: live ? "2026-07-30T07:00:00Z" : null,
    publication_verification_notes: live
      ? "Verified from Wix LIVE collection."
      : "Historical publication verification.",
    published_at: "2026-07-01T09:00:00Z",
    is_active: true,
  };
}

test("legacy Knowledge Hub row without collection or item ID is safely recognised", () => {
  const legacy = article(20, false);
  const classification = wixManagementClassification(legacy, "knowledge-hub");
  assert.equal(classification.managed, true);
  assert.equal(
    classification.reason,
    "legacy_published_knowledge_hub_url_and_verification",
  );
});

test("manual URLs and title-only rows remain outside Wix management", () => {
  assert.equal(
    isWixKnowledgeManagedArticle({
      id: "manual",
      title: "Knowledge Hub article",
      live_wix_url: "https://example.com/knowledge-hub/article",
      publication_verified_at: "2026-07-01T10:00:00Z",
      published_at: "2026-07-01T09:00:00Z",
      wix_sync_status: "live",
      wix_publication_status: "live",
    }, "knowledge-hub"),
    false,
  );
  assert.equal(
    isWixKnowledgeManagedArticle({ title: "Article 20", slug: "article-20" }, "knowledge-hub"),
    false,
  );
});

test("47 published rows reconcile to 19 current live and 28 historical rows", () => {
  const articles = Array.from({ length: 47 }, (_, index) => article(index + 1, index < 19));
  const liveIdentities = articles.slice(0, 19).map(stableWixIdentityForArticle);
  const selected = articles.filter((item) =>
    deactivationSelectionReason(item, liveIdentities, "knowledge-hub").selected,
  );
  assert.equal(selected.length, 28);

  const reconciled = articles.map((item) =>
    selected.some((candidate) => candidate.id === item.id)
      ? {
          ...item,
          is_active: false,
          wix_sync_status: "unpublished",
          wix_publication_status: "unpublished",
          publication_verified_at: null,
          unpublished_at: "2026-07-30T08:00:00Z",
        }
      : item,
  );
  const summary = buildVisibilitySummary({ articles: reconciled });
  assert.equal(summary.published_pages, 19);
  assert.equal(summary.awaiting_first_check, 19);

  const selectedOnSecondRun = reconciled.filter((item) =>
    deactivationSelectionReason(item, liveIdentities, "knowledge-hub").selected,
  );
  assert.equal(selectedOnSecondRun.length, 0);
});

test("safe diagnostic endpoint exposes only approved article lifecycle fields", async () => {
  const diagnostic = await read("../api/marketing-ai-visibility-wix-diagnostics.js");
  assert.match(diagnostic, /deployed_commit/);
  assert.match(diagnostic, /unmatched_records/);
  assert.match(diagnostic, /wix_managed_reason/);
  assert.match(diagnostic, /deactivation_reason/);
  assert.doesNotMatch(diagnostic, /SUPABASE_SERVICE_ROLE_KEY.*response/i);
  assert.doesNotMatch(diagnostic, /customer|email|phone/i);
});

test("sync result visibly includes every requested diagnostic count", async () => {
  const service = await read("../services/aiVisibility.js");
  for (const label of [
    "Total article records loaded",
    "Wix-managed records identified",
    "Active Wix-managed records before sync",
    "Live records matched",
    "Legacy Wix-managed candidates",
    "Missing-live candidates",
    "Records skipped as not Wix-managed",
    "Records deactivated",
  ]) {
    assert.match(service, new RegExp(label));
  }
});

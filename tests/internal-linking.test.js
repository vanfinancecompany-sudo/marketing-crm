import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildInternalLinkArticleProfile,
  isApprovedInternalUrl,
  suggestInternalLinks,
} from "../lib/internalLinking.js";

const page = (id, title, url, extra = {}) => ({
  id,
  title,
  url,
  category: "Products",
  keywords: [],
  vehicle_types: [],
  customer_intent: [],
  priority: 3,
  description: "",
  active: true,
  ...extra,
});

test("intent profile maps model references to buying-intent vehicle categories", () => {
  const profile = buildInternalLinkArticleProfile({
    article: {
      title: "Ford Transit Custom MWB or Ford Ranger?",
      content_markdown: "A Citroen Berlingo is a compact option. A Transit LWB offers more room.",
    },
  });
  assert.equal(profile.intents.has("medium_wheelbase_vans"), true);
  assert.equal(profile.intents.has("long_wheelbase_vans"), true);
  assert.equal(profile.intents.has("pickups"), true);
  assert.equal(profile.intents.has("small_vans"), true);
});

test("matcher recommends approved intent destinations rather than manufacturer pages", () => {
  const suggestions = suggestInternalLinks({
    article: {
      id: "current",
      title: "Choosing a Ford Transit Custom MWB with vehicle finance",
      content_markdown: "## Applying\nYou can apply after selecting a medium van.",
    },
    websitePages: [
      page("mwb", "Medium Wheelbase Vans", "/vans/medium-wheelbase", {
        vehicle_types: ["Medium Wheelbase Vans"],
        priority: 5,
      }),
      page("finance", "Van Finance", "/van-finance", {
        customer_intent: ["Vehicle finance"],
        category: "Finance",
      }),
      page("apply", "Apply Now", "/apply", {
        customer_intent: ["Applying"],
        category: "Applications",
      }),
      page("ford", "Ford vans", "/manufacturers/ford", {
        keywords: ["Ford"],
        priority: 1,
      }),
    ],
  });
  assert.deepEqual(
    new Set(suggestions.slice(0, 3).map((item) => item.destination_title)),
    new Set(["Medium Wheelbase Vans", "Apply Now", "Van Finance"])
  );
  assert.equal(suggestions.some((item) => item.destination_title === "Ford vans"), false);
  assert.equal(suggestions.every((item) => item.reason && item.confidence_score >= 40), true);
});

test("matcher rejects external, hidden and duplicate destinations", () => {
  const suggestions = suggestInternalLinks({
    article: { title: "Van finance and applying for vehicle finance" },
    websiteUrl: "https://www.vanfinancecompany.co.uk",
    websitePages: [
      page("active", "Van Finance", "/van-finance", { customer_intent: ["Van finance"] }),
      page("duplicate", "Finance Options", "/van-finance", { keywords: ["vehicle finance"] }),
      page("hidden", "Hidden Finance", "/hidden", { keywords: ["van finance"], active: false }),
      page("external", "External Finance", "https://example.com/finance", { keywords: ["van finance"] }),
    ],
  });
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].website_page_id, "active");
  assert.equal(isApprovedInternalUrl("/apply"), true);
  assert.equal(isApprovedInternalUrl("https://www.vanfinancecompany.co.uk/apply", "https://www.vanfinancecompany.co.uk"), true);
  assert.equal(isApprovedInternalUrl("https://example.com/apply", "https://www.vanfinancecompany.co.uk"), false);
});

test("Knowledge Hub cross-links require an approved, non-current article", () => {
  const websitePages = [
    page("approved-page", "Application guide", "/knowledge/application-guide", {
      category: "Knowledge Hub",
      keywords: ["applying"],
      knowledge_article_id: "approved",
    }),
    page("draft-page", "Draft guide", "/knowledge/draft", {
      category: "Knowledge Hub",
      keywords: ["applying"],
      knowledge_article_id: "draft",
    }),
    page("archived-page", "Archived guide", "/knowledge/archived", {
      category: "Knowledge Hub",
      keywords: ["applying"],
      knowledge_article_id: "archived",
    }),
  ];
  const suggestions = suggestInternalLinks({
    article: { id: "current", title: "Applying for van finance" },
    websitePages,
    knowledgeArticles: [
      { id: "approved", title: "How to apply", status: "approved" },
      { id: "draft", title: "Draft", status: "draft" },
      { id: "archived", title: "Archived", status: "archived" },
    ],
  });
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].target_type, "knowledge_article");
  assert.equal(suggestions[0].target_article_id, "approved");
});

test("matcher caps suggestions at eight and never duplicates a destination", () => {
  const suggestions = suggestInternalLinks({
    article: { title: "Van finance application documents and vehicle finance" },
    websitePages: Array.from({ length: 12 }, (_, index) =>
      page(`page-${index}`, `Finance guide ${index}`, `/finance/${index}`, {
        keywords: ["van finance", "documents"],
      })
    ),
  });
  assert.equal(suggestions.length, 8);
  assert.equal(new Set(suggestions.map((item) => item.destination_url)).size, 8);
});

test("migration and UI enforce review-only audited linking", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/022_intelligent_internal_linking_engine.sql", import.meta.url),
    "utf8"
  );
  const api = readFileSync(
    new URL("../api/marketing-editorial-engine.js", import.meta.url),
    "utf8"
  );
  const ui = readFileSync(
    new URL("../components/KnowledgeHubInternalLinking.jsx", import.meta.url),
    "utf8"
  );
  assert.match(migration, /knowledge_internal_link_suggestions/);
  assert.match(migration, /knowledge_internal_link_events/);
  assert.match(migration, /external_id/);
  assert.doesNotMatch(migration, /\bdrop\s+(table|column|constraint)\b/i);
  assert.match(api, /saveWebsiteIndexEntry/);
  assert.match(api, /decideInternalLink/);
  assert.match(api, /automatic_insertion: false/);
  assert.match(ui, /Accept\s*<\/button>/);
  assert.match(ui, /Reject\s*<\/button>/);
  assert.match(ui, /Save anchor/);
  assert.match(ui, /never inserts or publishes a link/);
  assert.doesNotMatch(ui, /No related internal links passed the relevance safeguard/);
});

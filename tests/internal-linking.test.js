import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildInternalLinkArticleProfile,
  isApprovedInternalUrl,
  mergeInternalLinkReviewState,
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
  approval_status: "approved",
  verified: true,
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
  assert.equal(suggestions.every((item) => item.reason && item.confidence_score >= 35), true);
});

test("MWB exact phrase and acronym matches rank the approved MWB destination first", () => {
  const websitePages = [
    page("mwb", "VAN FINANCE – MWB VANS", "/van-finance-mwb-vans", {
      category: "Stock",
      priority: 5,
      vehicle_types: ["MWB", "medium wheelbase", "medium van", "medium vans"],
      customer_intent: ["browse stock"],
    }),
    page("finance", "VIEW VANS | VAN FINANCE", "/van-finance", {
      category: "Finance",
      priority: 5,
      vehicle_types: ["van finance", "finance vans"],
    }),
    page("lwb", "VAN FINANCE – LWB VANS", "/van-finance-lwb-vans", {
      category: "Stock",
      priority: 4,
      vehicle_types: ["LWB", "long wheelbase", "large vans"],
    }),
    page("privacy", "Privacy Policy", "/privacy-policy", {
      category: "Support",
      priority: 5,
      keywords: ["business", "data", "van finance"],
    }),
    page("rent2buy", "Rent2Buy Pickups", "/rent2buy-pickups", {
      category: "Stock",
      priority: 5,
      vehicle_types: ["pickup", "Rent2Buy"],
    }),
  ];
  const snapshot = JSON.stringify(websitePages);
  const suggestions = suggestInternalLinks({
    article: {
      id: "article-mwb",
      title: "Understanding Medium Wheelbase Vans (MWB) for Your Business",
      slug: "understanding-medium-wheelbase-vans-mwb-for-your-business",
      seo_title: "Medium Wheelbase Vans (MWB) Business Guide",
      category: "Vehicle Guides",
      article_type: "buying_guide",
      content_markdown: [
        "# Understanding Medium Wheelbase Vans",
        "## Is an MWB van right for your business?",
        "Medium vans balance load space and everyday usability.",
        "Van finance can spread the cost.",
      ].join("\n"),
    },
    topic: { primary_keyword: "medium wheelbase vans" },
    websitePages,
  });
  assert.equal(suggestions[0].website_page_id, "mwb");
  assert.equal(suggestions[0].confidence_score >= 90, true);
  assert.match(suggestions[0].reason, /Exact (?:match|acronym): “(?:medium wheelbase|MWB)”/);
  assert.match(suggestions[0].reason, /Category match: Stock/);
  assert.equal(suggestions.some((item) => item.website_page_id === "privacy"), false);
  assert.equal(
    suggestions.findIndex((item) => item.website_page_id === "mwb") <
      suggestions.findIndex((item) => item.website_page_id === "finance"),
    true
  );
  assert.equal(
    suggestions.find((item) => item.website_page_id === "finance").confidence_score < 70,
    true
  );
  assert.equal(JSON.stringify(websitePages), snapshot);
});

test("exact phrases outrank generic overlap and legal pages require a direct topic", () => {
  const pages = [
    page("exact", "Medium Wheelbase Vans", "/medium-vans", {
      category: "Stock",
      vehicle_types: ["medium wheelbase", "MWB"],
    }),
    page("generic", "Business Van Finance", "/business-finance", {
      category: "Finance",
      priority: 5,
      keywords: ["van", "finance", "business"],
    }),
    page("cookies", "Cookie Policy", "/cookie-policy", {
      category: "Support",
      keywords: ["website", "business"],
    }),
    page("data", "Data Protection Policy", "/data-protection", {
      category: "Support",
      keywords: ["data", "business"],
    }),
  ];
  const suggestions = suggestInternalLinks({
    article: {
      title: "Medium wheelbase vans for business",
      content_markdown: "An MWB van is a practical business vehicle.",
    },
    websitePages: pages,
  });
  assert.equal(suggestions[0].website_page_id, "exact");
  assert.equal(suggestions[0].confidence_score > (suggestions.find((item) => item.website_page_id === "generic")?.confidence_score || 0), true);
  assert.equal(suggestions.some((item) => ["cookies", "data"].includes(item.website_page_id)), false);

  const legal = suggestInternalLinks({
    article: {
      title: "Privacy and data protection policy explained",
      slug: "privacy-data-protection-policy",
      content_markdown: "## Data protection\nHow customer information is handled.",
    },
    websitePages: pages,
  });
  assert.equal(legal.some((item) => item.website_page_id === "data"), true);
});

test("refresh merging preserves accepted and rejected decisions unchanged", () => {
  const accepted = {
    id: "accepted",
    website_page_id: "page-a",
    destination_title: "Accepted link",
    confidence_score: 80,
    source_content_hash: "old",
    status: "accepted",
    anchor_text: "Reviewed anchor",
  };
  const rejected = {
    id: "rejected",
    website_page_id: "page-b",
    destination_title: "Rejected link",
    confidence_score: 70,
    source_content_hash: "old",
    status: "rejected",
  };
  const merged = mergeInternalLinkReviewState({
    created: [{
      id: "new",
      website_page_id: "page-c",
      destination_title: "New MWB link",
      confidence_score: 96,
      source_content_hash: "current",
      status: "pending",
    }],
    existing: [
      accepted,
      rejected,
      {
        id: "stale",
        website_page_id: "page-d",
        destination_title: "Stale pending",
        confidence_score: 90,
        source_content_hash: "old",
        status: "pending",
      },
    ],
    proposedPageIds: new Set(["page-c"]),
    sourceHash: "current",
  });
  assert.deepEqual(merged.find((item) => item.id === "accepted"), accepted);
  assert.deepEqual(merged.find((item) => item.id === "rejected"), rejected);
  assert.equal(merged.some((item) => item.id === "stale"), false);
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
  assert.match(ui, /Refreshing…/);
  assert.match(ui, /refreshFeedback\.status === "error"/);
  assert.match(ui, /Accept\s*<\/button>/);
  assert.match(ui, /Reject\s*<\/button>/);
  assert.match(ui, /Save anchor/);
  assert.match(ui, /never inserts or publishes a link/);
  assert.doesNotMatch(ui, /No related internal links passed the relevance safeguard/);
});

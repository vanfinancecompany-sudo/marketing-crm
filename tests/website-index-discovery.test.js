import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyDiscoveredDestination,
  duplicateUrlKey,
  extractWebsitePage,
  findDuplicate,
  normalizeDiscoveryUrl,
} from "../lib/websiteIndexDiscovery.js";
import { scanWebsite } from "../lib/websiteIndexScanner.js";
import { suggestInternalLinks } from "../lib/internalLinking.js";

const root = "https://www.vanfinancecompany.co.uk";
const response = (html, status = 200, headers = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (name) => headers[name.toLowerCase()] || (name === "content-type" ? "text/html; charset=utf-8" : null) },
  text: async () => html,
});

test("normalisation stays on-domain and never invents filter or file destinations", () => {
  assert.equal(normalizeDiscoveryUrl("/vans/medium/?utm_source=menu", root), `${root}/vans/medium`);
  assert.equal(duplicateUrlKey("http://vanfinancecompany.co.uk/vans/medium/", root), "vanfinancecompany.co.uk/vans/medium");
  assert.equal(normalizeDiscoveryUrl("https://example.com/vans", root), null);
  assert.equal(normalizeDiscoveryUrl("/search?q=van", root), null);
  assert.equal(normalizeDiscoveryUrl("/stock?type=medium", root), null);
  assert.equal(normalizeDiscoveryUrl("/brochure.pdf", root), null);
  assert.equal(normalizeDiscoveryUrl("mailto:hello@example.com", root), null);
});

test("Wix-aware extraction finds desktop, mobile and embedded routes without mapping filter buttons", () => {
  const page = extractWebsitePage(`
    <html><head>
      <title>Van Finance Company</title>
      <link rel="canonical" href="${root}/">
      <meta name="description" content="Finance vans across the UK">
    </head><body>
      <nav class="desktop-menu"><a href="/van-finance">Vans on Finance</a></nav>
      <div class="mobile-drawer"><a aria-label="Apply Now" href="/apply">Apply Now</a></div>
      <button data-filter="medium">Medium</button>
      <script>{"pageUrl":"\\/knowledge-hub\\/application-guide"}</script>
    </body></html>
  `, root, root);
  assert.equal(page.title, "Van Finance Company");
  assert.equal(page.links.some((link) => link.evidence_type === "desktop_navigation"), true);
  assert.equal(page.links.some((link) => link.evidence_type === "mobile_navigation"), true);
  assert.equal(page.links.some((link) => link.evidence_type === "wix_embedded_route"), true);
  assert.deepEqual(page.categories_without_urls.map((item) => item.title), ["Medium"]);
  assert.equal(page.categories_without_urls[0].url, null);
  assert.equal(page.categories_without_urls[0].requires_manual_mapping, true);
});

test("intent classification stores manufacturer/model language as matching terms, not destinations", () => {
  const medium = classifyDiscoveredDestination({ title: "Medium Vans", navigation_text: "Medium", url: `${root}/vans/medium` });
  assert.equal(medium.suggested_category, "Stock");
  assert.equal(medium.suggested_matching_terms.includes("Transit Custom"), true);
  assert.equal(medium.suggested_matching_terms.includes("MWB"), true);
});

test("duplicate detection preserves existing approved records for selective merge", () => {
  const duplicate = findDuplicate(
    { title: "Medium Vans", url: `${root}/vans/medium/`, canonical_url: `${root}/vans/medium`, redirect_chain: [] },
    [{ id: "approved", title: "Medium Wheelbase Vans", url: "http://vanfinancecompany.co.uk/vans/medium" }],
    [],
    root
  );
  assert.equal(duplicate.existing_page_id, "approved");
  assert.match(duplicate.duplicate_type, /url/);
});

test("scanner leaves every candidate pending, unverified and unavailable", async () => {
  const pages = new Map([
    [root + "/", response(`<html><head><title>Home</title></head><body><nav class="desktop"><a href="/van-finance">Vans on Finance</a></nav><nav class="mobile"><a href="/apply">Apply Now</a></nav><button>Medium</button></body></html>`)],
    [`${root}/van-finance`, response("<html><head><title>Van Finance</title></head><body></body></html>")],
    [`${root}/apply`, response("<html><head><title>Apply Now</title></head><body></body></html>")],
  ]);
  const result = await scanWebsite({
    rootUrl: root,
    fetchImpl: async (url) => pages.get(url) || response("", 404),
    maximumPages: 10,
  });
  assert.equal(result.pages_scanned, 3);
  assert.equal(result.candidates.some((item) => item.requires_manual_mapping && item.url === null), true);
  assert.equal(result.candidates.every((item) => item.status === "pending_review"), true);
  assert.equal(result.candidates.every((item) => item.verified === false), true);
  assert.equal(result.candidates.every((item) => item.available_to_internal_linking === false), true);
});

test("pending or unverified destinations are excluded from Internal Linking", () => {
  const suggestions = suggestInternalLinks({
    article: { title: "Van finance application" },
    websitePages: [
      { id: "pending", title: "Van Finance", url: "/finance", active: true, approval_status: "pending_review", verified: false, category: "Finance", keywords: ["van finance"] },
      { id: "unverified", title: "Apply", url: "/apply", active: true, approval_status: "approved", verified: false, category: "Applications", keywords: ["application"] },
      { id: "safe", title: "Approved finance", url: "/approved", active: true, approval_status: "approved", verified: true, category: "Finance", keywords: ["van finance"] },
    ],
  });
  assert.deepEqual(suggestions.map((item) => item.website_page_id), ["safe"]);
});

test("migration and review API prohibit automatic approval and prepare AI Visibility monitoring", () => {
  const migration = readFileSync(new URL("../supabase/migrations/024_website_index_discovery_review.sql", import.meta.url), "utf8");
  const api = readFileSync(new URL("../api/marketing-website-index-discovery.js", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../components/KnowledgeHubInternalLinking.jsx", import.meta.url), "utf8");
  assert.match(migration, /available_to_internal_linking boolean not null default false/);
  assert.match(migration, /check \(available_to_internal_linking = false\)/);
  assert.match(migration, /monitor_in_ai_visibility_when_published boolean not null default true/);
  assert.doesNotMatch(migration, /\bdrop\s+(table|column)\b/i);
  assert.match(api, /automatic_approval: false/);
  assert.match(api, /selectively merged discovery data/);
  assert.match(ui, /Monitor in AI Visibility when published/);
  assert.match(ui, /No unique URL — manual mapping required/);
});

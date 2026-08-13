import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyKnowledgeLinkProduct,
  commercialDestinationRole,
  filterInternalLinkCandidates,
  hasStrongKnowledgeTopicOverlap,
  isApplicationDestinationRelevant,
  selectFocusedInternalLinkSuggestions,
} from "../lib/internalLinkStrategy.js";

const page = (id, title, url, extra = {}) => ({
  id,
  title,
  url,
  active: true,
  approval_status: "approved",
  verified: true,
  ...extra,
});

test("source product classification uses high-signal article context and defaults to finance", () => {
  assert.equal(classifyKnowledgeLinkProduct({ article: { title: "Can I Get Van Finance With an IVA?" } }), "finance");
  assert.equal(classifyKnowledgeLinkProduct({ article: { title: "How Does Rent2Buy Work?" } }), "rent2buy");
  assert.equal(classifyKnowledgeLinkProduct({ article: { title: "Proofs We Need", category: "Rent2Buy" } }), "rent2buy");
  assert.equal(
    classifyKnowledgeLinkProduct({ article: { title: "Buying a Used Van From a Dealer", content_markdown: "Rent2Buy is mentioned only in body copy." } }),
    "finance"
  );
});

test("commercial safe pools contain only the approved navigation roles", () => {
  assert.equal(commercialDestinationRole(page("home", "Van Finance Company", "/"), "finance"), "home");
  assert.equal(commercialDestinationRole(page("apply", "VAN FINANCE - APPLICATION FORM", "/apply-by-reg-finance/application-form"), "finance"), "application");
  assert.equal(commercialDestinationRole(page("stock", "VIEW VANS | VAN FINANCE", "/vans-on-finance"), "finance"), "stock");
  assert.equal(commercialDestinationRole(page("upload", "UPLOAD YOUR DOCUMENTS | VAN FINANCE", "/securely-upload-documents"), "finance"), "");
  assert.equal(commercialDestinationRole(page("r2b-home", "WHAT IS RENT2BUY | VAN FINANCE", "/guaranteed-van-lease"), "rent2buy"), "home");
  assert.equal(commercialDestinationRole(page("r2b-apply", "RENT2BUY APPLICATION", "/rent2buy-application"), "rent2buy"), "application");
  assert.equal(commercialDestinationRole(page("r2b-stock", "RENT2BUY VANS | NO CREDIT CHECK", "/rent2buyvans"), "rent2buy"), "stock");
});

test("buying guides do not receive an application destination just because finance appears in body copy", () => {
  assert.equal(
    isApplicationDestinationRelevant({
      article: {
        title: "Mileage, Age or Condition: What Matters Most When Buying a Used Van?",
        category: "Vehicle Guides",
        content_markdown: "Finance may be available subject to assessment.",
      },
    }),
    false
  );
  assert.equal(
    isApplicationDestinationRelevant({ article: { title: "What Do Lenders Consider When Assessing a Van Finance Application?", category: "Van Finance" } }),
    true
  );
});

test("Knowledge Hub relevance requires real topic overlap rather than generic van-finance intent", () => {
  const source = {
    title: "Buying a Used Van From a Dealer vs a Private Seller: What Should You Consider?",
    content_markdown: "## Dealer purchase\nCompare dealer preparation with a private seller.",
  };
  assert.equal(
    hasStrongKnowledgeTopicOverlap({
      sourceArticle: source,
      linkedArticle: { title: "Can I Use Van Finance Company Finance to Buy a Van From Another Dealer?" },
    }),
    true
  );
  assert.equal(
    hasStrongKnowledgeTopicOverlap({
      sourceArticle: source,
      linkedArticle: { title: "Van Finance for CIS Subcontractors: What Should You Prepare Before Applying?" },
    }),
    false
  );
  assert.equal(
    hasStrongKnowledgeTopicOverlap({
      sourceArticle: {
        title: "Can You Buy a Used Van Without Seeing It First?",
        content_markdown: "A finance application is a separate decision.",
      },
      linkedArticle: { title: "How Self-Employed Applicants Can Demonstrate Income for Van Finance" },
    }),
    false
  );
});

test("finance buying articles exclude Rent2Buy, unrelated Knowledge Hub pages and routine application links", () => {
  const financeArticle = {
    id: "source",
    title: "Buying a Used Van From a Dealer vs a Private Seller",
    category: "Comparisons",
    content_markdown: "## Dealer purchase\nCompare a dealer with a private seller.",
  };
  const pages = [
    page("finance-home", "Van Finance Company", "/"),
    page("finance-apply", "VAN FINANCE - APPLICATION FORM", "/apply-by-reg-finance/application-form"),
    page("finance-stock", "VIEW VANS | VAN FINANCE", "/vans-on-finance"),
    page("upload", "UPLOAD YOUR DOCUMENTS | VAN FINANCE", "/securely-upload-documents"),
    page("r2b", "WHAT IS RENT2BUY | VAN FINANCE", "/guaranteed-van-lease"),
    page("kh-dealer", "Buying From Another Dealer", "/knowledge/dealer", { knowledge_article_id: "kh-dealer-article" }),
    page("kh-cis", "CIS Finance", "/knowledge/cis", { knowledge_article_id: "kh-cis-article" }),
  ];
  const filtered = filterInternalLinkCandidates({
    article: financeArticle,
    websitePages: pages,
    knowledgeArticles: [
      { id: "kh-dealer-article", title: "Can I Use Van Finance Company Finance to Buy a Van From Another Dealer?", status: "approved" },
      { id: "kh-cis-article", title: "Van Finance for CIS Subcontractors: What Should You Prepare Before Applying?", status: "approved" },
    ],
  });
  assert.deepEqual(new Set(filtered.map((item) => item.id)), new Set(["finance-home", "finance-stock", "kh-dealer"]));
});

test("Rent2Buy articles stay inside the Rent2Buy commercial and Knowledge Hub pools", () => {
  const filtered = filterInternalLinkCandidates({
    article: { id: "source", title: "How Does Rent2Buy Work?", content_markdown: "## Rent2Buy eligibility\nHow the Rent2Buy process works." },
    websitePages: [
      page("finance", "VIEW VANS | VAN FINANCE", "/vans-on-finance"),
      page("r2b-home", "WHAT IS RENT2BUY | VAN FINANCE", "/guaranteed-van-lease"),
      page("r2b-apply", "RENT2BUY APPLICATION", "/rent2buy-application"),
      page("r2b-stock", "RENT2BUY VANS | NO CREDIT CHECK", "/rent2buyvans"),
      page("kh-finance", "Finance Guide", "/knowledge/finance-guide", { knowledge_article_id: "finance-guide" }),
      page("kh-r2b", "Rent2Buy Guide", "/knowledge/rent2buy-guide", { knowledge_article_id: "r2b-guide" }),
    ],
    knowledgeArticles: [
      { id: "finance-guide", title: "Van Finance Guide", status: "approved" },
      { id: "r2b-guide", title: "Rent2Buy Eligibility Guide", status: "approved" },
    ],
  });
  assert.deepEqual(new Set(filtered.map((item) => item.id)), new Set(["r2b-home", "r2b-apply", "r2b-stock", "kh-r2b"]));
});

test("focused selector keeps at most two strong Knowledge Hub links and two commercial links", () => {
  const selected = selectFocusedInternalLinkSuggestions([
    { website_page_id: "kh1", target_type: "knowledge_article", destination_title: "Remote Buying", destination_url: "/knowledge/remote", confidence_score: 92 },
    { website_page_id: "kh2", target_type: "knowledge_article", destination_title: "Delivery", destination_url: "/knowledge/delivery", confidence_score: 76 },
    { website_page_id: "kh3", target_type: "knowledge_article", destination_title: "Warranty", destination_url: "/knowledge/warranty", confidence_score: 72 },
    { website_page_id: "weak", target_type: "knowledge_article", destination_title: "Weak", destination_url: "/knowledge/weak", confidence_score: 40 },
    { website_page_id: "stock", target_type: "website_page", destination_title: "VIEW VANS | VAN FINANCE", destination_url: "/vans-on-finance", confidence_score: 80 },
    { website_page_id: "apply", target_type: "website_page", destination_title: "VAN FINANCE - APPLICATION FORM", destination_url: "/apply-by-reg-finance/application-form", confidence_score: 70 },
    { website_page_id: "home", target_type: "website_page", destination_title: "Van Finance Company", destination_url: "/", confidence_score: 65 },
  ]);
  assert.equal(selected.length, 4);
  assert.deepEqual(new Set(selected.map((item) => item.website_page_id)), new Set(["kh1", "kh2", "stock", "apply"]));
});

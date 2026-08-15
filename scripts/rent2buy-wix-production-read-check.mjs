import {
  loadRent2BuyKnowledgeHubArticles,
  RENT2BUY_KNOWLEDGE_COLLECTION_ID,
  RENT2BUY_KNOWLEDGE_SITE_ID,
} from "../lib/rent2BuyKnowledgeHubCms.js";

const productionUrl = String(process.env.VERCEL_PROJECT_PRODUCTION_URL || "").toLowerCase();
const isTargetProduction = process.env.VERCEL_ENV === "production"
  && productionUrl.includes("marketing-crm-github-work");

if (!isTargetProduction) {
  console.log("RENT2BUY_WIX_READ_CHECK_SKIPPED", {
    vercel_env: process.env.VERCEL_ENV || null,
    project_production_url: productionUrl || null,
  });
  process.exit(0);
}

const articles = await loadRent2BuyKnowledgeHubArticles({
  environment: process.env,
  useCache: false,
});

if (articles.length !== 52) {
  throw new Error(`Expected 52 published Rent2Buy Knowledge Hub articles, received ${articles.length}.`);
}

if (articles.some((article) => !String(article.live_wix_url || "").startsWith("https://www.rent2buyvans.co.uk/knowledge-hub-articles/"))) {
  throw new Error("Rent2Buy Knowledge Hub read returned a non-Rent2Buy article URL.");
}

console.log("RENT2BUY_WIX_READ_CHECK_COMPLETE", {
  site_id: RENT2BUY_KNOWLEDGE_SITE_ID,
  collection_id: RENT2BUY_KNOWLEDGE_COLLECTION_ID,
  published_articles: articles.length,
  all_urls_rent2buy: true,
});

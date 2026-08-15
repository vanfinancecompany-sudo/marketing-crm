import {
  loadRent2BuyKnowledgeHubArticles,
  RENT2BUY_KNOWLEDGE_COLLECTION_ID,
  RENT2BUY_KNOWLEDGE_SITE_ID,
} from "../lib/rent2BuyKnowledgeHubCms.js";

const productionUrl = String(process.env.VERCEL_PROJECT_PRODUCTION_URL || "").toLowerCase();
const isTargetProduction = process.env.VERCEL_ENV === "production"
  && productionUrl.includes("marketing-crm-six.vercel.app");

if (!isTargetProduction) {
  console.log("RENT2BUY_WIX_READ_CHECK_SKIPPED", {
    vercel_env: process.env.VERCEL_ENV || null,
    project_production_url: productionUrl || null,
  });
  process.exit(0);
}

if (!String(process.env.WIX_API_KEY || "").trim()) {
  console.log("RENT2BUY_WIX_READ_CHECK_RESULT", {
    configured: false,
    project_production_url: productionUrl,
  });
  process.exit(0);
}

try {
  const articles = await loadRent2BuyKnowledgeHubArticles({
    environment: process.env,
    useCache: false,
  });
  const allUrlsRent2Buy = articles.every((article) => String(article.live_wix_url || "").startsWith("https://www.rent2buyvans.co.uk/knowledge-hub-articles/"));
  console.log("RENT2BUY_WIX_READ_CHECK_RESULT", {
    configured: true,
    site_id: RENT2BUY_KNOWLEDGE_SITE_ID,
    collection_id: RENT2BUY_KNOWLEDGE_COLLECTION_ID,
    published_articles: articles.length,
    all_urls_rent2buy: allUrlsRent2Buy,
    usable: articles.length === 52 && allUrlsRent2Buy,
  });
} catch (error) {
  console.log("RENT2BUY_WIX_READ_CHECK_RESULT", {
    configured: true,
    usable: false,
    exception_type: error?.name || "Error",
    message: String(error?.message || "Wix read failed").slice(0, 300),
  });
}

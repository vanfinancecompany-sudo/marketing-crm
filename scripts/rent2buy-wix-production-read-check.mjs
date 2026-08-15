import { createClient } from "@supabase/supabase-js";

const productionUrl = String(process.env.VERCEL_PROJECT_PRODUCTION_URL || "").toLowerCase();
const isTargetProduction = process.env.VERCEL_ENV === "production"
  && productionUrl.includes("marketing-crm-github-work.vercel.app");

if (!isTargetProduction) {
  console.log("RENT2BUY_MIRROR_CHECK_SKIPPED", {
    vercel_env: process.env.VERCEL_ENV || null,
    project_production_url: productionUrl || null,
  });
  process.exit(0);
}

const supabaseUrl = String(process.env.SUPABASE_URL || "").trim();
const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
if (!supabaseUrl || !serviceKey) {
  console.log("RENT2BUY_MIRROR_CHECK_RESULT", { configured: false });
  process.exit(0);
}

try {
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await supabase
    .from("knowledge_articles")
    .select("id,category,status,live_wix_url,published_at,publication_verified_at,wix_sync_status,wix_publication_status,is_active")
    .ilike("live_wix_url", "https://%rent2buyvans.co.uk/knowledge-hub-articles/%")
    .limit(500);
  if (result.error) throw result.error;

  const rows = Array.isArray(result.data) ? result.data : [];
  const verified = rows.filter((row) => row.is_active === true
    && row.wix_publication_status === "live"
    && ["live", "synced"].includes(String(row.wix_sync_status || "").toLowerCase())
    && row.published_at
    && row.publication_verified_at
    && /^https:\/\/(?:www\.)?rent2buyvans\.co\.uk\/knowledge-hub-articles\//i.test(String(row.live_wix_url || "")));

  console.log("RENT2BUY_MIRROR_CHECK_RESULT", {
    configured: true,
    rent2buy_url_records: rows.length,
    verified_public_records: verified.length,
    rent2buy_category_records: verified.filter((row) => String(row.category || "").toLowerCase() === "rent2buy").length,
    unique_verified_ids: new Set(verified.map((row) => row.id)).size,
    usable_as_exact_52_article_index: verified.length === 52
      && verified.every((row) => String(row.category || "").toLowerCase() === "rent2buy"),
  });
} catch (error) {
  console.log("RENT2BUY_MIRROR_CHECK_RESULT", {
    configured: true,
    usable_as_exact_52_article_index: false,
    exception_type: error?.name || "Error",
    message: String(error?.message || "Supabase read failed").slice(0, 300),
  });
}

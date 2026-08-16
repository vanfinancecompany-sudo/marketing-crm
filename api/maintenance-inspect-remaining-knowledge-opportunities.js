import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const TOKEN_HASH = "ce05a1f7df69ffcc3ba09b3a8d74d669c0b45f29777d636f5fc29d48571e3779";
const MARKETING_PROJECT_ID = "prj_UA8X61RmObkTDVp8cCkZ5X4oPlHl";

function authorised(request) {
  const token = String(request.query?.token || "");
  if (!token) return false;
  const digest = crypto.createHash("sha256").update(token).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(TOKEN_HASH));
}

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase is not configured.");
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorised(request)) return response.status(401).json({ ok: false, message: "Unauthorised." });
  if (process.env.VERCEL_ENV !== "production" || process.env.VERCEL_GIT_COMMIT_REF !== "main") {
    return response.status(403).json({ ok: false, message: "Production main only." });
  }
  if (process.env.VERCEL_PROJECT_ID && process.env.VERCEL_PROJECT_ID !== MARKETING_PROJECT_ID) {
    return response.status(403).json({ ok: false, message: "Wrong project." });
  }

  try {
    const supabase = getSupabase();
    const { data: opportunities, error: opportunityError } = await supabase
      .from("knowledge_assistant_opportunities")
      .select("id,title,product,category,normalised_intent,status,priority_level,priority_score,recommended_action,related_article_ids,linked_article_id,internal_notes,closure_reason,updated_at")
      .in("normalised_intent", ["credit_eligibility", "vehicle_eligibility"])
      .order("updated_at", { ascending: false });
    if (opportunityError) throw opportunityError;

    const ids = (opportunities || []).map((item) => item.id);
    const { data: questions, error: questionError } = ids.length
      ? await supabase.from("knowledge_assistant_opportunity_questions").select("opportunity_id,original_question").in("opportunity_id", ids)
      : { data: [], error: null };
    if (questionError) throw questionError;

    const articleIds = [...new Set((opportunities || []).flatMap((item) => [...(item.related_article_ids || []), item.linked_article_id].filter(Boolean)))];
    const { data: articles, error: articleError } = articleIds.length
      ? await supabase
          .from("knowledge_articles")
          .select("id,title,slug,category,status,seo_title,meta_description,excerpt,content_markdown,faq_json,cta,quality_checks,wix_sync_status,wix_publication_status,live_wix_url,updated_at")
          .in("id", articleIds)
      : { data: [], error: null };
    if (articleError) throw articleError;

    const hydrated = (opportunities || []).map((item) => ({
      ...item,
      questions: (questions || []).filter((q) => q.opportunity_id === item.id).map((q) => q.original_question),
      related_articles: (articles || []).filter((article) => (item.related_article_ids || []).includes(article.id) || item.linked_article_id === article.id),
    }));

    return response.status(200).json({ ok: true, opportunities: hydrated });
  } catch (error) {
    return response.status(500).json({ ok: false, message: error.message || "Inspection failed." });
  }
}

import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { calculateKnowledgeQualityChecks } from "../lib/knowledgeHub.js";

const TOKEN_HASH = "7d78cbf7617caef22e1e3819e584ab65131ee83375f128ec967003a72df8126f";
const ARTICLE_ID = "7bdb2e7b-26e4-4b4e-9c2e-0b6141528dc8";
const PROJECT_ID = "prj_UA8X61RmObkTDVp8cCkZ5X4oPlHl";

function authorised(request) {
  const token = String(request.query?.token || "");
  if (!token) return false;
  const digest = crypto.createHash("sha256").update(token).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(TOKEN_HASH));
}

function supabaseClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase is not configured.");
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "GET") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorised(request)) return response.status(401).json({ ok: false, message: "Unauthorised." });
  if (process.env.VERCEL_ENV !== "production" || process.env.VERCEL_GIT_COMMIT_REF !== "main") return response.status(403).json({ ok: false, message: "Production main only." });
  if (process.env.VERCEL_PROJECT_ID && process.env.VERCEL_PROJECT_ID !== PROJECT_ID) return response.status(403).json({ ok: false, message: "Wrong project." });

  try {
    const supabase = supabaseClient();
    const { data: article, error } = await supabase.from("knowledge_articles").select("*").eq("id", ARTICLE_ID).single();
    if (error) throw error;
    if (article.status !== "approved") throw new Error(`Article status changed; expected approved, found ${article.status}.`);
    const checks = calculateKnowledgeQualityChecks(article, 1000);
    const { data: saved, error: saveError } = await supabase.from("knowledge_articles").update({ quality_checks: checks, updated_at: new Date().toISOString() }).eq("id", ARTICLE_ID).eq("status", "approved").select("id,title,status,quality_checks,wix_sync_status,wix_publication_status").single();
    if (saveError) throw saveError;
    return response.status(200).json({ ok: true, article: saved, safeguards: { article_id: ARTICLE_ID, content_changed: false, wix_calls: 0, publishing_actions: 0, approval_actions: 0 } });
  } catch (error) {
    return response.status(500).json({ ok: false, message: error.message || "Quality refresh failed." });
  }
}

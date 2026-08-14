import { createClient } from "@supabase/supabase-js";
import { competenceAuthorize } from "./marketing-ai-assistant-competence.js";
import { refreshKnowledgeOpportunityEvidence } from "./_knowledgeOpportunityEvidenceRefresh.js";

const clean = (value, limit = 1000) => String(value || "").trim().slice(0, limit);

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase is not configured.");
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "object") return request.body;
  try { return JSON.parse(request.body); } catch { return {}; }
}

export async function handleKnowledgeOpportunityEvidenceRequest(request, response, dependencies = {}) {
  response.setHeader?.("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!competenceAuthorize(request)) return response.status(401).json({ ok: false, message: "Access key not recognised." });

  try {
    const body = parseBody(request);
    if (clean(body.action, 80) !== "refreshEvidence") return response.status(400).json({ ok: false, message: "Unsupported evidence action." });
    const supabase = dependencies.supabase || getSupabase();
    const refresh = await refreshKnowledgeOpportunityEvidence(supabase, { days: body.days });
    return response.status(200).json({
      ok: true,
      refresh,
      automatic_content_creation: false,
      automatic_publication: false,
      manual_statuses_preserved: true,
    });
  } catch (error) {
    console.error("KNOWLEDGE OPPORTUNITY EVIDENCE REFRESH ERROR", {
      exception_type: error?.name || "Error",
      message: clean(error?.message, 500),
    });
    return response.status(500).json({ ok: false, message: "Live Knowledge Opportunity evidence could not be refreshed." });
  }
}

export default async function handler(request, response) {
  return handleKnowledgeOpportunityEvidenceRequest(request, response);
}

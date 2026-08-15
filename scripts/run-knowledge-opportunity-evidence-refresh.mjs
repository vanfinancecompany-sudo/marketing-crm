import { createClient } from "@supabase/supabase-js";
import { refreshKnowledgeOpportunityEvidence } from "../api/_knowledgeOpportunityEvidenceRefresh.js";

const TARGET_PROJECT_ID = "prj_zD76dAe2MHZdBTO08GNFSqOb9UHf";
const WINDOW_DAYS = 90;

function marker(name, payload = {}) {
  console.log(`${name} ${JSON.stringify(payload)}`);
}

function shouldRun() {
  return process.env.VERCEL_ENV === "production"
    && process.env.VERCEL_PROJECT_ID === TARGET_PROJECT_ID
    && process.env.VERCEL_GIT_COMMIT_REF === "main";
}

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required for the Knowledge Opportunity evidence refresh.`);
  return value;
}

async function main() {
  if (!shouldRun()) {
    marker("KNOWLEDGE_OPPORTUNITY_EVIDENCE_REFRESH_SKIPPED", {
      environment: process.env.VERCEL_ENV || null,
      project_id: process.env.VERCEL_PROJECT_ID || null,
      branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    });
    return;
  }

  const supabase = createClient(
    required("SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  marker("KNOWLEDGE_OPPORTUNITY_EVIDENCE_REFRESH_START", {
    window_days: WINDOW_DAYS,
    automatic_content_creation: false,
    automatic_publication: false,
    manual_statuses_preserved: true,
  });

  const refresh = await refreshKnowledgeOpportunityEvidence(supabase, { days: WINDOW_DAYS });

  marker("KNOWLEDGE_OPPORTUNITY_EVIDENCE_REFRESH_COMPLETE", {
    window_days: refresh.window_days,
    since: refresh.since,
    customer_analytics_since: refresh.customer_analytics_since,
    customer_analytics_reset_at: refresh.customer_analytics_reset_at,
    evidence_groups: refresh.evidence_groups,
    existing_updated: refresh.existing_updated,
    new_created: refresh.new_created,
    stale_cleared: refresh.stale_cleared,
    below_creation_threshold: refresh.below_creation_threshold,
    excluded_analytics: refresh.excluded_analytics,
    diagnostics: refresh.diagnostics,
    created_ids: refresh.created_ids,
    updated_ids: refresh.updated_ids,
    automatic_content_creation: false,
    automatic_publication: false,
    manual_statuses_preserved: true,
  });
}

main().catch((error) => {
  console.error("KNOWLEDGE_OPPORTUNITY_EVIDENCE_REFRESH_FATAL", JSON.stringify({
    name: error?.name || "Error",
    message: error?.message || String(error),
  }));
  process.exitCode = 1;
});

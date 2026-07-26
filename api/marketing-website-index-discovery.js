import { createClient } from "@supabase/supabase-js";
import {
  WEBSITE_INDEX_CATEGORIES,
  isApprovedInternalUrl,
} from "../lib/internalLinking.js";
import {
  DISCOVERY_ROOT_URL,
  buildDiscoveryCandidateEdit,
  discoverySummary,
  findDuplicate,
  normalizeDiscoveryUrl,
} from "../lib/websiteIndexDiscovery.js";
import { fetchWebsiteDocument, scanWebsite } from "../lib/websiteIndexScanner.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";
const MERGE_FIELDS = new Set([
  "title", "url", "category", "priority", "description", "keywords",
  "vehicle_types", "customer_intent", "monitor_in_ai_visibility_when_published",
]);

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const clean = (value, limit = 5000) => String(value || "").trim().slice(0, limit);
const cleanList = (value) =>
  [...new Set((Array.isArray(value) ? value : []).map((item) => clean(item, 200)).filter(Boolean))].slice(0, 100);
const parseBody = (request) =>
  typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
const configuredAccessKey = () => clean(process.env.MARKETING_CUSTOMER_DATABASE_API_KEY, 1000);
const authorize = (request) =>
  Boolean(configuredAccessKey() && clean(request.headers?.[API_KEY_HEADER], 1000) === configuredAccessKey());
const getSupabase = () => {
  const url = clean(process.env.SUPABASE_URL, 2000);
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY, 5000);
  if (!url || !key) throw new ApiError(500, "Supabase is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
};
const data = (result, fallback) => {
  if (result.error) throw new ApiError(500, result.error.message || fallback);
  return result.data;
};

async function audit(supabase, payload) {
  data(
    await supabase.from("knowledge_website_discovery_audit_events").insert(payload),
    "Website discovery audit history could not be saved."
  );
}

async function configuredRoot(supabase) {
  const settings = data(
    await supabase.from("knowledge_settings").select("website_url").eq("settings_key", "default").maybeSingle(),
    "Website settings could not be loaded."
  ) || {};
  return normalizeDiscoveryUrl(settings.website_url || DISCOVERY_ROOT_URL, DISCOVERY_ROOT_URL) || DISCOVERY_ROOT_URL;
}

async function loadDiscovery(supabase) {
  const [runs, candidates, auditEvents, pages] = await Promise.all([
    supabase.from("knowledge_website_discovery_runs").select("*").order("created_at", { ascending: false }).limit(20),
    supabase.from("knowledge_website_discovery_candidates").select("*").neq("status", "deleted").order("discovered_at", { ascending: false }).limit(1000),
    supabase.from("knowledge_website_discovery_audit_events").select("*").order("created_at", { ascending: false }).limit(500),
    supabase.from("knowledge_business_pages").select("*").order("title"),
  ]);
  [runs, candidates, auditEvents, pages].forEach((result) => data(result, "Website discovery data could not be loaded."));
  return {
    runs: runs.data || [],
    candidates: candidates.data || [],
    audit_events: auditEvents.data || [],
    website_index: pages.data || [],
  };
}

async function runScan(supabase, body) {
  const rootUrl = await configuredRoot(supabase);
  const requested = clean(body.root_url, 2000) || rootUrl;
  const normalized = normalizeDiscoveryUrl(requested, rootUrl);
  if (!normalized) throw new ApiError(400, "The scan must stay on the configured Van Finance Company website.");
  const maximumPages = Math.max(5, Math.min(100, Number(body.maximum_pages) || 60));
  const run = data(
    await supabase.from("knowledge_website_discovery_runs").insert({
      root_url: normalized,
      status: "running",
      scan_config: { maximum_pages: maximumPages, same_domain_only: true, automatic_approval: false },
    }).select().single(),
    "Website discovery scan could not be started."
  );
  await audit(supabase, {
    scan_run_id: run.id,
    action: "scan_started",
    reason: "Administrator started a same-domain Website Index discovery scan.",
    details: { root_url: normalized, maximum_pages: maximumPages, automatic_approval: false },
  });
  try {
    const [scan, existingPages] = await Promise.all([
      scanWebsite({ rootUrl: normalized, maximumPages }),
      data(await supabase.from("knowledge_business_pages").select("*"), "Existing Website Index records could not be loaded."),
    ]);
    const prepared = [];
    for (const candidate of scan.candidates) {
      const duplicate = findDuplicate(candidate, existingPages || [], prepared, normalized);
      prepared.push({
        scan_run_id: run.id,
        title: candidate.title || "Untitled destination",
        url: candidate.url,
        canonical_url: candidate.canonical_url,
        navigation_text: candidate.navigation_text,
        meta_description: candidate.meta_description,
        source_page: candidate.source_page,
        http_status: candidate.http_status,
        redirect_chain: candidate.redirect_chain,
        suggested_category: candidate.suggested_category,
        suggested_priority: candidate.suggested_priority,
        suggested_description: candidate.suggested_description,
        suggested_keywords: cleanList(candidate.suggested_keywords),
        suggested_matching_terms: cleanList(candidate.suggested_matching_terms),
        suggested_customer_intent: cleanList(candidate.suggested_customer_intent),
        evidence: candidate.evidence,
        requires_manual_mapping: candidate.requires_manual_mapping,
        duplicate_type: duplicate.duplicate_type,
        existing_page_id: duplicate.existing_page_id || null,
        monitor_in_ai_visibility_when_published: true,
        status: "pending_review",
        verified: false,
        available_to_internal_linking: false,
      });
    }
    const created = prepared.length
      ? data(
          await supabase.from("knowledge_website_discovery_candidates").insert(prepared).select(),
          "Discovered destinations could not be saved."
        )
      : [];
    if (created.length) {
      data(
        await supabase.from("knowledge_website_discovery_audit_events").insert(
          created.map((candidate) => ({
            scan_run_id: run.id,
            candidate_id: candidate.id,
            action: "destination_discovered",
            reason: "Destination saved for manual review.",
            details: {
              url: candidate.url,
              source_page: candidate.source_page,
              evidence_type: candidate.evidence?.evidence_type,
              automatic_approval: false,
            },
          }))
        ),
        "Discovered destination audit history could not be saved."
      );
    }
    const summary = discoverySummary(created, scan.pages_scanned, scan.broken_links.length);
    const completed = data(
      await supabase.from("knowledge_website_discovery_runs").update({
        ...summary,
        status: "completed",
        completed_at: new Date().toISOString(),
      }).eq("id", run.id).select().single(),
      "Website discovery summary could not be saved."
    );
    await audit(supabase, {
      scan_run_id: run.id,
      action: "scan_completed",
      reason: "Website discovery completed; every candidate remains unavailable pending manual review.",
      details: { ...summary, automatic_approval: false, broken_links: scan.broken_links },
    });
    return { run: completed, candidates: created, broken_links: scan.broken_links };
  } catch (error) {
    await supabase.from("knowledge_website_discovery_runs").update({
      status: "failed", error_details: clean(error.message, 5000), completed_at: new Date().toISOString(),
    }).eq("id", run.id);
    await audit(supabase, {
      scan_run_id: run.id,
      action: "scan_failed",
      reason: clean(error.message, 1000),
      details: { automatic_approval: false },
    });
    throw error;
  }
}

async function candidateById(supabase, id) {
  return data(
    await supabase.from("knowledge_website_discovery_candidates").select("*").eq("id", clean(id, 100)).single(),
    "Discovered destination could not be found."
  );
}

async function editCandidate(supabase, body) {
  const candidate = await candidateById(supabase, body.candidate_id);
  if (!["pending_review", "rejected"].includes(candidate.status)) {
    throw new ApiError(409, "Approved or merged discovery records cannot be edited.");
  }
  const changes = body.changes && typeof body.changes === "object" ? body.changes : {};
  const next = { ...candidate, ...changes };
  const rootUrl = await configuredRoot(supabase);
  const normalizedUrl = normalizeDiscoveryUrl(next.url, rootUrl);
  if (!clean(next.title, 300)) throw new ApiError(400, "A destination title is required.");
  if (!WEBSITE_INDEX_CATEGORIES.includes(next.suggested_category)) {
    throw new ApiError(400, "Select a supported Website Index category.");
  }
  const payload = buildDiscoveryCandidateEdit(candidate, changes, rootUrl);
  if (Object.prototype.hasOwnProperty.call(changes, "url")) {
    const [pages, candidates] = await Promise.all([
      data(
        await supabase.from("knowledge_business_pages").select("*"),
        "Existing Website Index records could not be checked."
      ),
      data(
        await supabase
          .from("knowledge_website_discovery_candidates")
          .select("*")
          .neq("id", candidate.id)
          .neq("status", "deleted"),
        "Other discovery candidates could not be checked."
      ),
    ]);
    payload.canonical_url = normalizedUrl;
    payload.redirect_chain = [];
    payload.http_status = null;
    payload.verified = false;
    payload.available_to_internal_linking = false;
    const duplicate = findDuplicate(
      { ...candidate, ...payload },
      pages || [],
      candidates || [],
      rootUrl
    );
    payload.duplicate_type = duplicate.duplicate_type;
    payload.existing_page_id = duplicate.existing_page_id || null;
    payload.duplicate_of_candidate_id = duplicate.duplicate_of_candidate_id || null;
  }
  payload.status = "pending_review";
  payload.reviewed_at = null;
  payload.updated_at = new Date().toISOString();
  const updated = data(
    await supabase.from("knowledge_website_discovery_candidates").update(payload).eq("id", candidate.id).select().single(),
    "Discovered destination changes could not be saved."
  );
  await audit(supabase, {
    scan_run_id: candidate.scan_run_id, candidate_id: candidate.id, action: "edited",
    reason: "Administrator edited the pending discovery recommendation.",
    details: {
      changed_fields: [
        "title", "url", "suggested_category", "suggested_priority",
        "suggested_keywords", "suggested_matching_terms",
        "suggested_customer_intent", "suggested_description",
        "monitor_in_ai_visibility_when_published",
      ],
      persisted_candidate_id: updated.id,
      approved_website_index_updated: false,
      automatic_approval: false,
    },
  });
  return updated;
}

async function verifyCandidateUrl(supabase, candidate) {
  const rootUrl = await configuredRoot(supabase);
  const url = normalizeDiscoveryUrl(candidate.url, rootUrl);
  if (!url || !isApprovedInternalUrl(url, rootUrl)) {
    throw new ApiError(400, "Map this candidate to a real same-domain URL before approval.");
  }
  let document;
  try {
    document = await fetchWebsiteDocument(url, { rootUrl });
  } catch {
    throw new ApiError(400, "The destination could not be verified on the public website.");
  }
  if (!document.scannable || document.status < 200 || document.status >= 300) {
    throw new ApiError(400, "Only a live public HTML destination can be approved.");
  }
  return { url: document.url, document };
}

function pagePayload(candidate, verification, existing = null) {
  return {
    page_key: existing?.page_key || `discovery_${candidate.id.replaceAll("-", "").slice(0, 24)}`,
    title: candidate.title,
    url: verification.url,
    category: candidate.suggested_category,
    keywords: cleanList(candidate.suggested_keywords),
    vehicle_types: cleanList(candidate.suggested_matching_terms),
    customer_intent: cleanList(candidate.suggested_customer_intent),
    priority: candidate.suggested_priority,
    description: candidate.suggested_description,
    product: existing?.product || "general",
    page_type: "website_index",
    active: true,
    source: existing?.source || "manual",
    external_id: existing?.external_id || null,
    sync_metadata: {
      ...(existing?.sync_metadata || {}),
      canonical_url: candidate.canonical_url,
      discovery_source_page: candidate.source_page,
      redirect_chain: verification.document.redirect_chain,
      wix_sync_ready: true,
    },
    approval_status: "approved",
    verified: true,
    verification_source: "website_discovery",
    verified_at: new Date().toISOString(),
    discovery_candidate_id: candidate.id,
    monitor_in_ai_visibility_when_published: candidate.monitor_in_ai_visibility_when_published !== false,
    updated_at: new Date().toISOString(),
  };
}

async function approveCandidate(supabase, body) {
  const candidate = await candidateById(supabase, body.candidate_id);
  if (candidate.status !== "pending_review") throw new ApiError(409, "Only pending destinations can be approved.");
  if (candidate.existing_page_id || candidate.duplicate_type !== "none") {
    throw new ApiError(409, "Review this duplicate and use Merge Existing instead of creating another destination.");
  }
  const verification = await verifyCandidateUrl(supabase, candidate);
  const saved = data(
    await supabase.from("knowledge_business_pages").insert(pagePayload(candidate, verification)).select().single(),
    "Approved Website Index destination could not be saved."
  );
  const updated = data(
    await supabase.from("knowledge_website_discovery_candidates").update({
      status: "approved", reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", candidate.id).select().single(),
    "Discovery approval could not be recorded."
  );
  await audit(supabase, {
    scan_run_id: candidate.scan_run_id, candidate_id: candidate.id, website_page_id: saved.id,
    action: "approved", reason: "Administrator verified and approved the discovered destination.",
    details: {
      url: saved.url, available_to_internal_linking: true,
      monitor_in_ai_visibility_when_published: saved.monitor_in_ai_visibility_when_published,
    },
  });
  return { candidate: updated, website_page: saved };
}

async function rejectCandidate(supabase, body) {
  const candidate = await candidateById(supabase, body.candidate_id);
  if (candidate.status !== "pending_review") throw new ApiError(409, "Only pending destinations can be rejected.");
  const updated = data(
    await supabase.from("knowledge_website_discovery_candidates").update({
      status: "rejected", review_notes: clean(body.reason, 2000),
      reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", candidate.id).select().single(),
    "Discovery rejection could not be recorded."
  );
  await audit(supabase, {
    scan_run_id: candidate.scan_run_id, candidate_id: candidate.id, action: "rejected",
    reason: updated.review_notes || "Administrator rejected the discovered destination.",
    details: { available_to_internal_linking: false },
  });
  return updated;
}

async function mergeCandidate(supabase, body) {
  const candidate = await candidateById(supabase, body.candidate_id);
  const existingId = clean(body.existing_page_id, 100) || candidate.existing_page_id;
  if (candidate.status !== "pending_review" || !existingId) throw new ApiError(409, "Select an existing destination to merge.");
  const existing = data(
    await supabase.from("knowledge_business_pages").select("*").eq("id", existingId).single(),
    "Existing Website Index destination could not be found."
  );
  const selected = cleanList(body.selected_fields).filter((field) => MERGE_FIELDS.has(field));
  if (!selected.length) throw new ApiError(400, "Select at least one field to update.");
  const verification = selected.includes("url")
    ? await verifyCandidateUrl(supabase, candidate)
    : { url: existing.url, document: { redirect_chain: existing.sync_metadata?.redirect_chain || [] } };
  const proposed = pagePayload(candidate, verification, existing);
  const payload = Object.fromEntries(selected.map((field) => [field, proposed[field]]));
  payload.updated_at = new Date().toISOString();
  const saved = data(
    await supabase.from("knowledge_business_pages").update(payload).eq("id", existing.id).select().single(),
    "Selected Website Index updates could not be merged."
  );
  const updated = data(
    await supabase.from("knowledge_website_discovery_candidates").update({
      status: "merged", existing_page_id: existing.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", candidate.id).select().single(),
    "Discovery merge could not be recorded."
  );
  await audit(supabase, {
    scan_run_id: candidate.scan_run_id, candidate_id: candidate.id, website_page_id: existing.id,
    action: "merged", reason: "Administrator selectively merged discovery data into an existing approved destination.",
    details: { selected_fields: selected, preserved_fields: Object.keys(existing).filter((field) => !selected.includes(field)) },
  });
  return { candidate: updated, website_page: saved };
}

async function deleteCandidate(supabase, body) {
  const candidate = await candidateById(supabase, body.candidate_id);
  const updated = data(
    await supabase.from("knowledge_website_discovery_candidates").update({
      status: "deleted", reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", candidate.id).select().single(),
    "Discovery record could not be deleted."
  );
  await audit(supabase, {
    scan_run_id: candidate.scan_run_id, candidate_id: candidate.id, action: "deleted",
    reason: "Administrator removed the discovery record from the review queue.",
    details: { soft_deleted: true, audit_preserved: true },
  });
  return updated;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorize(request)) return response.status(401).json({ ok: false, message: "Access key not recognised." });
  try {
    const body = parseBody(request);
    const supabase = getSupabase();
    let result;
    switch (body.action) {
      case "load": result = await loadDiscovery(supabase); break;
      case "scan": result = await runScan(supabase, body); break;
      case "edit": result = { candidate: await editCandidate(supabase, body) }; break;
      case "approve": result = await approveCandidate(supabase, body); break;
      case "reject": result = { candidate: await rejectCandidate(supabase, body) }; break;
      case "merge": result = await mergeCandidate(supabase, body); break;
      case "delete": result = { candidate: await deleteCandidate(supabase, body) }; break;
      default: throw new ApiError(400, "Unsupported Website Index discovery action.");
    }
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error("WEBSITE INDEX DISCOVERY ERROR", { message: error.message });
    return response.status(error.status || 500).json({
      ok: false,
      message: error.status ? error.message : "Website Index discovery request failed.",
    });
  }
}

import { createClient } from "@supabase/supabase-js";
import {
  AUTOMATION_JOB_TYPES,
  assertSafeAutomationAction,
  automationFingerprint,
  canQueueDraftFactory,
} from "../lib/editorialAutomation.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const clean = (value, max = 5000) => String(value || "").trim().slice(0, max);

function authorize(request) {
  const expected = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  const authorization = request.headers.authorization || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  return Boolean(expected && (request.headers[API_KEY_HEADER] === expected || bearer === expected));
}

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body);
    } catch {
      return {};
    }
  }
  return request.body;
}

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing server Supabase environment variables.");
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

function data(result, fallback) {
  if (result.error) throw new Error(result.error.message || fallback);
  return result.data;
}

async function loadAutomation(supabase) {
  const [settings, opportunities, jobs, logs, briefings, runs] = await Promise.all([
    supabase.from("knowledge_automation_settings").select("*").eq("settings_key", "default").single(),
    supabase
      .from("knowledge_automation_opportunities")
      .select(
        "*, knowledge_articles:knowledge_articles!knowledge_automation_opportunities_source_article_id_fkey(title)"
      )
      .order("priority_score", { ascending: false })
      .limit(500),
    supabase
      .from("knowledge_automation_jobs")
      .select("*, knowledge_articles(title), knowledge_automation_opportunities(title)")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("knowledge_automation_logs")
      .select("*, knowledge_articles(title), knowledge_automation_opportunities(title)")
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("knowledge_automation_briefings")
      .select("*")
      .order("briefing_date", { ascending: false })
      .limit(30),
    supabase.from("knowledge_automation_runs").select("*").order("started_at", { ascending: false }).limit(100),
  ]);
  [settings, opportunities, jobs, logs, briefings, runs].forEach((result) =>
    data(result, "Editorial Automation could not load.")
  );
  return {
    settings: settings.data,
    opportunities: opportunities.data || [],
    jobs: jobs.data || [],
    logs: logs.data || [],
    briefings: briefings.data || [],
    runs: runs.data || [],
  };
}

async function enqueueJob(supabase, {
  jobType,
  priority = 50,
  payload = {},
  opportunityId = null,
  articleId = null,
  idempotencyKey,
  explanation = "",
}) {
  if (!AUTOMATION_JOB_TYPES.includes(jobType)) throw new ApiError(400, "Unsupported automation job.");
  assertSafeAutomationAction(jobType);
  const settings = data(
    await supabase.from("knowledge_automation_settings").select("*").eq("settings_key", "default").single(),
    "Automation settings could not be loaded."
  );
  const result = await supabase
    .from("knowledge_automation_jobs")
    .insert({
      job_type: jobType,
      priority: Math.max(0, Math.min(100, Number(priority) || 50)),
      idempotency_key:
        clean(idempotencyKey, 500) ||
        `${jobType}:${automationFingerprint(opportunityId, articleId, JSON.stringify(payload), Date.now())}`,
      payload,
      opportunity_id: opportunityId,
      article_id: articleId,
      max_attempts: settings.max_attempts,
      explanation: clean(explanation),
    })
    .select()
    .single();
  if (result.error?.code === "23505") {
    return data(
      await supabase
        .from("knowledge_automation_jobs")
        .select("*")
        .eq("idempotency_key", clean(idempotencyKey, 500))
        .single(),
      "Existing automation job could not be loaded."
    );
  }
  return data(result, "Automation job could not be queued.");
}

async function setPaused(supabase, paused) {
  return data(
    await supabase
      .from("knowledge_automation_settings")
      .update({ paused: Boolean(paused), updated_at: new Date().toISOString() })
      .eq("settings_key", "default")
      .select()
      .single(),
    "Automation state could not be updated."
  );
}

async function saveSettings(supabase, values = {}) {
  const numberOr = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };
  const payload = {
    max_jobs_per_run: Math.max(1, Math.min(10, numberOr(values.max_jobs_per_run, 3))),
    max_attempts: Math.max(1, Math.min(5, numberOr(values.max_attempts, 3))),
    minimum_draft_score: Math.max(50, Math.min(95, numberOr(values.minimum_draft_score, 75))),
    daily_draft_limit: Math.max(0, Math.min(20, numberOr(values.daily_draft_limit, 3))),
    automatic_improvement_attempts: Math.max(
      0,
      Math.min(3, numberOr(values.automatic_improvement_attempts, 0))
    ),
    scan_interval_hours: Math.max(1, Math.min(168, numberOr(values.scan_interval_hours, 24))),
    updated_at: new Date().toISOString(),
  };
  return data(
    await supabase
      .from("knowledge_automation_settings")
      .update(payload)
      .eq("settings_key", "default")
      .select()
      .single(),
    "Automation settings could not be saved."
  );
}

async function approveOpportunity(supabase, body) {
  const opportunity = data(
    await supabase
      .from("knowledge_automation_opportunities")
      .select("*")
      .eq("id", clean(body.opportunity_id, 100))
      .single(),
    "Opportunity could not be found."
  );
  if (opportunity.status !== "draft") throw new ApiError(400, "Only draft opportunities can be approved.");
  if (opportunity.opportunity_type === "missing_topic") {
    const settings = data(
      await supabase
        .from("knowledge_automation_settings")
        .select("daily_draft_limit")
        .eq("settings_key", "default")
        .single(),
      "Automation settings could not be loaded."
    );
    if (Number(settings.daily_draft_limit) === 0) {
      throw new ApiError(
        400,
        "Automated draft preparation is disabled. Increase the daily draft limit before approving this opportunity."
      );
    }
  }
  const now = new Date().toISOString();
  const overrides = body.overrides && typeof body.overrides === "object" ? body.overrides : {};
  const primaryProduct = ["finance", "rent2buy", "both"].includes(overrides.primary_product)
    ? overrides.primary_product
    : opportunity.primary_product;
  const customerJourney = ["awareness", "research", "comparison", "decision", "ready_to_apply"].includes(
    overrides.customer_journey
  )
    ? overrides.customer_journey
    : opportunity.customer_journey;
  const approved = data(
    await supabase
      .from("knowledge_automation_opportunities")
      .update({
        status: "approved",
        approved_at: now,
        manual_overrides: overrides,
        title: clean(overrides.title, 300) || opportunity.title,
        primary_product: primaryProduct,
        customer_journey: customerJourney,
        updated_at: now,
      })
      .eq("id", opportunity.id)
      .select()
      .single(),
    "Opportunity approval could not be saved."
  );
  const jobType = canQueueDraftFactory(approved) ? "draft_factory" : "improvement";
  const job = await enqueueJob(supabase, {
    jobType,
    priority: approved.priority_score,
    opportunityId: approved.id,
    articleId: approved.source_article_id,
    idempotencyKey: `${jobType}:opportunity:${approved.id}`,
    explanation:
      jobType === "draft_factory"
        ? "User approved this topic opportunity for draft preparation."
        : "User approved this editorial improvement for preparation.",
  });
  data(
    await supabase
      .from("knowledge_automation_opportunities")
      .update({ status: "queued", updated_at: now })
      .eq("id", approved.id),
    "Opportunity queue state could not be saved."
  );
  return { opportunity: { ...approved, status: "queued" }, job };
}

async function dismissOpportunity(supabase, body) {
  return data(
    await supabase
      .from("knowledge_automation_opportunities")
      .update({
        status: "dismissed",
        dismissed_at: new Date().toISOString(),
        explanation: clean(body.reason) || "Dismissed by user.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", clean(body.opportunity_id, 100))
      .in("status", ["draft", "approved"])
      .select()
      .single(),
    "Opportunity could not be dismissed."
  );
}

async function cancelJob(supabase, body) {
  return data(
    await supabase
      .from("knowledge_automation_jobs")
      .update({
        status: "cancelled",
        cancellation_reason: clean(body.reason) || "Cancelled by user.",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", clean(body.job_id, 100))
      .eq("status", "queued")
      .select()
      .single(),
    "Automation job could not be cancelled."
  );
}

async function retryJob(supabase, body) {
  const jobId = clean(body.job_id, 100);
  const job = data(
    await supabase.from("knowledge_automation_jobs").select("*").eq("id", jobId).single(),
    "Automation job could not be found."
  );
  if (!["failed", "cancelled"].includes(job.status)) {
    throw new ApiError(400, "Only failed or cancelled jobs can be retried.");
  }
  return data(
    await supabase
      .from("knowledge_automation_jobs")
      .update({
        status: "queued",
        attempts: 0,
        available_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
        started_at: null,
        completed_at: null,
        error_message: null,
        cancellation_reason: null,
        idempotency_key: `${job.idempotency_key}:retry:${Date.now()}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id)
      .select()
      .single(),
    "Automation job could not be retried."
  );
}

export default async function handler(request, response) {
  if (request.method !== "POST") return response.status(405).json({ ok: false, message: "Method not allowed." });
  if (!authorize(request)) return response.status(401).json({ ok: false, message: "Access key not recognised." });
  try {
    const body = parseBody(request);
    const supabase = getSupabase();
    let result;
    switch (body.action) {
      case "load":
        result = await loadAutomation(supabase);
        break;
      case "pause":
        result = { settings: await setPaused(supabase, true) };
        break;
      case "resume":
        result = { settings: await setPaused(supabase, false) };
        break;
      case "saveSettings":
        result = { settings: await saveSettings(supabase, body.settings) };
        break;
      case "scanNow":
        result = {
          jobs: await Promise.all([
            enqueueJob(supabase, {
              jobType: "opportunity_scan",
              priority: 90,
              idempotencyKey: `opportunity_scan:manual:${Date.now()}`,
              explanation: "User requested an editorial opportunity scan.",
            }),
            enqueueJob(supabase, {
              jobType: "topic_discovery",
              priority: 80,
              idempotencyKey: `topic_discovery:manual:${Date.now()}`,
              explanation: "User requested AI topic discovery.",
            }),
            enqueueJob(supabase, {
              jobType: "daily_briefing",
              priority: 60,
              idempotencyKey: `daily_briefing:manual:${Date.now()}`,
              explanation: "Refresh the review briefing after the requested scan.",
            }),
          ]),
        };
        break;
      case "approveOpportunity":
        result = await approveOpportunity(supabase, body);
        break;
      case "dismissOpportunity":
        result = { opportunity: await dismissOpportunity(supabase, body) };
        break;
      case "cancelJob":
        result = { job: await cancelJob(supabase, body) };
        break;
      case "retryJob":
        result = { job: await retryJob(supabase, body) };
        break;
      default:
        throw new ApiError(400, "Unsupported Editorial Automation action.");
    }
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error("EDITORIAL AUTOMATION ERROR", {
      action: parseBody(request).action || "",
      message: error.message,
    });
    return response.status(error.status || 500).json({
      ok: false,
      message: error.status ? error.message : "Editorial Automation request failed.",
    });
  }
}

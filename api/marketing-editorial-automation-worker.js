import { createClient } from "@supabase/supabase-js";
import { analyseArticle, applyImprovement, proposeImprovement } from "./marketing-editorial-engine.js";
import { findTopics, generateArticle } from "./marketing-knowledge-hub.js";
import {
  assertSafeAutomationAction,
  automationFingerprint,
  buildDailyBriefing,
  buildScannerOpportunities,
  evaluateDraftThreshold,
  mergeDiscoveredTopics,
  nextRetry,
} from "../lib/editorialAutomation.js";

const API_KEY_HEADER = "x-marketing-customer-database-key";

const clean = (value, max = 5000) => String(value || "").trim().slice(0, max);

function authorize(request) {
  const authorization = request.headers.authorization || "";
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const cronSecret = process.env.CRON_SECRET;
  const marketingKey = process.env.MARKETING_CUSTOMER_DATABASE_API_KEY;
  return Boolean(
    (cronSecret && bearer === cronSecret) ||
      (marketingKey && (request.headers[API_KEY_HEADER] === marketingKey || bearer === marketingKey))
  );
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

async function logAction(supabase, values) {
  return data(
    await supabase.from("knowledge_automation_logs").insert(values).select().single(),
    "Automation execution log could not be saved."
  );
}

async function enqueueIfMissing(supabase, values) {
  const result = await supabase
    .from("knowledge_automation_jobs")
    .insert(values)
    .select()
    .single();
  if (result.error?.code === "23505") return null;
  return data(result, "Scheduled automation job could not be queued.");
}

async function ensureRecurringJobs(supabase, settings, now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  const hourBucket = Math.floor(now.getTime() / (Number(settings.scan_interval_hours) * 3600000));
  const common = { max_attempts: settings.max_attempts, payload: {} };
  return Promise.all([
    enqueueIfMissing(supabase, {
      ...common,
      job_type: "opportunity_scan",
      priority: 80,
      idempotency_key: `opportunity_scan:auto:${hourBucket}`,
      explanation: "Scheduled scan of editorial quality, freshness and coverage.",
    }),
    enqueueIfMissing(supabase, {
      ...common,
      job_type: "topic_discovery",
      priority: 70,
      idempotency_key: `topic_discovery:auto:${date}`,
      explanation: "Daily AI topic discovery for reviewable opportunities.",
    }),
    enqueueIfMissing(supabase, {
      ...common,
      job_type: "daily_briefing",
      priority: 40,
      idempotency_key: `daily_briefing:auto:${date}`,
      explanation: "Daily summary of completed automation and review priorities.",
    }),
  ]);
}

async function recoverStaleJobs(supabase, run, now = new Date()) {
  const leaseExpiredAt = new Date(now.getTime() - 20 * 60000).toISOString();
  const stale = data(
    await supabase
      .from("knowledge_automation_jobs")
      .update({
        status: "queued",
        available_at: now.toISOString(),
        locked_at: null,
        locked_by: null,
        started_at: null,
        error_message: "A previous worker lease expired. The job was safely returned to the queue.",
        updated_at: now.toISOString(),
      })
      .eq("status", "running")
      .lt("locked_at", leaseExpiredAt)
      .select(),
    "Expired worker leases could not be recovered."
  ) || [];
  for (const job of stale) {
    await logAction(supabase, {
      run_id: run.id,
      job_id: job.id,
      opportunity_id: job.opportunity_id,
      article_id: job.article_id,
      action: "queue_recovery",
      reason: "The prior worker did not complete within the 20-minute lease.",
      result: "requeued",
      details: { previous_attempts: job.attempts, recovered_at: now.toISOString() },
    });
  }
  return stale.length;
}

async function processOpportunityScan(supabase, settings) {
  const [articles, assessments, concepts, mappings, topics, knowledgeSettings] = await Promise.all([
    supabase.from("knowledge_articles").select("*").neq("status", "archived"),
    supabase
      .from("knowledge_article_editorial_assessments")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(2000),
    supabase.from("knowledge_concepts").select("*").eq("active", true),
    supabase.from("knowledge_article_concepts").select("*"),
    supabase.from("knowledge_topics").select("id,title,status"),
    supabase.from("knowledge_settings").select("freshness_days").eq("settings_key", "default").maybeSingle(),
  ]);
  [articles, assessments, concepts, mappings, topics, knowledgeSettings].forEach((result) =>
    data(result, "Opportunity Scanner context could not be loaded.")
  );
  const opportunities = buildScannerOpportunities({
    articles: articles.data || [],
    assessments: assessments.data || [],
    concepts: concepts.data || [],
    articleConcepts: mappings.data || [],
    topics: topics.data || [],
    freshnessDays: knowledgeSettings.data?.freshness_days || 180,
  });
  const fingerprints = opportunities.map((item) => item.fingerprint);
  const existing = fingerprints.length
    ? data(
        await supabase
          .from("knowledge_automation_opportunities")
          .select("fingerprint")
          .in("fingerprint", fingerprints),
        "Existing opportunities could not be checked."
      )
    : [];
  const existingSet = new Set((existing || []).map((item) => item.fingerprint));
  const fresh = opportunities.filter((item) => !existingSet.has(item.fingerprint));
  if (fresh.length) {
    data(
      await supabase.from("knowledge_automation_opportunities").insert(fresh),
      "Scanner opportunities could not be saved."
    );
  }
  return {
    opportunities_identified: opportunities.length,
    opportunities_created: fresh.length,
    explanation: "Deterministic scanner evaluated freshness, scores, FAQ, CTA, links and coverage.",
  };
}

async function processTopicDiscovery(supabase) {
  const categories = [
    "Van Finance",
    "Rent2Buy",
    "Credit",
    "Self Employed",
    "Limited Company",
    "Vehicle Guides",
    "Comparisons",
    "FAQs",
  ];
  const result = await findTopics(supabase, {
    categories,
    quantity: 20,
    brief:
      "Prioritise topics that can help qualified UK van buyers make a useful decision and submit a suitable Van Finance Company application. Quality and distinct customer intent matter more than volume.",
  });
  const existing = data(
    await supabase
      .from("knowledge_automation_opportunities")
      .select("title")
      .neq("status", "dismissed"),
    "Existing topic opportunities could not be checked."
  );
  const merged = mergeDiscoveredTopics(result.ideas || [], existing || []);
  const rows = merged.accepted.map((idea) => {
    const businessValue = Number(idea.estimated_value || idea.priority || 3);
    const conversion = /apply|eligib|decision|compare|cost|afford/i.test(
      `${idea.intent} ${idea.rationale} ${idea.title}`
    ) ? 5 : 3;
    const effort = Number(idea.difficulty || 3);
    const primaryProduct = idea.category === "Rent2Buy"
      ? "rent2buy"
      : idea.category === "Van Finance" || idea.category === "Credit"
        ? "finance"
        : "both";
    const journey = /apply|ready/i.test(idea.intent)
      ? "ready_to_apply"
      : /compar/i.test(`${idea.intent} ${idea.title}`)
        ? "comparison"
        : /decision|choose|cost/i.test(`${idea.intent} ${idea.title}`)
          ? "decision"
          : "research";
    return {
      opportunity_type: "missing_topic",
      title: idea.title,
      reason: idea.rationale || idea.opportunity_reason || "AI identified a distinct customer question.",
      evidence: { idea, source: "phase6_topic_discovery" },
      primary_product: primaryProduct,
      customer_journey: journey,
      business_value: Math.max(1, Math.min(5, businessValue)),
      conversion_potential: conversion,
      editorial_effort: Math.max(1, Math.min(5, effort)),
      priority_score: Math.max(
        0,
        Math.min(100, businessValue * 10 + conversion * 10 + (6 - effort) * 4)
      ),
      fingerprint: `topic:${automationFingerprint(idea.title, idea.intent)}`,
      status: "draft",
      explanation: "AI-discovered topic retained as a draft opportunity for manual approval.",
    };
  });
  let created = 0;
  for (const row of rows) {
    const inserted = await supabase.from("knowledge_automation_opportunities").insert(row);
    if (!inserted.error) created += 1;
    else if (inserted.error.code !== "23505") throw new Error(inserted.error.message);
  }
  return {
    ideas_generated: (result.ideas || []).length,
    duplicates_merged: merged.duplicates.length + Number(result.duplicate_count || 0),
    opportunities_created: created,
    explanation: "Ideas were deduplicated and stored for review; no topic or article was approved.",
  };
}

function templateKeyFor(opportunity) {
  return opportunity.primary_product === "rent2buy" ? "rent2buy-guide" : "finance-guide";
}

function categoryFor(opportunity) {
  const saved = opportunity.evidence?.idea?.category;
  if (saved) return saved;
  return opportunity.primary_product === "rent2buy" ? "Rent2Buy" : "Van Finance";
}

async function processDraftFactory(supabase, job, settings) {
  const opportunity = data(
    await supabase
      .from("knowledge_automation_opportunities")
      .select("*")
      .eq("id", job.opportunity_id)
      .single(),
    "Approved draft opportunity could not be found."
  );
  if (opportunity.status !== "queued") throw new Error("Opportunity is not queued for preparation.");
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const dailyResult = await supabase
      .from("knowledge_articles")
      .select("id", { count: "exact", head: true })
      .neq("automation_state", "manual")
      .gte("created_at", startOfDay.toISOString());
  if (dailyResult.error) throw new Error(dailyResult.error.message || "Daily draft count could not be checked.");
  if (Number(dailyResult.count || 0) >= Number(settings.daily_draft_limit)) {
    throw new Error("Daily automated draft preparation limit reached.");
  }
  const idea = opportunity.evidence?.idea || {};
  const topicTitle =
    opportunity.manual_overrides?.title || opportunity.title.replace(/^Cover:\s*/i, "");
  const existingTopic = data(
    await supabase
      .from("knowledge_topics")
      .select("*")
      .ilike("title", topicTitle)
      .neq("status", "archived")
      .limit(1),
    "Existing topic coverage could not be checked."
  )?.[0];
  const topic = existingTopic || data(
    await supabase
      .from("knowledge_topics")
      .insert({
        title: topicTitle,
        category: opportunity.manual_overrides?.category || categoryFor(opportunity),
        primary_keyword: idea.primary_keyword || null,
        secondary_keywords: idea.secondary_keywords || [],
        intent: idea.intent || opportunity.customer_journey,
        notes: opportunity.reason,
        status: "ready",
        priority: opportunity.business_value,
        estimated_value: opportunity.business_value,
        difficulty: opportunity.editorial_effort,
        target_persona: idea.target_persona || "",
        seasonal: Boolean(idea.seasonal),
        opportunity_reason: opportunity.reason,
        source: "phase6_automation",
        finder_metadata: { opportunity_id: opportunity.id, manual_approval_required: true },
      })
      .select()
      .single(),
    "Approved opportunity topic could not be saved."
  );
  const generated = await generateArticle(supabase, {
    topic: { id: topic.id },
    generation: {
      templateKey: templateKeyFor(opportunity),
      targetAudience: idea.target_persona || "UK van buyers",
      tone: "Helpful, clear and factual",
      approximateLength: 1200,
      instructions:
        "Prepare a high-quality draft that helps suitable customers make an informed decision and take an appropriate next step. Do not promise approval, publish, or imply automatic acceptance.",
    },
  });
  let article = data(
    await supabase
      .from("knowledge_articles")
      .update({
        automation_state: "preparing",
        source_automation_opportunity_id: opportunity.id,
      })
      .eq("id", generated.id)
      .select()
      .single(),
    "Generated draft automation state could not be saved."
  );
  let editorial = await analyseArticle(supabase, { article_id: article.id });
  let threshold = evaluateDraftThreshold(editorial.assessment, settings.minimum_draft_score);
  let improvementsApplied = 0;
  while (
    !threshold.passes &&
    improvementsApplied < Number(settings.automatic_improvement_attempts || 0)
  ) {
    const recommendation = editorial.assessment.suggested_improvements?.[0];
    if (!recommendation) break;
    const proposal = await proposeImprovement(supabase, {
      article_id: article.id,
      recommendation_key: recommendation.key,
    });
    const applied = await applyImprovement(supabase, { proposal_id: proposal.id });
    article = applied.article;
    improvementsApplied += 1;
    editorial = await analyseArticle(supabase, { article_id: article.id });
    threshold = evaluateDraftThreshold(editorial.assessment, settings.minimum_draft_score);
  }
  const automationState = threshold.passes ? "ready_for_review" : "needs_improvement";
  article = data(
    await supabase
      .from("knowledge_articles")
      .update({ automation_state: automationState })
      .eq("id", article.id)
      .select()
      .single(),
    "Draft readiness state could not be saved."
  );
  data(
    await supabase
      .from("knowledge_automation_opportunities")
      .update({
        status: threshold.passes ? "completed" : "approved",
        completed_at: threshold.passes ? new Date().toISOString() : null,
        explanation: threshold.reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", opportunity.id),
    "Opportunity completion could not be saved."
  );
  return {
    article_id: article.id,
    topic_id: topic.id,
    score: editorial.assessment.overall_score,
    ready_for_review: threshold.passes,
    improvements_applied: improvementsApplied,
    explanation: threshold.reason,
  };
}

async function processImprovement(supabase, job) {
  const opportunity = data(
    await supabase
      .from("knowledge_automation_opportunities")
      .select("*")
      .eq("id", job.opportunity_id)
      .single(),
    "Improvement opportunity could not be found."
  );
  if (!opportunity.source_article_id) throw new Error("Improvement opportunity has no article.");
  const analysis = await analyseArticle(supabase, { article_id: opportunity.source_article_id });
  const recommendations = [
    ...(analysis.assessment.business_recommendations || []),
    ...(analysis.assessment.suggested_improvements || []),
  ];
  const proposal = recommendations[0]
    ? await proposeImprovement(supabase, {
        article_id: opportunity.source_article_id,
        recommendation_key: recommendations[0].key,
      })
    : null;
  data(
    await supabase
      .from("knowledge_automation_opportunities")
      .update({
        status: proposal ? "completed" : "approved",
        completed_at: proposal ? new Date().toISOString() : null,
        explanation: proposal
          ? "A review-only improvement proposal was prepared. The article was not overwritten."
          : "No safe supported improvement proposal was available.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", opportunity.id),
    "Improvement opportunity result could not be saved."
  );
  return {
    article_id: opportunity.source_article_id,
    proposal_id: proposal?.id || null,
    score: analysis.assessment.overall_score,
    ready_for_review: Boolean(proposal),
    explanation: proposal
      ? "Review-only proposal prepared; user edits were not overwritten."
      : "No safe supported proposal was produced.",
  };
}

async function processDailyBriefing(supabase) {
  const start = new Date();
  start.setDate(start.getDate() - 2);
  const [logs, opportunities, jobs, assessments] = await Promise.all([
    supabase.from("knowledge_automation_logs").select("*").gte("created_at", start.toISOString()),
    supabase
      .from("knowledge_automation_opportunities")
      .select("*")
      .in("status", ["draft", "approved", "queued"]),
    supabase.from("knowledge_automation_jobs").select("*").order("created_at", { ascending: false }).limit(500),
    supabase
      .from("knowledge_article_editorial_assessments")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);
  [logs, opportunities, jobs, assessments].forEach((result) =>
    data(result, "Daily briefing context could not be loaded.")
  );
  const briefing = buildDailyBriefing({
    logs: logs.data || [],
    opportunities: opportunities.data || [],
    jobs: jobs.data || [],
    assessments: assessments.data || [],
  });
  return data(
    await supabase
      .from("knowledge_automation_briefings")
      .upsert(
        { ...briefing, updated_at: new Date().toISOString() },
        { onConflict: "briefing_date" }
      )
      .select()
      .single(),
    "Daily briefing could not be saved."
  );
}

async function executeJob(supabase, job, settings) {
  assertSafeAutomationAction(job.job_type);
  switch (job.job_type) {
    case "opportunity_scan":
      return processOpportunityScan(supabase, settings);
    case "topic_discovery":
      return processTopicDiscovery(supabase);
    case "draft_factory":
      return processDraftFactory(supabase, job, settings);
    case "improvement":
      return processImprovement(supabase, job);
    case "editorial_refresh":
      return analyseArticle(supabase, { article_id: job.article_id });
    case "daily_briefing":
      return processDailyBriefing(supabase);
    default:
      throw new Error("Unsupported automation job.");
  }
}

async function completeJob(supabase, run, job, result, started) {
  const completedAt = new Date();
  const duration = completedAt.getTime() - started.getTime();
  data(
    await supabase
      .from("knowledge_automation_jobs")
      .update({
        status: "succeeded",
        result,
        explanation: clean(result.explanation) || job.explanation,
        completed_at: completedAt.toISOString(),
        duration_ms: duration,
        locked_at: null,
        locked_by: null,
        updated_at: completedAt.toISOString(),
      })
      .eq("id", job.id)
      .eq("status", "running"),
    "Completed job state could not be saved."
  );
  await logAction(supabase, {
    run_id: run.id,
    job_id: job.id,
    opportunity_id: job.opportunity_id,
    article_id: result.article_id || job.article_id,
    action: job.job_type,
    reason: job.explanation,
    result: "succeeded",
    duration_ms: duration,
    details: result,
  });
}

async function failJob(supabase, run, job, error, started) {
  const completedAt = new Date();
  const duration = completedAt.getTime() - started.getTime();
  const retry = nextRetry(job, completedAt);
  data(
    await supabase
      .from("knowledge_automation_jobs")
      .update({
        status: retry.retry ? "queued" : "failed",
        available_at: retry.available_at || job.available_at,
        error_message: clean(error.message),
        completed_at: retry.retry ? null : completedAt.toISOString(),
        duration_ms: duration,
        locked_at: null,
        locked_by: null,
        updated_at: completedAt.toISOString(),
      })
      .eq("id", job.id),
    "Failed job state could not be saved."
  );
  await logAction(supabase, {
    run_id: run.id,
    job_id: job.id,
    opportunity_id: job.opportunity_id,
    article_id: job.article_id,
    action: job.job_type,
    reason: job.explanation,
    result: retry.retry ? "retry_queued" : "failed",
    duration_ms: duration,
    details: {
      error: clean(error.message),
      attempt: job.attempts,
      max_attempts: job.max_attempts,
      next_attempt_at: retry.available_at,
    },
  });
  return retry.retry;
}

export default async function handler(request, response) {
  if (!["GET", "POST"].includes(request.method)) {
    return response.status(405).json({ ok: false, message: "Method not allowed." });
  }
  if (!authorize(request)) return response.status(401).json({ ok: false, message: "Not authorised." });
  const supabase = getSupabase();
  const runStarted = new Date();
  let run;
  try {
    const settings = data(
      await supabase
        .from("knowledge_automation_settings")
        .select("*")
        .eq("settings_key", "default")
        .single(),
      "Automation settings could not be loaded."
    );
    run = data(
      await supabase
        .from("knowledge_automation_runs")
        .insert({
          trigger_type: request.method === "GET" ? "cron" : "manual",
          status: settings.paused ? "paused" : "running",
        })
        .select()
        .single(),
      "Automation run could not be started."
    );
    if (settings.paused) {
      const completedAt = new Date();
      const pausedRun = data(
        await supabase
          .from("knowledge_automation_runs")
          .update({
            completed_at: completedAt.toISOString(),
            duration_ms: completedAt.getTime() - runStarted.getTime(),
            summary: { manual_approval_required: true, publishing_actions: 0 },
          })
          .eq("id", run.id)
          .select()
          .single(),
        "Paused automation run could not be completed."
      );
      return response.status(200).json({ ok: true, paused: true, run: pausedRun });
    }
    const recovered = await recoverStaleJobs(supabase, run);
    await ensureRecurringJobs(supabase, settings);
    const workerId = `vercel:${process.env.VERCEL_REGION || "local"}:${run.id}`;
    const jobs = data(
      await supabase.rpc("claim_knowledge_automation_jobs", {
        p_worker: workerId,
        p_limit: settings.max_jobs_per_run,
      }),
      "Automation jobs could not be claimed."
    ) || [];
    let succeeded = 0;
    let failed = 0;
    let retried = 0;
    for (const job of jobs) {
      const started = new Date();
      const current = data(
        await supabase.from("knowledge_automation_jobs").select("status").eq("id", job.id).single(),
        "Claimed job state could not be checked."
      );
      if (current.status === "cancelled") continue;
      try {
        const result = await executeJob(supabase, job, settings);
        await completeJob(supabase, run, job, result, started);
        succeeded += 1;
      } catch (error) {
        const wasRetried = await failJob(supabase, run, job, error, started);
        if (wasRetried) retried += 1;
        else failed += 1;
      }
    }
    const completedAt = new Date();
    const updatedRun = data(
      await supabase
        .from("knowledge_automation_runs")
        .update({
          status: failed ? "failed" : "succeeded",
          jobs_claimed: jobs.length,
          jobs_succeeded: succeeded,
          jobs_failed: failed,
          summary: { retried, recovered, manual_approval_required: true, publishing_actions: 0 },
          completed_at: completedAt.toISOString(),
          duration_ms: completedAt.getTime() - runStarted.getTime(),
        })
        .eq("id", run.id)
        .select()
        .single(),
      "Automation run result could not be saved."
    );
    return response.status(200).json({ ok: true, run: updatedRun });
  } catch (error) {
    console.error("EDITORIAL AUTOMATION WORKER ERROR", { message: error.message });
    if (run?.id) {
      await supabase
        .from("knowledge_automation_runs")
        .update({
          status: "failed",
          error_message: clean(error.message),
          completed_at: new Date().toISOString(),
          duration_ms: Date.now() - runStarted.getTime(),
        })
        .eq("id", run.id);
    }
    return response.status(500).json({ ok: false, message: "Editorial Automation worker failed." });
  }
}

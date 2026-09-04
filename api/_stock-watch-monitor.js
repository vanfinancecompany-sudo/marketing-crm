function clean(value, limit = 2000) {
  return String(value ?? "").trim().slice(0, limit);
}

function millis(value) {
  const parsed = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function issue({ severity, code, pipeline = "system", title, evidence = {}, likelyCause, lookHere, directions = [], registration = "" }) {
  const reg = clean(registration, 20).toUpperCase();
  return {
    fingerprint: [code, pipeline, reg || "all"].join(":"),
    severity,
    code,
    pipeline,
    registration: reg || null,
    title,
    evidence,
    likelyCause,
    lookHere,
    directions,
  };
}

function countDeltaIssue({ key, label, current, previous, pipeline, lookHere, directions }) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  const delta = current - previous;
  const absolute = Math.abs(delta);
  const ratio = absolute / previous;
  if (absolute < 10 || ratio < 0.25) return null;
  const severity = absolute >= 25 || ratio >= 0.5 ? "critical" : "warning";
  return issue({
    severity,
    code: `COUNT_JUMP_${key.toUpperCase()}`,
    pipeline,
    title: `${label} changed sharply (${previous} → ${current})`,
    evidence: { previous, current, delta, ratio: Number(ratio.toFixed(3)) },
    likelyCause: "A feed, CMS authority, import, or publication-state change altered a large block of registrations at once.",
    lookHere,
    directions,
  });
}

export function buildStockWatchMonitorIssues({ snapshot, previousSnapshot = null, actionLogs = [], now = new Date() }) {
  const issues = [];
  const nowMs = now.getTime();
  const provider = snapshot?.provider || {};
  const refresh = provider.refresh || {};
  const counts = snapshot?.counts || {};
  const previousCounts = previousSnapshot?.counts || {};
  const queries = snapshot?.queries || {};

  if (snapshot?.providerError) {
    issues.push(issue({
      severity: "critical",
      code: "STOCK_SOURCE_UNAVAILABLE",
      title: "Stock source could not be read",
      evidence: { providerId: snapshot.providerId, error: snapshot.providerError },
      likelyCause: "The supplier adapter, credentials, source endpoint, or normalized source mapping is unavailable.",
      lookHere: "api/_stock-source-provider.js and the configured STOCK_SOURCE_PROVIDER_* environment variables",
      directions: [
        "Check the active provider ID and provider URL/credentials.",
        "Confirm the adapter returns normalized registration, status, source URL, image count and checked time.",
        "Do not change CMS stock until the provider snapshot is healthy again.",
      ],
    }));
  } else {
    const updatedMs = millis(refresh.updatedAt || provider.checkedAt);
    const ageHours = updatedMs ? (nowMs - updatedMs) / 3_600_000 : Infinity;
    if (refresh.status === "running" && refresh.startedAt && nowMs - millis(refresh.startedAt) > 2 * 3_600_000) {
      issues.push(issue({
        severity: "critical",
        code: "STOCK_SOURCE_REFRESH_STALLED",
        title: "Stock-source refresh has been running for more than two hours",
        evidence: { refresh, ageHours: Number(ageHours.toFixed(2)) },
        likelyCause: "The source scan stopped progressing, a provider request is hanging, or continuation scheduling is not advancing the run.",
        lookHere: "api/vansco-cache-live-refresh.js (current provider) or the active provider adapter refresh path",
        directions: [
          "Check the latest refresh run stage, remaining count and last error.",
          "Check Vercel runtime errors for the refresh route.",
          "Confirm the five-minute continuation cron is still firing while the current adapter is Vansco/Dragon.",
        ],
      }));
    } else if (ageHours > 14) {
      issues.push(issue({
        severity: "critical",
        code: "STOCK_SOURCE_REFRESH_STALE",
        title: "Stock-source data is more than 14 hours old",
        evidence: { checkedAt: provider.checkedAt, refreshUpdatedAt: refresh.updatedAt, ageHours: Number(ageHours.toFixed(2)) },
        likelyCause: "The source refresh has stopped, provider access changed, or the source adapter is not updating its normalized snapshot.",
        lookHere: "Stock-source adapter and scheduled refresh route",
        directions: ["Check the provider refresh status and Vercel cron executions.", "Check provider credentials/availability.", "Run a manual source refresh only after confirming no active run is already in progress."],
      }));
    } else if (ageHours > 8) {
      issues.push(issue({
        severity: "warning",
        code: "STOCK_SOURCE_REFRESH_OLD",
        title: "Stock-source data is getting old",
        evidence: { checkedAt: provider.checkedAt, ageHours: Number(ageHours.toFixed(2)) },
        likelyCause: "A scheduled refresh may have been missed or delayed.",
        lookHere: "Provider refresh schedule and latest monitor/source run",
        directions: ["Confirm the next scheduled source refresh is due.", "Check the last provider refresh result before manually restarting anything."],
      }));
    }
    if (Number(refresh.failed || 0) > 0 || refresh.error) {
      issues.push(issue({
        severity: Number(refresh.failed || 0) >= 5 ? "critical" : "warning",
        code: "STOCK_SOURCE_REFRESH_FAILURES",
        title: "Stock-source refresh contains failed records",
        evidence: { failed: refresh.failed, remaining: refresh.remaining, error: refresh.error },
        likelyCause: "One or more source detail requests failed or returned an unexpected payload.",
        lookHere: "Latest provider refresh run and failing source records",
        directions: ["Inspect the latest refresh last_error and failed source URLs.", "Check whether the provider changed HTML/API fields.", "Avoid broad CMS changes until failed registrations are understood."],
      }));
    }
    if (Number(provider.vehicleCount || 0) === 0) {
      issues.push(issue({
        severity: "critical",
        code: "STOCK_SOURCE_ZERO_VEHICLES",
        title: "Stock source returned zero usable vehicles",
        evidence: { providerId: provider.providerId, refresh },
        likelyCause: "The source adapter is broken, provider access changed, or registration mapping failed.",
        lookHere: "api/_stock-source-provider.js",
        directions: ["Check raw provider response count.", "Check registration normalization/mapping.", "Do not trust Missing/Reserved comparisons while the source count is zero."],
      }));
    }
  }

  for (const [name, query] of Object.entries(queries)) {
    if (query?.ok !== false) continue;
    issues.push(issue({
      severity: "critical",
      code: "AUTHORITY_QUERY_FAILED",
      pipeline: query.pipeline || "system",
      title: `${name} authority check failed`,
      evidence: { name, error: query.error, collectionId: query.collectionId, siteId: query.siteId },
      likelyCause: "Wix credentials, collection access, collection ID, or the live authority endpoint failed.",
      lookHere: query.collectionId ? `Wix ${query.siteId || "site"} / ${query.collectionId}` : "Wix authority query",
      directions: ["Check the Wix API response/status first.", "Confirm the expected site ID and collection ID have not changed.", "Confirm the API key has CMS read access."],
    }));
  }

  if (Number(counts.rent2buyLive || 0) === 0 && queries.rent2buy?.ok !== false) {
    issues.push(issue({
      severity: "critical",
      code: "RENT2BUY_LIVE_ZERO",
      pipeline: "rent2buy",
      title: "Authoritative Rent2Buy live collection has zero published registrations",
      evidence: { count: counts.rent2buyLive, authority: snapshot.authorities?.rent2buy },
      likelyCause: "ALLRENT2BUYVANS was emptied/drafted unexpectedly or the authority mapping is wrong.",
      lookHere: "VAN FINANCE Wix / ALLRENT2BUYVANS",
      directions: ["Open ALLRENT2BUYVANS in the Van Finance Wix CMS.", "Confirm live items are PUBLISHED, not Draft.", "Do not inspect the retired standalone Rent2Buy CMS as an authority."],
    }));
  }

  const deltaSpecs = [
    ["rent2buy_live", "Rent2Buy live stock", counts.rent2buyLive, previousCounts.rent2buyLive, "rent2buy", "VAN FINANCE Wix / ALLRENT2BUYVANS"],
    ["finance_live", "Van Finance live stock", counts.financeLive, previousCounts.financeLive, "finance", "VAN FINANCE Wix / VANFINANCE-ALLVANS"],
    ["provider", "Stock-source vehicle count", counts.providerVehicles, previousCounts.providerVehicles, "system", "Active stock-source adapter"],
  ];
  for (const [key, label, current, previous, pipeline, lookHere] of deltaSpecs) {
    const found = countDeltaIssue({ key, label, current, previous, pipeline, lookHere, directions: ["Compare this monitor run with the previous run.", "Check whether a bulk publish/draft/import happened.", "Check the relevant source/collection before changing records manually."] });
    if (found) issues.push(found);
  }

  const reservedDelta = Number(counts.rent2buyReserved || 0) - Number(previousCounts.rent2buyReserved || 0);
  if (previousSnapshot && reservedDelta >= 3) {
    issues.push(issue({
      severity: reservedDelta >= 6 ? "critical" : "warning",
      code: "RENT2BUY_RESERVED_JUMP",
      pipeline: "rent2buy",
      title: `Rent2Buy Reserved count jumped by ${reservedDelta}`,
      evidence: { previous: previousCounts.rent2buyReserved || 0, current: counts.rent2buyReserved || 0, delta: reservedDelta },
      likelyCause: "Either several vehicles genuinely changed source status together, or stale/non-authoritative live registrations have entered the comparison.",
      lookHere: "VAN FINANCE Wix / ALLRENT2BUYVANS, then active stock-source status for the matching registrations",
      directions: ["List the registrations behind the Reserved count.", "Confirm each is PUBLISHED in ALLRENT2BUYVANS.", "Confirm each is actually Reserved/Sold/Deposit Taken at the active stock provider.", "If old draft registrations appear, check authority code before touching CMS data."],
    }));
  }

  const recentFailures = actionLogs.filter((entry) => ["failed", "partial_failure"].includes(clean(entry.status).toLowerCase()) || Number(entry.failure_count || 0) > 0);
  if (recentFailures.length) {
    const byPipeline = new Map();
    for (const entry of recentFailures) {
      const pipeline = clean(entry.pipeline) || "system";
      const items = byPipeline.get(pipeline) || [];
      items.push(entry);
      byPipeline.set(pipeline, items);
    }
    for (const [pipeline, entries] of byPipeline) {
      issues.push(issue({
        severity: entries.length >= 2 ? "critical" : "warning",
        code: "DRAFT_ACTION_FAILURE",
        pipeline,
        title: `${entries.length} recent Stock Watch action failure${entries.length === 1 ? "" : "s"} in ${pipeline}`,
        evidence: { failures: entries.slice(0, 10).map((entry) => ({ traceId: entry.trace_id, registration: entry.registration, action: entry.action, error: entry.error, createdAt: entry.created_at })) },
        likelyCause: "The CMS action endpoint, Wix task, permissions, or publication state did not complete as expected.",
        lookHere: `stock_watch_action_logs for pipeline=${pipeline}, then the matching trace_id in Vercel runtime logs`,
        directions: ["Start with the newest failed trace ID.", "Check the exact collection/item result in the action log.", "Compare against the working Van Finance action path if Rent2Buy is the failing pipeline."],
      }));
    }
  }

  const staleStarted = actionLogs.filter((entry) => clean(entry.status).toLowerCase() === "started" && nowMs - millis(entry.created_at) > 10 * 60_000);
  if (staleStarted.length) {
    issues.push(issue({
      severity: "warning",
      code: "ACTION_TRACE_INCOMPLETE",
      title: "A Stock Watch action trace never recorded completion",
      evidence: { traces: staleStarted.slice(0, 10).map((entry) => ({ traceId: entry.trace_id, pipeline: entry.pipeline, registration: entry.registration, createdAt: entry.created_at })) },
      likelyCause: "A serverless invocation stopped before completion logging, or the function timed out/crashed.",
      lookHere: "Vercel runtime logs using the trace_id from stock_watch_action_logs",
      directions: ["Search Vercel logs for the trace ID.", "Check function duration/timeout and last emitted stage.", "Recheck CMS state before retrying the action."],
    }));
  }

  const successfulDrafts = actionLogs.filter((entry) => clean(entry.action).toLowerCase().includes("unpublish") && clean(entry.status).toLowerCase() === "completed" && Number(entry.changed_records || 0) > 0);
  const liveRent = new Set(snapshot?.registrations?.rent2buyLive || []);
  const liveFinance = new Set(snapshot?.registrations?.financeLive || []);
  for (const entry of successfulDrafts) {
    const reg = clean(entry.registration, 20).toUpperCase();
    if (!reg) continue;
    const liveSet = entry.pipeline === "rent2buy" ? liveRent : entry.pipeline === "finance" ? liveFinance : null;
    if (!liveSet?.has(reg)) continue;
    issues.push(issue({
      severity: "critical",
      code: "DRAFTED_VEHICLE_REAPPEARED",
      pipeline: entry.pipeline,
      registration: reg,
      title: `${reg} reappeared live after a successful Draft action`,
      evidence: { traceId: entry.trace_id, completedAt: entry.completed_at, authority: entry.authority, currentLive: true },
      likelyCause: "A stale mirror/category source republished the registration, the wrong live authority is being read, or an external sync republished it after the Draft action.",
      lookHere: entry.pipeline === "rent2buy" ? "VAN FINANCE Wix / ALLRENT2BUYVANS and the draft-action trace" : "VAN FINANCE Wix / VANFINANCE-ALLVANS and the draft-action trace",
      directions: ["Verify the registration's current publish status in the canonical collection.", "Inspect the action trace and the timestamp of any later stock sync.", "Check for a republish/import job after the successful Draft action."],
    }));
  }

  return issues;
}

export function summariseMonitorHealth(issues = []) {
  const critical = issues.filter((item) => item.severity === "critical").length;
  const warning = issues.filter((item) => item.severity === "warning").length;
  return {
    health: critical ? "critical" : warning ? "warning" : "healthy",
    issueCount: critical + warning,
    criticalCount: critical,
    warningCount: warning,
  };
}

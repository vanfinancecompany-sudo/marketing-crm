import handler from "../api/dealerkit-technical-backfill.js";

const EXPECTED_BRANCH = "fix/dealerkit-complete-vehicle-specifications";

function isTargetPreview(environment = process.env) {
  return environment.VERCEL_ENV === "preview" && environment.VERCEL_GIT_COMMIT_REF === EXPECTED_BRANCH;
}

async function invoke(query) {
  let statusCode = 200;
  let body = null;
  const headers = {};
  const response = {
    setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
    status(code) { statusCode = code; return response; },
    json(value) { body = value; return response; },
  };
  await handler({ method: "GET", query, headers: {} }, response);
  return { statusCode, body, headers };
}

function compactRecord(record = {}) {
  return {
    lane: record.lane,
    registration: record.registration,
    blockers: record.blockers || [],
    changeFields: record.changeFields || [],
    additions: Object.fromEntries(Object.entries(record.additions || {}).map(([field, detail]) => [field, detail?.addedCount || 0])),
    hasConfirmationToken: Boolean(record.confirmationToken),
  };
}

export async function runTechnicalBackfillBuild({ execute = false } = {}) {
  if (!isTargetPreview()) {
    console.log("TEMP_TECHNICAL_BACKFILL skipped outside the dedicated preview branch.");
    return { skipped: true, safe: true, executed: false };
  }

  const first = await invoke({ action: "dry-run" });
  if (first.statusCode !== 200 || !first.body?.ok) {
    console.log("TEMP_TECHNICAL_BACKFILL dry-run request failed", JSON.stringify({ statusCode: first.statusCode, body: first.body }));
    return { safe: false, executed: false, error: first.body?.message || `HTTP ${first.statusCode}` };
  }

  const dryRun = first.body;
  console.log("TEMP_TECHNICAL_BACKFILL_DRY_RUN", JSON.stringify({ safeToExecute: dryRun.safeToExecute, blockers: dryRun.blockers, summary: dryRun.summary }));
  for (const record of dryRun.records || []) console.log("TEMP_TECHNICAL_BACKFILL_RECORD", JSON.stringify(compactRecord(record)));

  if (!dryRun.safeToExecute) return { safe: false, executed: false, dryRun };
  if (!execute) return { safe: true, executed: false, dryRun };

  const pending = (dryRun.records || []).filter((record) => record.changeFieldCount > 0);
  const outcomes = [];
  for (const record of pending) {
    if (!record.confirmationToken) throw new Error(`No confirmation token was produced for ${record.registration}.`);
    const result = await invoke({ action: "execute", registration: record.registration, token: record.confirmationToken });
    console.log("TEMP_TECHNICAL_BACKFILL_EXECUTE", JSON.stringify({ registration: record.registration, lane: record.lane, statusCode: result.statusCode, body: result.body }));
    outcomes.push({ registration: record.registration, lane: record.lane, statusCode: result.statusCode, body: result.body });
    if (result.statusCode !== 200 || !result.body?.ok || (!result.body?.executed && !result.body?.alreadyComplete)) {
      throw new Error(`Technical backfill stopped at ${record.registration}: ${result.body?.message || `HTTP ${result.statusCode}`}`);
    }
  }

  const finalCheck = await invoke({ action: "dry-run" });
  if (finalCheck.statusCode !== 200 || !finalCheck.body?.ok) throw new Error(`Final technical backfill verification failed: ${finalCheck.body?.message || `HTTP ${finalCheck.statusCode}`}`);
  console.log("TEMP_TECHNICAL_BACKFILL_FINAL", JSON.stringify({ safeToExecute: finalCheck.body.safeToExecute, blockers: finalCheck.body.blockers, summary: finalCheck.body.summary }));
  const remaining = Number(finalCheck.body?.summary?.recordsWithChanges || 0);
  if (!finalCheck.body.safeToExecute || remaining !== 0) throw new Error(`Final technical backfill verification still has ${remaining} record(s) with changes or a safety blocker.`);

  return { safe: true, executed: true, outcomes, finalCheck: finalCheck.body };
}

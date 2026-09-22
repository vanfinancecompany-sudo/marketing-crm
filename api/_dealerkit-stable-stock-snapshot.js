import {
  DealerKitSnapshotIncompleteError,
  fetchDealerKitStockSnapshot,
} from "./_dealerkit-stock-adapter.js";

const DEFAULT_STABILITY_ATTEMPTS = 3;
const MAX_RATE_LIMIT_WAIT_MS = 15_000;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function rateLimitWaitMs(retryAfter, attempt) {
  const header = String(retryAfter ?? "").trim();
  if (header) {
    const seconds = Number(header);
    const milliseconds = Number.isFinite(seconds) && seconds >= 0
      ? seconds * 1000
      : Date.parse(header) - Date.now();
    if (Number.isFinite(milliseconds) && milliseconds >= 0) return Math.max(500, Math.ceil(milliseconds));
  }
  return Math.min(2_000, 750 * (2 ** (attempt - 1)));
}

function rateLimitFailure(error, attempts, reason) {
  const failure = new Error(`DealerKit stock list returned HTTP 429 Too Many Requests ${reason}.`);
  failure.status = 429;
  failure.retryAfter = error.retryAfter || null;
  failure.diagnostics = { stability: { attemptsUsed: attempts.length, attempts } };
  return failure;
}

function reportedTotals(snapshot) {
  const values = Array.isArray(snapshot?.diagnostics?.reportedTotals)
    ? snapshot.diagnostics.reportedTotals
    : [];
  return Array.from(new Set(values.map(Number).filter(Number.isFinite))).sort((a, b) => a - b);
}

function hasReportedTotalDrift(snapshot) {
  const totals = reportedTotals(snapshot);
  return snapshot?.diagnostics?.stableReportedTotal === false || totals.length > 1;
}

function retryableIncompleteSource(snapshot) {
  return hasReportedTotalDrift(snapshot)
    || Number(snapshot?.diagnostics?.failedPositions?.length || 0) > 0
    || Number(snapshot?.diagnostics?.invalidRecords?.length || 0) > 0;
}

function withStabilityDiagnostics(snapshot, attempts) {
  return {
    ...snapshot,
    diagnostics: {
      ...(snapshot?.diagnostics || {}),
      stability: {
        attemptsUsed: attempts.length,
        maxAttempts: attempts[attempts.length - 1]?.maxAttempts || attempts.length,
        attempts,
      },
    },
  };
}

export async function fetchStableDealerKitStockSnapshot({
  allowPartial = false,
  stabilityAttempts = DEFAULT_STABILITY_ATTEMPTS,
  sleep = wait,
  ...adapterOptions
} = {}) {
  const maxAttempts = Math.max(1, Math.min(5, Number(stabilityAttempts) || DEFAULT_STABILITY_ATTEMPTS));
  const attempts = [];
  let lastSnapshot = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let snapshot;
    try {
      snapshot = await fetchDealerKitStockSnapshot({
        ...adapterOptions,
        allowPartial: true,
      });
    } catch (error) {
      if (error?.status !== 429) throw error;
      const delayMs = rateLimitWaitMs(error.retryAfter, attempt);
      attempts.push({ attempt, maxAttempts, rateLimited: true, retryAfter: error.retryAfter || null, retryDelayMs: delayMs });
      if (attempt === maxAttempts) throw rateLimitFailure(error, attempts, `after ${attempts.length} bounded attempt(s)`);
      if (delayMs > MAX_RATE_LIMIT_WAIT_MS) throw rateLimitFailure(error, attempts, "because Retry-After exceeds the safe retry window");
      await sleep(delayMs);
      continue;
    }
    const totals = reportedTotals(snapshot);
    const totalDrift = hasReportedTotalDrift(snapshot);
    const retryableIncomplete = retryableIncompleteSource(snapshot);
    attempts.push({
      attempt,
      maxAttempts,
      complete: snapshot?.complete === true,
      totalDrift,
      retryableIncomplete,
      reportedTotals: totals,
      vehicleCount: Number(snapshot?.vehicleCount ?? snapshot?.vehicles?.length ?? 0),
      failedPositions: Number(snapshot?.diagnostics?.failedPositions?.length || 0),
      invalidRecords: Number(snapshot?.diagnostics?.invalidRecords?.length || 0),
    });
    lastSnapshot = snapshot;

    if (snapshot?.complete === true) {
      return withStabilityDiagnostics(snapshot, attempts);
    }

    // DealerKit intermittently returns HTTP 5xx for a bulk page or an individual
    // fallback position. Re-read the whole snapshot so a transient unreadable row
    // cannot manufacture a false "missing from DealerKit" classification. Hard
    // integrity failures such as duplicates still remain fail-closed without loops.
    if (!retryableIncomplete) break;
  }

  const decorated = withStabilityDiagnostics(lastSnapshot || {}, attempts);
  if (allowPartial) return decorated;

  throw new DealerKitSnapshotIncompleteError(
    `DealerKit stock snapshot remained incomplete or unstable after ${attempts.length} stability attempt(s).`,
    decorated.diagnostics || {},
  );
}

import {
  DealerKitSnapshotIncompleteError,
  fetchDealerKitStockSnapshot,
} from "./_dealerkit-stock-adapter.js";

if (
  process.env.VERCEL_ENV === "preview"
  && process.env.VERCEL_GIT_COMMIT_REF === "fix/dealerkit-af71tvy-reserved-snapshot"
) {
  await import("../scripts/diagnose-dealerkit-failed-positions.mjs");
}

const DEFAULT_STABILITY_ATTEMPTS = 3;

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
  ...adapterOptions
} = {}) {
  const maxAttempts = Math.max(1, Math.min(5, Number(stabilityAttempts) || DEFAULT_STABILITY_ATTEMPTS));
  const attempts = [];
  let lastSnapshot = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const snapshot = await fetchDealerKitStockSnapshot({
      ...adapterOptions,
      allowPartial: true,
    });
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

import { fetchDealerKitStockSnapshot } from "./_dealerkit-stock-adapter.js";

function nowIso() {
  return new Date().toISOString();
}

function positiveNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}

export default async function handler(request, response) {
  if (request.method !== "POST" && request.method !== "GET") {
    response.setHeader("Allow", "GET, POST");
    response.status(405).json({ ok: false, message: "Method not allowed." });
    return;
  }

  response.setHeader("Cache-Control", "no-store, max-age=0");

  try {
    const snapshot = await fetchDealerKitStockSnapshot({ allowPartial: true });
    const checkedAt = snapshot.checkedAt || nowIso();
    const succeeded = positiveNumber(snapshot.vehicleCount ?? snapshot.vehicles?.length, 0);
    const total = Math.max(succeeded, positiveNumber(snapshot.apiReportedTotal, succeeded));
    const failed = Math.max(0, total - succeeded);
    const complete = snapshot.complete === true;
    const stage = complete ? "complete" : "incomplete_source";
    const status = complete ? "complete" : "partial";

    const run = {
      id: "dealerkit-live",
      run_type: "dealerkit_api",
      status,
      stage,
      total_urls: total,
      processed_count: succeeded,
      success_count: succeeded,
      failure_count: failed,
      remaining_count: failed,
      started_at: checkedAt,
      updated_at: checkedAt,
      completed_at: checkedAt,
      last_error: complete ? null : "DealerKit returned an incomplete or unstable stock snapshot.",
      last_result: {
        providerId: "dealerkit",
        providerLabel: "DealerKit",
        sourceComplete: complete,
        apiReportedTotal: total,
        usableRecords: succeeded,
        diagnostics: snapshot.diagnostics || null,
      },
    };

    response.status(200).json({
      ok: true,
      providerId: "dealerkit",
      providerLabel: "DealerKit",
      complete,
      shouldContinue: false,
      runId: run.id,
      refresh: {
        providerId: "dealerkit",
        urlsFound: succeeded,
        rowsUpserted: 0,
        sourceComplete: complete,
        checkedAt,
      },
      processedCount: succeeded,
      successCount: succeeded,
      failureCount: failed,
      remainingCount: failed,
      totalRunProcessedCount: succeeded,
      totalRunSuccessCount: succeeded,
      totalRunFailureCount: failed,
      remainingThisRunCount: failed,
      remainingUncheckedOrMissingRegCount: failed,
      run,
      message: complete
        ? `DealerKit stock snapshot refreshed successfully with ${succeeded} vehicles.`
        : `DealerKit returned ${succeeded} of ${total} vehicles. The comparison may be shown for review, but destructive missing-stock actions must remain blocked until a complete snapshot is available.`,
    });
  } catch (error) {
    response.status(502).json({
      ok: false,
      providerId: "dealerkit",
      complete: false,
      shouldContinue: false,
      message: error?.message || "Could not refresh DealerKit stock.",
    });
  }
}

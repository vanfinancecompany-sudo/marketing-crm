import {
  getSupabaseServiceAdmin,
  normalizeRegistration,
} from "./_vansco-cache-utils.js";
import {
  fetchDealerKitStockDetail,
  fetchDealerKitStockSnapshot,
} from "./_dealerkit-stock-adapter.js";
import {
  dealerKitSourceStateMatchesIdentity,
  loadDealerKitSourceStateRegistration,
} from "./_dealerkit-source-state.js";

export const RESERVED_SOURCE_STATUSES = new Set([
  "reserved",
  "sold",
  "deposit_taken",
  "awaiting_delivery",
]);

function clean(value) {
  return String(value ?? "").trim();
}

function sourceStatus(vehicle = {}) {
  return clean(vehicle.status || vehicle.availability || vehicle.sourceStatus).toLowerCase();
}

function safetyStop(message) {
  return new Error(`Safety stop: ${message} Nothing was changed in Wix.`);
}

function isDetailNotFound(error) {
  return /DealerKit stock detail failed with HTTP 404\.?/i.test(clean(error?.message || error));
}

function stateAgeDays(row, now = new Date()) {
  const value = row?.last_seen_at || row?.updated_at || row?.source_updated_at;
  const time = value ? new Date(value).getTime() : NaN;
  if (!Number.isFinite(time)) return Infinity;
  return Math.max(0, (now.getTime() - time) / 86_400_000);
}

function verifiedResult({ registration, stockId, status, rawStatus, checkedAt, snapshot, evidence, previousStatus = "" }) {
  return {
    providerId: "dealerkit",
    providerLabel: "DealerKit",
    registration,
    supplierStockId: stockId,
    sourceStatus: status,
    rawSourceStatus: rawStatus || status,
    checkedAt: checkedAt || new Date().toISOString(),
    snapshotComplete: snapshot?.complete ?? null,
    evidence,
    previousSourceStatus: previousStatus || null,
  };
}

export async function verifyDealerKitReservedRegistration(
  registrationValue,
  {
    supplierStockId = "",
    environment = process.env,
    fetchImplementation = fetch,
    supabase = null,
    loadSnapshot = null,
    loadDetail = null,
    loadSourceState = null,
    now = new Date(),
    maxHistoricalAgeDays = 30,
  } = {},
) {
  const registration = normalizeRegistration(registrationValue);
  if (!registration) throw new Error("A valid vehicle registration is required.");

  const readSnapshot = loadSnapshot || ((options = {}) => fetchDealerKitStockSnapshot(options));
  const readDetail = loadDetail || ((stockId, options = {}) => fetchDealerKitStockDetail(stockId, options));
  const readSourceState = loadSourceState || (async (registrationToLoad) => {
    const database = supabase || getSupabaseServiceAdmin();
    return loadDealerKitSourceStateRegistration(database, registrationToLoad);
  });

  const requestedStockId = clean(supplierStockId);
  let snapshot = null;

  try {
    snapshot = await readSnapshot({
      environment,
      fetchImplementation,
      allowPartial: true,
    });

    const matches = (snapshot.vehicles || []).filter(
      (vehicle) => normalizeRegistration(vehicle?.registration) === registration,
    );

    if (matches.length > 1) {
      throw safetyStop(`DealerKit returned more than one stock record for ${registration}, so the vehicle could not be identified safely.`);
    }

    if (matches.length === 1) {
      const current = matches[0];
      const stockId = clean(current?.supplierStockId);
      if (!stockId) {
        throw safetyStop(`DealerKit found ${registration} but did not return a usable stock ID.`);
      }

      const currentStatus = sourceStatus(current);
      if (!RESERVED_SOURCE_STATUSES.has(currentStatus)) {
        throw safetyStop(`DealerKit currently shows ${registration} as ${clean(current?.sourceStatus) || currentStatus || "available/unknown"}, not Reserved/Sold/Deposit Taken/Awaiting Delivery.`);
      }

      const detail = await readDetail(stockId, {
        environment,
        fetchImplementation,
        specifications: false,
      });
      const detailRegistration = normalizeRegistration(detail?.registration);
      if (detailRegistration !== registration) {
        throw safetyStop(`DealerKit stock ID ${stockId} returned registration ${detailRegistration || "(blank)"} instead of ${registration}.`);
      }

      const detailStatus = sourceStatus(detail);
      if (!RESERVED_SOURCE_STATUSES.has(detailStatus)) {
        throw safetyStop(`DealerKit no longer shows ${registration} as Reserved/Sold/Deposit Taken/Awaiting Delivery.`);
      }

      return verifiedResult({
        registration,
        stockId,
        status: detailStatus,
        rawStatus: clean(detail?.sourceStatus) || detailStatus,
        checkedAt: detail?.checkedAt,
        snapshot,
        evidence: "current_registration_and_detail",
      });
    }

    if (!requestedStockId) {
      if (snapshot.complete === false) {
        throw safetyStop(`DealerKit could not safely verify ${registration}: it is absent from the readable rows, no previously known DealerKit stock identity was supplied, and the wider stock response is incomplete.`);
      }
      throw safetyStop(`DealerKit no longer shows ${registration} in the current stock feed and no previously known DealerKit stock identity was supplied.`);
    }

    const stateResult = await readSourceState(registration);
    if (stateResult?.available === false) {
      throw safetyStop(`DealerKit source history is not available for ${registration}, so a vanished vehicle cannot be verified safely.`);
    }

    const stateRow = stateResult?.row || null;
    if (!stateRow || !dealerKitSourceStateMatchesIdentity(stateRow, registration, requestedStockId)) {
      throw safetyStop(`The stored DealerKit identity for ${registration} does not match stock ID ${requestedStockId}.`);
    }

    const ageDays = stateAgeDays(stateRow, now);
    if (!Number.isFinite(ageDays) || ageDays > Math.max(1, Number(maxHistoricalAgeDays) || 30)) {
      throw safetyStop(`The last known DealerKit identity for ${registration} is too old to authorise a Wix change safely.`);
    }

    try {
      const detail = await readDetail(requestedStockId, {
        environment,
        fetchImplementation,
        specifications: false,
      });
      const detailRegistration = normalizeRegistration(detail?.registration);
      if (detailRegistration !== registration) {
        throw safetyStop(`DealerKit stock ID ${requestedStockId} returned registration ${detailRegistration || "(blank)"} instead of ${registration}.`);
      }

      const detailStatus = sourceStatus(detail);
      if (!RESERVED_SOURCE_STATUSES.has(detailStatus)) {
        throw safetyStop(`DealerKit currently resolves ${registration} from its known stock ID as ${clean(detail?.sourceStatus) || detailStatus || "available/unknown"}, so Wix removal is blocked.`);
      }

      return verifiedResult({
        registration,
        stockId: requestedStockId,
        status: detailStatus,
        rawStatus: clean(detail?.sourceStatus) || detailStatus,
        checkedAt: detail?.checkedAt,
        snapshot,
        evidence: "historical_identity_detail",
        previousStatus: clean(stateRow?.last_status),
      });
    } catch (error) {
      if (/^Safety stop:/i.test(clean(error?.message))) throw error;
      if (!isDetailNotFound(error)) throw error;

      return verifiedResult({
        registration,
        stockId: requestedStockId,
        status: "removed_from_dealerkit",
        rawStatus: "Removed from DealerKit API",
        checkedAt: new Date().toISOString(),
        snapshot,
        evidence: "historical_identity_detail_404",
        previousStatus: clean(stateRow?.last_status),
      });
    }
  } catch (error) {
    if (/^Safety stop:/i.test(clean(error?.message))) throw error;
    throw safetyStop(`DealerKit status could not be verified for ${registration}: ${clean(error?.message) || "DealerKit check failed."}`);
  }
}

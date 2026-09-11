import { normalizeRegistration } from "./_vansco-cache-utils.js";
import {
  fetchDealerKitStockDetail,
  fetchDealerKitStockSnapshot,
} from "./_dealerkit-stock-adapter.js";

const RESERVED_SOURCE_STATUSES = new Set(["reserved", "sold", "deposit_taken"]);

function clean(value) {
  return String(value ?? "").trim();
}

function safetyStop(message) {
  return new Error(`Safety stop: ${message} Nothing was changed in Wix.`);
}

export async function verifyDealerKitReservedRegistration(
  registrationValue,
  {
    supplierStockId = "",
    environment = process.env,
    fetchImplementation = fetch,
  } = {},
) {
  const registration = normalizeRegistration(registrationValue);
  if (!registration) throw new Error("A valid vehicle registration is required.");

  let stockId = clean(supplierStockId);
  let snapshot = null;

  try {
    if (!stockId) {
      snapshot = await fetchDealerKitStockSnapshot({
        environment,
        fetchImplementation,
        allowPartial: true,
      });

      const matches = (snapshot.vehicles || []).filter(
        (vehicle) => normalizeRegistration(vehicle?.registration) === registration,
      );

      if (matches.length > 1) {
        throw safetyStop(`DealerKit returned more than one stock record for ${registration}, so the reserved vehicle could not be identified safely.`);
      }

      if (!matches.length) {
        if (snapshot.complete === false) {
          throw safetyStop(`DealerKit could not safely verify ${registration} because the current DealerKit stock response is incomplete.`);
        }
        throw safetyStop(`DealerKit no longer shows ${registration} in the current stock feed.`);
      }

      stockId = clean(matches[0]?.supplierStockId);
      if (!stockId) {
        throw safetyStop(`DealerKit found ${registration} but did not return a usable stock ID.`);
      }
    }

    const detail = await fetchDealerKitStockDetail(stockId, {
      environment,
      fetchImplementation,
      specifications: false,
    });

    const detailRegistration = normalizeRegistration(detail?.registration);
    if (detailRegistration !== registration) {
      throw safetyStop(`DealerKit stock ID ${stockId} returned registration ${detailRegistration || "(blank)"} instead of ${registration}.`);
    }

    const sourceStatus = clean(detail?.status).toLowerCase();
    if (!RESERVED_SOURCE_STATUSES.has(sourceStatus)) {
      throw safetyStop(`DealerKit no longer shows ${registration} as Reserved/Sold/Deposit Taken.`);
    }

    return {
      providerId: "dealerkit",
      providerLabel: "DealerKit",
      registration,
      supplierStockId: stockId,
      sourceStatus,
      rawSourceStatus: clean(detail?.sourceStatus) || sourceStatus,
      checkedAt: detail?.checkedAt || new Date().toISOString(),
      snapshotComplete: snapshot?.complete ?? null,
    };
  } catch (error) {
    if (/^Safety stop:/i.test(clean(error?.message))) throw error;
    throw safetyStop(`DealerKit status could not be verified for ${registration}: ${clean(error?.message) || "DealerKit check failed."}`);
  }
}

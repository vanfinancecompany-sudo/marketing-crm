// Copy this file into the Wix site's Public files alongside aiAssistantPageAdapter.js.
// These are the live Van Finance Company CMS collection/field mappings supplied for the full vehicle pages.

export const FINANCE_VEHICLE_COLLECTION_ID = "VANFINANCEPAGES";
export const RENT2BUY_VEHICLE_COLLECTION_ID = "VANPAGES";

const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);

function vehicleIdentity(item = {}) {
  return {
    registration: clean(item.title, 20).toUpperCase() || null,
    stockId: clean(item._id, 100) || null,
    title: clean(item.titleText, 200) || null,
  };
}

export function buildCmsVehiclePageContext(collectionId, item = {}) {
  const collection = clean(collectionId, 100);
  const identity = vehicleIdentity(item);

  if (collection === FINANCE_VEHICLE_COLLECTION_ID) {
    return {
      pageType: "finance_vehicle",
      productContext: "finance",
      vehicle: {
        ...identity,
        pricing: {
          retailPriceVat: item.priceVat ?? null,
          financeMonthly: item.mthPrice ?? null,
        },
        applicationMode: "page_form",
      },
    };
  }

  if (collection === RENT2BUY_VEHICLE_COLLECTION_ID) {
    return {
      // The public API already has a locked Rent2Buy page context. Supplying vehicle identity/pricing makes
      // this instance vehicle-specific without creating a second conversational product path.
      pageType: "rent2buy_general",
      productContext: "rent2buy",
      vehicle: {
        ...identity,
        pricing: {
          initialRental: item.intialRentalCharge ?? null,
          monthlyRental: item.monthlyPayments ?? null,
        },
        termMonths: item.numberOfMonths ?? null,
        applicationMode: "generic",
      },
    };
  }

  throw new Error(`Unsupported AI Assistant vehicle collection: ${collection || "(blank)"}`);
}

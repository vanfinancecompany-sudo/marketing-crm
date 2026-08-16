// Copy this file into the Wix site's Public files alongside aiAssistantPageAdapter.js.
// These are the live Van Finance Company CMS collection/field mappings supplied for the full vehicle pages.

export const VEHICLE_DATASET_ID = "#dynamicDataset";
export const FINANCE_VEHICLE_COLLECTION_ID = "VANFINANCEPAGES";
export const RENT2BUY_VEHICLE_COLLECTION_ID = "VANPAGES";

const clean = (value, limit = 5000) => String(value ?? "").trim().slice(0, limit);

function vehicleIdentity(item = {}) {
  return {
    registration: clean(item.title, 20).toUpperCase() || null,
    stockId: clean(item._id, 100) || null,
    title: clean(item.titleText, 200) || null,
    year: clean(item.year, 80) || null,
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
        description: clean(item.vehicleDescriptionTextClick || item.descriptionLine, 7000) || null,
        highlights: clean(item.descriptionLine, 2000) || null,
        specification: clean(item.vehicleSpecificationText, 7000) || null,
        applyLink: clean(item.applyLink, 1000) || null,
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
      pageType: "rent2buy_general",
      productContext: "rent2buy",
      vehicle: {
        ...identity,
        description: clean(item.descriptionText, 7000) || null,
        highlights: clean(item.vehcleTickDescription, 7000) || null,
        specification: clean(item.specText, 7000) || null,
        applyLink: clean(item.applyLink, 1000) || null,
        pricing: {
          initialRental: item.intialRentalCharge ?? null,
          monthlyRental: item.monthlyPayments ?? null,
        },
        // Agreement length is deliberately not passed into customer chat. Rent2Buy term details
        // must come from approved Rent2Buy Business Knowledge rather than a stock-page field.
        applicationMode: "generic",
      },
    };
  }

  throw new Error(`Unsupported AI Assistant vehicle collection: ${collection || "(blank)"}`);
}

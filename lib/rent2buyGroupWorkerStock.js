import {
  mapFinanceVehicleRow, mapRentVehicleRow, normalizeRegistrationKey,
} from "../services/marketingVehicleContract.js";
import { buildFacebookGroupPostJob } from "../services/facebookGroupsAgent.js";
import { buildPostingCaption } from "../utils/creativeUtils.js";

export const FINANCE_MARKETING_STOCK_FIELDS = "id, title, picture, price, vat, salePrice, vanDescription, vanSpec, weblink, is_active";
export const RENT_MARKETING_STOCK_FIELDS = "id, created_at, registration, picture, monthly, week, initialRental, vanDescription, vanSpec, webLink, is_active";

export function selectWorkerAdvert(financeRows, rentRows, group, renewal, usedVehicleIds) {
  const rentByRegistration = new Map(rentRows.map(mapRentVehicleRow)
    .map(vehicle => [normalizeRegistrationKey(vehicle.registration || vehicle.reg), vehicle])
    .filter(([registration]) => registration));
  const adverts = financeRows.map(mapFinanceVehicleRow).flatMap(finance => {
    const rent = rentByRegistration.get(normalizeRegistrationKey(finance.registration || finance.reg || finance.title));
    if (!rent) return [];
    const vehicle = { ...finance, ...rent, id: finance.id, pipeline: "rent2buy", source: "rent2buy",
      rent2buyEligible: true, rent2buyData: rent };
    return [vehicle];
  }).map((vehicle, index) => buildFacebookGroupPostJob({ group, vehicle, productKey: "rent2buy", renewal,
    caption: buildPostingCaption(vehicle, { destination: "Rent2Buy Facebook", index }) }))
    .filter(job => job.caption && job.imageUrl && job.registration && job.vehicleId);
  const unused = adverts.find(job => !usedVehicleIds.includes(job.vehicleId));
  return { job: unused || adverts[0] || null, resetRotation: !unused && adverts.length > 0 };
}

export async function loadWorkerAdvert(db, group, renewal, usedVehicleIds) {
  const [finance, rent] = await Promise.all([
    db.from("facebook_adverts").select(FINANCE_MARKETING_STOCK_FIELDS).eq("is_active", true).limit(500),
    db.from("rent_vehicles").select(RENT_MARKETING_STOCK_FIELDS).eq("is_active", true).limit(500),
  ]);
  if (finance.error || rent.error) throw finance.error || rent.error;
  return selectWorkerAdvert(finance.data || [], rent.data || [], group, renewal, usedVehicleIds);
}

import assert from "node:assert/strict";
import test from "node:test";
import {
  GOOGLE_VEHICLE_ADS_STORE_CODES,
  buildGoogleVehicleAdsRows,
  buildGoogleVehicleAdsTsv,
  googleVehicleAdsEligibility,
  isGoogleVehicleAdsTargetVehicle,
} from "../lib/googleVehicleAdsFeed.js";

function baseVehicle(overrides = {}) {
  return {
    vehicleKey: "stock-1",
    registration: "HV25FCG",
    make: "Ford",
    model: "Ranger",
    title: "Ford Ranger EcoBlue Wildtrak Pickup Double Cab Diesel Auto 4WD",
    year: "2025",
    price: "32495",
    mileage: "12000",
    mileageUnit: "MI",
    vehicleUrl: "https://www.vansco.co.uk/vehicle-details/used-ford-ranger-for-sale-vansco-new-forest-u12345/",
    imageUrl: "https://cdn.dealerkit.uk/ranger.jpg",
    description: "Ford Ranger Wildtrak pickup. Vansco New Forest.",
    availability: "AVAILABLE",
    stateOfVehicle: "USED",
    bodyStyle: "Pickup",
    branchKey: "newForest",
    branchConflict: false,
    ...overrides,
  };
}

test("uses the exact Merchant Center store codes configured for Vansco", () => {
  assert.deepEqual(GOOGLE_VEHICLE_ADS_STORE_CODES, {
    vansco333: "VANSCO-333",
    southamptonAirport: "VANSCO-AIRPORT",
    newForest: "VANSCO-NEWFOREST",
    flexibuyCadnam: "FLEXIBUY-CADNAM",
  });
});

test("targets Vansco commercial stock and excludes passenger cars", () => {
  assert.equal(isGoogleVehicleAdsTargetVehicle(baseVehicle()), true);
  assert.equal(isGoogleVehicleAdsTargetVehicle(baseVehicle({
    model: "Transit",
    title: "Ford Transit 350 L3 H3 Panel Van",
    bodyStyle: "Panel Van",
  })), true);
  assert.equal(isGoogleVehicleAdsTargetVehicle(baseVehicle({
    make: "BMW",
    model: "3 Series",
    title: "BMW 3 Series 320d",
    bodyStyle: "Saloon",
  })), false);
});

test("requires a resolved branch and complete Google vehicle fields", () => {
  assert.equal(googleVehicleAdsEligibility(baseVehicle()).eligible, true);

  const unresolved = googleVehicleAdsEligibility(baseVehicle({ branchKey: "" }));
  assert.equal(unresolved.eligible, false);
  assert.equal(unresolved.reason, "missing_required_fields");
  assert.ok(unresolved.missing.includes("store_code"));

  const missingRegistration = googleVehicleAdsEligibility(baseVehicle({ registration: "" }));
  assert.equal(missingRegistration.eligible, false);
  assert.ok(missingRegistration.missing.includes("id"));
});

test("formats an in-stock UK vehicle offer for Merchant Center", () => {
  const { rows } = buildGoogleVehicleAdsRows([baseVehicle()], { mode: "pilot" });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    id: "HV25FCG",
    title: "2025 Ford Ranger EcoBlue Wildtrak Pickup Double Cab Diesel Auto 4WD",
    description: "Ford Ranger Wildtrak pickup. Vansco New Forest.",
    link: "https://www.vansco.co.uk/vehicle-details/used-ford-ranger-for-sale-vansco-new-forest-u12345/",
    image_link: "https://cdn.dealerkit.uk/ranger.jpg",
    availability: "in_stock",
    price: "32495.00 GBP",
    condition: "used",
    brand: "Ford",
    model: "Ranger",
    year: "2025",
    mileage: "12000 miles",
    VIN: "",
    body_style: "truck",
    store_code: "VANSCO-NEWFOREST",
    google_product_category: "916",
  });
});

test("pilot feed is bounded and TSV-safe", () => {
  const vehicles = Array.from({ length: 20 }, (_, index) => baseVehicle({
    vehicleKey: `stock-${index}`,
    registration: `AB12CD${String(index).padStart(2, "0")}`,
    description: "Line one\nLine two\twith tab",
  }));

  const feed = buildGoogleVehicleAdsTsv(vehicles, { mode: "pilot" });
  assert.equal(feed.rows.length, 12);
  assert.ok(feed.tsv.startsWith("id\ttitle\tdescription\tlink\timage_link\tavailability\tprice"));
  assert.equal(feed.tsv.includes("Line one\nLine two"), false);
  assert.equal(feed.tsv.includes("\twith tab"), false);
});

test("full feed includes Vansco vans and pickups while excluding passenger cars", () => {
  const vehicles = [
    baseVehicle({ registration: "HV25FCG" }),
    baseVehicle({
      registration: "CD24XYZ",
      vehicleKey: "stock-2",
      model: "Transit",
      title: "Ford Transit Panel Van",
      bodyStyle: "Panel Van",
    }),
    baseVehicle({
      registration: "AB24XYZ",
      vehicleKey: "stock-3",
      make: "BMW",
      model: "3 Series",
      title: "BMW 3 Series 320d",
      bodyStyle: "Saloon",
    }),
  ];

  const feed = buildGoogleVehicleAdsRows(vehicles, { mode: "full" });
  assert.equal(feed.rows.length, 2);
  assert.equal(feed.rows.some((row) => row.body_style === "full_size_van"), true);
  assert.equal(feed.skipped.some((item) => item.reason === "not_vansco_commercial_stock"), true);
});

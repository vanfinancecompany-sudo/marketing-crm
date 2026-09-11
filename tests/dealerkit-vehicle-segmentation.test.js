import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyDealerKitVehicle,
  dealerKitVehicleBelongsToPipeline,
  summariseDealerKitSegments,
} from "../lib/dealerKitVehicleSegmentation.js";

test("DealerKit segmentation keeps genuine cars separate from commercial vehicles", () => {
  const car = { vehicleType: "Car", bodyType: "Hatchback", title: "Ford Focus" };
  const transit = { vehicleType: "LCV", bodyType: "Panel Van", title: "Ford Transit" };
  const berlingo = { bodyType: "Panel Van", title: "Citroen Berlingo" };
  const pickup = { vehicleType: "Car", bodyType: "Double Cab Pickup", title: "Mitsubishi L200" };

  assert.equal(classifyDealerKitVehicle(car).segment, "car");
  for (const vehicle of [transit, berlingo, pickup]) {
    assert.equal(classifyDealerKitVehicle(vehicle).segment, "commercial");
    assert.equal(dealerKitVehicleBelongsToPipeline(vehicle, "cars"), false);
    assert.equal(dealerKitVehicleBelongsToPipeline(vehicle, "finance"), true);
    assert.equal(dealerKitVehicleBelongsToPipeline(vehicle, "rent2buy"), true);
  }
});

test("unclassified DealerKit records are held out of every product lane", () => {
  const unknown = { title: "Unmapped vehicle record" };
  assert.equal(classifyDealerKitVehicle(unknown).segment, "unknown");
  assert.equal(dealerKitVehicleBelongsToPipeline(unknown, "cars"), false);
  assert.equal(dealerKitVehicleBelongsToPipeline(unknown, "finance"), false);
  assert.deepEqual(summariseDealerKitSegments([
    unknown,
    { vehicleType: "Car", bodyType: "SUV" },
    { vehicleType: "LCV", bodyType: "Panel Van" },
  ]), { commercial: 1, car: 1, unknown: 1 });
});

test("known commercial model fallback prevents vans leaking into Cars", () => {
  for (const title of ["Ford Transit", "Citroen Berlingo", "Mitsubishi L200", "Peugeot Partner"]) {
    const result = classifyDealerKitVehicle({ title });
    assert.equal(result.segment, "commercial", title);
    assert.equal(result.confidence, "fallback", title);
  }
});

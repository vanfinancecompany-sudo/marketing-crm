import test from "node:test";
import assert from "node:assert/strict";
import { googleVehicleStockRisk, makeMerchantAction, confirmMerchantAction, merchantPending } from "../lib/vanscoGoogleVehicleAdsSafety.js";

const feedIds = new Set(["STOCK-1", "STOCK-2"]);

test("a matching DealerKit sold status is critical even when the ad feed still contains the item", () => {
  assert.equal(googleVehicleStockRisk({vehicleId:"stock-1",stock:{last_status:"sold"},feedIds}),"sold");
});
test("reserved stock is flagged but not incorrectly called sold", () => {
  assert.equal(googleVehicleStockRisk({vehicleId:"STOCK-1",stock:{last_status:"reserved"},feedIds}),"reserved");
  assert.equal(googleVehicleStockRisk({vehicleId:"STOCK-1",stock:{last_status:"awaiting_delivery"},feedIds}),"reserved");
});
test("disappearing from the Google feed creates a warning but not false proof of sale", () => {
  assert.equal(googleVehicleStockRisk({vehicleId:"STOCK-9",stock:{last_status:"available"},feedIds}),"missing");
  assert.equal(googleVehicleStockRisk({vehicleId:"STOCK-9",stock:null,feedIds}),"missing");
});
test("available Google-stock item is clear, sold exclusion takes priority", () => {
  assert.equal(googleVehicleStockRisk({vehicleId:"stock-1",stock:{last_status:"available"},feedIds}),"");
  assert.equal(googleVehicleStockRisk({vehicleId:"stock-1",stock:{last_status:"available"},feedIds,blockedIds:["STOCK-1"]}),"sold");
});
test("Merchant Center confirmation stays outstanding until explicit operator acknowledgement", () => {
  const item = makeMerchantAction({id:"stock-1",registration:"AB12 CDE",title:"Transit",reason:"sold",now:"2026-10-12T18:10:00.000Z"});
  assert.equal(item.vehicleId,"STOCK-1");
  assert.equal(merchantPending([item]).length,1);
  assert.equal(item.registration,"AB12 CDE");
  const confirmed = confirmMerchantAction([item],item.id,"2026-10-12T19:00:00.000Z");
  assert.equal(merchantPending(confirmed).length,0);
  assert.equal(confirmed[0].confirmedAt,"2026-10-12T19:00:00.000Z");
  assert.throws(() => confirmMerchantAction(confirmed,item.id),/no longer pending/);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {checkRent2BuyLegacyPriceWrite} from "../api/_rent2buy-protected-price-write.mjs";

function dbWith({data=[],error=null}={}){
  return {from:table=>{
    assert.equal(table,"dealerkit_rent2buy_special_deals");
    return {select:fields=>{
      assert.match(fields,/status/);
      return {eq:(field,registration)=>{
        assert.equal(field,"registration");
        assert.match(registration,/^[A-Z]{2}[0-9]{2}[A-Z]{3}$/);
        return {limit:async n=>{
          assert.equal(n,2);
          return {data,error};
        }};
      }};
    }};
  }};
}

test("all four legacy manual Wix specials are protected even when the new table does not exist",async()=>{
 for(const registration of ["BT25LVK","FV74 BBJ","FV74BEO","BJ74HTL"]){
  const result=await checkRent2BuyLegacyPriceWrite(registration,{
    getDb:()=>{throw Error("should not query DB for legacy holds");},
  });
  assert.equal(result.permitted,false);
  assert.equal(result.code,"confirmed_manual_special_hold");
 }
});

test("any saved future special, including draft or inactive, needs an audited pricing decision",async()=>{
 for(const status of ["draft","active","inactive"]){
  const result=await checkRent2BuyLegacyPriceWrite("ZZ25 XYZ",{
    db:dbWith({data:[{id:"special-123",registration:"ZZ25XYZ",status,revision:2}]}),
  });
  assert.equal(result.permitted,false);
  assert.equal(result.code,"special_deal_requires_audited_resolution");
 }
});

test("new Rent2Buy price write is allowed only after verifying no special record exists",async()=>{
 const result=await checkRent2BuyLegacyPriceWrite("ZZ25 XYZ",{db:dbWith({data:[]})});
 assert.deepEqual(result,{permitted:true,code:"no_special_deal_override"});
});

test("missing table, error, duplicate rows and invalid registration all fail closed",async()=>{
 for(const option of [
   {db:dbWith({data:null,error:{code:"PGRST205"}})},
   {db:dbWith({data:null})},
   {db:dbWith({data:[{id:"one"},{id:"two"}]})},
   {getDb:()=>{throw Error("database offline");}},
 ]){
  const result=await checkRent2BuyLegacyPriceWrite("ZZ25XYZ",option);
  assert.equal(result.permitted,false);
 }
 const invalid=await checkRent2BuyLegacyPriceWrite("NOTREG",{getDb:()=>{throw Error("unexpected lookup");}});
 assert.equal(invalid.code,"invalid_registration");
});

test("the two legacy Wix write endpoints invoke guard before first Wix mutation",()=>{
 const direct=fs.readFileSync(new URL("../api/dealerkit-published-price.js",import.meta.url),"utf8");
 const controlled=fs.readFileSync(new URL("../api/dealerkit-controlled-publish.js",import.meta.url),"utf8");
 assert.match(direct,/pipeline === "rent2buy" && action === "update"/);
 assert.match(direct,/await checkRent2BuyLegacyPriceWrite\(body.registration\)/);
 assert.ok(direct.indexOf("await checkRent2BuyLegacyPriceWrite(body.registration)")<
           direct.indexOf("await freshDealerKitVehicle(body, pipeline)"));
 assert.match(controlled,/targets\.some\(\(target\) => target.product === "rent2buy"\)/);
 assert.ok(controlled.indexOf("await checkRent2BuyLegacyPriceWrite(registration)")<
           controlled.indexOf("await reconcileControlledTargets(state, registration, targets)"));
 assert.match(controlled,/ControlledPublishError\(409, priceWriteGate.message/);
});

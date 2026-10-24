import test from "node:test";import assert from "node:assert/strict";import fs from "node:fs";
import {currentActiveRent2BuyManualSpecial} from "../lib/rent2BuyCurrentManualSpecial.mjs";
test("active manual special reads server-owned table only when enabled",async()=>{
 let reads=0;
 const db=()=>({from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>{reads++;return {data:{registration:"AB12CDE",enabled:true},error:null}}})})})})});
 assert.equal(await currentActiveRent2BuyManualSpecial("AB12CDE",{environment:{},supabase:db}),null);
 assert.equal(reads,0);
 assert.equal((await currentActiveRent2BuyManualSpecial("AB12CDE",{environment:{RENT2BUY_MANUAL_SPECIALS_ENABLED:"true"},supabase:db})).registration,"AB12CDE");
 assert.equal(reads,1);
});
test("Felix quote service and both Wix price-writing paths guard published manual offers",()=>{
 for(const file of ["../api/_rent2buy-quote-source.js","../api/dealerkit-published-price.js","../api/dealerkit-controlled-publish.js"])
  assert.match(fs.readFileSync(new URL(file,import.meta.url),"utf8"),/currentActiveRent2BuyManualSpecial/);
});

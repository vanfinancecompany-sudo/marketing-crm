import test from "node:test";import assert from "node:assert/strict";
import {manualSpecialSourceRevision} from "../lib/rent2BuyManualSpecialRevision.mjs";
test("current manual deal public revision matches server-side verification revision contract",()=>{
 const row={registration:"AB12CDE",source_stock_id:"stock-abc",monthly_ex_vat:"515",initial_ex_vat:"2000",term_months:36,updated_at:"2026-10-24T12:10:00.000Z"};
 const v=manualSpecialSourceRevision(row);
 assert.match(v,/^[0-9a-f]{40}$/);
 assert.equal(manualSpecialSourceRevision({...row}),v);
 for(const modified of [{monthly_ex_vat:"520"},{initial_ex_vat:"2100"},{term_months:48},{updated_at:"2026-10-24T12:11:00.000Z"}])
  assert.notEqual(manualSpecialSourceRevision({...row,...modified}),v);
});

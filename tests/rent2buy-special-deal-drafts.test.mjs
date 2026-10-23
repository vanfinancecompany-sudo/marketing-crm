import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  normaliseRent2BuySpecialDraft, specialDealToClient, allowedSpecialDraftWrite,
  canonicalRent2BuyRegistration,
} from "../lib/rent2BuySpecialDealPolicy.mjs";

const source={registration:"FV74 BBJ",supplierStockId:"stock-009",retailPrice:14695,year:2024,mileage:46251,vatStatus:"plus_vat",sourceUpdatedAt:"2026-10-23T12:00:00Z"};
const input={
  registration:"FV74 BBJ",confirmRegistration:"FV74BBJ",supplierStockId:"stock-009",
  monthlyExVat:545,initialExVat:2000,termMonths:36,milesPerMonth:1000,
  reason:"Approved sales manager special for October",expiresAt:"2050-12-31"
};

test("draft normalisation is independent of dealerkit review settings",()=>{
  const row=normaliseRent2BuySpecialDraft(input,source);
  assert.equal(row.registration,"FV74BBJ");
  assert.equal(row.supplier_stock_id,"stock-009");
  assert.equal(row.status,"draft");
  assert.equal(row.monthly_ex_vat,545);
  assert.equal(row.initial_ex_vat,2000);
  assert.equal(row.term_months,36);
  assert.equal(row.miles_per_month,1000);
  assert.equal(row.source_retail_amount,14695);
  assert.equal(row.source_vat_status,"plus_vat");
});

test("special deal drafts must be explicit and verified against live source",()=>{
  assert.throws(()=>normaliseRent2BuySpecialDraft({...input,confirmRegistration:"BT25LVK"},source),/exact registration/);
  assert.throws(()=>normaliseRent2BuySpecialDraft({...input,supplierStockId:"another-id"},source),/does not match/);
  assert.throws(()=>normaliseRent2BuySpecialDraft(input,{...source,registration:"BT25 LVK"}),/does not match/);
  assert.throws(()=>normaliseRent2BuySpecialDraft({...input,termMonths:40},source),/term is not/);
  assert.throws(()=>normaliseRent2BuySpecialDraft({...input,milesPerMonth:4500},source),/mileage allowance/);
  assert.throws(()=>normaliseRent2BuySpecialDraft({...input,initialExVat:999},source),/minimum/);
  assert.throws(()=>normaliseRent2BuySpecialDraft({...input,reason:"deal"},source),/reason/);
  assert.throws(()=>normaliseRent2BuySpecialDraft({...input,termMonths:48},{...source,mileage:80000}),/not eligible/);
  assert.throws(()=>normaliseRent2BuySpecialDraft({...input,termMonths:36,milesPerMonth:4000},source),/not eligible/);
});

test("protected specials remain pending until completed record is approved",()=>{
  assert.equal(canonicalRent2BuyRegistration("FV74 BBJ"),"FV74BBJ");
  const protectedRow=specialDealToClient({},"FV74 BBJ");
  assert.equal(protectedRow.protectedLegacy,true);
  assert.equal(protectedRow.legacyMonthlyExVat,545);
  assert.equal(protectedRow.persisted,false);
  assert.equal(protectedRow.termMonths,null);
  assert.equal(protectedRow.milesPerMonth,null);
});

test("draft saving requires explicit server-only unlock",()=>{
  assert.equal(allowedSpecialDraftWrite({}),false);
  assert.equal(allowedSpecialDraftWrite({RENT2BUY_SPECIAL_DRAFTS_ENABLED:"false"}),false);
  assert.equal(allowedSpecialDraftWrite({RENT2BUY_SPECIAL_DRAFTS_ENABLED:"true"}),false);
  assert.equal(allowedSpecialDraftWrite({
    RENT2BUY_SPECIAL_DRAFTS_ENABLED:"true",
    RENT2BUY_SPECIAL_PRICE_WRITE_GUARD_ENABLED:"true"
  }),true);
  const api=fs.readFileSync(new URL("../api/dealerkit-rent2buy-special-deal.js",import.meta.url),"utf8");
  assert.match(api,/if\(request.method==="PUT" && !allowedSpecialDraftWrite\(\)\)/);
  assert.match(api,/body.action!=="save_draft"/);
  assert.match(api,/expectedRevision/);
  assert.doesNotMatch(api, /patchFields\(|wixRequest\(|buildRent2BuyWixPricePatch\(/);
});

test("compact editor only mounts for Rent2Buy and remains collapsed by default",()=>{
  const workspace=fs.readFileSync(new URL("../utils/dealerKitReviewWorkspace.js",import.meta.url),"utf8");
  const editor=fs.readFileSync(new URL("../utils/rent2BuySpecialDealEditor.js",import.meta.url),"utf8");
  assert.match(workspace,/if \(product === "rent2buy"\) body\.appendChild\(renderRent2BuySpecialDealEditor\(vehicle\)\)/);
  assert.match(editor,/document\.createElement\("details"\)/);
  assert.match(editor,/action.disabled=true/);
  assert.doesNotMatch(editor,/\.open\s*=\s*true/);
});

test("review-only DDL is private, RLS enabled, and never auto-applied by deploy",()=>{
  const migration=fs.readFileSync(new URL("../docs/sql/rent2buy_special_deals_REVIEW_ONLY.sql",import.meta.url),"utf8");
  assert.match(migration,/enable row level security/);
  assert.match(migration,/revoke all on public\.dealerkit_rent2buy_special_deals from anon, authenticated/);
  assert.match(migration,/grant select, insert, update on public\.dealerkit_rent2buy_special_deals to service_role/);
  assert.match(migration,/dealerkit_rent2buy_special_deal_audit/);
});

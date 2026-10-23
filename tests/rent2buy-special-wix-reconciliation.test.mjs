import test from "node:test";
import assert from "node:assert/strict";
import {inspectRent2BuyWixSpecial} from "../lib/rent2BuySpecialWixReconciliation.mjs";

// Read-only source examples from live Van Finance Wix CMS, 23 October 2026.
// They are comparison fixtures, NOT instructions to change any Wix field.
const records={
  BT25LVK:{list:{title:"BT25LVK",mth:"£595 PM",initialRental2250Vat:"INITIAL RENTAL £2000 +VAT",weekly:"x48"},
           page:{title:"BT25LVK",monthlyPayments:"£595 +Vat (£714 INC VAT)",intialRentalCharge:"£2000 +Vat (£2400 INC VAT)",numberOfMonths:"48X MONTHLY PAYMENTS"},term:48},
  FV74BBJ:{list:{title:"FV74BBJ",mth:"£545 PM",initialRental2250Vat:"INITIAL RENTAL £2000 +VAT",weekly:"x48"},
           page:{title:"FV74BBJ",monthlyPayments:"£545 +Vat (£654 INC VAT)",intialRentalCharge:"£2000 +Vat (£2400 INC VAT)",numberOfMonths:"36X MONTHLY PAYMENTS"},term:36},
  FV74BEO:{list:{title:"FV74BEO",mth:"£595 PM",initialRental2250Vat:"INITIAL RENTAL £2000 +VAT",weekly:"x48"},
           page:{title:"FV74BEO",monthlyPayments:"£595 +Vat (£714 INC VAT)",intialRentalCharge:"£2000 +Vat (£2400 INC VAT)",numberOfMonths:"48X MONTHLY PAYMENTS"},term:48},
  BJ74HTL:{list:{title:"BJ74HTL",mth:"£595 PM",initialRental2250Vat:"INITIAL RENTAL £2000 +VAT",weekly:"x48"},
           page:{title:"BJ74HTL",monthlyPayments:"£693 +Vat (£832 INC VAT)",intialRentalCharge:"£2079 +Vat (£2495 INC VAT)",numberOfMonths:"48X MONTHLY PAYMENTS"},term:48},
};
function inspect(id,overrides={}){
 const r=records[id];
 return inspectRent2BuyWixSpecial({registration:id,listing:r.list,detail:r.page,
    reviewedTermMonths:r.term,...overrides});
}
test("each existing Wix special remains blocked without confirmed agreed mileage and terms",()=>{
 for(const id of Object.keys(records)){
   const x=inspect(id);
   assert.equal(x.ready,false);
   assert.ok(x.problems.includes("approved_special_terms_missing"),id);
   assert.ok(x.values.legacySpecialMonthly>0);
 }
});
test("BJ74 HTL is 48 months but Wix listing/detail differ on two prices",()=>{
 const x=inspect("BJ74HTL");
 assert.equal(x.values.listingPayments,48);
 assert.equal(x.values.detailPayments,48);
 assert.equal(x.values.listingMonthly,595);
 assert.equal(x.values.detailMonthly,693);
 assert.equal(x.values.listingInitial,2000);
 assert.equal(x.values.detailInitial,2079);
 assert.ok(x.problems.includes("monthly_price_disagreement"));
 assert.ok(x.problems.includes("initial_rental_disagreement"));
 assert.ok(x.problems.includes("manual_special_price_not_reconciled"));
 assert.equal(x.problems.includes("payment_count_disagreement"),false);
});
test("FV74 BBJ has 36 CRM/detail months vs 48 listing payments",()=>{
 const x=inspect("FV74BBJ");
 assert.equal(x.values.listingPayments,48);
 assert.equal(x.values.detailPayments,36);
 assert.ok(x.problems.includes("payment_count_disagreement"));
 assert.ok(x.problems.includes("reviewed_term_disagreement"));
 assert.equal(x.values.listingMonthly,545);
 assert.equal(x.values.detailMonthly,545);
});
test("BT25 LVK/BEO display matches but still require signed-off commercial agreement",()=>{
 for(const id of ["BT25LVK","FV74BEO"]){
  const x=inspect(id);
  assert.deepEqual(x.problems,["approved_special_terms_missing"]);
  const approved={
    registration:id,monthlyExVat:595,initialExVat:2000,termMonths:48,milesPerMonth:1000,
  };
  // This TEST FIXTURE is not an assertion that 1000 miles is commercially approved.
  assert.equal(inspect(id,{approvedAgreement:approved}).ready,true);
 }
});
test("missing or wrong Wix records never permit a special-deal migration",()=>{
 const x=inspectRent2BuyWixSpecial({registration:"BT25LVK",listing:{title:"SOMETHINGELSE"},detail:null});
 assert.equal(x.ready,false);
 assert.ok(x.problems.includes("missing_or_wrong_listing"));
 assert.ok(x.problems.includes("missing_or_wrong_vehicle_detail"));
});
test("an unexpected term or initial rental cannot be silently approved",()=>{
 const wrong={registration:"FV74BEO",termMonths:40,milesPerMonth:1000,monthlyExVat:595,initialExVat:2000};
 assert.ok(inspect("FV74BEO",{approvedAgreement:wrong}).problems.includes("approved_special_terms_missing"));
 const low={...wrong,termMonths:48,initialExVat:900};
 assert.ok(inspect("FV74BEO",{approvedAgreement:low}).problems.includes("approved_special_terms_missing"));
});

import test from "node:test";
import assert from "node:assert/strict";
import {inspectRent2BuyWixSpecial} from "../lib/rent2BuySpecialWixReconciliation.mjs";

const records={
  BT25LVK:{list:{title:"BT25LVK",mth:"£595 PM",initialRental2250Vat:"INITIAL RENTAL £2000 +VAT",weekly:"x48"},
           page:{title:"BT25LVK",monthlyPayments:"£595 +Vat (£714 INC VAT)",intialRentalCharge:"£2000 +Vat (£2400 INC VAT)",numberOfMonths:"48X MONTHLY PAYMENTS"}},
  FV74BBJ:{list:{title:"FV74BBJ",mth:"£545 PM",initialRental2250Vat:"INITIAL RENTAL £2000 +VAT",weekly:"x48"},
           page:{title:"FV74BBJ",monthlyPayments:"£545 +Vat (£654 INC VAT)",intialRentalCharge:"£2000 +Vat (£2400 INC VAT)",numberOfMonths:"36X MONTHLY PAYMENTS"}},
  FV74BEO:{list:{title:"FV74BEO",mth:"£595 PM",initialRental2250Vat:"INITIAL RENTAL £2000 +VAT",weekly:"x48"},
           page:{title:"FV74BEO",monthlyPayments:"£595 +Vat (£714 INC VAT)",intialRentalCharge:"£2000 +Vat (£2400 INC VAT)",numberOfMonths:"48X MONTHLY PAYMENTS"}},
  BJ74HTL:{list:{title:"BJ74HTL",mth:"£595 PM",initialRental2250Vat:"INITIAL RENTAL £2000 +VAT",weekly:"x48"},
           page:{title:"BJ74HTL",monthlyPayments:"£693 +Vat (£832 INC VAT)",intialRentalCharge:"£2079 +Vat (£2495 INC VAT)",numberOfMonths:"48X MONTHLY PAYMENTS"}},
};
const inspect=id=>inspectRent2BuyWixSpecial({registration:id,listing:records[id].list,detail:records[id].page});

test("BT25 LVK and FV74 BEO already match their fixed legacy deal",()=>{
  for(const id of ["BT25LVK","FV74BEO"]){
    const x=inspect(id);
    assert.equal(x.ready,true);
    assert.equal(x.customisable,false);
    assert.equal(x.contractualMileageRequired,false);
    assert.equal(x.values.expectedInitial,2000);
    assert.equal(x.values.expectedPayments,48);
  }
});

test("FV74 BBJ is confirmed fixed at 48 months; its 36-month detail field is wrong",()=>{
  const x=inspect("FV74BBJ");
  assert.equal(x.values.expectedMonthly,545);
  assert.equal(x.values.expectedInitial,2000);
  assert.equal(x.values.expectedPayments,48);
  assert.equal(x.values.listingPayments,48);
  assert.equal(x.values.detailPayments,36);
  assert.equal(x.ready,false);
  assert.ok(x.problems.includes("detail_term_not_fixed_special"));
});

test("BJ74 HTL is fixed £595 / £2,000 / 48; £693 / £2,079 detail is wrong",()=>{
  const x=inspect("BJ74HTL");
  assert.equal(x.values.expectedMonthly,595);
  assert.equal(x.values.expectedInitial,2000);
  assert.equal(x.values.expectedPayments,48);
  assert.equal(x.values.detailMonthly,693);
  assert.equal(x.values.detailInitial,2079);
  assert.equal(x.ready,false);
  assert.ok(x.problems.includes("detail_monthly_not_fixed_special"));
  assert.ok(x.problems.includes("detail_initial_not_fixed_special"));
});

test("fixed legacy specials require no contractual mileage and cannot be treated as matrix deals",()=>{
  for(const id of Object.keys(records)){
    const x=inspect(id);
    assert.equal(x.contractualMileageRequired,false);
    assert.equal(x.customisable,false);
  }
});

test("unknown vehicle is not treated as a fixed legacy special",()=>{
  const x=inspectRent2BuyWixSpecial({registration:"ZZ25XYZ",listing:{},detail:{}});
  assert.equal(x.ready,false);
  assert.deepEqual(x.problems,["not_a_fixed_legacy_special"]);
});

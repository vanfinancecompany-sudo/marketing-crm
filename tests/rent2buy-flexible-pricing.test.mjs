import test from "node:test";
import assert from "node:assert/strict";
import {
  RENT2BUY_MATRIX_TERMS,
  availableRent2BuyTerms,
  rent2BuyInitialRentalLadder,
  rent2BuyMaximumTerm,
  quoteRent2BuyMatrix,
} from "../lib/rent2BuyFlexiblePricing.mjs";

const base = { retailPrice: 12000, registrationYear: 2024, vehicleMileage: 25000, currentYear: 2026 };
const quote = (data = {}) => quoteRent2BuyMatrix({ ...base, ...data });

test("price matrix includes six-month steps from 12 through 48 months", () => {
  assert.deepEqual(RENT2BUY_MATRIX_TERMS, [12, 18, 24, 30, 36, 42, 48]);
  assert.deepEqual(availableRent2BuyTerms({ registrationYear: 2024, vehicleMileage: 25000, currentYear: 2026, milesPerMonth: 1000 }), RENT2BUY_MATRIX_TERMS);
});

test("PDF £12,000 van default: £400 / 48m / 1000mi, minimum £1750", () => {
  assert.deepEqual(rent2BuyInitialRentalLadder(12000), [1750, 2630, 3500, 4380]);
  const result = quote();
  assert.equal(result.status, "ok");
  assert.equal(result.pricingMode, "matrix");
  assert.equal(result.monthlyExVat, 400);
  assert.equal(result.monthlyIncVat, 480);
  assert.equal(result.initialExVat, 1750);
  assert.equal(result.initialIncVat, 2100);
  assert.equal(result.termMonths, 48);
  assert.equal(result.milesPerMonth, 1000);
});

test("PDF 36-month £12,000 matrix mileage bands", () => {
  const values = new Map([[1000,485],[1500,510],[2000,535],[2500,560],[3000,585],[3500,null],[4000,null]]);
  for (const [miles,monthly] of values) {
    const result = quote({ termMonths: 36, milesPerMonth: miles });
    if (monthly === null) assert.equal(result.status, "unavailable");
    else assert.equal(result.monthlyExVat, monthly, String(miles));
  }
});

test("PDF £12,000 36m / 2000mi with £3500 upfront is £465", () => {
  const result = quote({ termMonths: 36, milesPerMonth: 2000, initialRentalExVat: 3500 });
  assert.equal(result.monthlyExVat, 465);
});

test("PDF £12,000 van long-term matrix minimum across term bands", () => {
  const expected = [[12,1150],[18,820],[24,650],[30,550],[36,485],[42,440],[48,400]];
  for (const [term,monthly] of expected)
    assert.equal(quote({ termMonths:term }).monthlyExVat, monthly, String(term));
});

test("PDF live examples: Maxus, Ford and Nissan", () => {
  const maxus = quoteRent2BuyMatrix({ retailPrice:9995, registrationYear:2022, vehicleMileage:26600, currentYear:2026 });
  assert.equal(maxus.monthlyExVat, 320);
  assert.equal(maxus.initialExVat, 1460);
  const ford = quoteRent2BuyMatrix({ retailPrice:11495, registrationYear:2022, vehicleMileage:101000, currentYear:2026 });
  assert.equal(ford.monthlyExVat,460);
  assert.equal(ford.termMonths,36);
  assert.equal(ford.initialExVat,1680);
  const nissan = quoteRent2BuyMatrix({ retailPrice:14995, registrationYear:2024, vehicleMileage:46251, currentYear:2026 });
  assert.equal(nissan.monthlyExVat,525);
  assert.deepEqual(nissan.initialRentalOptionsExVat,[2190,3290,4380,5480]);
});

test("vehicle age and mileage restrict term before customer mileage cap", () => {
  assert.equal(rent2BuyMaximumTerm({registrationYear:2022,vehicleMileage:50000,currentYear:2026,milesPerMonth:1000}),48);
  assert.equal(rent2BuyMaximumTerm({registrationYear:2022,vehicleMileage:50001,currentYear:2026,milesPerMonth:1000}),36);
  assert.equal(rent2BuyMaximumTerm({registrationYear:2021,vehicleMileage:10000,currentYear:2026,milesPerMonth:1000}),36);
  assert.equal(rent2BuyMaximumTerm({registrationYear:2024,vehicleMileage:10000,currentYear:2026,milesPerMonth:2500}),36);
  assert.equal(rent2BuyMaximumTerm({registrationYear:2024,vehicleMileage:10000,currentYear:2026,milesPerMonth:3500}),30);
  assert.equal(rent2BuyMaximumTerm({registrationYear:2024,vehicleMileage:10000,currentYear:2026,milesPerMonth:4000}),24);
});

test("minimum initial rental is always at least £1000 + VAT", () => {
  const result=quote({retailPrice:5000});
  assert.equal(result.minimumInitialExVat,1000);
  assert.equal(result.initialIncVat,1200);
  assert.equal(quote({retailPrice:5000,initialRentalExVat:900}).status,"unavailable");
});

test("special deals apply only to their exact term, mileage and upfront configuration", () => {
  const deal={enabled:true,monthlyExVat:595,initialExVat:2140,termMonths:36,milesPerMonth:1000};
  const selected=quote({specialDeal:deal});
  assert.equal(selected.status,"ok");
  assert.equal(selected.pricingMode,"special");
  assert.equal(selected.monthlyExVat,595);
  assert.equal(selected.monthlyIncVat,714);
  assert.equal(selected.initialExVat,2140);
  assert.equal(selected.termMonths,36);
  const adjusted=quote({specialDeal:deal,termMonths:24,initialRentalExVat:1750});
  assert.equal(adjusted.pricingMode,"matrix");
  assert.equal(adjusted.monthlyExVat,650);
});

test("unapproved/invalid or absent special deals never override matrix prices", () => {
  assert.equal(quote({specialDeal:{enabled:false,monthlyExVat:1}}).pricingMode,"matrix");
  assert.equal(quote({specialDeal:{enabled:true,monthlyExVat:595,initialExVat:900,termMonths:36,milesPerMonth:1000}}).reason,"invalid_special_deal");
  assert.equal(quote({specialDeal:{enabled:true,monthlyExVat:595,initialExVat:2140,termMonths:99,milesPerMonth:1000}}).status,"unavailable");
});

test("fail closed for missing data, out-of-bounds terms and unselected upfront steps", () => {
  assert.equal(quote({retailPrice:null}).status,"unavailable");
  assert.equal(quote({vehicleMileage:undefined}).status,"unavailable");
  assert.equal(quote({registrationYear:null}).status,"unavailable");
  assert.equal(quote({termMonths:48,milesPerMonth:4000}).reason,"term_not_allowed");
  assert.equal(quote({milesPerMonth:4500}).status,"unavailable");
  assert.equal(quote({initialRentalExVat:1950}).reason,"initial_rental_not_on_matrix_ladder");
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { pendingRent2BuySpecialDeal, RENT2BUY_PENDING_SPECIAL_DEAL_IMPORTS } from "../lib/rent2BuyProtectedSpecialDeals.mjs";

test("the four current user-confirmed special deals are held from automatic Wix updates", () => {
  assert.deepEqual(RENT2BUY_PENDING_SPECIAL_DEAL_IMPORTS, {
    BT25LVK: {monthlyExVat:595,initialExVat:2000,termMonths:48},
    FV74BBJ: {monthlyExVat:545,initialExVat:2000,termMonths:48},
    FV74BEO: {monthlyExVat:595,initialExVat:2000,termMonths:48},
    BJ74HTL: {monthlyExVat:595,initialExVat:2000,termMonths:48},
  });
  for(const [reg,deal] of Object.entries(RENT2BUY_PENDING_SPECIAL_DEAL_IMPORTS)){
    const hold=pendingRent2BuySpecialDeal(reg);
    assert.equal(hold?.publisherMustHold,true);
    assert.equal(hold?.publishedMonthlyExVat,deal.monthlyExVat);
    assert.equal(hold?.initialExVat,2000);
    assert.equal(hold?.termMonths,48);
    assert.equal(hold?.milesPerMonth,null);
    assert.equal(hold?.customisable,false);
    assert.equal(hold?.overrideImported,false);
  }
  assert.equal(pendingRent2BuySpecialDeal("FV74 BBJ")?.publisherMustHold,true);
  assert.equal(pendingRent2BuySpecialDeal("NOTDEAL"),null);
});

test("controlled publisher produces zero target writes for pending manual specials", () => {
  const publisher=fs.readFileSync(new URL("../lib/dealerKitRent2BuyWixPlan.js", import.meta.url),"utf8");
  assert.match(publisher,/pendingRent2BuySpecialDeal\(registration\)/);
  assert.match(publisher,/if \(pendingSpecial\)\s*\{\s*return \{/);
  assert.match(publisher,/targets: \[\]/);
  assert.match(publisher,/canPublish: false, protectedSpecialDeal: pendingSpecial/);
  assert.match(publisher,/protected_special_deal_not_imported/);
});

test("existing non-Rent2Buy advertisements remain outside the manual-special hold", () => {
  const publisher=fs.readFileSync(new URL("../lib/dealerKitRent2BuyWixPlan.js", import.meta.url),"utf8");
  assert.match(publisher,/decision\.rent2buyEnabled \? pendingRent2BuySpecialDeal\(registration\) : null/);
});

test("Price Differences write endpoint blocks protected Rent2Buy deals before changing Wix", () => {
  const source=fs.readFileSync(new URL("../api/dealerkit-published-price.js", import.meta.url),"utf8");
  assert.match(source,/pendingRent2BuySpecialDeal\(body\.registration\)/);
  assert.match(source,/protectedDeal && action === "update"/);
  assert.match(source,/pendingRent2BuySpecialDeal\(vehicle\.registration\)/);
  assert.match(source,/preview\.protected_special_deal = protectedDeal/);
  assert.match(source,/approved manual special-deal price/);
  assert.match(source,/if \(pipeline === "rent2buy" && action === "update"/);
});

test("Price Differences UI replaces Update Wix price with a disabled protected badge", () => {
  const source=fs.readFileSync(new URL("../utils/vanscoWixPriceHelper.js",import.meta.url),"utf8");
  assert.match(source,/details\.pipeline === "rent2buy" \? pendingRent2BuySpecialDeal\(details\.registration\)/);
  assert.match(source,/if \(special\) \{/);
  assert.match(source,/disabled\.disabled = true/);
  assert.match(source,/disabled\.textContent = "Special deal protected"/);
  assert.match(source,/data-rent2buy-price-protection/);
});

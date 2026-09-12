import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  rent2BuyRentalVatPolicy,
  resolveVanFinanceVatText,
} from "../lib/dealerKitVatPolicy.js";
import {
  transformRent2BuyVatSource,
  transformVanFinanceVatSource,
} from "../scripts/dealerkit-vat-publishing-transform.mjs";

const root = new URL("../", import.meta.url);

test("Van Finance keeps verified VAT displays and accepts explicit no-extra-VAT evidence", () => {
  assert.equal(resolveVanFinanceVatText({ vatStatus: "plus_vat" }), "+VAT");
  assert.equal(resolveVanFinanceVatText({ vatStatus: "no_vat" }), "N/A");

  // FP66PXU reaches the live controlled-publish route as DealerKit inc_vat.
  // That means the advertised retail figure is VAT-inclusive, so Wix must not
  // add +VAT on top. The existing verified no-extra-VAT display is N/A.
  assert.equal(resolveVanFinanceVatText({ vatStatus: "inc_vat" }), "N/A");

  assert.equal(resolveVanFinanceVatText({ vatStatus: "unknown", sourceVatStatus: "Non VAT" }), "N/A");
  assert.equal(resolveVanFinanceVatText({ vatStatus: "unknown", sourceVatStatus: "VAT included" }), "N/A");
  assert.equal(resolveVanFinanceVatText({
    vatStatus: "unknown",
    description: "£8,495 NO VAT. 2016 Citroen Dispatch Enterprise Plus M.",
  }), "N/A");
});

test("Van Finance still fails closed when VAT evidence is ambiguous", () => {
  assert.equal(resolveVanFinanceVatText({ vatStatus: "unknown", description: "Great value van" }), "");
  assert.equal(resolveVanFinanceVatText({ vatStatus: "unknown", description: "VAT status to be confirmed" }), "");
});

test("Rent2Buy rental VAT is always plus VAT while preserving donor VAT for audit", () => {
  for (const sourceVatStatus of ["plus_vat", "no_vat", "inc_vat", "unknown"]) {
    assert.deepEqual(rent2BuyRentalVatPolicy(sourceVatStatus), {
      sourceVatStatus,
      vatStatus: "plus_vat",
      vatKnown: true,
      vatMultiplier: 1.2,
    });
  }
});

test("build transform wires the VAT policies into Van Finance and Rent2Buy planners", async () => {
  const [vfcSource, rent2BuySource] = await Promise.all([
    readFile(new URL("lib/dealerKitWixCreatePlan.js", root), "utf8"),
    readFile(new URL("lib/dealerKitRent2BuyPlan.js", root), "utf8"),
  ]);

  const transformedVfc = transformVanFinanceVatSource(vfcSource);
  assert.match(transformedVfc, /resolveVanFinanceVatText/);
  assert.match(transformedVfc, /DEALERKIT_VFC_VAT_POLICY/);
  assert.match(transformedVfc, /vat_display_unverified/);

  const transformedRent2Buy = transformRent2BuyVatSource(rent2BuySource);
  assert.match(transformedRent2Buy, /rent2BuyRentalVatPolicy/);
  assert.match(transformedRent2Buy, /DEALERKIT_RENT2BUY_VAT_POLICY/);
  assert.match(transformedRent2Buy, /sourceVatStatus: rentalVatPolicy\.sourceVatStatus/);
  assert.match(transformedRent2Buy, /listingInitialDisplay: `INITIAL RENTAL £\$\{upfront\} \+VAT`/);
});

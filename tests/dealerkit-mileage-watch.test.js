import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanMileage, mileageFromSpecification, listingMileage, buildMileageDifferences,
  buildMileageFieldPatch, MILEAGE_COLLECTIONS, MILEAGE_CANONICAL,
} from "../lib/dealerKitMileageWatch.js";
import { buildMileagePreview, applyMileagePreview } from "../api/dealerkit-mileage-update.js";

test("mileage parser accepts exact Wix values, but never guesses from arbitrary text", () => {
  assert.equal(cleanMileage("74,250 miles"), 74250);
  assert.equal(cleanMileage("74250"), 74250);
  assert.equal(cleanMileage("75.5"), null);
  assert.equal(cleanMileage("unknown"), null);
  assert.equal(cleanMileage(0), null);
  assert.equal(mileageFromSpecification("REGISTRATION: AB22CDE\nMILEAGE: 74,250\nFUEL TYPE: DIESEL"), 74250);
  assert.equal(mileageFromSpecification("Mileage: 74,250\nMILLAGE: 75,000"), null);
  assert.equal(mileageFromSpecification("ENGINE: 2.0\nYEAR: 2022"), null);
  assert.equal(listingMileage({ specText: "MILEAGE: 60,500" }, "rent2buy"), 60500);
  assert.equal(listingMileage({ vanDetails: "MILEAGE: 60,500" }, "rent2buy"), 60500);
});

test("only unambiguous stock IDs matched to published Wix registration create mileage alerts", () => {
  const source = [{ registration: "AB22 CDE", supplierStockId: "s1", mileage: 74250, isCurrentlyOnVansco: true }];
  const published = [{ registration: "AB22CDE", mileage: 71000, vehicleDescription: "Ford Transit" }];
  const result = buildMileageDifferences(source, published, "finance");
  assert.equal(result.length, 1);
  assert.equal(result[0].difference, 3250);
  assert.equal(result[0].wixMileage, 71000);
  assert.equal(buildMileageDifferences(source, [{ ...published[0], mileage: 74250 }]).length, 0);
  assert.equal(buildMileageDifferences([...source, { ...source[0], supplierStockId: "different" }], published).length, 0);
  assert.equal(buildMileageDifferences([{ ...source[0], isCurrentlyOnVansco: false }], published).length, 0);
});

test("Finance detail field and spec update only the mileage tokens", () => {
  const existing = {
    mileage: "71,000",
    vehicleSpecificationText: "REGISTRATION: AB22 CDE\nMILEAGE: 71,000\nFUEL TYPE: DIESEL",
    priceVat: "£18,995 +VAT",
  };
  const patch = buildMileageFieldPatch("VANFINANCEPAGES", existing, 74250, "finance");
  assert.deepEqual(Object.keys(patch.fields).sort(), ["mileage", "vehicleSpecificationText"]);
  assert.equal(patch.fields.mileage, "74,250");
  assert.match(patch.fields.vehicleSpecificationText, /MILEAGE: 74,250/);
  assert.doesNotMatch(JSON.stringify(patch.fields), /priceVat/);
  assert.equal(existing.mileage, "71,000");
});

test("Cars and Rent2Buy update listing and detail specification text, preserving every other line", () => {
  const cases = [
    ["CARFINANCE", "cars", "vanSpec"],
    ["CARPAGES", "cars", "descriptionLine"],
    ["ALLRENT2BUYVANS", "rent2buy", "vanSpec"],
    ["LWBVANS", "rent2buy", "specText"],
    ["PICKUPS", "rent2buy", "vanDetails"],
    ["VANPAGES", "rent2buy", "specText"],
  ];
  for (const [collection, pipeline, field] of cases) {
    const input = "YEAR: 2022\nMILEAGE: 50,000\n________________________";
    const patch = buildMileageFieldPatch(collection, { [field]: input, price: "£10,000", mth: "£345 PM" }, 51000, pipeline);
    assert.equal(patch.error, undefined, collection);
    assert.deepEqual(patch.fields, { [field]: "YEAR: 2022\nMILEAGE: 51,000\n________________________" });
  }
});

test("unknown, ambiguous or invalid mileage cannot trigger destructive CMS replacement", () => {
  assert.match(buildMileageFieldPatch("VANPAGES", { specText: "YEAR: 2022" }, 60000, "rent2buy").error, /no safely identifiable/i);
  assert.match(buildMileageFieldPatch("VANPAGES", { specText: "MILEAGE: around 80,000" }, 81000, "rent2buy").error, /Ambiguous/i);
  assert.match(buildMileageFieldPatch("VANFINANCEPAGES", { mileage: "", vehicleSpecificationText: "MILEAGE: 30,000" }, 31000, "finance").error, /missing/i);
  assert.match(buildMileageFieldPatch("CARPAGES", { descriptionLine: "MILEAGE: 50000\nMILEAGE: 50001" }, 51000, "cars").error, /Ambiguous/i);
  assert.equal(buildMileageFieldPatch("VANPAGES", { specText: "MILEAGE: 50,000" }, 50000, "rent2buy").changed, false);
});

test("zero mileage placeholders in Wix can be repaired without treating zero as a DealerKit source", () => {
  assert.equal(cleanMileage(0), null);
  assert.equal(listingMileage({vanSpec:"MILEAGE: 0"}, "finance"), null);
  const listing = buildMileageFieldPatch("VANFINANCE-ALLVANS", { vanSpec: "YEAR: 2022\\nMILEAGE: 0\\nFUEL TYPE: DIESEL" }, 77500, "finance");
  assert.equal(listing.error, undefined);
  assert.equal(listing.previousMileage, 0);
  assert.equal(listing.fields.vanSpec, "YEAR: 2022\\nMILEAGE: 77,500\\nFUEL TYPE: DIESEL");
  const detail = buildMileageFieldPatch("VANFINANCEPAGES", { mileage: "0", vehicleSpecificationText: "MILEAGE: 77,500" }, 77500, "finance");
  assert.equal(detail.error, undefined);
  assert.deepEqual(detail.fields, { mileage: "77,500" });
});
test("conflicting positive mileage fields must block a Wix update", () => {
  const check = buildMileageFieldPatch("VANFINANCEPAGES", {
    mileage: "90,000",
    vehicleSpecificationText: "MILEAGE: 94,000"
  }, 98000, "finance");
  assert.match(check.error, /disagree/i);
  assert.deepEqual(check.fields, {});
});

test("all three pipelines target canonical listing and vehicle page, with Rent2Buy sharing Wix CMS", () => {
  for (const pipeline of ["finance", "rent2buy", "cars"]) {
    assert.equal(MILEAGE_CANONICAL[pipeline].length, 2);
    assert.ok(MILEAGE_CANONICAL[pipeline].every((id) => MILEAGE_COLLECTIONS[pipeline].includes(id)));
  }
});

function mockSetup() {
  const rows = new Map([
    ["VANFINANCE-ALLVANS", { id: "wix-1", data: { title: "AB22CDE", vanSpec: "YEAR: 2022\nMILEAGE: 71,000", _publishStatus: "PUBLISHED" } }],
    ["VANFINANCEPAGES", { id: "wix-2", data: { title: "AB22CDE", mileage: "71,000", vehicleSpecificationText: "MILEAGE: 71,000", _publishStatus: "PUBLISHED" } }],
  ]);
  const query = async (_config, collectionId) => rows.has(collectionId) ? [rows.get(collectionId)] : [];
  const fetchDetail = async () => ({ registration: "AB22 CDE", supplierStockId: "s1", mileage: 74250, status: "available", year: 2022 });
  const input = { pipeline: "finance", registration: "AB22CDE", supplierStockId: "s1" };
  return { rows, query, fetchDetail, input };
}

test("preview verifies live DealerKit, both Wix authorities, and makes no writes", async () => {
  const { rows, query, fetchDetail, input } = mockSetup();
  const preview = await buildMileagePreview(input, { query, fetchDetail, configuration: {} });
  assert.equal(preview.changedRecords, 2);
  assert.equal(preview.canApply, true);
  assert.equal(preview.lowered, false);
  assert.deepEqual(preview.targets.map((x) => x.collectionId).sort(), ["VANFINANCE-ALLVANS", "VANFINANCEPAGES"]);
  assert.equal(rows.get("VANFINANCE-ALLVANS").data.vanSpec, "YEAR: 2022\nMILEAGE: 71,000");
});

test("successful Wix apply patches mileage only, then verifies both rows", async () => {
  const { rows, query, fetchDetail, input } = mockSetup();
  const preview = await buildMileagePreview(input, { query, fetchDetail, configuration: {} });
  let writes = 0;
  const request = async (_config, url, options) => {
    assert.equal(options.method, "PATCH");
    const item = [...rows.values()].find((row) => url.endsWith(row.id));
    assert.ok(item);
    for (const change of options.body.patch.fieldModifications) {
      assert.ok(["vanSpec", "vehicleSpecificationText", "mileage"].includes(change.fieldPath));
      item.data[change.fieldPath] = change.setFieldOptions.value;
    }
    writes += 1;
    return {};
  };
  const result = await applyMileagePreview(input, preview, { query, request });
  assert.equal(result.verified, true);
  assert.equal(result.changedRecords, 2);
  assert.equal(writes, 2);
  assert.equal(rows.get("VANFINANCEPAGES").data.mileage, "74,250");
});

test("Wix state changed after preview blocks before overwriting another edit", async () => {
  const { rows, query, fetchDetail, input } = mockSetup();
  const preview = await buildMileagePreview(input, { query, fetchDetail, configuration: {} });
  rows.get("VANFINANCE-ALLVANS").data.vanSpec = "MILEAGE: 72,500";
  await assert.rejects(
    applyMileagePreview(input, preview, { query, request: () => { throw new Error("must not write"); } }),
    /not fully verified/i,
  );
});

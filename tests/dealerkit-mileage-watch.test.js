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
  assert.match(buildMileageFieldPatch("VANFINANCEPAGES", { mileage: "" }, 31000, "finance").error, /no safely identifiable/i);
  assert.match(buildMileageFieldPatch("CARPAGES", { descriptionLine: "MILEAGE: 50000\nMILEAGE: 50001" }, 51000, "cars").error, /Ambiguous/i);
  assert.equal(buildMileageFieldPatch("VANPAGES", { specText: "MILEAGE: 50,000" }, 50000, "rent2buy").changed, false);
});

test("published Finance detail pages with no mileage field are repaired only from an unambiguous specification", () => {
  const missing = {
    title: "HV22UVX",
    vehicleSpecificationText: "YEAR: 2022\nMILLAGE: 16,430\nFUEL TYPE: DIESEL",
    askingPrice: "£18,995",
  };
  const patch = buildMileageFieldPatch("VANFINANCEPAGES", missing, 16490, "finance");
  assert.equal(patch.error, undefined);
  assert.equal(patch.previousMileage, 16430);
  assert.equal(patch.missingMileage, true);
  assert.deepEqual(patch.fields, {
    mileage: "16,490",
    vehicleSpecificationText: "YEAR: 2022\nMILLAGE: 16,490\nFUEL TYPE: DIESEL",
  });
  assert.equal(Object.hasOwn(missing, "mileage"), false);
  assert.equal(missing.askingPrice, "£18,995");

  const alreadyCorrect = buildMileageFieldPatch("VANFINANCEPAGES", {
    vehicleSpecificationText: "MILLAGE: 70,000"
  }, 70000, "finance");
  assert.deepEqual(alreadyCorrect.fields, { mileage: "70,000" });
  assert.equal(alreadyCorrect.previousMileage, 70000);

  const empty = buildMileageFieldPatch("VANFINANCEPAGES", {
    mileage: "", vehicleSpecificationText: "MILLAGE: 78,000"
  }, 79000, "finance");
  assert.equal(empty.error, undefined);
  assert.deepEqual(Object.keys(empty.fields).sort(), ["mileage", "vehicleSpecificationText"]);

  const malformed = buildMileageFieldPatch("VANFINANCEPAGES", {
    mileage: "unknown", vehicleSpecificationText: "MILEAGE: 78,000"
  }, 79000, "finance");
  assert.match(malformed.error, /unrecognised/i);

  const ambiguous = buildMileageFieldPatch("VANFINANCEPAGES", {
    vehicleSpecificationText: "MILEAGE: 77,000\nMILEAGE: 78,000"
  }, 79000, "finance");
  assert.match(ambiguous.error, /ambiguous/i);
});

test("zero mileage placeholders in Wix can be repaired without treating zero as a DealerKit source", () => {
  assert.equal(cleanMileage(0), null);
  assert.equal(listingMileage({vanSpec:"MILEAGE: 0"}, "finance"), null);
  const listing = buildMileageFieldPatch("VANFINANCE-ALLVANS", { vanSpec: "YEAR: 2022\nMILEAGE: 0\nFUEL TYPE: DIESEL" }, 77500, "finance");
  assert.equal(listing.error, undefined);
  assert.equal(listing.previousMileage, 0);
  assert.equal(listing.fields.vanSpec, "YEAR: 2022\nMILEAGE: 77,500\nFUEL TYPE: DIESEL");
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

test("legacy Cars dotted thousands mileage can be safely normalised in both Wix fields", () => {
  const values = [
    ["CARFINANCE", "vanSpec"],
    ["CARPAGES", "descriptionLine"],
  ];
  for (const [collectionId, field] of values) {
    const existing = {
      [field]: "REGISTRATION: DA67 PHV\nYEAR: 2017/67\nMILLAGE: 88.600\nEURO: 6",
      priceVat: "£13,995",
    };
    // A dotted legacy record remains in the comparison until its Wix text is corrected.
    assert.equal(mileageFromSpecification(existing[field]), null);
    const patch = buildMileageFieldPatch(collectionId, existing, 88600, "cars");
    assert.equal(patch.error, undefined, collectionId);
    assert.equal(patch.changed, true, collectionId);
    assert.equal(patch.previousMileage, 88600, collectionId);
    assert.deepEqual(patch.fields, {
      [field]: "REGISTRATION: DA67 PHV\nYEAR: 2017/67\nMILLAGE: 88,600\nEURO: 6",
    });
    assert.equal(existing.priceVat, "£13,995");
  }
});

test("legacy dot mileage only accepts complete thousands groups, never guessed decimals", () => {
  for (const malformed of ["88.6", "88.60", "88.6000", "88.60.0", "88,600.0", "88.600.12"]) {
    const patch = buildMileageFieldPatch("CARFINANCE", { vanSpec: "MILLAGE: " + malformed }, 88600, "cars");
    assert.match(patch.error, /Ambiguous|unrecognised/i, malformed);
    assert.deepEqual(patch.fields, {}, malformed);
  }
});

test("BMW car preview and apply normalises two published Wix specs, no other car fields", async () => {
  const rows = new Map([
    ["CARFINANCE", {
      id: "car-listing",
      data: {
        title: "DA67PHV", _publishStatus: "PUBLISHED",
        vanSpec: "REGISTRATION: DA67 PHV\nYEAR: 2017/67\nMILLAGE: 88.600\nEURO: 6",
        askingPrice: 13500,
      }
    }],
    ["CARPAGES", {
      id: "car-detail",
      data: {
        title: "DA67PHV", _publishStatus: "PUBLISHED",
        descriptionLine: "REGISTRATION: DA67 PHV\nMILLAGE: 88.600\nTRANSMISSION: AUTO",
        image: "existing-car-image",
      }
    }],
  ]);
  const input = {
    pipeline: "cars", registration: "DA67PHV", supplierStockId: "car-1"
  };
  const query = async (_config, collectionId) => rows.has(collectionId) ? [rows.get(collectionId)] : [];
  const fetchDetail = async () => ({
    registration: "DA67 PHV", supplierStockId: "car-1", mileage: 88600, status: "available"
  });
  const preview = await buildMileagePreview(input, { query, fetchDetail, configuration: {} });
  assert.equal(preview.changedRecords, 2);
  assert.deepEqual(preview.targets.map(x => x.collectionId).sort(), ["CARFINANCE", "CARPAGES"]);
  assert.deepEqual(preview.targets.map(x => x.changedFields), [["vanSpec"], ["descriptionLine"]]);
  assert.equal(preview.lowered, false);
  const request = async (_config, url, options) => {
    assert.equal(options.method, "PATCH");
    const row = [...rows.values()].find(item => url.endsWith(item.id));
    for (const modification of options.body.patch.fieldModifications) {
      assert.equal(modification.action, "SET_FIELD");
      row.data[modification.fieldPath] = modification.setFieldOptions.value;
    }
  };
  const applied = await applyMileagePreview(input, preview, { query, request });
  assert.equal(applied.verified, true);
  assert.match(rows.get("CARFINANCE").data.vanSpec, /MILLAGE: 88,600/);
  assert.match(rows.get("CARPAGES").data.descriptionLine, /MILLAGE: 88,600/);
  assert.equal(rows.get("CARFINANCE").data.askingPrice, 13500);
  assert.equal(rows.get("CARPAGES").data.image, "existing-car-image");
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

test("an absent Wix mileage field can be inserted and verified without disturbing other data", async () => {
  const { rows, query, fetchDetail, input } = mockSetup();
  const detail = rows.get("VANFINANCEPAGES");
  delete detail.data.mileage;
  const beforePrice = detail.data.priceVat;
  const preview = await buildMileagePreview(input, { query, fetchDetail, configuration: {} });
  const target = preview.targets.find(row => row.collectionId === "VANFINANCEPAGES");
  assert.equal(target.missingMileage, true);
  assert.equal(target.previousMileage, 71000);
  assert.deepEqual(target.changedFields.sort(), ["mileage", "vehicleSpecificationText"]);
  const request = async (_config, url, options) => {
    const row = [...rows.values()].find(item => url.endsWith(item.id));
    for (const change of options.body.patch.fieldModifications) {
      assert.equal(change.action, "SET_FIELD");
      row.data[change.fieldPath] = change.setFieldOptions.value;
    }
  };
  const applied = await applyMileagePreview(input, preview, { query, request });
  assert.equal(applied.verified, true);
  assert.equal(detail.data.mileage, "74,250");
  assert.equal(detail.data.vehicleSpecificationText, "MILEAGE: 74,250");
  assert.equal(detail.data.priceVat, beforePrice);
});

test("rollback of a newly created mileage field removes it again if verification fails", async () => {
  const { rows, fetchDetail, input } = mockSetup();
  const detail = rows.get("VANFINANCEPAGES");
  delete detail.data.mileage;
  let writes = 0;
  let failOnce = true;
  const query = async (_config, collectionId) => {
    if (writes === 2 && failOnce) {
      failOnce = false;
      throw new Error("Simulated Wix read failure after writes");
    }
    return rows.has(collectionId) ? [rows.get(collectionId)] : [];
  };
  const preview = await buildMileagePreview(input, { query, fetchDetail, configuration: {} });
  const operations = [];
  const request = async (_config, url, options) => {
    const row = [...rows.values()].find(item => url.endsWith(item.id));
    for (const change of options.body.patch.fieldModifications) {
      operations.push(change.action + ":" + change.fieldPath);
      if (change.action === "REMOVE_FIELD") delete row.data[change.fieldPath];
      else if (change.action === "SET_FIELD") row.data[change.fieldPath] = change.setFieldOptions.value;
      else assert.fail("Unexpected Wix field operation");
    }
    writes++;
  };
  await assert.rejects(applyMileagePreview(input, preview, { query, request }), /not fully verified/i);
  assert.equal(Object.hasOwn(detail.data, "mileage"), false);
  assert.equal(detail.data.vehicleSpecificationText, "MILEAGE: 71,000");
  assert.equal(rows.get("VANFINANCE-ALLVANS").data.vanSpec, "YEAR: 2022\nMILEAGE: 71,000");
  assert.ok(operations.includes("REMOVE_FIELD:mileage"));
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

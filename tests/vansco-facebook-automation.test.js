import test from "node:test";
import assert from "node:assert/strict";

import {
  buildVanscoFacebookCaption,
  extractUkRegistration,
  hasExplicitVanscoVatLabel,
  isEligibleVanscoVehicle,
  normalizeVanscoMetaRow,
  parseCsvRecords,
  resolveVanscoBranch,
  vanscoDailySlots,
  vatLabelFromText,
} from "../lib/vanscoFacebookAutomation.js";

test("DealerKit Meta CSV parser keeps quoted descriptions and literal dotted headers", () => {
  const rows = parseCsvRecords(
    'vehicle_id,title,description,mileage.value,image[0].url,address.city\r\n'
    + '"abc","Ford Transit","Line one, line two","12345","https://cdn.example.com/a.jpg","Southampton"\r\n',
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].description, "Line one, line two");
  assert.equal(rows[0]["mileage.value"], "12345");
  assert.equal(rows[0]["image[0].url"], "https://cdn.example.com/a.jpg");
});

test("branch resolver prefers explicit Vansco branch wording over a conflicting URL slug", () => {
  const result = resolveVanscoBranch({
    description: "Vansco Limited - New Forest. Call our team today.",
    vehicleUrl: "https://www.vansco.co.uk/vehicle-details/example-vansco-southampton-airport-u123/",
    city: "Southampton",
  });
  assert.equal(result.branchKey, "newForest");
  assert.equal(result.source, "description");
  assert.equal(result.conflict, true);
});

test("branch resolver recognises each Vansco branch and Cadnam fallback", () => {
  assert.equal(resolveVanscoBranch({
    description: "This vehicle is situated at our Vansco 333 Showroom.",
  }).branchKey, "vansco333");
  assert.equal(resolveVanscoBranch({
    description: "Vansco Limited - Southampton Airport",
  }).branchKey, "southamptonAirport");
  assert.equal(resolveVanscoBranch({
    city: "Cadnam",
  }).branchKey, "newForest");
});

test("VAT and registration helpers only return explicit evidence", () => {
  assert.equal(vatLabelFromText("Price £12,995 + VAT"), "+ VAT");
  assert.equal(vatLabelFromText("Price £12,995 NO VAT"), "NO VAT");
  assert.equal(vatLabelFromText("Price £12,995 including VAT"), "INC VAT");
  assert.equal(vatLabelFromText("Price £12,995 VAT included"), "INC VAT");
  assert.equal(vatLabelFromText("Price £12,995"), "");
  assert.equal(hasExplicitVanscoVatLabel("Advertised price: £12,995 + VAT"), true);
  assert.equal(hasExplicitVanscoVatLabel("Advertised price: £12,995"), false);
  assert.equal(extractUkRegistration("Registration: AB12 CDE"), "AB12CDE");
});

test("normalised Meta rows require AVAILABLE stock, image, price and live vehicle URL", () => {
  const vehicle = normalizeVanscoMetaRow({
    vehicle_id: "abc123",
    title: "Ford Transit Custom",
    year: "2022",
    price: "12995 GBP",
    url: "https://www.vansco.co.uk/vehicle-details/example",
    "image[0].url": "https://cdn.example.com/image.jpg",
    "mileage.value": "42000",
    availability: "AVAILABLE",
    description: "Vansco Limited - New Forest. Price + VAT.",
    "address.city": "Cadnam",
  });
  assert.equal(vehicle.branchKey, "newForest");
  assert.equal(vehicle.vatLabel, "+ VAT");
  assert.equal(vehicle.mileage, "42000");
  assert.equal(isEligibleVanscoVehicle(vehicle), true);
  assert.equal(isEligibleVanscoVehicle({ ...vehicle, availability: "SOLD" }), false);
});

test("branch-specific caption uses only the selected site details", () => {
  const caption = buildVanscoFacebookCaption({
    title: "2022 Ford Transit Custom",
    year: "2022",
    price: "12995 GBP",
    mileage: "42000",
    vatLabel: "+ VAT",
    branchKey: "newForest",
    vehicleUrl: "https://www.vansco.co.uk/vehicle-details/example",
  });
  assert.match(caption, /Vansco New Forest/);
  assert.match(caption, /Senior Service Station/);
  assert.match(caption, /02380 813 119/);
  assert.doesNotMatch(caption, /02380 333 777/);
  assert.doesNotMatch(caption, /02381 780 300/);
  assert.match(caption, /£12,995 \+ VAT/);
});

test("35-post schedule is evenly spaced without crossing midnight", () => {
  const slots = vanscoDailySlots("2026-09-25", 35);
  assert.equal(slots.length, 35);
  assert.equal(slots[0].localTime, "00:30");
  assert.equal(slots.at(-1).localTime, "23:10");
  assert.equal(new Set(slots.map((slot) => slot.dueAt)).size, 35);
});


test("shared footer branch names do not override a vehicle-specific page branch", () => {
  const pageText = [
    "This vehicle is situated at our Vansco 333 Showroom.",
    "333 Showroom 02380 333 777",
    "New Forest 02380 813 119",
    "S'hampton Airport 02381 780 300",
  ].join(" ");
  const result = resolveVanscoBranch({ pageText });
  assert.equal(result.branchKey, "vansco333");
  assert.equal(result.source, "page");
  assert.equal(result.conflict, false);
});


test("caption refuses ambiguous VAT instead of publishing a bare price", () => {
  assert.throws(
    () => buildVanscoFacebookCaption({
      title: "2022 Volkswagen Transporter",
      year: "2022",
      price: "20995 GBP",
      mileage: "23000",
      vatLabel: "",
      branchKey: "newForest",
      vehicleUrl: "https://www.vansco.co.uk/vehicle-details/example",
    }),
    /VAT status is unresolved/,
  );
});

test("worker replaces queued live posts that are missing a VAT label", async () => {
  const { readFile } = await import("node:fs/promises");
  const worker = await readFile(
    new URL("../api/vansco-facebook-automation-worker.js", import.meta.url),
    "utf8",
  );
  assert.match(worker, /vat_label_missing/);
  assert.match(worker, /vat_unresolved/);
  assert.match(worker, /hasExplicitVanscoVatLabel/);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildVanscoFacebookCaption,
  extractUkRegistration,
  hasExplicitVanscoVatLabel,
  isEligibleVanscoVehicle,
  isVanscoCar,
  isVanscoVatResolved,
  normalizeVanscoMetaRow,
  parseCsvRecords,
  resolveVanscoBranch,
  vanscoDailySlots,
  vanscoNextDateKey,
  vanscoAdvertVatLabel,
  vatLabelFromStatus,
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
  assert.equal(vatLabelFromStatus("plus_vat"), "+ VAT");
  assert.equal(vatLabelFromStatus("no_vat"), "NO VAT");
  assert.equal(vatLabelFromStatus("vat_included"), "INC VAT");
  assert.equal(vatLabelFromStatus("inc_vat"), "INC VAT");
  assert.equal(vatLabelFromStatus("unknown"), "");
  assert.equal(hasExplicitVanscoVatLabel("Advertised price: £12,995 + VAT"), true);
  assert.equal(hasExplicitVanscoVatLabel("Advertised price: £12,995"), false);
  assert.equal(extractUkRegistration("Registration: AB12 CDE"), "AB12CDE");
});

test("Vansco car classification suppresses VAT wording without weakening van VAT rules", () => {
  const car = {
    title: "2003 Jaguar XKR",
    bodyStyle: "Convertible",
    vehicleUrl: "https://www.vansco.co.uk/jaguar-xkr-supercharged-convertible-petrol-automatic",
    vatLabel: "NO VAT",
  };
  const van = {
    title: "2022 Volkswagen Transporter",
    bodyStyle: "Panel Van",
    vehicleUrl: "https://www.vansco.co.uk/volkswagen-transporter-panel-van",
    vatLabel: "NO VAT",
  };
  assert.equal(isVanscoCar(car), true);
  assert.equal(isVanscoCar(van), false);
  assert.equal(vanscoAdvertVatLabel(car), "");
  assert.equal(vanscoAdvertVatLabel(van), "NO VAT");
  assert.equal(isVanscoVatResolved({ ...car, vatLabel: "" }), true);
  assert.equal(isVanscoVatResolved({ ...van, vatLabel: "" }), false);
});

test("Vansco car caption shows the retail price without NO VAT", () => {
  const caption = buildVanscoFacebookCaption({
    title: "2003 Jaguar XKR",
    year: "2003",
    price: "12999 GBP",
    mileage: "67800",
    vatLabel: "NO VAT",
    bodyStyle: "Convertible",
    branchKey: "vansco333",
    vehicleUrl: "https://www.vansco.co.uk/jaguar-xkr-supercharged-convertible-petrol-automatic",
  });
  assert.match(caption, /Advertised price: £12,999/);
  assert.doesNotMatch(caption, /NO VAT|INC VAT|\+ VAT/);
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

test("35-post schedule is evenly spaced from 08:00 through 21:00", () => {
  const slots = vanscoDailySlots("2026-09-25", 35);
  assert.equal(slots.length, 35);
  assert.equal(slots[0].localTime, "08:00");
  assert.equal(slots.at(-1).localTime, "21:00");
  assert.ok(slots.every((slot) => slot.localMinutes >= 8 * 60 && slot.localMinutes <= 21 * 60));
  assert.equal(new Set(slots.map((slot) => slot.dueAt)).size, 35);
});

test("Vansco next-day queue date rolls across month and year boundaries", () => {
  assert.equal(vanscoNextDateKey("2026-09-25"), "2026-09-26");
  assert.equal(vanscoNextDateKey("2026-09-30"), "2026-10-01");
  assert.equal(vanscoNextDateKey("2026-12-31"), "2027-01-01");
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
  assert.match(worker, /car_vat_label_present/);
  assert.match(worker, /vat_unresolved/);
  assert.match(worker, /hasExplicitVanscoVatLabel/);
  assert.match(worker, /isVanscoVatResolved/);
  assert.match(worker, /vanscoAdvertVatLabel/);
  assert.match(worker, /scheduleDateKey = currentSlots\.length \? dateKey : vanscoNextDateKey\(dateKey\)/);
  assert.match(worker, /scheduleDate: scheduleDateKey/);

  const source = await readFile(
    new URL("../api/_vansco-facebook-source.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /hydrateVanscoVatFromDealerKitState/);
  assert.match(source, /dealerkit_stock_state/);
  assert.match(source, /supplier_stock_id,source_url,last_seen_at,vehicle_snapshot/);
  assert.match(source, /vatSource: "dealerkit_stock_state"/);
  assert.match(source, /hydrateVanscoVatFromCache/);
  assert.match(source, /fetchVanscoDetailHtml/);
  assert.match(source, /parseDetailHtml/);
  assert.match(source, /VAT_CACHE_MAX_AGE_MS/);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildVanscoFacebookCaption,
  buildVanscoGoogleBusinessCaption,
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
  vanscoFacebookImageUrls,
  vanscoGoogleBusinessSlots,
  vatLabelFromStatus,
  vatLabelFromText,
  vanscoSocialTitle,
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
    "image[0].url": "https://cdn.example.com/image-main.jpg",
    "image[2].url": "https://cdn.example.com/image-third.jpg",
    "image[1].url": "https://cdn.example.com/image-second.jpg",
    "image[3].url": "https://cdn.example.com/image-fourth.jpg",
    "mileage.value": "42000",
    availability: "AVAILABLE",
    description: "Vansco Limited - New Forest. Price + VAT.",
    "address.city": "Cadnam",
  });
  assert.equal(vehicle.branchKey, "newForest");
  assert.equal(vehicle.vatLabel, "+ VAT");
  assert.equal(vehicle.mileage, "42000");
  assert.equal(vehicle.imageUrl, "https://cdn.example.com/image-main.jpg");
  assert.deepEqual(vehicle.imageUrls, [
    "https://cdn.example.com/image-main.jpg",
    "https://cdn.example.com/image-second.jpg",
    "https://cdn.example.com/image-third.jpg",
  ]);
  assert.deepEqual(vanscoFacebookImageUrls(vehicle), vehicle.imageUrls);
  assert.equal(isEligibleVanscoVehicle(vehicle), true);
  assert.equal(isEligibleVanscoVehicle({ ...vehicle, availability: "SOLD" }), false);
});


test("Vansco social titles prefer rich DealerKit titles and concise specialist descriptors", () => {
  assert.equal(
    vanscoSocialTitle({
      title: "Mercedes-Benz A Class",
      dealerKitTitle: "Mercedes-Benz A Class 1.5 A180d AMG Line (Premium 2) Hatchback 5dr Diesel Manual Euro 6 (s/s) (116 ps)",
      make: "Mercedes-Benz",
      model: "A Class",
      bodyType: "Hatchback",
      attentionGrabber: "Parking Camera-Heated Seats",
    }),
    "Mercedes-Benz A Class 1.5 A180d AMG Line (Premium 2) Hatchback 5dr Diesel Manual Euro 6 (s/s) (116 ps)",
  );

  assert.equal(
    vanscoSocialTitle({
      title: "Peugeot Boxer",
      dealerKitTitle: "Peugeot Boxer BlueHDi 440 2.0 4dr Minibus (9-17 Seats) Manual Diesel Minibus (9-17 Seats) Manual Diesel Minibus (9-17 Seats) Manual Diesel",
      make: "Peugeot",
      model: "Boxer",
      trim: "Professional Premium +",
      bodyType: "Minibus",
      attentionGrabber: "17 SEATER MINIBUS",
    }),
    "Peugeot Boxer Professional Premium + 17 SEATER MINIBUS",
  );
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

test("Vansco Google Business copy is branch-specific and contains no finance offer", () => {
  const caption = buildVanscoGoogleBusinessCaption({
    title: "Ford Transit Custom",
    dealerKitTitle: "Ford Transit Custom 2.0 EcoBlue Limited Panel Van",
    year: "2022",
    registration: "AB12CDE",
    mileage: "42000",
    price: "19995 GBP",
    branchKey: "southamptonAirport",
    vehicleUrl: "https://www.vansco.co.uk/vehicle-details/example",
  });

  assert.match(caption, /VANSCO SOUTHAMPTON AIRPORT STOCK/);
  assert.match(caption, /REGISTRATION: AB12CDE/);
  assert.match(caption, /YEAR: 2022/);
  assert.match(caption, /MILEAGE: 42,000/);
  assert.match(caption, /Available now from Vansco Southampton Airport/);
  assert.match(caption, /using Learn more/);
  assert.doesNotMatch(caption, /£|deposit|monthly|APR|finance/i);
});

test("Vansco Google Business schedule creates ten staggerable branch slots", () => {
  const base = vanscoGoogleBusinessSlots("2026-09-28", 10, 0);
  const airport = vanscoGoogleBusinessSlots("2026-09-28", 10, 5);
  const forest = vanscoGoogleBusinessSlots("2026-09-28", 10, 10);
  assert.equal(base.length, 10);
  assert.equal(base[0].localTime, "08:30");
  assert.equal(base.at(-1).localTime, "20:00");
  assert.equal(airport[0].localTime, "08:35");
  assert.equal(forest[0].localTime, "08:40");
  assert.equal(new Set(base.map((slot) => slot.dueAt)).size, 10);
});

test("30-post schedule is evenly spaced from 08:00 through 21:00", () => {
  const slots = vanscoDailySlots("2026-09-25", 30);
  assert.equal(slots.length, 30);
  assert.equal(slots[0].localTime, "08:00");
  assert.equal(slots.at(-1).localTime, "21:00");
  assert.ok(slots.every((slot) => slot.localMinutes >= 8 * 60 && slot.localMinutes <= 21 * 60));
  assert.equal(new Set(slots.map((slot) => slot.dueAt)).size, 30);
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
  assert.match(worker, /image_count_upgrade/);
  assert.match(worker, /car_vat_label_present/);
  assert.match(worker, /vat_unresolved/);
  assert.match(worker, /hasExplicitVanscoVatLabel/);
  assert.match(worker, /isVanscoVatResolved/);
  assert.match(worker, /vanscoAdvertVatLabel/);
  assert.match(worker, /vanscoFacebookImageUrls/);
  assert.match(worker, /imageUrls,/);
  assert.match(worker, /scheduleDateKey = currentSlots\.length \? dateKey : vanscoNextDateKey\(dateKey\)/);
  assert.match(worker, /scheduleDate: scheduleDateKey/);
  assert.match(worker, /buffer_duplicate/);
  assert.match(worker, /buffer_media_rejected/);
  assert.match(worker, /duplicateSkippedCount/);
  assert.match(worker, /mediaSkippedCount/);
  assert.match(worker, /continue;/);

  const source = await readFile(
    new URL("../api/_vansco-facebook-source.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /hydrateVanscoVatFromDealerKitState/);
  assert.match(source, /dealerkit_stock_state/);
  assert.match(source, /supplier_stock_id,source_url,last_seen_at,vehicle_snapshot/);
  assert.match(source, /"dealerkit_stock_state"/);
  assert.match(source, /hydrateVanscoVatFromCache/);
  assert.match(source, /fetchVanscoDetailHtml/);
  assert.match(source, /parseDetailHtml/);
  assert.match(source, /VAT_CACHE_MAX_AGE_MS/);
  assert.match(source, /snapshot\?\.images/);
  assert.match(source, /vanscoFacebookImageUrls/);
  assert.match(
    source,
    /\.\.\.\(Array\.isArray\(evidence\?\.imageUrls\)[\s\S]*\.\.\.\(Array\.isArray\(vehicle\?\.imageUrls\)/,
  );
});


test("Vansco Buffer runtime sends at most three ordered image assets", async () => {
  const { readFile } = await import("node:fs/promises");
  const runtime = await readFile(
    new URL("../api/_vansco-buffer-runtime.js", import.meta.url),
    "utf8",
  );
  assert.match(runtime, /imageUrls = \[\]/);
  assert.match(runtime, /\.slice\(0, 3\)/);
  assert.match(runtime, /assets: urls\.map\(\(url\) => \(\{ image: \{ url \} \}\)\)/);
});

test("Vansco Buffer converts Wix AVIF/WebP assets to JPEG before publishing", async () => {
  const { vanscoBufferCompatibleImageUrl } = await import("../api/_vansco-buffer-runtime.js");
  assert.equal(
    vanscoBufferCompatibleImageUrl("https://static.wixstatic.com/media/example~mv2.avif"),
    "https://static.wixstatic.com/media/example~mv2.avif/v1/fit/w_1600,h_1600/file.jpg",
  );
  assert.equal(
    vanscoBufferCompatibleImageUrl("https://static.wixstatic.com/media/example~mv2.webp?x=1"),
    "https://static.wixstatic.com/media/example~mv2.webp/v1/fit/w_1600,h_1600/file.jpg",
  );
  assert.equal(
    vanscoBufferCompatibleImageUrl("https://acdn.uk/vansco/i/example.jpeg"),
    "https://acdn.uk/vansco/i/example.jpeg",
  );
  assert.equal(
    vanscoBufferCompatibleImageUrl("https://other.example/image.avif"),
    "",
  );
});

test("Vansco Google Business runtime maps exactly the three branch channels", async () => {
  const { vanscoGoogleBusinessBranchKey } = await import("../api/_vansco-buffer-runtime.js");
  assert.equal(vanscoGoogleBusinessBranchKey({
    service: "googlebusiness",
    name: "Vansco 333 Showroom",
  }), "vansco333");
  assert.equal(vanscoGoogleBusinessBranchKey({
    service: "googlebusiness",
    name: "Vansco Southampton Airport",
  }), "southamptonAirport");
  assert.equal(vanscoGoogleBusinessBranchKey({
    service: "googlebusiness",
    name: "Vansco New Forest",
  }), "newForest");
  assert.equal(vanscoGoogleBusinessBranchKey({
    service: "googlebusiness",
    name: "Van Finance Company",
  }), "");
  assert.equal(vanscoGoogleBusinessBranchKey({
    service: "facebook",
    name: "Vansco Limited",
  }), "");
});

test("Vansco Google Business worker enforces branch-only van routing", async () => {
  const { readFile } = await import("node:fs/promises");
  const worker = await readFile(
    new URL("../api/vansco-google-business-automation-worker.js", import.meta.url),
    "utf8",
  );
  assert.match(worker, /VANSCO_GOOGLE_BUSINESS_POSTS_PER_DAY/);
  assert.match(worker, /vehicle\.branchKey === branchKey && !vehicle\.branchConflict/);
  assert.match(worker, /!isVanscoCar\(vehicle\)/);
  assert.match(worker, /createVanscoGoogleBusinessPost/);
  assert.match(worker, /linkUrl: vehicle\.vehicleUrl/);
  assert.match(worker, /vansco333/);
  assert.match(worker, /southamptonAirport/);
  assert.match(worker, /newForest/);
});


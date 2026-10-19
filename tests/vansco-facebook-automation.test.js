import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { vanscoBufferCooldownRemainingMs } from "../api/_vansco-buffer-runtime.js";
import {
  activeVanscoMediaQuarantine,
  isVanscoMediaUrlFailure,
  preflightVanscoFacebookImage,
  preflightVanscoFacebookImages,
  quarantineFromFailedVanscoFacebookPosts,
  quarantineFromFailedVanscoGoogleBusinessPosts,
  quarantineVanscoVehicle,
} from "../lib/vanscoFailedMediaRecovery.js";

import {
  VANSCO_FACEBOOK_STORIES_PER_DAY,
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
  selectVanscoSocialImagesFromSources,
  vanscoFacebookStorySlots,
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

test("Vansco Facebook Stories are four evenly spaced daily slots", () => {
  assert.equal(VANSCO_FACEBOOK_STORIES_PER_DAY, 4);
  const slots = vanscoFacebookStorySlots("2026-09-28");
  assert.equal(slots.length, 4);
  assert.deepEqual(
    slots.map((slot) => slot.localTime),
    ["09:30", "12:45", "16:15", "19:30"],
  );
  assert.equal(new Set(slots.map((slot) => slot.dueAt)).size, 4);
});

test("25-post schedule is evenly spaced from 08:00 through 21:00 with rolling limit headroom", () => {
  const slots = vanscoDailySlots("2026-09-25", 30); // Request deliberately above cap
  assert.equal(slots.length, 25);
  assert.equal(slots[0].localTime, "08:00");
  assert.equal(slots.at(-1).localTime, "21:00");
  assert.ok(slots.every((slot) => slot.localMinutes >= 8 * 60 && slot.localMinutes <= 21 * 60));
  assert.equal(new Set(slots.map((slot) => slot.dueAt)).size, 25);
  assert.equal(slots.length + VANSCO_FACEBOOK_STORIES_PER_DAY, 29);
  assert.ok(slots.length + VANSCO_FACEBOOK_STORIES_PER_DAY < 35);
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
  assert.doesNotMatch(worker, /image_count_upgrade/);
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
  assert.match(source, /selectVanscoSocialImagesFromSources/);
  assert.match(source, /preferLiveMetaImages/);
  assert.match(source, /hydrateVanscoVatFromCache/);
});


test("Vansco Facebook and GBP use current Meta sale artwork ahead of old saved DealerKit stock photographs", () => {
  const oldSale = [
    "https://acdn.uk/vansco/i/oktoberfest-old-front.jpeg",
    "https://acdn.uk/vansco/i/oktoberfest-old-side.jpeg",
  ];
  const freshMeta = {
    vehicleUrl: "https://www.vansco.co.uk/ford-transit-registration-a",
    imageUrl: "https://static.wixstatic.com/media/halloween-new-front.jpg",
    imageUrls: [
      "https://static.wixstatic.com/media/halloween-new-front.jpg",
      "https://static.wixstatic.com/media/halloween-new-side.webp",
    ],
  };
  const preferred = selectVanscoSocialImagesFromSources(freshMeta, oldSale, {preferLiveMeta: true});
  assert.deepEqual(preferred, freshMeta.imageUrls);
  assert.ok(preferred.every(url => !url.includes("oktoberfest")));

  // Opt-in is deliberate: Vansco Instagram and Stories retain their current
  // photo order and there is no shared VFC / Rent2Buy publishing change.
  assert.deepEqual(
    selectVanscoSocialImagesFromSources(freshMeta, oldSale),
    [oldSale[0],oldSale[1],freshMeta.imageUrls[0]],
  );
  assert.deepEqual(
    selectVanscoSocialImagesFromSources({ imageUrls: [], imageUrl: "" }, oldSale, {preferLiveMeta: true}),
    oldSale,
  );
});

test("Vansco Facebook restores all first three when Meta only contains a matching live lead image", () => {
  const lead = "https://acdn.uk/vansco/i/halloween-front.jpeg";
  const side = "https://acdn.uk/vansco/i/halloween-side.jpeg";
  const interior = "https://acdn.uk/vansco/i/halloween-interior.jpeg";
  const fourth = "https://acdn.uk/vansco/i/halloween-fourth.jpeg";
  const stockGallery = [lead, side, interior, fourth];

  // Exactly matching first image identifies the same campaign/gallery.
  assert.deepEqual(
    selectVanscoSocialImagesFromSources({ imageUrl: lead, imageUrls: [lead] }, stockGallery, { preferLiveMeta: true }),
    [lead, side, interior],
  );

  // A two-image Meta prefix can likewise be completed from the verified stock.
  assert.deepEqual(
    selectVanscoSocialImagesFromSources({ imageUrl: lead, imageUrls: [lead, side] }, stockGallery, { preferLiveMeta: true }),
    [lead, side, interior],
  );
  assert.deepEqual(
    selectVanscoSocialImagesFromSources({ imageUrl: lead, imageUrls: [lead, side, interior] }, stockGallery, { preferLiveMeta: true }),
    [lead, side, interior],
  );
});

test("Vansco never mixes old or differently ordered promotions to reach three images", () => {
  const fresh = "https://acdn.uk/vansco/i/new-halloween-promo.jpeg";
  const old = "https://acdn.uk/vansco/i/previous-promo.jpeg";
  const a = "https://acdn.uk/vansco/i/side-a.jpeg";
  const b = "https://acdn.uk/vansco/i/side-b.jpeg";
  assert.deepEqual(
    selectVanscoSocialImagesFromSources({ imageUrls: [fresh] }, [old, a, b], { preferLiveMeta: true }),
    [fresh],
  );
  assert.deepEqual(
    selectVanscoSocialImagesFromSources({ imageUrls: [fresh, a] }, [fresh, b, a], { preferLiveMeta: true }),
    [fresh, a],
  );
  assert.deepEqual(
    selectVanscoSocialImagesFromSources({ imageUrls: [fresh] }, [], { preferLiveMeta: true }),
    [fresh],
  );
});

test("Vansco existing queue is protected from bulk image-count upgrades", async () => {
  const worker = await (await import("node:fs/promises")).readFile(new URL("../api/vansco-facebook-automation-worker.js", import.meta.url), "utf8");
  const start = worker.indexOf("async function pruneStaleScheduledPosts(");
  const end = worker.indexOf("function dailyLimitFromState", start);
  assert.ok(start !== -1 && end > start);
  const prune = worker.slice(start,end);
  assert.doesNotMatch(prune, /imageUpgradeRequired|image_count_upgrade|queuedImageCount/);
  assert.match(prune, /vat_label_missing/);
  assert.match(prune, /vehicle_no_longer_live/);
});

test("Vansco latest-image priority is per vehicle, preserves exact order and never combines campaign generations", () => {
  const newFirst = "https://acdn.uk/vansco/i/new-halloween-front.jpeg";
  const oldFront = "https://acdn.uk/vansco/i/old-sale-front.jpeg";
  const vanA = {imageUrl:newFirst,imageUrls:[newFirst]};
  const vanB = {imageUrl:"https://acdn.uk/vansco/i/another-vehicle.jpeg",imageUrls:["https://acdn.uk/vansco/i/another-vehicle.jpeg"]};
  assert.deepEqual(selectVanscoSocialImagesFromSources(vanA,[oldFront],{preferLiveMeta:true}),[newFirst]);
  assert.deepEqual(selectVanscoSocialImagesFromSources(vanB,[oldFront],{preferLiveMeta:true}),vanB.imageUrls);
  assert.deepEqual(selectVanscoSocialImagesFromSources({imageUrls:[newFirst,newFirst],imageUrl:newFirst},[oldFront],{preferLiveMeta:true}),[newFirst]);
});

test("all Vansco social channels opt in to fresh Meta image priority without modifying other brands", () => {
  const facebook=readFileSync(new URL("../api/vansco-facebook-automation-worker.js",import.meta.url),"utf8");
  const google=readFileSync(new URL("../api/vansco-google-business-automation-worker.js",import.meta.url),"utf8");
  const stories=readFileSync(new URL("../api/vansco-facebook-story-automation-worker.js",import.meta.url),"utf8");
  const instagram=readFileSync(new URL("../api/vansco-instagram-automation-worker.js",import.meta.url),"utf8");
  const loader=readFileSync(new URL("../api/_vansco-facebook-source.js",import.meta.url),"utf8");
  assert.match(facebook,/fetchVanscoMetaCatalogue\(\{ preferLiveMetaImages: true \}\)/);
  assert.match(google,/fetchVanscoMetaCatalogue\(\{ preferLiveMetaImages: true \}\)/);
  assert.match(stories,/preferLiveMetaImages/);
  assert.match(instagram,/preferLiveMetaImages/);
  assert.match(loader,/preferLiveMetaImages = false/);
  assert.doesNotMatch(facebook,/pruneStaleScheduledPosts\([\s\S]*?deleteVanscoBufferPost\([\s\S]*?image_changed/);
});

test("Vansco Buffer runtime sends at most three ordered image assets", async () => {
  const { readFile } = await import("node:fs/promises");
  const runtime = await readFile(
    new URL("../api/_vansco-buffer-runtime.js", import.meta.url),
    "utf8",
  );
  assert.match(runtime, /imageUrls = \[\]/);
  assert.match(runtime, /\.slice\(0, 3\)/);
  assert.match(runtime, /assets: hostedUrls\.map\(\(url\) => \(\{ image: \{ url \} \}\)\)/);
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

test("Vansco Story worker uses the dedicated Story lane and five-per-day target", async () => {
  const { readFile } = await import("node:fs/promises");
  const worker = await readFile(
    new URL("../api/vansco-facebook-story-automation-worker.js", import.meta.url),
    "utf8",
  );
  assert.match(worker, /VANSCO_FACEBOOK_STORIES_PER_DAY/);
  assert.match(worker, /createVanscoFacebookStory/);
  assert.match(worker, /vanscoFacebookStorySlots/);
  assert.match(worker, /VANSCO_FACEBOOK_STORIES_AUTOMATION_ENABLED/);
  const runtime = await readFile(
    new URL("../api/_vansco-buffer-runtime.js", import.meta.url),
    "utf8",
  );
  assert.match(runtime, /metadata: \{ facebook: \{ type: "story" \} \}/);
});

test("normal Vansco Facebook worker excludes Stories from the 30-post target", async () => {
  const { readFile } = await import("node:fs/promises");
  const worker = await readFile(
    new URL("../api/vansco-facebook-automation-worker.js", import.meta.url),
    "utf8",
  );
  assert.match(worker, /loadVanscoFacebookActivity/);
  assert.match(worker, /!isVanscoFacebookStory\(post\)/);
  assert.match(worker, /remainingNormal/);
  assert.match(worker, /VANSCO_FACEBOOK_MAX_POSTS_PER_DAY - normalSent - normalScheduled/);
});


test("Vansco Buffer workers use daytime cadence and cached monitoring reserve", async () => {
  const { readFile } = await import("node:fs/promises");
  const facebook = await readFile(new URL("../api/vansco-facebook-automation-worker.js", import.meta.url), "utf8");
  const stories = await readFile(new URL("../api/vansco-facebook-story-automation-worker.js", import.meta.url), "utf8");
  const google = await readFile(new URL("../api/vansco-google-business-automation-worker.js", import.meta.url), "utf8");
  const runtime = await readFile(new URL("../api/_vansco-buffer-runtime.js", import.meta.url), "utf8");
  assert.match(facebook, /isBufferScheduledRunDue\("two-hour"\)/);
  assert.match(stories, /isBufferScheduledRunDue\("two-hour"\)/);
  assert.match(google, /isBufferScheduledRunDue\("four-hour-plus-final"\)/);
  assert.match(runtime, /isBufferApiActiveWindow/);
  assert.match(runtime, /vanscoMonitoringReserveActive/);
  assert.match(runtime, /BUFFER_MONITORING_MAX_24H_REQUESTS/);
});

test("Vansco provider cooldown is shared across the independent Facebook and GBP workers", () => {
  const now=Date.parse("2026-10-17T10:00:00Z");
  assert.equal(vanscoBufferCooldownRemainingMs({blockedUntil:"2026-10-17T10:15:00Z"},now),900_000);
  assert.equal(vanscoBufferCooldownRemainingMs({blockedUntil:"2026-10-17T09:59:00Z"},now),0);
  assert.equal(vanscoBufferCooldownRemainingMs({},now),0);
  const runtime=readFileSync(new URL("../api/_vansco-buffer-runtime.js",import.meta.url),"utf8");
  assert.match(runtime,/await ensureVanscoBufferNotCoolingDown\(\)/);
  assert.match(runtime,/isBufferRateLimitMessage\(readableError\(payload, ""\)\)/);
  assert.match(runtime,/Math.max\(15 \* 60 \* 1000, bufferRetryAfterMs\(response\)\)/);
  assert.match(runtime,/recordVanscoBufferRateLimit\(response\)/);
  assert.match(runtime,/await writeBlobJson\(API_QUOTA_STATE_PATH, vanscoQuotaState\)/);
  assert.match(runtime,/\.\.\.previous,\s*rateLimits,/);
});

test("Vansco Google Business retains branch independence, saves successful history, and stops on a shared cooldown", () => {
  const worker=readFileSync(new URL("../api/vansco-google-business-automation-worker.js",import.meta.url),"utf8");
  assert.match(worker,/for \(const branchKey of BRANCH_ORDER\) \{\s*try \{/);
  assert.match(worker,/branchResults\[branchKey\] = \{\s*connected: true,\s*state: rateLimited \? "deferred" : "failed"/);
  assert.match(worker,/if \(rateLimited\) \{[\s\S]*?break;/);
  assert.match(worker,/await saveVanscoGoogleBusinessHistory\(history.lastPostedByBranch\)/);
  assert.match(worker,/failedBranches\.length \? "degraded" : "healthy"/);
  assert.match(worker,/error\?\.code === "BUFFER_RATE_LIMIT" \? 429 : 500/);
  // None of these modifications change the reel or VFC normal-post workers.
  assert.doesNotMatch(readFileSync(new URL("../api/youtube-daily-batch.js",import.meta.url),"utf8"),/vanscoBufferCooldownRemainingMs/);
});

test("Vansco Buffer monitoring collects today's actual failed posts without counting them as sent", async () => {
  const { vanscoFailedPostsByChannel, vanscoSentPostsByChannel } = await import("../api/_vansco-buffer-runtime.js");
  const item = (id, status, channelId, dueAt, message = "") => ({
    node: {
      id, status, channelId, dueAt, createdAt: "2026-10-16T10:00:00Z",
      error: status === "error" ? {message, supportUrl:"https://support.buffer.com/help"} : null,
    },
  });
  const payload = { data: {
    facebookSent: {edges:[
      item("f1","error","fb","2026-10-17T11:00:00Z","Facebook permission expired"),
      item("f2","sent","fb","2026-10-17T12:00:00Z"),
      item("f3","error","other","2026-10-17T12:00:00Z","Wrong channel"),
    ],pageInfo:{hasNextPage:false}},
    vansco333Sent: {edges:[
      item("g1","error","333","2026-10-17T07:00:00Z","Image rejected"),
      item("g2","error","333","2026-10-16T07:00:00Z","Yesterday"),
      item("g3","sent","333","2026-10-17T09:00:00Z"),
    ],pageInfo:{hasNextPage:false}},
    airportSent: {edges:[item("a1","sent","air","2026-10-17T10:00:00Z")],pageInfo:{hasNextPage:false}},
    newForestSent: {edges:[],pageInfo:{hasNextPage:false}},
  }};
  const branches={vansco333:{channelId:"333"},southamptonAirport:{channelId:"air"},newForest:{channelId:"forest"}};
  const failed=vanscoFailedPostsByChannel(payload,"fb",branches,"2026-10-17");
  assert.equal(failed.facebook.length,1);
  assert.equal(failed.facebook[0].postId,"f1");
  assert.equal(failed.facebook[0].message,"Facebook permission expired");
  assert.equal(failed.googleBusiness.vansco333.length,1);
  assert.equal(failed.googleBusiness.vansco333[0].message,"Image rejected");
  assert.equal(failed.googleBusiness.vansco333[0].stockRegistration,"");
  assert.deepEqual(failed.googleBusiness.southamptonAirport,[]);
  const gbpImageFailure = {
    ...payload,
    data: { ...payload.data, airportSent: { edges: [{
      node: {
        id: "a2", status: "error", channelId: "air",
        dueAt: "2026-10-17T10:00:00Z",
        text: "VANSCO SOUTHAMPTON AIRPORT STOCK\n\nREGISTRATION: AB12CDE",
        error: { message: "Please update the media URL to be publicly accessible before retrying the post." },
      },
    }], pageInfo: { hasNextPage: false } } },
  };
  const gbpExtracted = vanscoFailedPostsByChannel(gbpImageFailure, "fb", branches, "2026-10-17");
  assert.equal(gbpExtracted.googleBusiness.southamptonAirport[0].stockRegistration, "AB12CDE");

  assert.deepEqual(failed.googleBusiness.newForest,[]);
  const sent=vanscoSentPostsByChannel(payload,"fb",branches);
  assert.equal(sent.facebook.length,1);
  assert.equal(sent.googleBusiness.vansco333.length,1);
  assert.equal(sent.googleBusiness.southamptonAirport.length,1);
  assert.equal(sent.hasNextPage,false);
});

test("Vansco status collects provider publishing errors from existing four aliases, never by extra API call", () => {
  const source=readFileSync(new URL("../api/_vansco-buffer-runtime.js",import.meta.url),"utf8");
  const query=source.slice(source.indexOf("const ALL_CHANNEL_STATUS_QUERY"),source.indexOf("export function vanscoSentPostsByChannel"));
  assert.equal((query.match(/status: \[sent, error\]/g)||[]).length,4);
  assert.equal((query.match(/error \{ message supportUrl \}/g)||[]).length,4);
  assert.match(source,/const failedPosts = vanscoFailedPostsByChannel\(payload/);
  assert.match(source,/failedPostCountsComplete: !posts.hasNextPage/);
  assert.match(source,/await writeBlobJson\(LIVE_STATUS_SNAPSHOT_PATH, snapshot\)/);
});

test("failed Vansco Facebook image links quarantine only matching automated vehicles, not GBP platform failures", () => {
  const now = Date.parse("2026-10-17T13:20:00Z");
  const van = "https://www.vansco.co.uk/ford-transit-test-123";
  const another = "https://www.vansco.co.uk/peugeot-expert-test-456";
  const vehicles = [{ vehicleUrl: van }, { vehicleUrl: another }];
  const post = (id, text, message, dueAt="2026-10-17T11:00:00Z") => ({
    id, status:"error", text, dueAt, error: { message },
  });
  const failed = [
    post("media-one", "🚐 NOW AVAILABLE AT VANSCO\n" + van,
      "Please update the media URL to be publicly accessible before retrying the post."),
    post("google-api", "🚐 NOW AVAILABLE AT VANSCO\n" + another,
      "There appears to be an issue with the Google Business API."),
    post("manually-authored", "Special offer\n" + another,
      "Please update the media URL to be publicly accessible."),
    post("unknown", "🚐 NOW AVAILABLE AT VANSCO\nhttps://www.vansco.co.uk/unknown",
      "Media URL not accessible"),
    post("old", "🚐 NOW AVAILABLE AT VANSCO\n" + another,
      "Media URL not accessible", "2026-09-14T10:00:00Z"),
  ];
  const result = quarantineFromFailedVanscoFacebookPosts({}, failed, vehicles, now);
  assert.equal(result.detected, 1);
  assert.equal(Object.keys(result.quarantine).length, 1);
  assert.equal(result.quarantine[van].postId, "media-one");
  assert.equal(result.quarantine[another], undefined);
  const repeated = quarantineFromFailedVanscoFacebookPosts(result.quarantine, failed, vehicles, now + 1000);
  assert.equal(repeated.detected, 0);
  assert.equal(isVanscoMediaUrlFailure("There appears to be an issue with the Google Business API."), false);
  assert.equal(isVanscoMediaUrlFailure("Please update the media URL to be publicly accessible"), true);
});

test("Vansco media quarantine expires and can be refreshed without blacklisting every vehicle", () => {
  const now = Date.parse("2026-10-17T13:20:00Z");
  const url = "https://www.vansco.co.uk/van-example";
  let entries = quarantineVanscoVehicle({}, url, { now, periodMs: 3600000 });
  assert.deepEqual(Object.keys(activeVanscoMediaQuarantine(entries, now + 100)), [url]);
  assert.deepEqual(activeVanscoMediaQuarantine(entries, now + 3600001), {});
  assert.equal(quarantineVanscoVehicle({}, "https://untrusted.example/van", { now })["https://untrusted.example/van"], undefined);
});

test("Vansco Buffer preflight must fetch one image byte, even when HEAD would appear healthy", async () => {
  const url = "https://acdn.uk/vansco/i/example.jpeg";
  const response = (status=206, type="image/jpeg", length="250000") => ({
    ok: status >= 200 && status < 300, status,
    headers: { get(key) {
      return key === "content-type" ? type
        : key === "content-range" && status === 206 ? "bytes 0-0/" + length
        : key === "content-length" ? length : null;
    } },
    body: { cancel: async () => {} },
  });
  const calls = [];
  const ok = await preflightVanscoFacebookImage(url, async (_url, opts) => {
    calls.push(opts.method);
    assert.equal(opts.method, "GET");
    assert.equal(opts.headers.Range, "bytes=0-0");
    assert.equal(opts.redirect, "manual");
    return response();
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(calls, ["GET"]);
  const rejected = await preflightVanscoFacebookImage(url, async () => response(200, "text/html"));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, "not_an_image");
  const blocked = await preflightVanscoFacebookImage(url, async () => response(403));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "image_http_403");
  const oversized = await preflightVanscoFacebookImage(url, async () => response(206, "image/jpeg", "8100000"));
  assert.equal(oversized.ok, false);
  assert.equal(oversized.reason, "image_over_8mb");
  const networkBlocked = await preflightVanscoFacebookImage(url, async () => { throw new Error("refused"); });
  assert.equal(networkBlocked.ok, false);
  assert.equal(networkBlocked.reason, "image_get_unavailable");
  const all = await preflightVanscoFacebookImages([url,url,url], async () => response());
  assert.equal(all.ok, true);
  const unusable = await preflightVanscoFacebookImages([url,"https://127.0.0.1/secret.jpeg"], async () => response());
  assert.equal(unusable.ok, false);
  assert.equal(unusable.reason, "untrusted_image_host");
});

test("failed Vansco Google Business media only quarantines matching automated stock and branch", () => {
  const now = Date.parse("2026-10-18T09:20:00Z");
  const airport = "https://www.vansco.co.uk/ford-transit-airport-123";
  const forest = "https://www.vansco.co.uk/ford-transit-forest-456";
  const vehicles = [
    {registration:"AB12CDE",branchKey:"southamptonAirport",vehicleUrl:airport},
    {registration:"EF34GHI",branchKey:"newForest",vehicleUrl:forest},
  ];
  const failures = { southamptonAirport: [
    {postId:"image-one",dueAt:"2026-10-18T08:30:00Z",stockRegistration:"AB12CDE",
      message:"Please update the media URL to be publicly accessible before retrying the post."},
    {postId:"platform",dueAt:"2026-10-18T09:00:00Z",stockRegistration:"AB12CDE",
      message:"There appears to be an issue with the Google Business API."},
    {postId:"wrong-branch",dueAt:"2026-10-18T09:00:00Z",stockRegistration:"EF34GHI",
      message:"Media URL not accessible"},
    {postId:"unknown",dueAt:"2026-10-18T09:00:00Z",stockRegistration:"ZZ99ZZZ",
      message:"Media URL not accessible"},
  ] };
  const result = quarantineFromFailedVanscoGoogleBusinessPosts({},failures,vehicles,now);
  assert.equal(result.detected,1);
  assert.equal(result.quarantine[airport].postId,"image-one");
  assert.equal(result.quarantine[forest],undefined);
  const again=quarantineFromFailedVanscoGoogleBusinessPosts(result.quarantine,failures,vehicles,now+1000);
  assert.equal(again.detected,0);
});

test("Vansco Facebook refill excludes failed media and still seeks another eligible stock van", () => {
  const worker = readFileSync(new URL("../api/vansco-facebook-automation-worker.js",import.meta.url),"utf8");
  const runtime = readFileSync(new URL("../api/_vansco-buffer-runtime.js",import.meta.url),"utf8");
  assert.match(worker,/quarantineFromFailedVanscoFacebookPosts/);
  assert.match(worker,/\.\.\.Object.keys\(mediaQuarantine\)/);
  assert.match(worker,/MAX_IMAGE_CHECKS_PER_RUN = 15/);
  assert.match(worker,/preflightVanscoFacebookImages\(compatibleImages\)/);
  assert.match(worker,/saveVanscoFacebookMediaQuarantine\(activeVanscoMediaQuarantine\(mediaQuarantine\)\)/);
  assert.match(worker,/continue;[\s\S]*?posts.push\(post\)/);
  assert.match(runtime,/failedMediaPosts: posts\(/);
  assert.match(runtime,/filter: \{ status: \[error\], channelIds: \[\$channelId\] \}/);
  assert.doesNotMatch(worker,/deleteVanscoBufferPost\(\{.*failedMedia/);
  // The revised query shares the already-scheduled Buffer activity read.
  assert.match(runtime,/failedPosts: \(payload\?\.data\?\.failedMediaPosts\?\.edges/);
});

test("Vansco 333, Airport and New Forest precheck photo URLs independently before scheduling", () => {
  const worker = readFileSync(new URL("../api/vansco-google-business-automation-worker.js",import.meta.url),"utf8");
  const runtime = readFileSync(new URL("../api/_vansco-buffer-runtime.js",import.meta.url),"utf8");
  assert.match(worker,/MAX_GBP_IMAGE_CHECKS_PER_BRANCH = 12/);
  assert.match(worker,/preflightVanscoFacebookImage\(\s*vanscoBufferCompatibleImageUrl\(vehicle.imageUrl\)/);
  assert.match(worker,/vehicles: eligible.filter\(\(item\) => !mediaQuarantine\[item.vehicleUrl\]\)/);
  assert.match(worker,/if \(!checked.ok\) \{/);
  assert.match(worker,/periodMs: VANSCO_MEDIA_PREFLIGHT_FAILURE_MS/);
  assert.match(worker,/excludedRegistrations.add\(registration\);/);
  assert.match(worker,/saveVanscoGoogleBusinessMediaQuarantine\(activeVanscoMediaQuarantine\(mediaQuarantine\)\)/);
  assert.match(runtime,/GOOGLE_FAILED_MEDIA_PATH/);
  assert.match(worker,/quarantineFromFailedVanscoGoogleBusinessPosts/);
  assert.match(worker,/loadVanscoCachedFailedGoogleBusinessPosts/);
  assert.match(runtime,/loadVanscoCachedFailedGoogleBusinessPosts/);
  // A separate Google Business API error must NOT blacklist the source image.
  assert.doesNotMatch(worker.slice(worker.indexOf("} catch (error) {",worker.indexOf("createVanscoGoogleBusinessPost("))),/quarantineVanscoVehicle/);
});

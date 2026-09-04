import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { sourcesForPipeline } from "../api/stock-watch-wix-listing-presence.js";
import { countVanscoVehicleImages, extractVanscoVehicleImageUrls } from "../api/_vansco-image-gallery.js";
import { buildImageReadinessAlerts, MIN_VANSCO_IMAGE_COUNT } from "../api/vansco-image-readiness.js";

const FINANCE_WIX_SITE_ID = "85f11c52-ee54-495d-aaec-a351831709b5";
const LEGACY_RENT2BUY_WIX_SITE_ID = "548f025b-673c-47f7-9bb6-383ab5d946e4";

test("Cars live-presence authority is CARFINANCE only", () => {
  const sources = sourcesForPipeline("cars");
  assert.equal(sources.length, 1);
  assert.equal(sources[0].siteId, FINANCE_WIX_SITE_ID);
  assert.equal(sources[0].collectionId, "CARFINANCE");
});

test("Rent2Buy live-presence authority is ALLRENT2BUYVANS on VAN FINANCE Wix only", () => {
  const sources = sourcesForPipeline("rent2buy");
  assert.equal(sources.length, 1);
  assert.equal(sources[0].siteId, FINANCE_WIX_SITE_ID);
  assert.equal(sources[0].collectionId, "ALLRENT2BUYVANS");
  assert.equal(sources.some((source) => source.siteId === LEGACY_RENT2BUY_WIX_SITE_ID), false);
});

test("historic standalone Rent2Buy Wix CMS can never resurrect drafted vehicles", () => {
  const source = fs.readFileSync(new URL("../api/stock-watch-wix-listing-presence.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, new RegExp(LEGACY_RENT2BUY_WIX_SITE_ID.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(source, /Published ALLRENT2BUYVANS rows in the VAN FINANCE Wix CMS only/);
  assert.match(source, /must not[\s\S]*resurrect a vehicle that is already Draft/i);
});

test("full-page SEO collections are never part of listing presence authority", () => {
  const source = fs.readFileSync(new URL("../api/stock-watch-wix-listing-presence.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /CARPAGES/);
  assert.doesNotMatch(source, /VANPAGES/);
  assert.doesNotMatch(source, /VANFINANCEPAGES/);
});

test("Stock Watch replaces stale Cars and Rent2Buy CRM flags only after a complete Wix presence check", () => {
  const source = fs.readFileSync(new URL("../scripts/apply-wix-authoritative-stock-presence.mjs", import.meta.url), "utf8");
  assert.match(source, /pipeline === \"cars\" \|\| pipeline === \"rent2buy\"/);
  assert.match(source, /if \(presence\.complete\)/);
  assert.match(source, /effectiveRegistrations = \(presence\.registrations \|\| \[\]\)/);
  assert.match(source, /effectiveVehicles = vehicles\.filter/);
  assert.match(source, /Marketing CRM stock fallback/);
});

test("Stock Watch follow-up intersects Rent2Buy Wix presence with active CRM registrations", () => {
  const source = fs.readFileSync(new URL("../scripts/apply-vansco-stock-watch-followups.mjs", import.meta.url), "utf8");
  assert.match(source, /const liveRegistrationSet = new Set\(\(presence\.registrations \|\| \[\]\)/);
  assert.match(source, /effectiveRegistrations = vehicleRegistrations\.filter\(\(registration\) => liveRegistrationSet\.has\(registration\)\)/);
  assert.match(source, /const percent = complete \? 100/);
  assert.match(source, /Vansco now has at least 5 vehicle images/);
});

test("Vansco gallery counter keeps unique vehicle photos for the matching stock ID", () => {
  const stockUrl = "https://www.vansco.co.uk/vehicle-details/used-ford-transit-for-sale-u12345";
  const html = `
    <img src="https://img.cdn.dragon2000.net/C1723/U12345/IMG_100-large.jpg">
    <img src="https://img.cdn.dragon2000.net/C1723/U12345/IMG_100-thumb.jpg">
    <script>window.gallery=["https:\/\/img.cdn.dragon2000.net\/C1723\/U12345\/IMG_101-large.jpg"];</script>
    <img src="https://img.cdn.dragon2000.net/C1723/U99999/IMG_999-large.jpg">
    <img src="https://example.com/logo.png">
  `;

  const images = extractVanscoVehicleImageUrls(html, stockUrl);
  assert.equal(images.length, 2);
  assert.equal(countVanscoVehicleImages(html, stockUrl), 2);
});

test("image readiness requires CRM match + one-image CMS page + at least five Vansco images", () => {
  const base = {
    pipeline: "finance",
    localVehicles: [{ id: 1, title: "Ford Transit AB24CDE", weblink: "https://www.vanfinancecompany.co.uk/vehicle/ab24cde", is_active: true }],
    cmsItems: [{ registration: "AB24CDE", title: "Ford Transit", imageCount: 1, images: ["one.jpg"] }],
    cacheRows: [{ registration: "AB24CDE", title: "Ford Transit", image_url: "vansco.jpg", stock_url: "https://www.vansco.co.uk/vehicle-details/transit-u12345", source_status: "available", is_currently_on_vansco: true }],
    sourceImageCounts: { AB24CDE: 12 },
  };

  assert.equal(MIN_VANSCO_IMAGE_COUNT, 5);

  const alerts = buildImageReadinessAlerts(base);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].displayStatus, "images_ready");
  assert.equal(alerts[0].cmsImageCount, 1);
  assert.equal(alerts[0].sourceImageCount, 12);

  assert.equal(buildImageReadinessAlerts({ ...base, sourceImageCounts: { AB24CDE: 4 } }).length, 0, "four Vansco images must not alert");
  assert.equal(buildImageReadinessAlerts({ ...base, sourceImageCounts: { AB24CDE: 5 } }).length, 1, "five Vansco images must alert");
  assert.equal(buildImageReadinessAlerts({ ...base, cmsItems: [{ ...base.cmsItems[0], imageCount: 2, images: ["one.jpg", "two.jpg"] }] }).length, 0, "completed CMS gallery must suppress later source changes");
  assert.equal(buildImageReadinessAlerts({ ...base, localVehicles: [] }).length, 0, "vehicle not advertised in this CRM must not alert");
  assert.equal(buildImageReadinessAlerts({ ...base, cacheRows: [] }).length, 0, "vehicle without a current Vansco match must not alert");
});

test("Rent2Buy image readiness stays in the Rent2Buy registration set", () => {
  const alerts = buildImageReadinessAlerts({
    pipeline: "rent2buy",
    localVehicles: [{ id: 2, registration: "RO21VVD", webLink: "https://www.rent2buyvans.co.uk/vehicle/ro21vvd", is_active: true }],
    cmsItems: [{ registration: "RO21VVD", imageCount: 1, images: ["one.jpg"] }],
    cacheRows: [{ registration: "RO21VVD", title: "Rent2Buy van", stock_url: "https://www.vansco.co.uk/vehicle-details/van-u12346", is_currently_on_vansco: true }],
    sourceImageCounts: { RO21VVD: 8 },
  });

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].pipeline, "rent2buy");
});

test("Stock Watch build transform wires image counts and never relies on Due In wording", () => {
  const transform = fs.readFileSync(new URL("../scripts/apply-wix-authoritative-stock-presence.mjs", import.meta.url), "utf8");
  const apiSource = fs.readFileSync(new URL("../api/vansco-image-readiness.js", import.meta.url), "utf8");

  assert.match(transform, /fetchVanscoImageReadiness/);
  assert.match(transform, /countVanscoVehicleImages/);
  assert.match(transform, /imageCountsByRegistration/);
  assert.match(transform, /New Vansco photos ready/);
  assert.doesNotMatch(apiSource, /due\s+in/i);
  assert.match(apiSource, /pageImageCount !== 1/);
  assert.match(apiSource, /sourceImageCount === null \|\| sourceImageCount < MIN_VANSCO_IMAGE_COUNT/);
  assert.match(apiSource, /localVehicle = localByRegistration\.get\(registration\)/);
});
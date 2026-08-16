import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  clearPublicWixVehicleContextCache,
  inferPublicWixPageContext,
  resolvePublicWixPageContext,
} from "../lib/publicWixSiteContext.js";

const environment = {
  WIX_API_KEY: "wix-test-key",
  WIX_SITE_ID: "site-test-id",
};

function wixResponse(dataItems) {
  return {
    ok: true,
    status: 200,
    async json() { return { dataItems }; },
  };
}

function htmlResponse(html) {
  return {
    ok: true,
    status: 200,
    async text() { return html; },
  };
}

test("site-wide route inference recognises Finance and Rent2Buy vehicle URLs without page Velo", () => {
  const finance = inferPublicWixPageContext("https://www.vanfinancecompany.co.uk/van-finance/ab12cde");
  assert.equal(finance.page_type, "finance_vehicle");
  assert.equal(finance.collection_id, "VANFINANCEPAGES");
  assert.equal(finance.registration, "AB12CDE");

  const rent2buy = inferPublicWixPageContext("https://www.vanfinancecompany.co.uk/guaranteed-rent2buy-vans/yr22okj");
  assert.equal(rent2buy.page_type, "rent2buy_general");
  assert.equal(rent2buy.collection_id, "VANPAGES");
  assert.equal(rent2buy.registration, "YR22OKJ");
});

test("site-wide route inference locks obvious product pages and leaves unknown pages as product choice", () => {
  assert.equal(inferPublicWixPageContext("https://www.vanfinancecompany.co.uk/rent2buy-vans").page_type, "rent2buy_general");
  assert.equal(inferPublicWixPageContext("https://www.vanfinancecompany.co.uk/van-finance-small-vans").page_type, "finance_general");
  assert.equal(inferPublicWixPageContext("https://www.vanfinancecompany.co.uk/").page_type, "homepage");
  assert.equal(inferPublicWixPageContext("https://www.vanfinancecompany.co.uk/contact").page_type, "homepage");
  assert.throws(() => inferPublicWixPageContext("https://example.com/van-finance/ab12cde"), /Van Finance Company/);
});

test("Finance vehicle context is read server-side from VANFINANCEPAGES with description and specification", async () => {
  clearPublicWixVehicleContextCache();
  let request = null;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return wixResponse([{
      id: "finance-item-1",
      data: {
        title: "AB12CDE",
        titleText: "Ford Transit Custom Limited",
        year: "2022/22",
        descriptionLine: "LIMITED - AIR CON - CRUISE CONTROL",
        vehicleDescriptionTextClick: "A clean Transit Custom with useful working-van equipment.",
        vehicleSpecificationText: "REGISTRATION: AB12 CDE\nYEAR: 2022/22\nMILEAGE: 42,000\nTRANSMISSION: MANUAL",
        applyLink: "/apply/ab12cde",
        mthPrice: "£399 + VAT",
        priceVat: "£19,995 + VAT",
      },
    }]);
  };

  const context = await resolvePublicWixPageContext("https://www.vanfinancecompany.co.uk/van-finance/ab12cde", { environment, fetchImpl });
  assert.equal(context.page_type, "finance_vehicle");
  assert.equal(context.vehicle.registration, "AB12CDE");
  assert.equal(context.vehicle.vehicle_id, "finance-item-1");
  assert.equal(context.vehicle.title, "Ford Transit Custom Limited");
  assert.equal(context.vehicle.year, "2022/22");
  assert.match(context.vehicle.description, /clean Transit Custom/);
  assert.match(context.vehicle.highlights, /AIR CON/);
  assert.match(context.vehicle.specification, /42,000/);
  assert.equal(context.vehicle.apply_link, "/apply/ab12cde");
  assert.equal(context.vehicle.pricing.finance_monthly, "£399 + VAT");
  assert.equal(context.vehicle.pricing.finance_retail_vat, "£19,995 + VAT");
  assert.match(request.url, /\/wix-data\/v2\/items\/query$/);
  assert.equal(request.options.headers.Authorization, "wix-test-key");
  assert.equal(request.options.headers["wix-site-id"], "site-test-id");
  const body = JSON.parse(request.options.body);
  assert.equal(body.dataCollectionId, "VANFINANCEPAGES");
  assert.equal(body.query.filter.title.$eq, "AB12CDE");
});

test("Rent2Buy vehicle context is read CMS-first from mirrored VANPAGES with rich details and fixed pricing", async () => {
  clearPublicWixVehicleContextCache();
  let cmsCalls = 0;
  const fetchImpl = async (url) => {
    if (url.startsWith("https://www.wixapis.com")) {
      cmsCalls += 1;
      return wixResponse([{
        id: "rent-item-1",
        data: {
          title: "YR22OKJ",
          titleText: "Peugeot Boxer Professional",
          year: "2022/22",
          descriptionText: "Professional Boxer prepared for Rent2Buy.",
          vehcleTickDescription: "AIR CONDITIONING - BLUETOOTH",
          specText: "REGISTRATION: YR22 OKJ\nMILEAGE: 50,000\nTRANSMISSION: MANUAL",
          applyLink: "/rent2buy-apply/yr22okj",
          intialRentalCharge: "£1,800 + VAT / £2,160 inc VAT",
          monthlyPayments: "£515 + VAT / £618 inc VAT",
          numberOfMonths: 48,
        },
      }]);
    }
    throw new Error("Public HTML should not be requested after successful CMS lookup");
  };

  const context = await resolvePublicWixPageContext("https://www.rent2buyvans.co.uk/van-pages/yr22okj", { environment, fetchImpl });
  assert.equal(cmsCalls, 1);
  assert.equal(context.page_type, "rent2buy_general");
  assert.equal(context.vehicle.registration, "YR22OKJ");
  assert.equal(context.vehicle.vehicle_id, "rent-item-1");
  assert.equal(context.vehicle.title, "Peugeot Boxer Professional");
  assert.equal(context.vehicle.year, "2022/22");
  assert.match(context.vehicle.description, /Rent2Buy/);
  assert.match(context.vehicle.highlights, /BLUETOOTH/);
  assert.match(context.vehicle.specification, /50,000/);
  assert.equal(context.vehicle.pricing.rent2buy_monthly, "£515 + VAT / £618 inc VAT");
  assert.equal(context.vehicle.pricing.rent2buy_initial, "£1,800 + VAT / £2,160 inc VAT");
  assert.equal("term_months" in context.vehicle, false);
});

test("Finance vehicle context falls back to the trusted live page when Wix Data lookup fails", async () => {
  clearPublicWixVehicleContextCache();
  const pageUrl = "https://www.vanfinancecompany.co.uk/van-finance/hx24zgr";
  const fetchImpl = async (url) => {
    if (url === pageUrl) {
      return htmlResponse(`
        <html><body>
          <h5>Ford Ranger 2.0 TD Wild Track</h5>
          <div>£29,995 +VAT</div>
          <div>FINANCE FROM ONLY</div><div>MONTH</div><h2>£625</h2>
          <div>REGISTRATION: HX24 ZGR</div>
        </body></html>
      `);
    }
    return { ok: false, status: 403, async json() { return {}; } };
  };

  const context = await resolvePublicWixPageContext(pageUrl, { environment, fetchImpl });
  assert.equal(context.page_type, "finance_vehicle");
  assert.equal(context.vehicle.registration, "HX24ZGR");
  assert.equal(context.vehicle.pricing.finance_monthly, "£625");
  assert.equal(context.vehicle.pricing.finance_retail_vat, "£29,995 +VAT");
});

test("Rent2Buy fallback reads fixed initial and monthly pricing without exposing agreement length", async () => {
  clearPublicWixVehicleContextCache();
  const pageUrl = "https://www.rent2buyvans.co.uk/van-pages/lj23apm";
  const fetchImpl = async (url) => {
    if (url === pageUrl) {
      return htmlResponse(`
        <html><body>
          <h5>2023/73 MAXUS eDeliver 3 ELECTRIC / AUTO</h5>
          <div>REGISTRATION: LJ23 APM</div>
          <h5>INITIAL RENTAL CHARGE</h5><h5>£1176 +VAT (£1412 INC VAT)</h5>
          <h5>MONTHLY PAYMENTS</h5><h5>£392 +VAT (£471 INC VAT)</h5>
          <h5>36X MONTHLY PAYMENTS</h5>
        </body></html>
      `);
    }
    return { ok: false, status: 503, async json() { return {}; } };
  };

  const context = await resolvePublicWixPageContext(pageUrl, { environment: {}, fetchImpl });
  assert.equal(context.page_type, "rent2buy_general");
  assert.equal(context.vehicle.registration, "LJ23APM");
  assert.equal(context.vehicle.pricing.rent2buy_initial, "£1176 +VAT (£1412 INC VAT)");
  assert.equal(context.vehicle.pricing.rent2buy_monthly, "£392 +VAT (£471 INC VAT)");
  assert.equal("term_months" in context.vehicle, false);
});

test("vehicle lookup failure degrades safely to identity-only context rather than inventing prices", async () => {
  clearPublicWixVehicleContextCache();
  const fetchImpl = async (url) => {
    if (url.startsWith("https://www.wixapis.com")) {
      return { ok: false, status: 503, async json() { return {}; } };
    }
    return { ok: false, status: 503, async text() { return ""; } };
  };
  const context = await resolvePublicWixPageContext("https://www.vanfinancecompany.co.uk/van-finance/ab12cde", { environment, fetchImpl });
  assert.equal(context.page_type, "finance_vehicle");
  assert.equal(context.vehicle.registration, "AB12CDE");
  assert.deepEqual(context.vehicle.pricing, {});
});

test("site-wide endpoint replaces browser page context with the server-resolved page URL context", async () => {
  const source = await readFile(new URL("../api/ai-assistant-sitewide.js", import.meta.url), "utf8");
  assert.match(source, /resolvePublicWixPageContext\(pageUrl/);
  assert.match(source, /page_context: pageContext/);
  assert.match(source, /validateWixOrigin/);
  assert.doesNotMatch(source, /body\.page_context\s*\|\|/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  clearPublicWixVehicleContextCache,
  inferPublicWixPageContext,
  resolvePublicWixPageContext,
} from "../lib/publicWixSiteContext.js";
import { initialCustomerReply } from "../lib/publicAssistantFoundation.js";

test("standalone Rent2Buy homepage is locked to Rent2Buy without a product choice", () => {
  for (const url of [
    "https://www.rent2buyvans.co.uk/",
    "https://rent2buyvans.co.uk/",
    "https://www.rent2buyvans.co.uk/finance",
    "https://www.rent2buyvans.co.uk/contact",
  ]) {
    const context = inferPublicWixPageContext(url);
    assert.equal(context.page_type, "rent2buy_general", url);
    assert.equal(context.product, "rent2buy", url);
    assert.equal(context.collection_id, null, url);
  }
});

test("standalone Rent2Buy vehicle route resolves mirrored VANPAGES identity without page Velo", () => {
  const context = inferPublicWixPageContext("https://www.rent2buyvans.co.uk/van-pages/bl72vff");
  assert.equal(context.page_type, "rent2buy_general");
  assert.equal(context.product, "rent2buy");
  assert.equal(context.collection_id, "VANPAGES");
  assert.equal(context.registration, "BL72VFF");
  assert.equal(context.public_page_first, false);
});

test("standalone Rent2Buy vehicle profile is read from mirrored VANPAGES CMS before public HTML", async () => {
  clearPublicWixVehicleContextCache();
  const pageUrl = "https://www.rent2buyvans.co.uk/van-pages/bl72vff";
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    if (String(url).startsWith("https://www.wixapis.com")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            dataItems: [{
              id: "r2b-bl72vff",
              data: {
                title: "BL72VFF",
                titleText: "Ford Transit Custom Trend",
                year: "2022/72",
                descriptionText: "Ford Transit Custom prepared for Rent2Buy.",
                vehcleTickDescription: "AIR CONDITIONING - CRUISE CONTROL - PARKING SENSORS",
                specText: "REGISTRATION: BL72 VFF\nMILEAGE: 61,000\nFUEL TYPE: DIESEL\nTRANSMISSION: MANUAL",
                intialRentalCharge: "£2350 +VAT (£2820 INC VAT)",
                monthlyPayments: "£745 +VAT (£894 INC VAT)",
                numberOfMonths: 48,
              },
            }],
          };
        },
      };
    }
    throw new Error(`Public HTML should not be requested: ${url}`);
  };

  const context = await resolvePublicWixPageContext(pageUrl, {
    environment: {
      WIX_API_KEY: "main-site-key",
      WIX_SITE_ID: "main-site-id",
    },
    fetchImpl,
  });

  assert.equal(context.page_type, "rent2buy_general");
  assert.equal(context.vehicle.registration, "BL72VFF");
  assert.equal(context.vehicle.title, "Ford Transit Custom Trend");
  assert.match(context.vehicle.specification, /61,000/);
  assert.match(context.vehicle.highlights, /AIR CONDITIONING/);
  assert.equal(context.vehicle.pricing.rent2buy_initial, "£2350 +VAT (£2820 INC VAT)");
  assert.equal(context.vehicle.pricing.rent2buy_monthly, "£745 +VAT (£894 INC VAT)");
  assert.equal("term_months" in context.vehicle, false);
  assert.equal(requests.length, 1);
  assert.equal(requests.every((url) => String(url).startsWith("https://www.wixapis.com")), true);
});

test("standalone Rent2Buy loader is hard locked to Rent2Buy and contains no Wix page hooks", async () => {
  const loader = await readFile(new URL("../public/wix-ai-assistant/site-loader.js", import.meta.url), "utf8");
  assert.match(loader, /rent2buyvans\.co\.uk/);
  assert.match(loader, /van-pages/);
  assert.match(loader, /pageType: "rent2buy_general"/);
  assert.match(loader, /productContext: "rent2buy"/);
  assert.match(loader, /activeContext\.pageType === "homepage"/);
  assert.doesNotMatch(loader, /#dynamicDataset|installDynamicVehicleAiAssistantWidget|wix-data/);
});

test("hosted assistant may be framed by both Rent2Buy production domains", async () => {
  const configuration = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const policy = configuration.headers?.find((entry) => entry.source === "/wix-ai-assistant/embed.html");
  const csp = policy?.headers?.find((header) => header.key === "Content-Security-Policy")?.value || "";
  assert.match(csp, /https:\/\/rent2buyvans\.co\.uk/);
  assert.match(csp, /https:\/\/www\.rent2buyvans\.co\.uk/);
  assert.doesNotMatch(csp, /frame-ancestors \*/);
});

test("vehicle greetings advertise only supported finance or Rent2Buy help", () => {
  assert.equal(
    initialCustomerReply("finance_vehicle", { registration: "AB12CDE" }),
    "Hi — I can help with finance, pricing and applying for this van. What would you like to know?",
  );
  assert.equal(
    initialCustomerReply("rent2buy_general", { registration: "BL72VFF" }),
    "Hi — I can help with Rent2Buy costs, terms and applying for this van. What would you like to know?",
  );
  assert.doesNotMatch(initialCustomerReply("finance_vehicle", { registration: "AB12CDE" }), /anything about this van/i);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  clearPublicWixVehicleContextCache,
  inferPublicWixPageContext,
  resolvePublicWixPageContext,
} from "../lib/publicWixSiteContext.js";
import { initialCustomerReply } from "../lib/publicAssistantFoundation.js";

function htmlResponse(html) {
  return {
    ok: true,
    status: 200,
    async text() { return html; },
  };
}

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

test("standalone Rent2Buy vehicle route resolves VANPAGES identity without page Velo", () => {
  const context = inferPublicWixPageContext("https://www.rent2buyvans.co.uk/van-pages/bl72vff");
  assert.equal(context.page_type, "rent2buy_general");
  assert.equal(context.product, "rent2buy");
  assert.equal(context.collection_id, "VANPAGES");
  assert.equal(context.registration, "BL72VFF");
  assert.equal(context.public_page_first, true);
});

test("standalone Rent2Buy vehicle pricing is read from its trusted live page before any Wix API lookup", async () => {
  clearPublicWixVehicleContextCache();
  const pageUrl = "https://www.rent2buyvans.co.uk/van-pages/bl72vff";
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    if (url === pageUrl) {
      return htmlResponse(`
        <html><body>
          <div>REGISTRATION: BL72 VFF</div>
          <h5>INITIAL RENTAL CHARGE</h5><h5>£2350 +VAT (£2820 INC VAT)</h5>
          <h5>MONTHLY PAYMENTS</h5><h5>£745 +VAT (£894 INC VAT)</h5>
          <h5>48X MONTHLY PAYMENTS</h5>
        </body></html>
      `);
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const context = await resolvePublicWixPageContext(pageUrl, {
    environment: {
      WIX_API_KEY: "main-site-key-must-not-be-used",
      WIX_SITE_ID: "main-site-id-must-not-be-used",
    },
    fetchImpl,
  });

  assert.equal(context.page_type, "rent2buy_general");
  assert.equal(context.vehicle.registration, "BL72VFF");
  assert.equal(context.vehicle.pricing.rent2buy_initial, "£2350 +VAT (£2820 INC VAT)");
  assert.equal(context.vehicle.pricing.rent2buy_monthly, "£745 +VAT (£894 INC VAT)");
  assert.equal(context.vehicle.term_months, 48);
  assert.deepEqual(requests, [pageUrl]);
  assert.equal(requests.some((url) => String(url).startsWith("https://www.wixapis.com")), false);
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

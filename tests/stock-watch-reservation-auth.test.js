import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import financeReservedHandler from "../api/finance-reserved-wix-stock.js";
import rent2buyReservedHandler from "../api/rent2buy-reserved-wix-stock.js";
import carReservedHandler from "../api/car-reserved-wix-stock.js";

function responseCapture() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

test("reserved Wix endpoints fail closed without Marketing CRM access", async () => {
  for (const handler of [financeReservedHandler, rent2buyReservedHandler, carReservedHandler]) {
    const response = responseCapture();
    await handler({ method: "POST", headers: {}, body: { action: "unpublish", registration: "LC72YEG", confirmed: true } }, response);
    assert.equal(response.statusCode, 401);
    assert.match(String(response.body?.message || ""), /Marketing CRM access is required/i);
  }
});

test("reserved Wix browser services send the existing Marketing access header", () => {
  for (const path of [
    "../services/financeReservedWixStock.js",
    "../services/rent2buyReservedWixStock.js",
    "../services/carReservedWixStock.js",
  ]) {
    const source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /buildMarketingAccessHeaders/);
  }
});

test("reservation auth is applied after monitor instrumentation", () => {
  const source = fs.readFileSync(new URL("../scripts/apply-stock-watch-monitor-cron-auth.mjs", import.meta.url), "utf8");
  assert.match(source, /apply-stock-watch-reservation-auth\.mjs/);
});

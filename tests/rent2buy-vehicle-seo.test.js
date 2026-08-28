import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildRent2BuyVehicleSeoTitle, normalizeRent2BuyRegistration } from "../lib/rent2buyVehicleSeo.js";

test("builds a unique Rent2Buy vehicle title from existing CMS fields", () => {
  assert.equal(
    buildRent2BuyVehicleSeoTitle({ titleText: "Ford Transit 350 EcoBlue DROPSIDE", year: "2019/19" }),
    "2019 Ford Transit 350 EcoBlue DROPSIDE | Rent2Buy Vans"
  );
});

test("trims unusually long vehicle names without losing the Rent2Buy brand suffix", () => {
  const title = buildRent2BuyVehicleSeoTitle({
    titleText: "Mercedes-Benz Sprinter 314 CDI Premium Extra Long Wheelbase High Roof Business Edition",
    year: "2021/71",
  });
  assert.ok(title.length <= 68);
  assert.match(title, /^2021 /);
  assert.match(title, / \| Rent2Buy Vans$/);
});

test("normalizes vehicle registrations for safe lookup", () => {
  assert.equal(normalizeRent2BuyRegistration("CN19 VNL"), "CN19VNL");
  assert.equal(normalizeRent2BuyRegistration("cn19vnl"), "CN19VNL");
  assert.equal(normalizeRent2BuyRegistration("not a registration"), "");
});

test("Rent2Buy site helpers pause route polling while the page is hidden", async () => {
  const loaders = await Promise.all([
    readFile(new URL("../public/rent2buy-stock-helper/site-loader.js", import.meta.url), "utf8"),
    readFile(new URL("../public/rent2buy-vehicle-seo/site-loader.js", import.meta.url), "utf8"),
  ]);

  for (const loader of loaders) {
    assert.match(loader, /visibilitychange/);
    assert.match(loader, /document\.hidden/);
    assert.match(loader, /clearInterval\(routeTimer\)/);
  }
});

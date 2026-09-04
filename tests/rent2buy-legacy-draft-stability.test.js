import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const FINANCE_WIX_SITE_ID = "85f11c52-ee54-495d-aaec-a351831709b5";
const LEGACY_RENT2BUY_WIX_SITE_ID = "548f025b-673c-47f7-9bb6-383ab5d946e4";

const apiSource = () => fs.readFileSync(new URL("../api/rent2buy-reserved-wix-stock.js", import.meta.url), "utf8");
const transformSource = () => fs.readFileSync(new URL("../scripts/apply-rent2buy-legacy-draft-stability.mjs", import.meta.url), "utf8");

test("authoritative Rent2Buy API contains Finance Wix and excludes the historic standalone site", () => {
  const source = apiSource();
  assert.match(source, new RegExp(FINANCE_WIX_SITE_ID));
  assert.doesNotMatch(source, new RegExp(LEGACY_RENT2BUY_WIX_SITE_ID));
  assert.match(source, /VAN FINANCE Wix Rent2Buy CMS only/);
});

test("Rent2Buy Draft writes are ordered and use the Finance Wix credentials", () => {
  const source = apiSource();
  assert.match(source, /for \(const match of preview\.matches\)/);
  assert.match(source, /WIX_FINANCE_API_KEY/);
  assert.doesNotMatch(source, /WIX_RENT2BUY_API_KEY/);
});

test("single-CMS build guard refuses any reintroduction of the old standalone Wix site", () => {
  const source = transformSource();
  assert.match(source, new RegExp(LEGACY_RENT2BUY_WIX_SITE_ID));
  assert.match(source, /historic RENT2BUY VANS Wix site must not be an API authority/);
  assert.match(source, /authoritative VAN FINANCE Wix CMS/);
});

test("single-CMS change preserves Rent2Buy safety barriers", () => {
  const source = apiSource();
  assert.doesNotMatch(source, /method:\s*["']DELETE["']/i);
  assert.match(source, /VAN PAGES is hard protected and can never be moved to draft/);
  assert.match(source, /SET_DRAFT_STATUS/);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../utils/creativeUtils.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../App.jsx", import.meta.url), "utf8");
const marketplace = fs.readFileSync(new URL("../services/marketplaceAutomation.js", import.meta.url), "utf8");

test("Rent2Buy Marketplace uses the same caption template as Rent2Buy Facebook", () => {
  const start = source.indexOf("export function buildPostingCaption(");
  const end = source.indexOf("export function buildCarFinancePostingCaption(", start);
  assert.ok(start >= 0 && end > start, "posting caption function must exist");
  const builder = source.slice(start, end);
  const rentBranch = builder.indexOf('if (destination === "Rent2Buy Facebook" || destination === "Rent2Buy Marketplace")');
  const financeBranch = builder.indexOf("const financeHooks =");
  assert.ok(rentBranch >= 0, "both Rent2Buy destinations must share their caption template");
  assert.ok(financeBranch > rentBranch, "Rent2Buy branch must precede Van Finance fallback");
  assert.match(builder.slice(rentBranch, financeBranch), /NO CREDIT CHECK/);
  assert.match(builder.slice(rentBranch, financeBranch), /RENT IT!/);
  assert.doesNotMatch(builder.slice(rentBranch, financeBranch), /VAN FINANCE COMPANY/);
});

test("Marketplace continues to pass generated caption into Rent2Buy helper", () => {
  assert.match(app, /caption: buildPostingCaption\(vehicle, \{ destination: "Rent2Buy Marketplace", index \}\)/);
  assert.match(marketplace, /description: ensureVisitLine\(caption\)/);
});

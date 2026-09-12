import { readFile, writeFile } from "node:fs/promises";
import {
  transformRent2BuyVatSource,
  transformVanFinanceVatSource,
} from "./dealerkit-vat-publishing-transform.mjs";

const vfcUrl = new URL("../lib/dealerKitWixCreatePlan.js", import.meta.url);
const rent2BuyUrl = new URL("../lib/dealerKitRent2BuyPlan.js", import.meta.url);

const [vfcSource, rent2BuySource] = await Promise.all([
  readFile(vfcUrl, "utf8"),
  readFile(rent2BuyUrl, "utf8"),
]);

const nextVfcSource = transformVanFinanceVatSource(vfcSource);
const nextRent2BuySource = transformRent2BuyVatSource(rent2BuySource);

await Promise.all([
  writeFile(vfcUrl, nextVfcSource),
  writeFile(rent2BuyUrl, nextRent2BuySource),
]);

if (!nextVfcSource.includes("DEALERKIT_VFC_VAT_POLICY")) {
  throw new Error("DealerKit Van Finance VAT policy was not applied.");
}
if (!nextRent2BuySource.includes("DEALERKIT_RENT2BUY_VAT_POLICY")) {
  throw new Error("DealerKit Rent2Buy VAT policy was not applied.");
}

console.log("Applied DealerKit VAT publishing policy for Van Finance and Rent2Buy.");

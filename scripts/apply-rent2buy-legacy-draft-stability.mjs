import fs from "node:fs";
import { fileURLToPath } from "node:url";

const targetUrl = new URL("../api/rent2buy-reserved-wix-stock.js", import.meta.url);
const targetPath = fileURLToPath(targetUrl);
let source = fs.readFileSync(targetPath, "utf8");

function replaceOnce(before, after, label) {
  const first = source.indexOf(before);
  if (first === -1) throw new Error(`Rent2Buy legacy Draft stability transform could not find: ${label}`);
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`Rent2Buy legacy Draft stability transform found duplicate anchor: ${label}`);
  }
  source = source.replace(before, after);
}

if (!source.includes("const TASK_MAX_POLLS = 30;")) {
  replaceOnce(
    "const TASK_MAX_POLLS = 12;",
    "const TASK_MAX_POLLS = 30;",
    "legacy Wix task polling window"
  );
}

if (!source.includes("async function settleDraftMatchesSafely(matches)")) {
  replaceOnce(
    "export async function unpublishReservedRent2BuyWixStock(registrationValue) {",
`async function settleDraftMatchesSafely(matches) {
  const settled = new Array(matches.length);
  const indexedMatches = matches.map((match, index) => ({ match, index }));
  const legacySiteId = RENT2BUY_WIX_SITES[1].id;
  const directMatches = indexedMatches.filter(({ match }) => match.siteId !== legacySiteId);
  const legacyMatches = indexedMatches.filter(({ match }) => match.siteId === legacySiteId);

  await Promise.all(directMatches.map(async ({ match, index }) => {
    try {
      settled[index] = { status: "fulfilled", value: await setDraftMatch(match) };
    } catch (reason) {
      settled[index] = { status: "rejected", reason };
    }
  }));

  // The old RENT2BUY VANS Wix collections use background publish-status tasks.
  // Run those one at a time so duplicate/category rows do not race each other
  // through the same legacy collection task queue.
  for (const { match, index } of legacyMatches) {
    try {
      settled[index] = { status: "fulfilled", value: await setDraftMatch(match) };
    } catch (reason) {
      settled[index] = { status: "rejected", reason };
    }
  }

  return settled;
}

export async function unpublishReservedRent2BuyWixStock(registrationValue) {`,
    "safe legacy Wix task settlement helper"
  );
}

if (source.includes("const settled = await Promise.allSettled(preview.matches.map(setDraftMatch));")) {
  replaceOnce(
    "const settled = await Promise.allSettled(preview.matches.map(setDraftMatch));",
    "const settled = await settleDraftMatchesSafely(preview.matches);",
    "concurrent Rent2Buy Draft actions"
  );
}

fs.writeFileSync(targetPath, source);
console.log("Applied Rent2Buy legacy Draft stability: 30-second polling and sequential old-site background tasks.");

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  executeDealerKitReservedWixMutations,
} from "../api/_dealerkit-reservation-mutation-safety.js";
import {
  previewReservedFinanceWixStock,
  unpublishReservedFinanceWixStock,
} from "../services/financeReservedWixStock.js";
import {
  previewReservedCarWixStock,
  unpublishReservedCarWixStock,
} from "../services/carReservedWixStock.js";
import {
  previewReservedRent2BuyWixStock,
  unpublishReservedRent2BuyWixStock,
} from "../services/rent2buyReservedWixStock.js";

const completePreview = {
  matches: [{ collectionId: "SAFE", collectionLabel: "Safe listing", itemId: "wix-item-1" }],
  collections: [{ id: "SAFE", label: "Safe listing", error: "", matches: [] }],
};

test("exact DealerKit identity is verified before the Wix scan and immediately before the write", async () => {
  const sequence = [];
  const verifyDealerKit = async (registration, options) => {
    sequence.push("verify");
    assert.equal(registration, "LC72YEG");
    assert.equal(options.supplierStockId, "dealerkit-stock-42");
    return { registration, supplierStockId: options.supplierStockId, sourceStatus: "reserved" };
  };

  const result = await executeDealerKitReservedWixMutations({
    registrationValue: "LC72 YEG",
    supplierStockId: "dealerkit-stock-42",
    verifyDealerKit,
    loadPreview: async () => { sequence.push("preview"); return completePreview; },
    mutateMatch: async (match) => { sequence.push("mutate"); return match; },
  });

  assert.deepEqual(sequence, ["verify", "preview", "verify", "mutate"]);
  assert.equal(result.results[0].ok, true);
});

test("a mismatched DealerKit stock ID blocks the Wix scan and mutation", async () => {
  let previewCalls = 0;
  let mutationCalls = 0;
  await assert.rejects(
    executeDealerKitReservedWixMutations({
      registrationValue: "LC72YEG",
      supplierStockId: "wrong-stock-id",
      verifyDealerKit: async () => { throw new Error("Safety stop: stock ID returned another registration. Nothing was changed in Wix."); },
      loadPreview: async () => { previewCalls += 1; return completePreview; },
      mutateMatch: async () => { mutationCalls += 1; },
    }),
    /another registration/i,
  );
  assert.equal(previewCalls, 0);
  assert.equal(mutationCalls, 0);
});

test("failed required Wix reads fail closed instead of becoming a successful changed zero", async () => {
  let mutationCalls = 0;
  await assert.rejects(
    executeDealerKitReservedWixMutations({
      registrationValue: "LC72YEG",
      supplierStockId: "dealerkit-stock-42",
      verifyDealerKit: async () => ({ sourceStatus: "reserved" }),
      loadPreview: async () => ({
        matches: [],
        collections: [{ id: "COLLECTION", label: "Required collection", error: "Wix returned 503", matches: [] }],
      }),
      mutateMatch: async () => { mutationCalls += 1; },
    }),
    /Wix could not be fully verified.*Nothing was changed in Wix/i,
  );
  assert.equal(mutationCalls, 0);
});

test("DealerKit status changing at the final recheck blocks the destructive Wix call", async () => {
  let verificationCalls = 0;
  let mutationCalls = 0;
  const result = await executeDealerKitReservedWixMutations({
    registrationValue: "LC72YEG",
    supplierStockId: "dealerkit-stock-42",
    verifyDealerKit: async () => {
      verificationCalls += 1;
      if (verificationCalls === 2) throw new Error("Safety stop: DealerKit now shows Available. Nothing was changed in Wix.");
      return { sourceStatus: "reserved" };
    },
    loadPreview: async () => completePreview,
    mutateMatch: async () => { mutationCalls += 1; },
  });

  assert.equal(result.verificationStopped, true);
  assert.equal(result.results[0].safetyStop, true);
  assert.equal(mutationCalls, 0);
});

test("reservation browser services carry supplier_stock_id in preview and unpublish payloads", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  try {
    for (const [preview, unpublish] of [
      [previewReservedFinanceWixStock, unpublishReservedFinanceWixStock],
      [previewReservedCarWixStock, unpublishReservedCarWixStock],
      [previewReservedRent2BuyWixStock, unpublishReservedRent2BuyWixStock],
    ]) {
      await preview("LC72YEG", "dealerkit-stock-42");
      await unpublish("LC72YEG", "dealerkit-stock-42");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requests.length, 6);
  assert.equal(requests.every((request) => request.body.supplier_stock_id === "dealerkit-stock-42"), true);
  assert.equal(requests.filter((request) => request.body.action === "unpublish").every((request) => request.body.confirmed === true), true);
});

test("final safety transform is ordered after UI, monitor and auth transforms", () => {
  const packageJson = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const build = packageJson.scripts.build;
  const finalIndex = build.indexOf("apply-dealerkit-reservation-final-safety.mjs");
  assert.ok(finalIndex > build.indexOf("apply-stock-watch-monitor-agent.mjs"));
  assert.ok(finalIndex > build.indexOf("apply-stock-watch-monitor-cron-auth.mjs"));
  assert.ok(finalIndex > build.indexOf("apply-dealerkit-readiness-monitor-fix.mjs"));
});

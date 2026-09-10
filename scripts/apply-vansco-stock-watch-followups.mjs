import fs from "node:fs";
import { fileURLToPath } from "node:url";

function patchFile(relativePath, patches) {
  const targetUrl = new URL(relativePath, import.meta.url);
  const targetPath = fileURLToPath(targetUrl);
  let source = fs.readFileSync(targetPath, "utf8");

  for (const { before, after, label, already } of patches) {
    if (already && source.includes(already)) continue;
    const first = source.indexOf(before);
    if (first === -1) throw new Error(`Vansco Stock Watch follow-up could not find: ${label}`);
    if (source.indexOf(before, first + before.length) !== -1) {
      throw new Error(`Vansco Stock Watch follow-up found duplicate anchor: ${label}`);
    }
    source = source.replace(before, after);
  }

  fs.writeFileSync(targetPath, source);
}

patchFile("../services/vanscoStockCache.js", [
  {
    label: "completed refresh percent",
    already: "const complete =\n    Boolean(payload?.complete)",
    before: `  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const stage = payload?.complete ? "complete" : run.stage || fallbackStage;`,
    after: `  const complete =
    Boolean(payload?.complete) ||
    String(run?.status || "").toLowerCase() === "complete" ||
    String(run?.stage || fallbackStage || "").toLowerCase() === "complete";
  const percent = complete ? 100 : total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const stage = complete ? "complete" : run.stage || fallbackStage;`,
  },
  {
    label: "completed refresh progress colour",
    already: "barEl.style.background = complete ?",
    before: `    barEl.style.background = payload?.complete ? "#16a34a" : failed > 0 ? "#f59e0b" : "#2563eb";`,
    after: `    barEl.style.background = complete ? "#16a34a" : failed > 0 ? "#f59e0b" : "#2563eb";`,
  },
]);

patchFile("../pages/VanscoStockWatchPage.jsx", [
  {
    label: "Rent2Buy live Wix and CRM intersection",
    already: "effectiveRegistrations = vehicleRegistrations.filter((registration) => liveRegistrationSet.has(registration));",
    before: `            effectiveRegistrations = (presence.registrations || []).map(normalizeLocalStockRegistration).filter(Boolean);
            const liveRegistrationSet = new Set(effectiveRegistrations);`,
    after: `            const liveRegistrationSet = new Set((presence.registrations || []).map(normalizeLocalStockRegistration).filter(Boolean));
            effectiveRegistrations = vehicleRegistrations.filter((registration) => liveRegistrationSet.has(registration));`,
  },
  {
    label: "five-photo image readiness wording",
    already: "DealerKit now has at least 5 vehicle images",
    before: "If that page still has exactly one image and DealerKit now has multiple vehicle photos, it appears in New DealerKit photos ready.",
    after: "If that page still has exactly one image and DealerKit now has at least 5 vehicle images, it appears in New DealerKit photos ready.",
  },
]);

patchFile("../api/vansco-cache-live-refresh.js", [
  {
    label: "safe Vansco discovery import",
    already: "discoverAllVanscoUrls,",
    before: `  discoverVanscoUrls,\n`,
    after: "",
  },
  {
    label: "safe Vansco snapshot helper import",
    already: `from "./_vansco-url-snapshot-safety.js";`,
    before: `} from "./_vansco-cache-utils.js";\n`,
    after: `} from "./_vansco-cache-utils.js";\nimport {\n  discoverAllVanscoUrls,\n  getPreviousVanscoUrlSnapshot,\n  markConfirmedAbsentVanscoRows,\n} from "./_vansco-url-snapshot-safety.js";\n`,
  },
  {
    label: "safe all-source discovery",
    already: "const discovery = await discoverAllVanscoUrls();",
    before: "const discovery = await discoverVanscoUrls();",
    after: "const discovery = await discoverAllVanscoUrls();",
  },
  {
    label: "previous successful URL snapshot",
    already: "const previousSnapshot = await getPreviousVanscoUrlSnapshot(supabase);",
    before: `  const discovery = await discoverVanscoUrlsWithRetries();\n  const refreshedAt = nowIso();`,
    after: `  const previousSnapshot = await getPreviousVanscoUrlSnapshot(supabase);\n  const discovery = await discoverVanscoUrlsWithRetries();\n  const refreshedAt = nowIso();`,
  },
  {
    label: "two-snapshot stale confirmation",
    already: "const stale = await markConfirmedAbsentVanscoRows(supabase,",
    before: `  const { data: staleRows, error: staleUpdateError } = await supabase\n    .from(CACHE_TABLE)\n    .update({\n      is_currently_on_vansco: false,\n      updated_at: refreshedAt,\n    })\n    .eq("is_currently_on_vansco", true)\n    .lt("last_seen_in_url_list_at", refreshedAt)\n    .select("id");\n\n  if (staleUpdateError) throw staleUpdateError;\n\n  const staleRowsMarked = Array.isArray(staleRows) ? staleRows.length : 0;`,
    after: `  const stale = await markConfirmedAbsentVanscoRows(supabase, {\n    previousSnapshotAt: previousSnapshot.snapshotAt,\n    refreshedAt,\n  });\n  const staleRowsMarked = stale.staleRowsMarked;`,
  },
  {
    label: "stale confirmation diagnostics",
    already: "staleMarkingReason: stale.reason",
    before: `    staleRowsMarked,\n    staleMarkingSkipped: false,\n    usedFallbackCache: false,`,
    after: `    staleRowsMarked,\n    staleMarkingSkipped: stale.staleMarkingSkipped,\n    staleMarkingReason: stale.reason,\n    previousActiveCount: previousSnapshot.activeCount,\n    usedFallbackCache: false,`,
  },
]);

console.log("Applied Vansco Stock Watch follow-ups: completed scans show 100%, Rent2Buy authority is CRM ∩ live Wix, image-readiness uses the five-photo threshold, and URL removals require two successful snapshots.");

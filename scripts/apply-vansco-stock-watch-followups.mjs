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
    already: "Vansco now has at least 5 vehicle images",
    before: "If that page still has exactly one image and Vansco now has multiple vehicle photos, it appears in New Vansco photos ready.",
    after: "If that page still has exactly one image and Vansco now has at least 5 vehicle images, it appears in New Vansco photos ready.",
  },
]);

console.log("Applied Vansco Stock Watch follow-ups: completed scans show 100%, Rent2Buy authority is CRM ∩ live Wix, and image-readiness wording uses the five-photo threshold.");

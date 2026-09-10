import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { retireDuplicateVercelRuntime } from "./scripts/retire-duplicate-vercel-runtime.mjs";
import { probeDealerKitCoverageReadOnly } from "./scripts/dealerkit-phase1-coverage-probe.mjs";

function retireDuplicateVercelRuntimePlugin() {
  return {
    name: "retire-duplicate-vercel-runtime",
    closeBundle() {
      retireDuplicateVercelRuntime();
    },
  };
}

function dealerKitPhase1InspectionPlugin() {
  return {
    name: "dealerkit-phase1-inspection",
    async closeBundle() {
      const isInspectionBranch = process.env.VERCEL_GIT_COMMIT_REF === "feature/dealerkit-phase1-inspection";
      const isPreview = process.env.VERCEL_ENV === "preview";
      if (!isInspectionBranch || !isPreview) return;
      await probeDealerKitCoverageReadOnly();
    },
  };
}

export default defineConfig({
  plugins: [react(), retireDuplicateVercelRuntimePlugin(), dealerKitPhase1InspectionPlugin()],
});
